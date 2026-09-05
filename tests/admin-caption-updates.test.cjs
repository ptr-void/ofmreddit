const assert = require("node:assert/strict")
const { test } = require("node:test")
const fs = require("node:fs")
const path = require("node:path")

test("analytics uses all recorded history and distinguishes unique visitors", () => {
  const visits = fs.readFileSync(path.join(__dirname, "../app/api/admin/visits/route.ts"), "utf8")
  assert.doesNotMatch(visits, /INTERVAL 30 DAY/)
  assert.match(visits, /COUNT\(DISTINCT/)
})

test("caption generation uses Gemini JSON with an exact result count", () => {
  const caption = fs.readFileSync(path.join(__dirname, "../app/api/caption-generator/route.ts"), "utf8")
  assert.match(caption, /generativelanguage\.googleapis\.com/)
  assert.match(caption, /responseMimeType:\s*"application\/json"/)
  assert.match(caption, /minItems:\s*expectedCount/)
  assert.match(caption, /maxItems:\s*expectedCount/)
  assert.doesNotMatch(caption, /router\.huggingface\.co/)
})
