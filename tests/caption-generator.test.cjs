const assert = require('node:assert/strict')
const { test } = require('node:test')
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm'), ts = require('typescript')
const source = fs.readFileSync(path.join(__dirname, '../app/api/caption-generator/route.ts'), 'utf8')
function fixture({ authenticated = true, brokenDocument = false, output, finishReason, thought, model, statuses = [], retryAfter, fetchError } = {}) {
  const calls = [], documents = [1,2,3].map(id => ({id,filename:`knowledge-${id}.docx`,cloudinary_url:`https://files.test/${id}`,file_type:'docx',file_size:20}))
  const dependencies = {
    'next/server': {NextResponse:{json:(body,init={})=>({body,status:init.status||200})}},
    '@/lib/auth': {verifyToken:()=>authenticated ? {userId:1}:null},
    '@/lib/db': {queryOne:async()=>({id:1,prompt_text:'ADMIN_PROMPT: produce five captions'}),query:async()=>documents},
    '@xmldom/xmldom': require('@xmldom/xmldom'),
    'node:timers/promises': {setTimeout:async()=>{}},
    mammoth:{extractRawText:async({buffer})=>({value:`EXTRACTED:${buffer.toString()}`})},
  }
  const context = {exports:{},Buffer,AbortSignal,process:{env:{GEMINI_API_KEY:'fixture-key', ...(model ? {CAPTION_GEMINI_MODEL:model} : {})}},console:{error:()=>{}},
    require:name=>dependencies[name],fetch:async(url,options)=>{
      calls.push({url,options})
      if (url.startsWith('https://files.test/')) return {ok:!brokenDocument,status:brokenDocument?404:200,arrayBuffer:async()=>Buffer.from(`FILE-${url.split('/').pop()}`)}
      if (fetchError) throw fetchError
      const status = statuses.shift() || 200
      if (status !== 200) return {ok:false,status,headers:{get:()=>retryAfter||null},body:{cancel:async()=>{}}}
      return {ok:true,status,headers:{get:()=>null},json:async()=>({candidates:[{finishReason,content:{parts:[...(thought ? [{thought:true,text:thought}] : []),{text:output ?? JSON.stringify({caption_results:Array.from({length:5},(_,i)=>({option:`Option ${i+1}`,text:`Fitness caption ${i+1}`}))})}]}}]})}
    }}
  vm.runInNewContext(ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020,esModuleInterop:true}}).outputText,context)
  return {route:context.exports,calls}
}
const request=()=>new Request('http://fixture.test/api/caption-generator',{method:'POST',headers:{authorization:'Bearer fixture','content-type':'application/json'},body:JSON.stringify({posts:[{id:'post_001',gender:'female',niche_features:['fitness'],degen_scale:0,interactive_mode:'OFF',visual_context:'gym selfie',content_type:'Picture'}]})})

test('caption request includes the saved admin instructions and all three extracted documents',async()=>{
  const {route,calls}=fixture();const response=await route.POST(request())
  assert.equal(response.status,200);assert.equal(response.body.captions.length,5)
  assert.equal(response.body.meta.knowledgeDocuments,3);assert.equal(response.body.meta.promptSource,'admin')
  const api=calls.find(call=>call.url.includes('generativelanguage.googleapis.com'))
  const payload=JSON.parse(api.options.body)
  assert.equal(payload.systemInstruction.parts[0].text,'ADMIN_PROMPT: produce five captions')
  assert.ok(api.url.includes('gemini-3.8-flash:generateContent'))
  assert.equal(payload.generationConfig.thinkingConfig.thinkingLevel,'medium')
  assert.equal(payload.generationConfig.temperature,undefined)
  assert.equal(payload.generationConfig.responseSchema,undefined)
  assert.equal(payload.generationConfig.thinkingConfig.thinkingBudget,undefined)
  const parts=payload.contents[0].parts.map(part=>part.text).join('\n')
  for (let id=1;id<=3;id++) assert.match(parts,new RegExp(`EXTRACTED:FILE-${id}`))
  assert.match(parts,/<request_data>/);assert.match(parts,/post_001/)
})

test('failed knowledge downloads stop generation instead of silently omitting a document',async()=>{
  const {route,calls}=fixture({brokenDocument:true});const response=await route.POST(request())
  assert.equal(response.status,500)
  assert.ok(!calls.some(call=>call.url.includes('generativelanguage.googleapis.com')))
})

test('unauthenticated caption requests never fetch knowledge or call Gemini',async()=>{
  const {route,calls}=fixture({authenticated:false});const response=await route.POST(request())
  assert.equal(response.status,401);assert.equal(calls.length,0)
})

