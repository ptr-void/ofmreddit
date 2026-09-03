const assert = require('node:assert/strict')
const { test } = require('node:test')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const ts = require('typescript')

function load(relative, dependencies, env = {}) {
  const code = ts.transpileModule(fs.readFileSync(path.join(__dirname, '..', relative), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText
  const context = { exports: {}, process: { env }, console, require: name => {
    if (!(name in dependencies)) throw new Error(`Unexpected import ${name}`)
    return dependencies[name]
  } }
  vm.runInNewContext(code, context)
  return context.exports
}
const next = { NextResponse: { json: (body, init = {}) => ({ body, status: init.status || 200 }) } }
const display = load('lib/reddit-database-display.ts', {})
const request = body => new Request('https://example.test/api/admin/pending', {
  method: 'POST', headers: { authorization: 'Bearer fixture', 'Content-Type': 'application/json' }, body: JSON.stringify(body),
})

test('archived communities stay excluded even with an approved DB mirror or a stale sheet snapshot', async () => {
  const route = load('app/api/reddit-database/route.ts', {
    'next/server': next,
    '@/lib/db': { query: async sql => sql.includes('subreddit_maintenance') ? [{ subreddit_name: 'db_archived' }] : [
      { subreddit_name: 'sheet_archived', subscribers: 999 }, { subreddit_name: 'db_archived', subscribers: 999 }, { subreddit_name: 'live' },
    ] },
    '@/lib/reddit-database-display': display,
    '@/lib/google-sheets-reader': {
      parseSpreadsheetUrl: () => ({ spreadsheetId: 'fixture', gid: '0' }),
      createWorkbookReader: async () => ({ readByGid: async () => ({
        title: 'Sheet1', headers: ['Subreddit', 'Link', 'Total Members', 'Sync Status'],
        rows: [['Live', '', '100', 'success'], ['Sheet_Archived', '', '123', 'archived'], ['DB_Archived', '', '456', 'success']],
      }) }),
    },
  }, { SUBREDDIT_SHEET_URL: 'fixture' })
  const response = await route.GET()
  assert.equal(response.status, 200)
  assert.equal(response.body.mainSheet.rows.length, 1)
  assert.equal(response.body.mainSheet.rows[0][1], '100')
})

test('review reads and writes require admin authentication before any DB access', async () => {
  const route = load('app/api/admin/pending/route.ts', {
    'next/server': next, '@/lib/auth': { verifyAdminToken: () => null },
    '@/lib/db': { query: () => { throw Error('unexpected DB access') }, getPool: () => { throw Error('unexpected DB access') } },
  })
  assert.equal((await route.GET(new Request('https://example.test'))).status, 401)
  assert.equal((await route.POST(request({ action: 'approve', id: 1 }))).status, 401)
})

function adminFixture({ locked = true, state = 'active' } = {}) {
  const statements = []
  const connection = {
    query: async sql => { statements.push(sql); return [[{ acquired: locked ? 1 : 0 }]] },
    execute: async (sql, params) => {
      statements.push([sql, params])
      if (sql.startsWith('SELECT subreddit_name')) return [[{ subreddit_name: 'Example', status: 'pending' }]]
      if (sql.startsWith('SELECT state')) return [[{ state }]]
      return [[]]
    },
    beginTransaction: async () => statements.push('begin'), commit: async () => statements.push('commit'),
    rollback: async () => statements.push('rollback'), release: () => statements.push('release'),
  }
  return { statements, route: load('app/api/admin/pending/route.ts', {
    'next/server': next, '@/lib/auth': { verifyAdminToken: () => ({ userId: 1, isAdmin: true }) },
    '@/lib/db': { getPool: () => ({ getConnection: async () => connection }) },
  }) }
}

test('approve queues one sheet addition, never publishes before worker verification', async () => {
  const { route, statements } = adminFixture()
  const response = await route.POST(request({ action: 'approve', id: 1 }))
  assert.equal(response.status, 200)
  assert.equal(response.body.queued, true)
  const sql = JSON.stringify(statements)
  assert.match(sql, /requested_action='add'/)
  assert.doesNotMatch(sql, /SET status='approved'/)
  assert.ok(statements.includes('commit'))
  assert.equal(statements.at(-1), 'release')
})

test('restore is queued, and reject preserves a durable human decision', async () => {
  let fixture = adminFixture({ state: 'archived' })
  let response = await fixture.route.POST(request({ action: 'restore', subreddit: 'example' }))
  assert.equal(response.body.queued, true)
  assert.match(JSON.stringify(fixture.statements), /requested_action='restore'/)
  fixture = adminFixture()
  response = await fixture.route.POST(request({ action: 'reject', id: 1 }))
  assert.equal(response.body.queued, false)
  assert.match(JSON.stringify(fixture.statements), /SET status='rejected'/)
})

test('invalid actions and competing worker locks cannot mutate the queue', async () => {
  let fixture = adminFixture()
  assert.equal((await fixture.route.POST(request({ action: 'delete', id: 1 }))).status, 400)
  assert.equal((await fixture.route.POST(request(null))).status, 400)
  assert.equal(fixture.statements.length, 0)
  fixture = adminFixture({ locked: false })
  assert.equal((await fixture.route.POST(request({ action: 'approve', id: 1 }))).status, 409)
  assert.ok(!fixture.statements.includes('begin'))
  fixture = adminFixture({ state: 'archived' })
  assert.equal((await fixture.route.POST(request({ action: 'approve', id: 1 }))).status, 409)
  assert.ok(fixture.statements.includes('rollback'))
})
