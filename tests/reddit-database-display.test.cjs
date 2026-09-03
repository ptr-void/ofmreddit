const assert = require("node:assert/strict")
const { test } = require("node:test")
const fs = require("node:fs")
const path = require("node:path")
const vm = require("node:vm")
const ts = require("typescript")

const source = fs.readFileSync(path.join(__dirname, "../lib/reddit-database-display.ts"), "utf8")
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText
const context = { exports: {}, Intl }
vm.runInNewContext(compiled, context)
const { formatDatabaseMetric, databaseColumnLabel, sourceRowHealth, subredditKey } = context.exports

test("member counts and karma have commas regardless of source formatting", () => {
  for (const header of ["Total Members", "Min Post Karma", "Hot 1 (Weekly)"]) {
    assert.equal(formatDatabaseMetric(header, "1115693"), "1,115,693")
    assert.equal(formatDatabaseMetric(header, "1,115,693"), "1,115,693")
    assert.equal(formatDatabaseMetric(header, "0"), "0")
    assert.equal(formatDatabaseMetric(header, ""), "")
    assert.equal(formatDatabaseMetric(header, "Unknown"), "Unknown")
  }
  assert.equal(formatDatabaseMetric("Hot 2-5 Avg (Weekly)", "1234.5"), "1,234.5")
  assert.equal(formatDatabaseMetric("Min Account Age", "126d (u/example)"), "126d (u/example)")
})

test("names, niche tags, links, and malformed values are never number-formatted", () => {
  assert.equal(formatDatabaseMetric("Subreddit Name", "1234567"), "1234567")
  assert.equal(formatDatabaseMetric("Niche", "general, fitness"), "general, fitness")
  assert.equal(formatDatabaseMetric("Total Members", "12,34"), "12,34")
})

test("sampled minima are not labeled as verified posting requirements", () => {
  assert.equal(databaseColumnLabel("Min Post Karma"), "Observed Min Post Karma")
  assert.equal(databaseColumnLabel("Min Account Age"), "Observed Min Account Age")
  assert.equal(databaseColumnLabel("Total Members"), "Total Members")
})

test("failed rows are marked stale, not dead or deleted", () => {
  const rows = [["Example", "error", "2026-09-03T00:00:00Z", "178874"], ["Live", "success"], ["Legacy"]]
  const before = JSON.stringify(rows)
  const health = sourceRowHealth(["Subreddit", "Sync Status", "Scraped At UTC", "Min Post Karma"], rows)
  assert.equal(health.example.status, "stale")
  assert.equal(health.example.lastAttemptAt, "2026-09-03T00:00:00Z")
  assert.equal(health.live, undefined)
  assert.equal(health.legacy.status, "unverified")
  assert.equal(JSON.stringify(rows), before)
  assert.equal(subredditKey("https://www.reddit.com/r/Example/?x=1"), "example")
  assert.equal(subredditKey("r/Example/"), "example")
})
