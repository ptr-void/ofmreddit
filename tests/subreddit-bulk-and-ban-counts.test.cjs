const assert = require('node:assert/strict'), { test } = require('node:test')
const fs = require('node:fs'), vm = require('node:vm'), ts = require('typescript')
function load(file, deps = {}, globals = {}) {
  const context = { exports: {}, URL, AbortSignal, console, process: {env:{SUBREDDIT_SHEET_URL:'fixture'}}, ...globals,
    require: name => { if (!(name in deps)) throw Error('Unexpected import '+name); return deps[name] } }
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText,context)
  return context.exports
}
const names = load('lib/subreddit-submissions.ts')
const next = {NextResponse:{json:(body,init={})=>({body,status:init.status||200})}}
const plain = value => JSON.parse(JSON.stringify(value))

test('pasted names, links, CRLF, commas, spaces, semicolons and bullets normalize and deduplicate',()=>{
  const parsed=names.parseSubredditList('Foo\r\nr/foo, /r/Bar; https://old.reddit.com/r/Bar/top/?t=week\n- baz\n2. https://www.reddit.com/r/qux/ aaa BBB')
  assert.deepEqual(plain(parsed.items.map(x=>x.name)),['foo','bar','baz','qux','aaa','bbb'])
  assert.equal(parsed.duplicates,2)
  assert.deepEqual(plain(names.parseSubredditList(['r/foo','FOO','r/bar']).items.map(x=>x.name)),['foo','bar'])
})
test('foreign URLs, usernames, encoded or malformed paths and invalid names stay visible as invalid',()=>{
  for(const input of ['https://evil.test/r/foo','https://reddit.com.evil.test/r/foo','https://www.reddit.com/user/foo','foo-bar','r/a','https://reddit.com/r/a%2fb/','x'.repeat(22)])
    assert.equal(names.submissionName(input),null,input)
  assert.equal(names.parseSubredditList('foo invalid-name bar').items.length,3)
})

