const assert = require('node:assert/strict'), { test } = require('node:test')
const fs = require('node:fs'), vm = require('node:vm'), ts = require('typescript')
const { migrateCaptionAccess } = require('../scripts/migrate-caption-access.cjs')
function load(file, dependencies) {
  const context = { exports: {}, console: { error() {} }, process: { env: {} }, require: name => {
    if (name in dependencies) return dependencies[name]
    throw Error('Unexpected dependency ' + name)
  } }
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true,
  } }).outputText, context)
  return context.exports
}
test('access uses persisted switch and current database admin status, not JWT roles', async () => {
  let enabled = 0, admin = 0, exists = true, configured = true
  const helper = load('lib/caption-access.ts', { '@/lib/db': { queryOne: async sql =>
    sql.includes('information_schema') ? { count: configured ? 1 : 0 } : sql.includes('is_admin')
      ? exists ? { is_admin: admin } : null : { caption_generation_enabled: enabled } } })
  assert.equal((await helper.captionAccessForUser(5)).allowed, false)
  admin = 1; assert.equal((await helper.captionAccessForUser(5)).allowed, true)
  admin = 0; enabled = 1; assert.equal((await helper.captionAccessForUser(5)).allowed, true)
  enabled = 0; assert.equal((await helper.captionAccessForUser(5)).allowed, false)
  configured = false; assert.equal((await helper.captionAccessForUser(5)).allowed, true)
  exists = false; assert.equal((await helper.captionAccessForUser(5)).allowed, false)
})
test('only database admins save boolean switches, preserving other site settings', async () => {
  let admin = 0, configured = true, enabled = true
  const writes = []
  const route = load('app/api/admin/caption-access/route.ts', {
    'next/server': { NextResponse: { json: (body, init = {}) => ({ body, status: init.status || 200, headers: init.headers }) } },
    '@/lib/auth': { verifyToken: () => ({ userId: 5, isAdmin: true }) },
    '@/lib/db': { queryOne: async () => ({ is_admin: admin }), query: async (sql, params) => { writes.push(sql); enabled = params[0] === 1 } },
    '@/lib/caption-access': { readCaptionAccess: async () => ({ configured, enabled }) },
  })
  const req = value => new Request('http://fixture.test', { method: 'PUT', headers: { authorization: 'Bearer test', 'content-type': 'application/json' }, body: JSON.stringify({ enabled: value }) })
  assert.equal((await route.PUT(req(false))).status, 403); assert.equal(writes.length, 0)
  admin = 1
  for (const value of [0, 1, 'false', null]) assert.equal((await route.PUT(req(value))).status, 400)
  assert.equal(writes.length, 0)
  configured = false; assert.equal((await route.PUT(req(false))).status, 503); assert.equal(writes.length, 0)
  configured = true; const response = await route.PUT(req(false))
  assert.equal(response.status, 200); assert.equal(response.body.enabled, false)
  assert.equal(response.headers['Cache-Control'], 'private, no-store')
  assert.ok(writes.every(sql => !/show_sub|cooldown|ALTER|CREATE/i.test(sql)))
})
test('paused image analysis stops before parsing image data, prompts or provider requests', async () => {
  let touched = false
  const route = load('app/api/analyze-image/route.ts', {
    'next/server': { NextResponse: { json: (body, init = {}) => ({ body, status: init.status || 200 }) } },
    '@/lib/auth': { verifyToken: () => ({ userId: 5 }) },
    '@/lib/db': { query: async () => { touched = true; throw Error('Unexpected query') } },
    '@/lib/caption-access': { captionAccessForUser: async () => ({ allowed: false }), CAPTION_PAUSED_MESSAGE: 'Paused' },
  })
  const response = await route.POST({ headers: new Headers({ authorization: 'Bearer test' }), json: async () => { touched = true; throw Error('Unexpected body read') } })
  assert.equal(response.status, 403); assert.equal(response.body.code, 'CAPTION_ACCESS_PAUSED'); assert.equal(touched, false)
})
test('migration defaults to read-only, backs up before additive apply, and repeats without changing switch', async () => {
  let exists = false, backedUp = false; const calls = []
  const db = { execute: async sql => {
    calls.push(sql)
    if (sql.startsWith('SHOW COLUMNS')) return [exists ? [{ Field: 'caption_generation_enabled', Default: '1' }] : []]
    if (sql.startsWith('SHOW CREATE')) return [{ schema: 'fixture' }]
    assert.ok(backedUp); exists = true; return [[]]
  } }
  const plan = await migrateCaptionAccess(db); assert.equal(plan.statements.length, 1); assert.equal(exists, false)
  await migrateCaptionAccess(db, { apply: true, backup: async () => { backedUp = true } })
  assert.equal(exists, true)
  assert.equal((await migrateCaptionAccess(db, { apply: true })).statements.length, 0)
  assert.equal(calls.filter(sql => sql.startsWith('ALTER')).length, 1)
  assert.ok(!calls.some(sql => /UPDATE|DELETE|DROP/i.test(sql)))
})
