const fs = require('node:fs'), path = require('node:path')

async function migrateCaptionAccess(db, { apply = false, backup = async () => {} } = {}) {
  const [columns] = await db.execute('SHOW COLUMNS FROM site_controls')
  const statements = columns.some(column => column.Field === 'caption_generation_enabled') ? [] : [
    'ALTER TABLE site_controls ADD COLUMN caption_generation_enabled TINYINT(1) NOT NULL DEFAULT 1',
  ]
  if (apply && statements.length) {
    const [schema] = await db.execute('SHOW CREATE TABLE site_controls')
    await backup(schema[0])
    for (const statement of statements) await db.execute(statement)
    const [verified] = await db.execute('SHOW COLUMNS FROM site_controls')
    if (!verified.some(column => column.Field === 'caption_generation_enabled' && Number(column.Default) === 1)) {
      throw new Error('Caption-access migration readback failed.')
    }
  }
  return { applied: apply, statements, alreadyReady: statements.length === 0 }
}
module.exports = { migrateCaptionAccess }
if (require.main === module) {
  ;(async () => {
    require('@next/env').loadEnvConfig(path.resolve(__dirname, '..'))
    if (!process.env.DB_HOST || !process.env.DB_USER || !process.env.DB_NAME) throw new Error('Database configuration required.')
    const db = await require('mysql2/promise').createConnection({ host: process.env.DB_HOST, user: process.env.DB_USER,
      password: process.env.DB_PASSWORD, database: process.env.DB_NAME })
    try {
      let backupPath
      const report = await migrateCaptionAccess(db, { apply: process.argv.includes('--apply'), backup: async schema => {
        const directory = path.resolve(__dirname, '../output'); fs.mkdirSync(directory, { recursive: true })
        backupPath = path.join(directory, `caption-access-schema-backup-${Date.now()}.json`)
        fs.writeFileSync(backupPath, JSON.stringify(schema, null, 2))
      } })
      console.log(JSON.stringify({ ...report, ...(backupPath ? { backupPath } : {}) }))
    } finally { await db.end() }
  })().catch(error => { console.error(error.message); process.exitCode = 1 })
}
