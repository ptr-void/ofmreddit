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

test("accounts without an assigned subscription inherit the active Free tier", async () => {
  const statements = []
  const freeTier = {
    id: 1,
    weekly_scraper_limit: 5,
    weekly_planner_limit: 5,
    weekly_caption_limit: 5,
    weekly_database_limit: 5,
    saved_username_limit: 5,
    saved_profile_limit: 5,
    daily_subreddit_checker_limit: 3,
  }
  const limits = load("lib/limits.ts", {
    "@/lib/db": {
      getPool: () => { throw new Error("not used") },
      query: async () => [],
      queryOne: async (sql, params) => {
        statements.push([sql, params])
        return sql.includes("FROM user_subscriptions") ? null : freeTier
      },
    },
  })

  const tier = await limits.getActiveTierForUser(42)
  assert.equal(tier.daily_subreddit_checker_limit, 3)
  assert.equal(statements.length, 2)
  assert.match(statements[1][0], /LOWER\(name\) = 'free'/)
})
