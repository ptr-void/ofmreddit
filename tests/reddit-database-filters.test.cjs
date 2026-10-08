const assert = require('node:assert/strict'), { test } = require('node:test')
const fs = require('node:fs'), vm = require('node:vm'), ts = require('typescript')
const context = { exports: {} }
vm.runInNewContext(ts.transpileModule(fs.readFileSync('lib/reddit-database-filters.ts', 'utf8'), { compilerOptions: {
  module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020,
} }).outputText, context)
const { filterDatabaseFlags } = context.exports
const headers = ['Subreddit','CTA Captions','Verification','Bot Bouncer','Hot 1 (Weekly)']
const rows = [['A','Yes','No','No','500'],['B','No','Yes','Yes','700'],['C','Yes','Yes','No','300'],['D','Unknown','','','900']]
test('Yes, No and Any filters apply independently without treating unknown as No', () => {
  const base={cta:'all',verification:'all',botBouncer:'all'}
  assert.equal(filterDatabaseFlags(headers,rows,base).length,4)
  assert.equal(filterDatabaseFlags(headers,rows,{...base,cta:'yes'}).map(r=>r[0]).join(','),'A,C')
  assert.equal(filterDatabaseFlags(headers,rows,{...base,cta:'no'}).map(r=>r[0]).join(','),'B')
  assert.equal(filterDatabaseFlags(headers,rows,{...base,verification:'no'}).map(r=>r[0]).join(','),'A')
  assert.equal(filterDatabaseFlags(headers,rows,{...base,botBouncer:'yes'}).map(r=>r[0]).join(','),'B')
  assert.equal(filterDatabaseFlags([],rows,{...base,verification:'no'}).length,0)
})
test('all three flags intersect, leaving filtered rows available for top-performance sorting', () => {
  const selected=filterDatabaseFlags(headers,rows,{cta:'yes',verification:'all',botBouncer:'no'})
    .sort((a,b)=>Number(b[4])-Number(a[4]))
  assert.equal(selected.map(r=>r[0]).join(','),'A,C')
  assert.equal(filterDatabaseFlags(headers,rows,{cta:'yes',verification:'no',botBouncer:'no'}).length,1)
  assert.equal(rows.length,4)
})
test('shared niche selectors offer text search, type-to-open, and scroll inside the dialog subtree', () => {
  const shared=fs.readFileSync('components/niche-tag-select.tsx','utf8')
  assert.match(shared,/Search niche tags/);assert.match(shared,/onKeyDown/)
  assert.match(shared,/closest<HTMLElement>\('\[role="dialog"\]'\)/)
  assert.match(shared,/container=\{container\}/);assert.match(shared,/overflow-y-auto overscroll-contain touch-pan-y/)
  assert.match(shared,/selected\.length >= 8/)
  const page=fs.readFileSync('app/reddit-database/page.tsx','utf8')
  for(const flag of ['ctaFilter','verificationFilter','botBouncerFilter']) assert.match(page,new RegExp(flag))
  assert.match(page,/filterDatabaseFlags/);assert.match(page,/SearchableNicheFilter/)
  for(const file of ['components/reddit-database/submit-subreddit-modal.tsx','components/admin/pending-subreddits-tab.tsx','app/subreddit-checker/page.tsx']) assert.match(fs.readFileSync(file,'utf8'),/NicheTagSelect/)
})
