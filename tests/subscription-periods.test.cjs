const fs = require("node:fs")
const path = require("node:path")
const test = require("node:test")
const assert = require("node:assert/strict")

const root = path.join(__dirname, "..")

test("subscription limits use the tier's configured rolling period", () => {
  const limits = fs.readFileSync(path.join(root, "lib/limits.ts"), "utf8")
  assert.match(limits, /usage_period_days/)
  assert.match(limits, /feature === "database" \? 1/)
  assert.match(limits, /DATE_SUB\(NOW\(\), INTERVAL \? DAY\)/)
  assert.match(limits, /if \(cap < 0\)/)
  assert.match(limits, /const cap = 3/)
})

test("production plan migration defines exactly the four requested plans", () => {
  const migration = fs.readFileSync(path.join(root, "scraper/migrate_subscription_plans.py"), "utf8")
  for (const plan of ["Free", "Minimum", "Basic", "Pro"]) {
    assert.match(migration, new RegExp(plan.replace("-", "\\-")))
  }
  assert.doesNotMatch(migration, /VALUES \('Unlimited'/)
  assert.match(migration, /DELETE FROM subscription_tiers WHERE id=6/)
  assert.match(migration, /price=10/)
  assert.match(migration, /price=30/)
  assert.match(migration, /price=50/)
  assert.match(migration, /saved_username_limit=3/)
  assert.match(migration, /saved_profile_limit=0/)
})

test("tier controls expose only active customer limits", () => {
  const admin = fs.readFileSync(path.join(root, "components/admin/subscription-tier-tab.tsx"), "utf8")
  assert.match(admin, /SPA Tool Limit/)
  assert.match(admin, /Subreddit Database Limit \(24 hours\)/)
  assert.match(admin, /Daily Minimum Reqs Scraper Limit/)
  assert.doesNotMatch(admin, /Planner Limit/)
  assert.doesNotMatch(admin, /Caption Limit/)
  assert.doesNotMatch(admin, /Saved Profile Limit/)
})

test("plan cards keep fixed feature allowances visible", () => {
  const plans = fs.readFileSync(path.join(root, "components/subscription/tiers.tsx"), "utf8")
  assert.match(plans, /SPA analyses \/.*term/)
  assert.match(plans, /termScrapes/)
  assert.doesNotMatch(plans, />Planner</)
  assert.doesNotMatch(plans, />Captions</)
  assert.doesNotMatch(plans, />Saved Usernames</)
  assert.doesNotMatch(plans, />Saved Profiles</)
})
