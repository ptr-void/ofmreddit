const assert = require("node:assert/strict")
const { test } = require("node:test")
const fs = require("node:fs")
const path = require("node:path")
const vm = require("node:vm")
const ts = require("typescript")

function load(relative, dependencies) {
  const code = ts.transpileModule(fs.readFileSync(path.join(__dirname, "..", relative), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true },
  }).outputText
  const context = { exports: {}, console, Date, Math, require: name => {
    if (!(name in dependencies)) throw new Error(`Unexpected import ${name}`)
    return dependencies[name]
  } }
  vm.runInNewContext(code, context)
  return context.exports
}

const next = { NextResponse: { json: (body, init = {}) => ({ body, status: init.status || 200 }) } }
const request = body => new Request("https://example.test/api/auth/register", {
  method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
})

test("an existing verified email is rejected before an invite code is consumed", async () => {
  const statements = []
  const connection = {
    beginTransaction: async () => statements.push("begin"),
    rollback: async () => statements.push("rollback"),
    commit: async () => statements.push("commit"),
    release: () => statements.push("release"),
    execute: async (sql) => {
      statements.push(sql)
      if (sql.startsWith("SELECT id, email_verified")) {
        return [[{ id: 3, email_verified: 1, telegram_username: "fixture" }]]
      }
      throw new Error(`Unexpected SQL: ${sql}`)
    },
  }
  const route = load("app/api/auth/register/route.ts", {
    "next/server": next,
    bcryptjs: { hash: async () => "hash" },
    nodemailer: { createTransport: () => ({ sendMail: async () => ({}) }) },
    "@/lib/db": { getPool: () => ({ getConnection: async () => connection }) },
  })
  const response = await route.POST(request({ email: "EXAMPLE@test.com", password: "secret", inviteCode: "ABC123" }))
  assert.equal(response.status, 409)
  assert.match(response.body.error, /sign in/i)
  assert.doesNotMatch(JSON.stringify(statements), /DELETE FROM invite_codes/)
  assert.ok(statements.includes("rollback"))
})

test("the verification screen survives refresh and resend does not require the password", () => {
  const page = fs.readFileSync(path.join(__dirname, "../app/register/page.tsx"), "utf8")
  assert.match(page, /sessionStorage\.getItem\("pendingVerificationEmail"\)/)
  assert.match(page, /JSON\.stringify\(\{ email, op: "resend" \}\)/)
  assert.match(page, /id="otp"/)
})
