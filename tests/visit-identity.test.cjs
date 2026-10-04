const assert = require('node:assert/strict')
const { test } = require('node:test')
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm'), ts = require('typescript')
const { migrateVisitIdentity } = require('../scripts/migrate-visit-identity.cjs')

function route(file, { identity = true, payload = { userId: 7 }, admin = true } = {}) {
  const calls = []
  const context = { exports: {}, console: { error() {} }, require: name => ({
    'next/server': { NextResponse: { json: (body, init = {}) => ({ body, status: init.status || 200, headers: init.headers }) } },
    '@/lib/auth': { verifyToken: () => payload, verifyAdminToken: () => admin ? payload : null },
    '@/lib/visit-identity': { visitIdentityEnabled: async () => identity },
    '@/lib/db': { query: async (sql, params) => { calls.push({ sql, params }); return /COUNT/.test(sql) ? [{ count: 2 }] : [] } },
  }[name]) }
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(__dirname, '..', file), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText, context)
  return { exports: context.exports, calls }
}
function request(body = { pagePath: '/caption-generator' }, token = 'signed') {
  return new Request('http://fixture.test/api/track-visit', { method: 'POST',
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}),
      'x-forwarded-for': '203.0.113.1, 192.0.2.1' }, body: JSON.stringify(body) })
}

test('signed-in visits use verified JWT identity, never caller-supplied account or Telegram fields', async () => {
  const f = route('app/api/track-visit/route.ts')
  const response = await f.exports.POST(request({ pagePath: '/caption-generator', user_id: 999, telegram_username: 'spoofed' }))
  assert.equal(response.body.success, true)
  assert.equal(f.calls[0].params[3], 7); assert.equal(f.calls[0].params[1], '203.0.113.1')
  assert.match(f.calls[0].sql, /SELECT id FROM users WHERE id = \?/)
  assert.ok(!f.calls[0].params.includes('spoofed'))
  assert.equal(response.body.user_id, undefined)
})

test('guest, invalid and malformed identities record anonymous visits', async () => {
  for (const payload of [null, { userId: '7' }, { userId: -1 }, { userId: 0 }]) {
    const f = route('app/api/track-visit/route.ts', { payload })
    assert.equal((await f.exports.POST(request())).body.success, true)
    assert.equal(f.calls[0].params[3], null)
  }
  const f = route('app/api/track-visit/route.ts')
  await f.exports.POST(request(undefined, '')); assert.equal(f.calls[0].params[3], null)
})

test('legacy schemas keep recording visits without schema writes', async () => {
  const f = route('app/api/track-visit/route.ts', { identity: false })
  assert.equal((await f.exports.POST(request())).body.success, true)
  assert.equal(f.calls[0].params.length, 3); assert.doesNotMatch(f.calls[0].sql, /user_id|ALTER|CREATE/)
})

test('invalid paths do not reach visit storage', async () => {
  for (const pagePath of [undefined, {}, '//other-host/path', 'https://fixture.test', '/' + 'x'.repeat(255)]) {
    const f = route('app/api/track-visit/route.ts')
    assert.equal((await f.exports.POST(request({ pagePath }))).status, 400)
    assert.equal(f.calls.length, 0)
  }
})

test('only admin requests can read Telegram-linked website logs or prepare the table', async () => {
  for (const file of ['app/api/admin/visits/route.ts', 'app/api/setup-db/route.ts']) {
    let f = route(file)
    assert.equal((await f.exports.GET(new Request('http://fixture.test'))).status, 401)
    assert.equal(f.calls.length, 0)
    f = route(file, { admin: false })
    assert.equal((await f.exports.GET(request())).status, 403); assert.equal(f.calls.length, 0)
  }
})

test('admin visits join account by recorded ID, with no IP or guest identity matching', async () => {
  const f = route('app/api/admin/visits/route.ts')
  const response = await f.exports.GET(request())
  const recent = f.calls.find(c => c.sql.includes('LIMIT 50')).sql
  assert.match(recent, /LEFT JOIN users u ON u.id = v.user_id/)
  assert.match(recent, /u.telegram_username/); assert.doesNotMatch(recent, /u\..*ip_address/)
  assert.equal(response.body.accountTrackingEnabled, true)
  assert.equal(response.headers['Cache-Control'], 'private, no-store')
  const legacy = route('app/api/admin/visits/route.ts', { identity: false })
  assert.equal((await legacy.exports.GET(request())).body.accountTrackingEnabled, false)
  assert.match(legacy.calls.find(c => c.sql.includes('LIMIT 50')).sql, /NULL AS user_id/)
})

function database() {
  let columns = [{ Field: 'id', Null: 'NO' }], indexes = []
  const calls = []
  return { calls, execute: async (sql, params) => {
    calls.push(sql)
    if (sql === 'SHOW COLUMNS FROM website_visits') return [columns]
    if (sql.startsWith('SHOW COLUMNS FROM users')) return [[{ Type: 'int(11)' }]]
    if (sql === 'SHOW INDEX FROM website_visits') return [indexes]
    if (sql === 'SHOW CREATE TABLE website_visits') return [[{ 'Create Table': 'fixture schema' }]]
    if (sql.includes('ADD COLUMN')) columns = [...columns, { Field: 'user_id', Null: 'YES' }]
    if (sql.includes('ADD INDEX')) indexes = [{ Column_name: 'user_id', Seq_in_index: 1 }]
    return [[]]
  } }
}

test('identity migration is read-only by default, additive on apply, backed up and idempotent', async () => {
  const db = database()
  let report = await migrateVisitIdentity(db)
  assert.equal(report.statements.length, 2); assert.ok(!db.calls.some(sql => sql.startsWith('ALTER')))
  let backedUp = false
  report = await migrateVisitIdentity(db, { apply: true, backup: async () => { backedUp = true } })
  assert.equal(backedUp, true); assert.equal(report.applied, true)
  assert.equal(db.calls.filter(sql => sql.startsWith('ALTER')).length, 2)
  assert.ok(!db.calls.some(sql => /UPDATE|DELETE|DROP|INSERT/.test(sql)))
  report = await migrateVisitIdentity(db, { apply: true })
  assert.equal(report.alreadyReady, true); assert.equal(report.statements.length, 0)
})

test('client attaches auth when available and admin table distinguishes guests and unlinked accounts', () => {
  const tracker = fs.readFileSync(path.join(__dirname, '../components/visit-tracker.tsx'), 'utf8')
  assert.match(tracker, /Authorization: `Bearer \$\{token\}`/)
  const table = fs.readFileSync(path.join(__dirname, '../components/admin/visits-tab.tsx'), 'utf8')
  assert.match(table, /Visitor \/ Telegram/); assert.match(table, /Guest \/ historical visit/)
  assert.match(table, /Telegram not linked/); assert.match(table, /colSpan=\{5\}/)
})
