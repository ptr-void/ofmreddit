const assert = require("node:assert/strict")
const { test } = require("node:test")
const fs = require("node:fs")
const path = require("node:path")
const vm = require("node:vm")
const ts = require("typescript")

function load(relative, dependencies, globals = {}) {
  const code = ts.transpileModule(fs.readFileSync(path.join(__dirname, "..", relative), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true },
  }).outputText
  const context = { exports: {}, console, URL, Request, process: { env: {} }, ...globals, require: name => {
    if (!(name in dependencies)) throw new Error(`Unexpected import ${name}`)
    return dependencies[name]
  } }
  vm.runInNewContext(code, context)
  return context.exports
}

test("crypto amounts use exact fixed-point arithmetic", () => {
  const payments = load("lib/binance-payments.ts", {
    "node:crypto": require("node:crypto"),
    "@/lib/db": { getPool: () => null, query: async () => [], queryOne: async () => null },
  })
  assert.equal(payments.decimalToUnits("10.003217"), 1000321700n)
  assert.equal(payments.formatUnits(1000321700n), "10.003217")
  assert.throws(() => payments.decimalToUnits("10 USDT"), /invalid decimal/i)
})

test("payment endpoints require authentication and reject malformed intent ids", async () => {
  const next = { NextResponse: { json: (body, init = {}) => ({ body, status: init.status || 200 }) } }
  const route = load("app/api/payments/binance/route.ts", {
    "next/server": next,
    "@/lib/auth": { verifyToken: token => token === "valid" ? { userId: 7 } : null },
    "@/lib/binance-payments": {
      createPaymentIntent: async () => { throw new Error("unexpected") },
      getAndReconcilePaymentIntent: async () => { throw new Error("unexpected") },
    },
  })
  const anonymous = new Request("https://example.test/api/payments/binance", { method: "POST", body: "{}" })
  assert.equal((await route.POST(anonymous)).status, 401)
  const malformed = new Request("https://example.test/api/payments/binance?id=bad", { headers: { authorization: "Bearer valid" } })
  assert.equal((await route.GET(malformed)).status, 400)
})

test("the unsigned placeholder Binance webhook is removed", () => {
  assert.equal(fs.existsSync(path.join(__dirname, "../app/api/webhooks/binance/route.ts")), false)
})
