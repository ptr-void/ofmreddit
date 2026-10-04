// Explicit, additive migration. Default is a read-only plan; never run via tracking requests.
const fs = require('node:fs')
const path = require('node:path')

async function migrateVisitIdentity(db, { apply = false, backup = async () => {} } = {}) {
  const [columns] = await db.execute('SHOW COLUMNS FROM website_visits')
  const [userId] = await db.execute('SHOW COLUMNS FROM users WHERE Field = ?', ['id'])
  const type = userId[0]?.Type
  if (!type || !/^(?:tinyint|smallint|mediumint|int|bigint)(?:\(\d+\))?(?: unsigned)?$/i.test(type)) {
    throw new Error('Unsupported users.id type; inspect schema before migrating.')
  }
  const [indexes] = await db.execute('SHOW INDEX FROM website_visits')
  const statements = []
  if (!columns.some(column => column.Field === 'user_id')) {
    statements.push(`ALTER TABLE website_visits ADD COLUMN user_id ${type} NULL DEFAULT NULL`)
  }
  if (!indexes.some(index => index.Column_name === 'user_id' && Number(index.Seq_in_index) === 1)) {
    if (indexes.some(index => index.Key_name === 'idx_website_visits_user_id')) {
      throw new Error('Visit identity index name already used; inspect schema before migrating.')
    }
    statements.push('ALTER TABLE website_visits ADD INDEX idx_website_visits_user_id (user_id)')
  }
  if (apply && statements.length) {
    const [schema] = await db.execute('SHOW CREATE TABLE website_visits')
    await backup(schema[0])
    for (const statement of statements) await db.execute(statement)
    const [verifiedColumns] = await db.execute('SHOW COLUMNS FROM website_visits')
    const [verifiedIndexes] = await db.execute('SHOW INDEX FROM website_visits')
    if (!verifiedColumns.some(column => column.Field === 'user_id' && column.Null === 'YES') ||
        !verifiedIndexes.some(index => index.Column_name === 'user_id' && Number(index.Seq_in_index) === 1)) {
      throw new Error('Visit identity migration readback failed; inspect database schema.')
    }
  }
  return { applied: apply, statements, alreadyReady: statements.length === 0,
    historicalVisits: 'Existing visits keep NULL user_id; no IP-based identity backfill.' }
}

module.exports = { migrateVisitIdentity }
if (require.main === module) {
  ;(async () => {
    require('@next/env').loadEnvConfig(path.resolve(__dirname, '..'))
    if (!process.env.DB_HOST || !process.env.DB_USER || !process.env.DB_NAME) {
      throw new Error('DB_HOST, DB_USER and DB_NAME must be configured for this migration.')
    }
    const db = await require('mysql2/promise').createConnection({ host: process.env.DB_HOST,
      user: process.env.DB_USER, password: process.env.DB_PASSWORD, database: process.env.DB_NAME })
    try {
      let backupPath
      const report = await migrateVisitIdentity(db, { apply: process.argv.includes('--apply'), backup: async schema => {
        const directory = path.resolve(__dirname, '../output')
        fs.mkdirSync(directory, { recursive: true })
        backupPath = path.join(directory, `visit-identity-schema-backup-${Date.now()}.json`)
        fs.writeFileSync(backupPath, JSON.stringify(schema, null, 2))
      } })
      console.log(JSON.stringify({ ...report, ...(backupPath ? { backupPath } : {}) }))
    } finally { await db.end() }
  })().catch(error => { console.error(error.message); process.exitCode = 1 })
}
