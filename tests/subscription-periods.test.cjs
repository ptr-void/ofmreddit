const fs = require("node:fs")
const path = require("node:path")
const test = require("node:test")
const assert = require("node:assert/strict")

const root = path.join(__dirname, "..")

test("subscription limits use the tier's configured rolling period", () => {
  const limits = fs.readFileSync(path.join(root, "lib/limits.ts"), "utf8")
  assert.match(limits, /usage_period_days/)
  assert.match(limits, /DATE_SUB\(NOW\(\), INTERVAL \? DAY\)/)
  assert.match(limits, /if \(cap < 0\)/)
})

test("production plan migration defines all four requested plans", () => {
  const migration = fs.readFileSync(path.join(root, "scraper/migrate_subscription_plans.py"), "utf8")
  for (const plan of ["Free", "10-Day Pass", "Standard", "Unlimited"]) {
    assert.match(migration, new RegExp(plan.replace("-", "\\-")))
  }
  assert.match(migration, /price=10/)
  assert.match(migration, /price=30/)
  assert.match(migration, /price=50/)
})
