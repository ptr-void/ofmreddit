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
  assert.match(page, /four-week rolling averages/)
})

const { hasWeeklyMetrics, applyFourWeekAverages } = context.exports
const weeklyHeaders = ['Subreddit', 'Hot 1 (Weekly)', 'Hot 2-5 Avg (Weekly)', 'Hot 6-10 Avg (Weekly)']
const historyHeaders = ['Subreddit', 'Scraped At UTC', 'Hot 1', 'Hot 2-5 Avg', 'Hot 6-10 Avg']
const cases = JSON.parse(fs.readFileSync(path.join(__dirname,'fixtures/four-week-metrics.json'),'utf8'))
for (const fixture of cases) test(`four-week parity: ${fixture.name}`,()=>{
  const rows = [['r/Example/', '', '', '']]
  const history = fixture.samples.map(([stamp,values])=>['example',stamp,...values.map(value=>value===null?'':String(value))])
  const result = applyFourWeekAverages(weeklyHeaders,rows,historyHeaders,history,Date.parse(fixture.now))
  assert.deepEqual(Array.from(result[0].slice(1)),fixture.expected.map(value=>value===null?'':String(value)))
  assert.equal(JSON.stringify(rows),JSON.stringify([['r/Example/','','','']]))
})

test('rolling means replace published three-scrape values, while absent history retains the published score',()=>{
  const history=cases[1].samples.map(([stamp,values])=>['example',stamp,...values.map(String)])
  const rows=[['example','9999','9999','9999'],['no_history','50','','']]
  const result=applyFourWeekAverages(weeklyHeaders,rows,historyHeaders,history,Date.parse(cases[1].now))
  assert.deepEqual(Array.from(result[0].slice(1)),['350','90','45'])
  assert.equal(JSON.stringify(result[1]),JSON.stringify(rows[1]))
  assert.equal(hasWeeklyMetrics(weeklyHeaders),true);assert.equal(hasWeeklyMetrics(['Subreddit','Members']),false)
  assert.throws(()=>applyFourWeekAverages(weeklyHeaders,[],['wrong'],[]),/headers/)
})

test('invalid history cells are independently ignored and arbitrary old dates never show on the table',()=>{
  const result=applyFourWeekAverages(weeklyHeaders,[['example','','','']],historyHeaders,
    [['example','2026-09-25T00:00:00Z','2','bad','4'],['example','bad','9999','9999','9999']],Date.parse('2026-09-30T00:00:00Z'))
  assert.deepEqual(Array.from(result[0].slice(1)),['2','','4'])
  const table=fs.readFileSync(path.join(__dirname,'../components/reddit-database/database-table.tsx'),'utf8')
  assert.doesNotMatch(table,/weeklyBaselineLabel|baselineLabel|Scores measured|Historical ·/)
  assert.match(table,/four UTC calendar weeks/)
  assert.equal(databaseColumnLabel('Hot 1 (Weekly)'),'Top 1 (4-week avg)')
})

test('last-known retention restores lost values but never replaces existing scores with old, zero or future readings',()=>{
  const { retainLastKnownWeeklyValues }=context.exports
  const rows=[['example','500','0','']]
  const history=[['example','2026-06-01T00:00:00Z','100','30','12'],
    ['example','2026-06-02T00:00:00Z','120','40','0'],['example','2027-01-01T00:00:00Z','9999','9999','9999']]
  const next=retainLastKnownWeeklyValues(weeklyHeaders,rows,historyHeaders,history,Date.parse('2026-10-08T00:00:00Z'))
  assert.deepEqual(Array.from(next[0]),['example','500','40','12'])
  assert.deepEqual(rows,[['example','500','0','']])
})

test('last-known retention rejects Sunday-to-Tuesday readings in the new Sunday-based week',()=>{
  const {retainLastKnownWeeklyValues}=context.exports
  const rows=[['example','','','']]
  const history=[['example','2026-10-24T23:59:59Z','440','44','22'],
    ['example','2026-10-25T00:00:00Z','1','1','1']]
  const result=retainLastKnownWeeklyValues(weeklyHeaders,rows,historyHeaders,history,Date.parse('2026-10-25T12:00:00Z'))
  assert.deepEqual(Array.from(result[0].slice(1)),['440','44','22'])
  const page=fs.readFileSync(path.join(__dirname,'../app/reddit-database/page.tsx'),'utf8')
  assert.match(page,/Sunday–Saturday week \(UTC\)/)
})

test('default alphabetical ordering uses normalized community names and never mutates source rows',()=>{
  const {sortDatabaseRowsByName}=context.exports
  const rows=[['https://www.reddit.com/r/Zebra/'],['r/apple'],['Banana'],['https://www.reddit.com/r/1819gw/']]
  const before=JSON.stringify(rows)
  assert.deepEqual(Array.from(sortDatabaseRowsByName(['Subreddit Name'],rows),r=>r[0]),[rows[3][0],rows[1][0],rows[2][0],rows[0][0]])
  assert.equal(JSON.stringify(rows),before)
  assert.equal(sortDatabaseRowsByName(['Unknown'],rows),rows)
  const page=fs.readFileSync(path.join(__dirname,'../app/reddit-database/page.tsx'),'utf8')
  assert.match(page,/Alphabetical \(A–Z\)/)
  assert.match(page,/rows = sortDatabaseRowsByName\(headers, rows\)/)
})
