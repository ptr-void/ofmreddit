// Opt-in, live browser smoke test. Uses the real form and provider; incurs API usage.
// CAPTION_TEST_TOKEN must belong to the account being tested. Never logs the token.
const fs = require('node:fs')
const path = require('node:path')
const puppeteer = require('puppeteer')

async function testCaptionWebsite({ url, token, runs = 3, output = 'output/caption-website-test', expectedThinking = 'low' }) {
  if (!url || !token) throw new Error('Set CAPTION_WEBSITE_URL and CAPTION_TEST_TOKEN for the test account.')
  const origin = new URL(url).origin
  const destination = path.resolve(output)
  fs.mkdirSync(path.dirname(destination), { recursive: true })
  const report = { checkedAt: new Date().toISOString(), origin, runs: [] }
  let browser
  try {
    browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox'] })
    const page = await browser.newPage()
    await page.setViewport({ width: 1440, height: 1050 })
    await page.evaluateOnNewDocument(value => localStorage.setItem('token', value), token)
    await page.goto(`${origin}/caption-generator`, { waitUntil: 'networkidle2', timeout: 60_000 })
    await page.waitForSelector('[role="tab"]', { timeout: 45_000 })
    async function clickText(selector, text) {
      for (const element of await page.$$(selector)) {
        if (await element.evaluate(node => node.textContent.trim()) === text) { await element.click(); return }
      }
      throw new Error(`Missing form control: ${text}`)
    }
    await clickText('[role="tab"]', 'Advanced Mode')
    const input = { features: 'adult, fitness', context: 'fitness mirror selfie in a gym wearing workout clothing' }
    for (const [selector, value] of [['#features', input.features], ['#context', input.context]]) {
      await page.click(selector, { clickCount: 3 })
      await page.type(selector, value)
    }
    await clickText('button', 'Advanced Options')
    await (await page.$('[role="slider"]')).focus()
    await page.keyboard.press('Home') // Level 1; avoid explicit content in test fixtures.
    for (let run = 0; run < runs; run++) {
      // Exercise both statement and interactive form paths without standalone API calls.
      const interactive = run % 2 === 1
      if (await page.$eval('[role="switch"]', node => node.getAttribute('aria-checked') === 'true') !== interactive) {
        await page.click('[role="switch"]')
      }
      const started = Date.now()
      const pending = page.waitForResponse(response => response.url() === `${origin}/api/caption-generator`
        && response.request().method() === 'POST', { timeout: 180_000 })
      await clickText('button[type="submit"]', 'Generate Captions')
      const response = await pending
      const body = await response.json().catch(() => ({ error: 'Non-JSON server response' }))
      await page.waitForFunction(() => Array.from(document.querySelectorAll('button[type="submit"]'))
        .some(button => button.innerText === 'Generate Captions' && !button.disabled), { timeout: 15_000 })
      const rendered = await page.$$eval('[aria-label="Copy caption"]', nodes => nodes.map(node => node.parentElement.querySelector('p')?.innerText))
      const retained = await page.evaluate(() => ({ features: document.querySelector('#features').value, context: document.querySelector('#context').value }))
      const uiMessages = await page.evaluate(() => document.body.innerText.split('\n')
        .filter(line => /daily.*quota|daily request limit|reported retry time|Retry in|Captions generated/i.test(line)).slice(0, 12))
      const passed = response.status() === 200 && body.captions?.length === 5 && rendered.length === 5
        && body.captions.every((caption, index) => caption.text === rendered[index])
        && body.meta?.model === 'gemini-3.8-flash' && body.meta?.knowledgeDocuments === 3
        && body.meta?.thinkingLevel === expectedThinking
        && body.meta?.interactiveMode === (interactive ? 'ON' : 'OFF')
        && retained.features === input.features && retained.context === input.context
      const result = { run: run + 1, interactive, durationMs: Date.now() - started, status: response.status(),
        captionCount: body.captions?.length || 0, renderedCaptionCount: rendered.length,
        meta: body.meta, error: body.error, code: body.code, quota: body.quota,
        retryAfterSeconds: body.retryAfterSeconds, retryAvailableAt: body.retryAvailableAt,
        quotaFeedbackPassed: body.code === 'DAILY_QUOTA_EXHAUSTED' && response.status() === 429
          && uiMessages.some(line => line.includes('daily request limit'))
          && !uiMessages.some(line => /Retry in 10 seconds/.test(line)),
        uiMessages,
        inputsRetained: retained.features === input.features && retained.context === input.context, passed }
      report.runs.push(result)
      await page.screenshot({ path: `${destination}-${run + 1}.png`, fullPage: true })
      console.log(JSON.stringify(result))
      if (!passed) break
    }
    report.passed = report.runs.length === runs && report.runs.every(run => run.passed)
    return report
  } catch (error) {
    report.failure = error.message
    report.passed = false
    return report
  } finally {
    if (browser) await browser.close()
    fs.writeFileSync(`${destination}.json`, JSON.stringify(report, null, 2))
  }
}
module.exports = { testCaptionWebsite }
if (require.main === module) {
  testCaptionWebsite({ url: process.env.CAPTION_WEBSITE_URL, token: process.env.CAPTION_TEST_TOKEN,
    output: process.env.CAPTION_TEST_OUTPUT, runs: 3 }).then(report => {
    if (!report.passed) process.exitCode = 1
  }).catch(error => { console.error(error.message); process.exitCode = 1 })
}
