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
    assert.equal(formatDatabaseMetric(header, "0"), header.startsWith("Hot ") ? "—" : "0")
    assert.equal(formatDatabaseMetric(header, ""), header.startsWith("Hot ") ? "—" : "")
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
  assert.equal(subredditKey("https://www.reddit.com/r/Example/hot/"), "example")
})

const { compareDatabaseValues } = context.exports
test("missing metrics sort last in both directions, with numeric comparison", () => {
  for (const direction of ["asc", "desc"]) {
    assert.equal(compareDatabaseValues("", "10", direction), 1)
    assert.equal(compareDatabaseValues("10", "Unknown", direction), -1)
    assert.equal(compareDatabaseValues("", "", direction), 0)
  }
  assert.ok(compareDatabaseValues("1,000", "900", "asc") > 0)
  assert.ok(compareDatabaseValues("1,000", "900", "desc") < 0)
  assert.ok(compareDatabaseValues("0", "10", "asc") < 0)
})

test("table uses opaque sticky headers and hover help without icon buttons", () => {
  const table = fs.readFileSync(path.join(__dirname, "../components/reddit-database/database-table.tsx"), "utf8")
  assert.doesNotMatch(table, /bg-muted\/60|<Info|z-40 relative/)
  assert.match(table, /sticky top-0 z-40 bg-muted/)
  assert.match(table, /TooltipTrigger asChild/)
  const page = fs.readFileSync(path.join(__dirname, "../app/reddit-database/page.tsx"), "utf8")
  assert.match(page, /verificationPosition \+ 1/)
  assert.match(page, />Add a Subreddit<\/button>/)
})

test("review text reflects the 400-upvote policy and explains the limits of Reddit's 18+ flag", () => {
  const review = fs.readFileSync(path.join(__dirname, "../components/admin/pending-subreddits-tab.tsx"), "utf8")
  assert.match(review, /at least 400 upvotes/)
  assert.doesNotMatch(review, /at least 100 upvotes/)
  assert.match(review, /flag alone does not verify/)
  const page = fs.readFileSync(path.join(__dirname, "../app/reddit-database/page.tsx"), "utf8")
  assert.match(page, /latest three positive readings/)
})

const { needsWeeklyHistory, restoreWeeklyAverages } = context.exports
const weeklyHeaders = ['Subreddit', 'Hot 1 (Weekly)', 'Hot 2-5 Avg (Weekly)', 'Hot 6-10 Avg (Weekly)']
const historyHeaders = ['Subreddit', 'Scraped At UTC', 'Hot 1', 'Hot 2-5 Avg', 'Hot 6-10 Avg']
test('missing weekly stats recover independent latest-three-positive means without overwriting published values', () => {
  const rows = [['r/Example/', '0', '', '99'], ['no_history', '', '0', '']]
  const before = JSON.stringify(rows)
  const history = [
    ['example', '2026-09-01T00:00:00Z', '100', '40', '20'],
    ['example', '2026-09-03T00:00:00Z', '400', '0', '30'],
    ['example', '2026-09-02T00:00:00+00:00', '200', '60'],
    ['EXAMPLE', '2026-09-04T00:00:00Z', '600', '80'],
    ['example', '2026-09-04T00:00:00Z', '600', '80'],
    ['example', '2026-09-05T00:00:00Z', '0', ''],
    ['example', '2099-09-01T00:00:00Z', '9999', '9999', '9999'],
    ['example', 'not-a-date', '9999', '9999', '9999'],
  ]
  assert.equal(needsWeeklyHistory(weeklyHeaders, rows), true)
  const result = restoreWeeklyAverages(weeklyHeaders, rows, historyHeaders, history, Date.parse('2026-10-01T00:00:00Z'))
  assert.equal(result[0][1], '400'); assert.equal(result[0][2], '60'); assert.equal(result[0][3], '99')
  assert.equal(JSON.stringify(result[1]), JSON.stringify(rows[1]))
  assert.equal(JSON.stringify(rows), before)
  assert.equal(needsWeeklyHistory(weeklyHeaders, [['example', '100', '60', '20']]), false)
  assert.equal(needsWeeklyHistory(['Subreddit', 'Members'], [['example', '0']]), false)
})
test('history validates headers, supports partial metric observations and matches Python rounding', () => {
  const history = [ ['example','2026-09-01T00:00:00Z','2','3','invalid'],
    ['example','2026-09-02T00:00:00Z','3','4','0'] ]
  const result = restoreWeeklyAverages(weeklyHeaders, [['example','','','']], historyHeaders, history)
  assert.equal(result[0][1], '2'); assert.equal(result[0][2], '4'); assert.equal(result[0][3], '')
  assert.throws(() => restoreWeeklyAverages(weeklyHeaders, [], ['wrong'], []), /headers/)
  assert.equal(formatDatabaseMetric('Hot 1 (Weekly)', '0.0'), '—')
  for (const direction of ['asc','desc']) assert.equal(compareDatabaseValues('—', '10', direction), 1)
})