function routeFixture({ statuses={}, saved={}, auth=true, sheetFailure=false }={}) {
  const calls=[],saves=[],oauth=[]
  const route=load('app/api/subreddits/submit/route.ts',{
    'next/server':next, '@/lib/auth':{verifyToken:()=>auth?{userId:7}:null},
    '@/lib/niche-presets':{validateNicheTags:async value=>value?{ok:true,value:'general'}:{ok:false,error:'Select niche tags'}},
    '@/lib/reddit-oauth':{getRedditAccessToken:async()=>{oauth.push(1);return 'fixture'}},
    '@/lib/subreddit-submissions':names,
    '@/lib/subreddit-submission-store':{queueSubredditSubmission:async(...args)=>{saves.push(args);if(saved[args[0]]==='error')throw Error('DB failure');return saved[args[0]]||'submitted'}},
    '@/lib/reddit-database-display':{subredditKey:v=>v.toLowerCase()},
    '@/lib/google-sheets-reader':{parseSpreadsheetUrl:()=>({spreadsheetId:'fixture',gid:'0'}),createWorkbookReader:async()=>({readByGid:async()=>{
      if(sheetFailure)throw Error('Sheet failure')
      return {headers:['Subreddit','Sync Status'],rows:[['existing','success'],['archived','archived']]}
    }})},
  },{fetch:async(url,options)=>{
    const name=/\/r\/([^/]+)\/about/.exec(url)[1];calls.push({name,options})
    if(statuses[name]==='timeout')throw new DOMException('Timed out','TimeoutError')
    const status=Number(statuses[name])||200
    return {ok:status===200,status,json:async()=>({data:statuses[name]==='incomplete'?{}:{over18:statuses[name]!=='sfw',display_name:statuses[name]==='mismatch'?'different':name,subscribers:123}})}
  }})
  const request=(body,token='fixture')=>new Request('https://test/api/subreddits/submit',{method:'POST',headers:{authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify(body)})
  return {route,calls,saves,oauth,request}
}
test('bulk API queues valid names independently, skips curated rows and preserves per-name failures',async()=>{
  const f=routeFixture({statuses:{missing:404,sfw:'sfw'}})
  const response=await f.route.POST(f.request({subreddits:['Foo','r/foo','existing','missing','sfw','invalid-name'],tags:'general'}))
  assert.equal(response.status,200)
  assert.deepEqual(plain(response.body.results.map(x=>[x.name,x.status])),[['foo','submitted'],['existing','existing'],['missing','invalid'],['sfw','invalid'],[null,'invalid']])
  assert.equal(response.body.duplicates,1);assert.equal(f.oauth.length,1)
  assert.deepEqual(plain(f.saves),[['foo','general',123,7]])
  assert.ok(f.calls.every(x=>x.options.signal instanceof AbortSignal))
})
test('single-name API compatibility, preset validation, JSON shape, size and authentication gates',async()=>{
  const f=routeFixture()
  assert.equal((await f.route.POST(f.request({subreddit:'foo',tags:'general'}))).body.results[0].status,'submitted')
  for(const body of [null,{subreddits:{name:'foo'}},{subreddits:[42]},{subreddits:[]},{subreddit:'foo',tags:''},
    {subreddits:['aa','bb','cc','dd','ee','ff'],tags:'general'},{subreddit:'x'.repeat(16001),tags:'general'}])
    assert.equal((await f.route.POST(f.request(body))).status,400)
  const unauthorized=routeFixture({auth:false})
  assert.equal((await unauthorized.route.POST(unauthorized.request({subreddit:'foo',tags:'general'}))).status,401)
  assert.equal(unauthorized.calls.length,0);assert.equal(unauthorized.saves.length,0)
})
test('rate limits stop further Reddit checks in the batch without losing successes or marking a ban',async()=>{
  const f=routeFixture({statuses:{second:429}})
  const response=await f.route.POST(f.request({subreddits:['first','second','third'],tags:'general'}))
  assert.deepEqual(plain(response.body.results.map(x=>x.status)),['submitted','failed','failed'])
  assert.equal(response.body.results[1].retryable,true);assert.equal(response.body.results[2].retryable,true)
  assert.equal(f.calls.length,2);assert.equal(f.saves.length,1)
})
test('private, provider timeout, malformed identity and DB failures are per-name and retryable',async()=>{
  const f=routeFixture({statuses:{private:403,timeout:'timeout',wrong:'mismatch',bad:'incomplete'},saved:{db:'error'}})
  const response=await f.route.POST(f.request({subreddits:['private','timeout','wrong','bad','db'],tags:'general'}))
  assert.ok(response.body.results.every(x=>x.status==='failed'&&x.retryable))
  assert.equal(response.body.success,false)
  const down=routeFixture({sheetFailure:true})
  assert.equal((await down.route.POST(down.request({subreddit:'foo',tags:'general'}))).status,503)
  assert.equal(down.saves.length,0)
})
test('approved, rejected and archived statuses are not claimed to be newly queued',async()=>{
  const f=routeFixture({saved:{approved:'existing',denied:'rejected',archived:'archived'}})
  const response=await f.route.POST(f.request({subreddits:['approved','denied','archived'],tags:'general'}))
  assert.deepEqual(plain(response.body.results.map(x=>x.status)),['existing','rejected','archived'])
})

function storeFixture({state='active',status='pending',attempt=false,failAttribution=false}={}){
  const statements=[]
  const connection={beginTransaction:async()=>statements.push('begin'),rollback:async()=>statements.push('rollback'),
    commit:async()=>statements.push('commit'),release:()=>statements.push('release'),execute:async(sql,params)=>{
      statements.push([sql,params])
      if(sql.startsWith('SELECT state'))return [[{state}]]
      if(sql.startsWith('SELECT status'))return [[{status}]]
      if(sql.startsWith('SELECT user_id'))return [attempt?[{user_id:7}]:[]]
      if(failAttribution&&sql.startsWith('INSERT INTO subreddit_submission_attempts'))throw Error('fixture failure')
      return [[]]
    }}
  const store=load('lib/subreddit-submission-store.ts',{'@/lib/db':{getPool:()=>({getConnection:async()=>connection})}})
  return {store,statements}
}
test('queue item and submission attribution commit together; retries preserve idempotent reward attribution',async()=>{
  for(const attempt of [false,true]){
    const f=storeFixture({attempt})
    assert.equal(await f.store.queueSubredditSubmission('foo','general',123,7),attempt?'pending':'submitted')
    assert.ok(f.statements.includes('commit'));assert.equal(f.statements.at(-1),'release')
    const insert=f.statements.find(x=>Array.isArray(x)&&x[0].startsWith('INSERT INTO subreddit_submission_attempts'))
    assert.deepEqual(plain(insert[1]),['foo',7,'general']);assert.match(insert[0],/ON DUPLICATE KEY UPDATE/)
    assert.doesNotMatch(insert[0],/rewarded_at\s*=/)
  }
  const failure=storeFixture({failAttribution:true})
  await assert.rejects(()=>failure.store.queueSubredditSubmission('foo','general',123,7))
  assert.ok(failure.statements.includes('rollback'));assert.ok(!failure.statements.includes('commit'))
})
test('stored admin rejection, approval and archival are preserved in the locked transaction',async()=>{
  for(const [config,want] of [[{state:'archived'},'archived'],[{status:'rejected'},'rejected'],[{status:'approved'},'existing']]){
    const f=storeFixture(config)
    assert.equal(await f.store.queueSubredditSubmission('foo','general',123,7),want)
    assert.ok(f.statements.includes('rollback'));assert.ok(!f.statements.includes('commit'))
    assert.ok(!f.statements.some(x=>Array.isArray(x)&&x[0].startsWith('INSERT INTO subreddit_submission_attempts')))
  }
})
test('ban counters use unique explicit-ban ledger names and exact UTC day/seven-day boundaries',async()=>{
  const calls=[]
  const module=load('lib/subreddit-ban-counts.ts',{'@/lib/db':{query:async(sql,params)=>{calls.push([sql,params]);return [{today:'2',last7Days:'7'}]}}})
  const now=new Date('2026-10-10T04:05:06Z'),counts=await module.getBanDetectionCounts(now)
  assert.equal(counts.today,2);assert.equal(counts.last7Days,7);assert.equal(counts.timezone,'UTC')
  assert.equal(counts.todayStart,'2026-10-10T00:00:00.000Z');assert.equal(counts.weekStart,'2026-10-03T04:05:06.000Z')
  assert.match(calls[0][0],/COUNT\(DISTINCT/);assert.match(calls[0][0],/action = 'banned_detected'/)
  assert.match(calls[0][0],/FROM_UNIXTIME/)
  assert.deepEqual(plain(calls[0][1]),[Date.parse(counts.todayStart)/1000,Date.parse(counts.weekStart)/1000,now.getTime()/1000])
})
test('bad or unavailable counts are errors rather than fabricated zeros',async()=>{
  for(const values of [[],[{today:-1,last7Days:4}],[{today:'invalid',last7Days:4}],[{today:null,last7Days:4}],[{today:5,last7Days:4}]]){
    const module=load('lib/subreddit-ban-counts.ts',{'@/lib/db':{query:async()=>values}})
    await assert.rejects(()=>module.getBanDetectionCounts())
  }
})
