// Opt-in website smoke test: real table, counters, niches and existing-name bulk submissions.
// Optional intercepted client cases are explicitly reported separately from live checks.
const fs = require('node:fs')
const path = require('node:path')
const assert = require('node:assert/strict')
const puppeteer = require('puppeteer')

async function testSubredditDatabaseWebsite({ url, token, names, clientFixtures = false, output = 'output/bulk-bans-website' }) {
  if (!url || !token || !Array.isArray(names) || names.length < 6) throw Error('Supply the site URL, test token and at least six existing database names.')
  const origin = new URL(url).origin, report = { checkedAt: new Date().toISOString(), live: {}, clientFixtures: {} }
  const destination = path.resolve(output)
  fs.mkdirSync(path.dirname(destination), { recursive: true })
  let browser, page, livePayload
  const calls = []
  try {
    browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox'] })
    page = await browser.newPage()
    await page.setViewport({ width: 1440, height: 1050 })
    if (process.env.DATABASE_TEST_USER_AGENT) await page.setUserAgent(process.env.DATABASE_TEST_USER_AGENT)
    await page.evaluateOnNewDocument(token => {
      localStorage.setItem('token', token)
      localStorage.setItem('user', JSON.stringify({ isAdmin: false, hasTelegramLinked: true }))
    }, token)
    const reply = page.waitForResponse(response => response.url() === origin + '/api/reddit-database', { timeout: 90_000 })
    await page.goto(origin + '/reddit-database', { waitUntil: 'networkidle2', timeout: 90_000 })
    const response = await reply
    assert.equal(response.status(), 200)
    livePayload = await response.json()
    assert.ok(livePayload.banCounts)
    await page.waitForSelector('[data-testid="banned-day"]')
    report.live.rowCount = livePayload.mainSheet.rows.length
    report.live.counts = livePayload.banCounts
    assert.equal(await page.$eval('[data-testid="banned-day"]', node => node.textContent.trim()), livePayload.banCounts.today.toLocaleString())
    assert.equal(await page.$eval('[data-testid="banned-week"]', node => node.textContent.trim()), livePayload.banCounts.last7Days.toLocaleString())
    report.live.renderedCountsMatchApi = true
    await page.screenshot({ path: `${destination}-live-counts.png` })

    const fill = async (selector, value) => {
      await page.click(selector); await page.keyboard.down('Control'); await page.keyboard.press('A'); await page.keyboard.up('Control'); await page.keyboard.sendCharacter(value)
    }
    const open = async () => {
      report.stage = "open modal"
      await page.click('button[class*="bg-primary"]')
      await page.waitForSelector('textarea#subreddit')
      await page.waitForFunction(() => document.getElementById('tags') && !document.getElementById('tags').disabled)
    }
    const selectTag = async () => {
      report.stage = "select niche"
      await page.click('#tags'); await page.screenshot({path: `${destination}-niche-popover.png`})
      await page.waitForSelector('[role="group"][aria-label="Niche tags"] label')
      await page.waitForFunction(() => { const popup = document.querySelector('[data-slot="popover-content"]'); return popup && getComputedStyle(popup).opacity === '1' && popup.getAnimations().every(animation => animation.playState === 'finished') })
      await page.click('[role="group"][aria-label="Niche tags"] [role="checkbox"]')
      await page.waitForFunction(() => !!document.querySelector('[role="group"][aria-label="Niche tags"] [data-state="checked"]'))
      await page.keyboard.press('Escape')
      await page.waitForFunction(() => !document.querySelector('[data-slot="popover-content"]'))
    }
    const submit = async () => {
      report.stage = "submit list"
      await page.click('[role="dialog"] button[type="submit"]')
      report.formState = await page.evaluate(() => ({ tag: document.getElementById('tags')?.textContent, valid: document.querySelector('[role="dialog"] form')?.checkValidity(), alerts: Array.from(document.querySelectorAll('[role="alert"]')).map(node => node.textContent) }))
      await page.waitForFunction(() => !Array.from(document.querySelectorAll('[role="dialog"] [role="status"]')).some(node => /Checking/.test(node.textContent)), { timeout: 90_000 })
    }
    const close = async () => { await page.keyboard.press('Escape'); await page.waitForFunction(() => !document.querySelector('[role="dialog"]')) }

    // Real website/route/Sheet path: use existing names so no production review items are created.
    await open()
    const input = `r/${names[0]}\n${names[1]}, https://www.reddit.com/r/${names[2]}/; ${names.slice(3).join('\n')}\n${names[0].toUpperCase()}`
    report.stage = "paste list"; await fill('#subreddit', input)
    assert.match(await page.$eval('[data-testid="subreddit-paste-count"]', node => node.textContent), new RegExp(`${names.length} unique names.*1 duplicates`))
    await selectTag()
    const liveResults = []
    const listener = async response => {
      if (response.url() === origin + '/api/subreddits/submit' && response.request().method() === 'POST') liveResults.push(await response.json())
    }
    page.on('response', listener)
    await submit()
    await page.waitForFunction(count => document.querySelectorAll('[data-submission-status="existing"]').length === count, {}, names.length)
    page.off('response', listener)
    assert.equal(liveResults.length, Math.ceil(names.length / 5))
    assert.ok(liveResults.every(reply => reply.results.every(result => result.status === 'existing')))
    report.live.bulkNamesChecked = names.length
    report.live.bulkDuplicatesIgnored = true
    report.live.everyNameVerifiedExisting = true
    await page.screenshot({ path: `${destination}-live-bulk.png` })
    await close()

    if (clientFixtures) {
      let scenario = 'partial', requestCount = 0, counts = { ...livePayload.banCounts, today: 3, last7Days: 9 }
      await page.setRequestInterception(true)
      page.on('request', request => {
        if (request.url() === origin + '/api/reddit-database') {
          return request.respond({ status: 200, contentType: 'application/json', body: JSON.stringify({ ...livePayload, banCounts: counts }) })
        }
        if (request.url() === origin + '/api/subreddits/submit' && request.method() === 'POST') {
          const body = JSON.parse(request.postData()), names = body.subreddits
          calls.push({ scenario, names }); requestCount++
          if (scenario === 'late-failure' && requestCount === 2) return request.respond({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'Fixture outage' }) })
          const results = names.map(name => {
            const status = scenario === 'partial' && name === 'charlie' && requestCount === 1 ? 'failed' : 'submitted'
            return { input: name, name, status, message: status === 'failed' ? 'Retry this name' : 'Submitted for admin approval', retryable: status === 'failed' }
          })
          return request.respond({ status: 200, contentType: 'application/json', body: JSON.stringify({ results, success: true, paused: scenario === 'pause' }) })
        }
        return request.continue()
      })
      await page.reload({ waitUntil: 'networkidle2' })
      assert.equal(await page.$eval('[data-testid="banned-day"]', node => node.textContent.trim()), '3')
      assert.equal(await page.$eval('[data-testid="banned-week"]', node => node.textContent.trim()), '9')
      report.clientFixtures.nonzeroCountersRender = true
      await fill('#search', 'no_such_row_in_this_test')
      assert.equal(await page.$eval('[data-testid="banned-day"]', node => node.textContent.trim()), '3')
      report.clientFixtures.filtersDoNotChangeGlobalCounts = true
      await fill('#search', '')

      await open(); await fill('#subreddit', 'alpha\nbravo\ncharlie\ndelta\necho\nfoxtrot\ngolf\nhotel\nALPHA\ninvalid-name'); await selectTag(); await submit()
      assert.equal(calls.length, 2)
      assert.deepEqual(calls.map(call => call.names.length), [5, 3])
      assert.equal(await page.$eval('#subreddit', node => node.value), 'charlie\ninvalid-name')
      assert.equal(await page.$$eval('[data-submission-status="submitted"]', nodes => nodes.length), 7)
      await page.screenshot({ path: `${destination}-partial-results.png` })
      await submit()
      assert.deepEqual(calls.at(-1).names, ['charlie'])
      assert.equal(await page.$eval('#subreddit', node => node.value), 'invalid-name')
      report.clientFixtures.partialFailureRetainsOnlyUnfinishedNames = true
      report.clientFixtures.retryDoesNotResubmitSuccesses = true
      await close()

      scenario = 'late-failure'; requestCount = 0
      await open(); await fill('#subreddit', 'alpha01\nalpha02\nalpha03\nalpha04\nalpha05\nalpha06\nalpha07'); await selectTag(); await submit()
      assert.equal(await page.$eval('#subreddit', node => node.value), 'alpha06\nalpha07')
      assert.equal(await page.$$eval('[data-submission-status="submitted"]', nodes => nodes.length), 5)
      assert.match(await page.$eval('[role="alert"]', node => node.textContent), /Fixture outage/)
      report.clientFixtures.laterBatchOutagePreservesEarlierResults = true
      await close()

      scenario = 'pause'; requestCount = 0
      await open(); await fill('#subreddit', 'alpha01\nalpha02\nalpha03\nalpha04\nalpha05\nalpha06'); await selectTag(); await submit()
      assert.equal(requestCount, 1)
      assert.equal(await page.$eval('#subreddit', node => node.value), 'alpha06')
      report.clientFixtures.providerPauseStopsNextBatch = true
      await close()

      scenario = 'large-list'; requestCount = 0
      await open()
      const large = Array.from({length: 101}, (_, index) => 'bulk' + String(index).padStart(3, '0'))
      await fill('#subreddit', large.join('\n')); await selectTag(); await submit()
      assert.equal(requestCount, 0)
      assert.match(await page.$eval('[role="alert"]', node => node.textContent), /up to 100/)
      assert.equal(await page.$eval('#subreddit', node => node.value), large.join('\n'))
      report.clientFixtures.oversizedListPreservedBeforeSubmission = true
      await fill('#subreddit', large.slice(0, 100).join('\n')); await submit()
      assert.equal(requestCount, 20)
      assert.equal(await page.$$eval('[data-submission-status="submitted"]', nodes => nodes.length), 100)
      assert.equal(await page.$('#subreddit'), null)
      report.clientFixtures.hundredNamePasteCompletesInBoundedBatches = true
      await close()

      counts = null
      await page.reload({ waitUntil: 'networkidle2' })
      assert.equal(await page.$eval('[data-testid="banned-day"]', node => node.textContent.trim()), 'Unavailable')
      assert.ok(await page.$('tbody tr'))
      report.clientFixtures.unavailableCountersKeepTableVisible = true
      await page.setViewport({ width: 390, height: 844 })
      await open(); await fill('#subreddit', 'alpha\nbravo\ncharlie'); await selectTag()
      const mobile = await page.$eval('[role="dialog"]', node => { const bounds = node.getBoundingClientRect(); return {left: bounds.left, right: bounds.right, width: innerWidth} })
      assert.ok(mobile.left >= 0 && mobile.right <= mobile.width)
      assert.notEqual(await page.$eval('#tags', node => node.textContent.trim()), 'Select niche tags')
      report.clientFixtures.mobileModalAndNicheSelection = true
      await page.screenshot({ path: `${destination}-mobile.png` })
      await close()
    }
    report.passed = true
  } catch (error) {
    report.failure = error.message; report.passed = false
    if (page) await page.screenshot({ path: `${destination}-failure.png` }).catch(() => {})
  } finally {
    if (browser) await browser.close()
    report.fixtureSubmissionCalls = calls
    fs.writeFileSync(`${destination}.json`, JSON.stringify(report, null, 2))
  }
  return report
}
module.exports = { testSubredditDatabaseWebsite }
if (require.main === module) testSubredditDatabaseWebsite({ url: process.env.DATABASE_WEBSITE_URL, token: process.env.DATABASE_TEST_TOKEN,
  names: (process.env.DATABASE_TEST_EXISTING_NAMES || '').split(',').filter(Boolean), clientFixtures: process.env.DATABASE_TEST_CLIENT_FIXTURES === 'true' })
  .then(report => { console.log(JSON.stringify(report)); if (!report.passed) process.exitCode = 1 })
  .catch(error => { console.error(error.message); process.exitCode = 1 })