const xml = (id = 'post_001', count = 5) => `<caption_results><post id="${id}">${Array.from({length:count}, (_,i)=>`<caption>Fitness &amp; confidence ${i+1} 💪</caption>`).join('')}</post></caption_results>`
test('native Gem XML becomes caption cards without rewriting text or losing emojis',async()=>{
  const {route}=fixture({output:xml(),thought:'Private reasoning not displayed'})
  const response=await route.POST(request())
  assert.equal(response.status,200);assert.equal(response.body.captions.length,5)
  assert.equal(response.body.captions[0].text,'Fitness & confidence 1 💪')
  assert.equal(response.body.rawOutput,xml());assert.equal(response.body.meta.model,'gemini-3.8-flash')
})
test('Gem plain-line XML also works',async()=>{
  const output='<caption_results>\n'+Array.from({length:5},(_,i)=>`Gym caption ${i+1} 💪`).join('\n')+'\n</caption_results>'
  const {route}=fixture({output});assert.equal((await route.POST(request())).body.captions.length,5)
})
test('wrong post IDs, incomplete counts, malformed XML and DTDs never become caption cards',async()=>{
  for (const output of [xml('another_post'),xml('post_001',4),'<caption_results><caption>Broken</caption_results>',
    '<!DOCTYPE caption_results [<!ENTITY x SYSTEM "file:///secret">]>'+xml()]) {
    const {route}=fixture({output});assert.equal((await route.POST(request())).status,502)
  }
})
test('truncated responses are surfaced rather than accepted as successful captions',async()=>{
  const {route}=fixture({output:xml(),finishReason:'MAX_TOKENS'});assert.equal((await route.POST(request())).status,502)
})
test('UI feature strings and interactive toggles map to the Gem input contract',async()=>{
  const {route,calls}=fixture()
  const req=new Request('http://fixture.test',{method:'POST',headers:{authorization:'Bearer fixture','content-type':'application/json'},body:JSON.stringify({physicalFeatures:'blonde, fitness',isInteractive:true,visualContext:'gym selfie',contentType:'picture'})})
  assert.equal((await route.POST(req)).status,200)
  const payload=JSON.parse(calls.find(call=>call.url.includes('generativelanguage.googleapis.com')).options.body)
  const block=payload.contents[0].parts.at(-1).text
  const input=JSON.parse(block.replace(/<\/?request_data>/g,''))
  assert.deepEqual(input.posts[0].niche_features,['blonde','fitness'])
  assert.equal(input.posts[0].clickbait_style,'y');assert.equal(input.posts[0].interactive_mode,'ON')
  assert.equal(input.posts[0].content_type,'Picture')
})

test('temporary model errors retry the same request and model',async()=>{
  const {route,calls}=fixture({statuses:[503,503,200],output:xml()})
  assert.equal((await route.POST(request())).status,200)
  const generations=calls.filter(call=>call.url.includes('generativelanguage.googleapis.com'))
  assert.equal(generations.length,3)
  assert.ok(generations.every(call=>call.url===generations[0].url && call.options.body===generations[0].options.body))
})
test('persistent overload and long cooldowns surface useful errors without model fallback',async()=>{
  let fixtureCase=fixture({statuses:[503,503,503,503]})
  let response=await fixtureCase.route.POST(request())
  assert.equal(response.status,503);assert.equal(response.body.model,'gemini-3.8-flash')
  fixtureCase=fixture({statuses:[429],retryAfter:'120'})
  response=await fixtureCase.route.POST(request())
  assert.equal(response.status,429)
  assert.equal(response.body.retryAfterSeconds,120);assert.equal(response.body.retryable,true)
  assert.equal(fixtureCase.calls.filter(call=>call.url.includes('generativelanguage.googleapis.com')).length,1)
})
test('quick mode does not inject unused advanced-form defaults into Gem input',async()=>{
  const {route,calls}=fixture()
  const req=new Request('http://fixture.test',{method:'POST',headers:{authorization:'Bearer fixture','content-type':'application/json'},body:JSON.stringify({mode:'quick',physicalFeatures:'fitness',visualContext:'gym selfie',creativeStyle:'fantasy',subredditType:'generalist'})})
  assert.equal((await route.POST(req)).status,200)
  const payload=JSON.parse(calls.find(call=>call.url.includes('generativelanguage.googleapis.com')).options.body)
  const input=JSON.parse(payload.contents[0].parts.at(-1).text.replace(/<\/?request_data>/g,''))
  assert.equal(input.posts[0].creative_style,undefined)
  assert.equal(input.posts[0].subreddit_type,undefined)
})

test('generation timeouts return a retryable status rather than a generic server error',async()=>{
  const {route}=fixture({fetchError:new DOMException('Timed out','TimeoutError')})
  const response=await route.POST(request())
  assert.equal(response.status,504);assert.match(response.body.error,/timed out/)
})

test('a fourth attempt can recover an overload, while non-transient errors are not retried',async()=>{
  let f=fixture({statuses:[503,503,503,200],output:xml()})
  let response=await f.route.POST(request())
  assert.equal(response.status,200);assert.equal(response.body.meta.attempts,4)
  assert.equal(f.route.maxDuration,90)
  f=fixture({statuses:[400]});response=await f.route.POST(request())
  assert.equal(response.body.retryable,false)
  assert.equal(f.calls.filter(call=>call.url.includes('generativelanguage.googleapis.com')).length,1)
  f=fixture({statuses:[408,200],output:xml()});assert.equal((await f.route.POST(request())).status,200)
})
test('caption UI keeps provider failures distinct from invalid-input feedback',()=>{
  const page=fs.readFileSync(path.join(__dirname,'../app/caption-generator/page.tsx'),'utf8')
  const generate=page.slice(page.indexOf('const handleGenerateCaptions'),page.indexOf('const handleClearCaptions'))
  assert.match(generate,/errorData.retryable/);assert.match(generate,/Retry in/)
  assert.match(generate,/your inputs are unchanged/)
})
