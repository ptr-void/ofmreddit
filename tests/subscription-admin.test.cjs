const fs = require("node:fs")
const path = require("node:path")
const test = require("node:test")
const assert = require("node:assert/strict")

const root = path.join(__dirname, "..")

test("manual tier assignment is immediate and does not require dates", () => {
  const api = fs.readFileSync(path.join(root, "app/api/admin/subscriptions/route.ts"), "utf8")
  const panel = fs.readFileSync(path.join(root, "components/admin/user-subscription-tab.tsx"), "utf8")
  assert.match(api, /starts_at = NOW\(\), ends_at = NULL/)
  assert.doesNotMatch(api, /Missing userId, tierId, or start date/)
  assert.doesNotMatch(panel, /Start Date|End Date/)
  assert.match(panel, /Paid plans update automatically after payment/)
})

test("confirmed payments still activate subscriptions automatically", () => {
  const payments = fs.readFileSync(path.join(root, "lib/binance-payments.ts"), "utf8")
  assert.match(payments, /INSERT INTO user_subscriptions/)
  assert.match(payments, /DATE_ADD\(NOW\(\), INTERVAL \? DAY\)/)
})
