const assert = require("node:assert/strict")
const { test } = require("node:test")
const fs = require("node:fs")
const path = require("node:path")

test("analytics uses all recorded history and distinguishes unique visitors", () => {
  const visits = fs.readFileSync(path.join(__dirname, "../app/api/admin/visits/route.ts"), "utf8")
  assert.doesNotMatch(visits, /INTERVAL 30 DAY/)
  assert.match(visits, /COUNT\(DISTINCT/)
})

test("caption generation preserves Gem instructions with the current Flash model", () => {
  const caption = fs.readFileSync(path.join(__dirname, "../app/api/caption-generator/route.ts"), "utf8")
  assert.match(caption, /gemini-3\.8-flash/)
  assert.match(caption, /text: prompt\.prompt_text/)
  assert.match(caption, /\.\.\.knowledgeParts/)
  assert.match(caption, /thinkingLevel: THINKING_LEVEL/)
  assert.doesNotMatch(caption, /responseSchema|thinkingBudget|Return JSON only/)
})
