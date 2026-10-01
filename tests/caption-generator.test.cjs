const assert = require('node:assert/strict')
const { test } = require('node:test')
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm'), ts = require('typescript')
const source = fs.readFileSync(path.join(__dirname, '../app/api/caption-generator/route.ts'), 'utf8')
function fixture({ authenticated = true, brokenDocument = false } = {}) {
  const calls = [], documents = [1,2,3].map(id => ({id,filename:`knowledge-${id}.docx`,cloudinary_url:`https://files.test/${id}`,file_type:'docx',file_size:20}))
  const dependencies = {
    'next/server': {NextResponse:{json:(body,init={})=>({body,status:init.status||200})}},
    '@/lib/auth': {verifyToken:()=>authenticated ? {userId:1}:null},
    '@/lib/db': {queryOne:async()=>({id:1,prompt_text:'ADMIN_PROMPT: produce five captions'}),query:async()=>documents},
    mammoth:{extractRawText:async({buffer})=>({value:`EXTRACTED:${buffer.toString()}`})},
  }
  const context = {exports:{},Buffer,AbortSignal,process:{env:{GEMINI_API_KEY:'fixture-key'}},console:{error:()=>{}},
    require:name=>dependencies[name],fetch:async(url,options)=>{
      calls.push({url,options})
      if (url.startsWith('https://files.test/')) return {ok:!brokenDocument,status:brokenDocument?404:200,arrayBuffer:async()=>Buffer.from(`FILE-${url.split('/').pop()}`)}
      return {ok:true,json:async()=>({candidates:[{content:{parts:[{text:JSON.stringify({caption_results:Array.from({length:5},(_,i)=>({option:`Option ${i+1}`,text:`Fitness caption ${i+1}`}))})}]}}]})}
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
  assert.match(payload.systemInstruction.parts[0].text,/ADMIN_PROMPT/)
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
