const assert = require("node:assert/strict")
const { test } = require("node:test")
const fs = require("node:fs")
const path = require("node:path")
const vm = require("node:vm")
const ts = require("typescript")

function load(relative, dependencies, globals = {}) {
  const code = ts.transpileModule(fs.readFileSync(path.join(__dirname, "..", relative), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText
  const context = {
    exports: {}, console, ...globals,
    require: name => {
      if (!(name in dependencies)) throw new Error(`Unexpected import ${name}`)
      return dependencies[name]
    },
  }
  vm.runInNewContext(code, context)
  return context.exports
}

const next = { NextResponse: { json: (body, init = {}) => ({ body, status: init.status || 200 }) } }

test("direct submissions require authentication and niche tags, then attribute the submitter", async () => {
  const statements = []
  const route = load("app/api/subreddits/submit/route.ts", {
    "next/server": next,
    "@/lib/auth": { verifyToken: token => token === "valid" ? { userId: 7 } : null },
    "@/lib/db": { query: async (sql, params) => { statements.push([sql, params]); return [] } },
  }, {
    fetch: async () => ({ ok: true, json: async () => ({ data: { over18: true, subscribers: 123 } }) }),
  })
  const make = body => new Request("https://example.test/api/subreddits/submit", {
    method: "POST",
    headers: { authorization: "Bearer valid", "Content-Type": "application/json" },
    body: JSON.stringify(body),
  })

  assert.equal((await route.POST(make({ subreddit: "example", tags: "" }))).status, 400)
  assert.equal(statements.length, 0)
  const response = await route.POST(make({ subreddit: "Example", tags: "fitness" }))
  assert.equal(response.status, 200)
  assert.equal(statements.length, 2)
  assert.match(statements[1][0], /subreddit_submission_attempts/)
  assert.deepEqual(Array.from(statements[1][1]), ["example", 7, "fitness", "example"])
})

test("checker bonus usage is consumed atomically only after the daily allowance", async () => {
  const statements = []
  const connection = {
    beginTransaction: async () => statements.push("begin"),
    rollback: async () => statements.push("rollback"),
    commit: async () => statements.push("commit"),
    release: () => statements.push("release"),
    execute: async (sql, params) => {
      statements.push([sql, params])
      if (sql.includes("SELECT custom_subreddit_checker_limit")) {
        return [[{ custom_subreddit_checker_limit: 1, subreddit_checker_credits: 1 }]]
      }
      if (sql.includes("SELECT COUNT(*)")) return [[{ count: 1 }]]
      return [[]]
    },
  }
  const limits = load("lib/limits.ts", {
    "@/lib/db": {
      getPool: () => ({ getConnection: async () => connection }),
      query: async () => [], queryOne: async () => null,
    },
  })
  const result = await limits.recordSubredditCheckerUsage(7, { subreddit: "example" })
  assert.equal(result.ok, true)
  assert.equal(result.usedBonusCredit, true)
  assert.equal(result.bonusCredits, 0)
  const sql = JSON.stringify(statements)
  assert.match(sql, /subreddit_checker_credits = subreddit_checker_credits - 1/)
  assert.match(sql, /INSERT INTO feature_usage/)
  assert.ok(statements.includes("commit"))
  assert.equal(statements.at(-1), "release")
})
