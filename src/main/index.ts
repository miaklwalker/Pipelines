import { app, BrowserWindow, ipcMain, dialog } from 'electron'
import { join } from 'path'
import { promises as fs, existsSync, mkdirSync } from 'fs'
import { is } from '@electron-toolkit/utils'
import * as duckdb from 'duckdb'
import * as crypto from 'crypto'
import * as pg from 'pg'
const { Pool } = pg

let db: duckdb.Database
let conn: duckdb.Connection

function initDB(): void {
  db = new duckdb.Database(':memory:')
  conn = db.connect()
  conn.run('PRAGMA threads=4')
}

function createWindow(): void {
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1024,
    minHeight: 700,
    backgroundColor: '#0d1117',
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 14, y: 16 },
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    win.loadURL(process.env['ELECTRON_RENDERER_URL'])
    win.webContents.openDevTools()
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

app.whenReady().then(() => {
  initDB()
  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

// ─── IPC Handlers ────────────────────────────────────────────────────────────

// Select and analyze a CSV file
ipcMain.handle('csv:select', async (): Promise<CSVSelectResult | null> => {
  const { canceled, filePaths } = await dialog.showOpenDialog({
    title: 'Select CSV File',
    properties: ['openFile'],
    filters: [{ name: 'Delimited Files', extensions: ['csv', 'tsv', 'txt'] }]
  })
  if (canceled || !filePaths[0]) return null

  const filePath = filePaths[0]
  const safe = filePath.replace(/'/g, "''")

  return new Promise((resolve, reject) => {
    conn.run(
      `CREATE OR REPLACE VIEW __schema_sniff AS SELECT * FROM read_csv_auto('${safe}') LIMIT 0`,
      (err) => {
        if (err) return reject(new Error(`Failed to read CSV: ${err.message}`))
        conn.all('DESCRIBE __schema_sniff', (descErr, rows) => {
          if (descErr) return reject(new Error(descErr.message))
          const columns: ColumnInfo[] = (rows as DescribeRow[]).map((r) => ({
            name: r.column_name,
            type: normalizeType(r.column_type)
          }))
          resolve({ filePath, fileName: filePath.split('/').pop() ?? filePath, columns })
        })
      }
    )
  })
})

// Preview a node's SQL output (first 50 rows)
ipcMain.handle('db:preview', async (_, { sql }: { sql: string }): Promise<PreviewResult> => {
  return new Promise((resolve, reject) => {
    conn.all(`SELECT * FROM (${sql}) __preview LIMIT 50`, (err, rows) => {
      if (err) return reject(new Error(err.message))
      if (!rows?.length) return resolve({ columns: [], rows: [] })
      const columns = Object.keys(rows[0] as object)
      const data = (rows as Record<string, unknown>[]).map((r) =>
        columns.map((c) => {
          const v = r[c]
          if (v === null || v === undefined) return null
          if (v instanceof Date) return v.toISOString()
          return String(v)
        })
      )
      resolve({ columns, rows: data })
    })
  })
})

// Export a SQL query result to a CSV file using DuckDB COPY
ipcMain.handle('csv:export', async (_, {
  sql,
  delimiter = ',',
  includeHeader = true,
  defaultPath,
  skipDialogIfDefaultPath = false,
}: {
  sql: string
  delimiter?: string
  includeHeader?: boolean
  defaultPath?: string
  skipDialogIfDefaultPath?: boolean
}): Promise<ExportResult | null> => {
  let filePath: string | undefined
  if (skipDialogIfDefaultPath && defaultPath?.trim()) {
    filePath = defaultPath.trim()
  } else {
    const dialogResult = await dialog.showSaveDialog({
      title: 'Export CSV',
      defaultPath: defaultPath?.trim() || 'output.csv',
      filters: [{ name: 'CSV File', extensions: ['csv'] }]
    })
    if (dialogResult.canceled || !dialogResult.filePath) return null
    filePath = dialogResult.filePath
  }

  const safe      = filePath.replace(/'/g, "''")
  const safeDelim = delimiter.replace(/'/g, "''")

  return new Promise((resolve, reject) => {
    conn.run(
      `COPY (${sql}) TO '${safe}' (FORMAT CSV, HEADER ${includeHeader ? 'true' : 'false'}, DELIMITER '${safeDelim}')`,
      (copyErr) => {
        if (copyErr) return reject(new Error(copyErr.message))
        conn.all(`SELECT COUNT(*) AS cnt FROM (${sql}) __c`, (countErr, rows) => {
          const row = (rows as { cnt: number | bigint }[] | null)?.[0]
          // DuckDB returns COUNT(*) as BigInt — convert to plain Number for JSON safety
          const rowCount = countErr || row == null ? null : Number(row.cnt)
          resolve({ filePath, rowCount })
        })
      }
    )
  })
})

// Pick a CSV output path without executing an export
ipcMain.handle('csv:pick-path', async (_, { defaultPath }: { defaultPath?: string }): Promise<string | null> => {
  const { canceled, filePath } = await dialog.showSaveDialog({
    title: 'Choose CSV Output File',
    defaultPath: defaultPath?.trim() || 'output.csv',
    filters: [{ name: 'CSV File', extensions: ['csv'] }],
  })
  if (canceled || !filePath) return null
  return filePath
})

// Save the current pipeline to a .pipes JSON file
ipcMain.handle('project:save', async (_, { data }: { data: string }): Promise<string | null> => {
  const { canceled, filePath } = await dialog.showSaveDialog({
    title: 'Save Pipeline',
    defaultPath: 'pipeline.pipes',
    filters: [
      { name: 'Pipeline File', extensions: ['pipes'] },
      { name: 'JSON', extensions: ['json'] }
    ]
  })
  if (canceled || !filePath) return null
  await fs.writeFile(filePath, data, 'utf-8')
  return filePath
})

// Save a pipeline directly to a known path (no dialog — subsequent saves)
ipcMain.handle('project:saveToPath', async (_, { path, data }: { path: string; data: string }): Promise<void> => {
  await fs.writeFile(path, data, 'utf-8')
})

// Load a pipeline from a .pipes JSON file
ipcMain.handle('project:load', async (): Promise<{ path: string; data: string } | null> => {
  const { canceled, filePaths } = await dialog.showOpenDialog({
    title: 'Open Pipeline',
    filters: [
      { name: 'Pipeline File', extensions: ['pipes'] },
      { name: 'JSON', extensions: ['json'] }
    ]
  })
  if (canceled || !filePaths[0]) return null
  const path = filePaths[0]
  const data = await fs.readFile(path, 'utf-8')
  return { path, data }
})

// ─── PostgreSQL handlers ──────────────────────────────────────────────────────

interface PgConfig { host: string; port: number; database: string; user: string; password: string; ssl: boolean }

/** Escape a CSV field value */
function csvField(v: unknown): string {
  if (v === null || v === undefined) return ''
  const s = v instanceof Date ? v.toISOString() : String(v)
  if (s.includes(',') || s.includes('"') || s.includes('\n') || s.includes('\r')) {
    return '"' + s.replace(/"/g, '""') + '"'
  }
  return s
}

/** Serialize pg result to CSV string */
function pgResultToCSV(fields: { name: string }[], rows: Record<string, unknown>[]): string {
  const header = fields.map((f) => csvField(f.name)).join(',')
  const lines  = rows.map((row) => fields.map((f) => csvField(row[f.name])).join(','))
  return [header, ...lines].join('\n') + '\n'
}

/** Derive a stable path for a cached query result */
function pgCachePath(config: PgConfig, query: string): string {
  const hash = crypto.createHash('md5')
    .update(JSON.stringify({ h: config.host, p: config.port, db: config.database, u: config.user }) + query)
    .digest('hex').slice(0, 16)
  const dir = join(app.getPath('userData'), 'pg-cache')
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  return join(dir, hash + '.csv')
}

/** Sniff column types from a CSV file using DuckDB */
function sniffCSVColumns(csvPath: string): Promise<ColumnInfo[]> {
  return new Promise((resolve, reject) => {
    const safe = csvPath.replace(/'/g, "''")
    conn.run(`CREATE OR REPLACE VIEW __pg_sniff AS SELECT * FROM read_csv_auto('${safe}') LIMIT 0`, (err) => {
      if (err) return reject(err)
      conn.all('DESCRIBE __pg_sniff', (descErr, rows) => {
        if (descErr) return reject(descErr)
        resolve((rows as DescribeRow[]).map((r) => ({ name: r.column_name, type: normalizeType(r.column_type) })))
      })
    })
  })
}

// Test a PostgreSQL connection
ipcMain.handle('pg:test', async (_, config: PgConfig): Promise<{ ok: boolean; error?: string }> => {
  const pool = new Pool({ host: config.host, port: config.port, database: config.database, user: config.user, password: config.password, ssl: config.ssl ? { rejectUnauthorized: false } : false, connectionTimeoutMillis: 5000 })
  try {
    const client = await pool.connect()
    client.release()
    await pool.end()
    return { ok: true }
  } catch (err) {
    await pool.end().catch(() => {})
    return { ok: false, error: (err as Error).message }
  }
})

// Fetch from PG, write to temp CSV, return metadata
ipcMain.handle('pg:fetch', async (_, config: PgConfig, query: string): Promise<{ csvPath: string; columns: ColumnInfo[]; rowCount: number }> => {
  const pool = new Pool({ host: config.host, port: config.port, database: config.database, user: config.user, password: config.password, ssl: config.ssl ? { rejectUnauthorized: false } : false })
  try {
    const result = await pool.query(query)
    await pool.end()
    const tmpDir = app.getPath('temp')
    const csvPath = join(tmpDir, 'pg-fetch-' + Date.now() + '.csv')
    const csv = pgResultToCSV(result.fields, result.rows)
    await fs.writeFile(csvPath, csv, 'utf-8')
    const columns = await sniffCSVColumns(csvPath)
    return { csvPath, columns, rowCount: result.rowCount ?? result.rows.length }
  } catch (err) {
    await pool.end().catch(() => {})
    throw err
  }
})

// Fetch from PG with caching — if cache exists and force=false, return cached file
ipcMain.handle('pg:fetch-cached', async (_, config: PgConfig, query: string, force: boolean): Promise<{ csvPath: string; columns: ColumnInfo[]; rowCount: number; fromCache: boolean; cacheDate: string }> => {
  const cachePath = pgCachePath(config, query)
  if (!force && existsSync(cachePath)) {
    const stat = await fs.stat(cachePath)
    const columns = await sniffCSVColumns(cachePath)
    // Count rows (subtract header)
    const content = await fs.readFile(cachePath, 'utf-8')
    const rowCount = Math.max(0, content.split('\n').filter(Boolean).length - 1)
    return { csvPath: cachePath, columns, rowCount, fromCache: true, cacheDate: stat.mtime.toISOString() }
  }
  // Fetch fresh data
  const pool = new Pool({ host: config.host, port: config.port, database: config.database, user: config.user, password: config.password, ssl: config.ssl ? { rejectUnauthorized: false } : false })
  try {
    const result = await pool.query(query)
    await pool.end()
    const csv = pgResultToCSV(result.fields, result.rows)
    await fs.writeFile(cachePath, csv, 'utf-8')
    const columns = await sniffCSVColumns(cachePath)
    return { csvPath: cachePath, columns, rowCount: result.rowCount ?? result.rows.length, fromCache: false, cacheDate: new Date().toISOString() }
  } catch (err) {
    await pool.end().catch(() => {})
    throw err
  }
})

// List all user schemas and tables (+ views) in a PostgreSQL database
ipcMain.handle('pg:list-tables', async (_, config: PgConfig): Promise<{ schema: string; name: string }[]> => {
  const pool = new Pool({ host: config.host, port: config.port, database: config.database, user: config.user, password: config.password, ssl: config.ssl ? { rejectUnauthorized: false } : false, connectionTimeoutMillis: 8000 })
  try {
    const result = await pool.query(`
      SELECT table_schema AS schema, table_name AS name
      FROM information_schema.tables
      WHERE table_schema NOT IN ('information_schema', 'pg_catalog', 'pg_toast')
        AND table_type IN ('BASE TABLE', 'VIEW')
      ORDER BY table_schema, table_name
    `)
    await pool.end()
    return result.rows as { schema: string; name: string }[]
  } catch (err) {
    await pool.end().catch(() => {})
    throw err
  }
})

// Describe columns of a specific table in a PostgreSQL database
ipcMain.handle('pg:describe-table', async (_, config: PgConfig, schema: string, tableName: string): Promise<{ name: string; type: string }[]> => {
  const pool = new Pool({ host: config.host, port: config.port, database: config.database, user: config.user, password: config.password, ssl: config.ssl ? { rejectUnauthorized: false } : false, connectionTimeoutMillis: 8000 })
  try {
    const result = await pool.query(
      `SELECT column_name, data_type FROM information_schema.columns WHERE table_schema = $1 AND table_name = $2 ORDER BY ordinal_position`,
      [schema, tableName]
    )
    await pool.end()
    return result.rows.map((r: { column_name: string; data_type: string }) => ({ name: r.column_name, type: normalizeType(r.data_type) }))
  } catch (err) {
    await pool.end().catch(() => {})
    throw err
  }
})

// Delete a cached CSV file
ipcMain.handle('pg:clear-cache', async (_, csvPath: string): Promise<void> => {
  try { await fs.unlink(csvPath) } catch { /* already gone */ }
})

// Materialize a SQL query to a temp Parquet file and return its path + columns
ipcMain.handle('materialize:run', async (_, { sql, existingPath }: { sql: string; existingPath?: string }): Promise<{ parquetPath: string; columns: ColumnInfo[] }> => {
  // Delete old file if re-materializing
  if (existingPath) {
    try { await fs.unlink(existingPath) } catch { /* already gone */ }
  }

  const tmpDir = join(app.getPath('temp'), 'pipelines-materialize')
  if (!existsSync(tmpDir)) mkdirSync(tmpDir, { recursive: true })
  const parquetPath = join(tmpDir, 'mat-' + Date.now() + '.parquet')
  const safePath = parquetPath.replace(/'/g, "''")

  await new Promise<void>((resolve, reject) => {
    conn.run(`COPY (${sql}) TO '${safePath}' (FORMAT PARQUET)`, (err) => {
      if (err) reject(new Error(err.message))
      else resolve()
    })
  })

  // Sniff the column schema from the written parquet
  const columns: ColumnInfo[] = await new Promise((resolve, reject) => {
    conn.run(`CREATE OR REPLACE VIEW __mat_sniff AS SELECT * FROM read_parquet('${safePath}') LIMIT 0`, (err) => {
      if (err) return reject(new Error(err.message))
      conn.all('DESCRIBE __mat_sniff', (descErr, rows) => {
        if (descErr) return reject(new Error(descErr.message))
        resolve((rows as DescribeRow[]).map((r) => ({ name: r.column_name, type: normalizeType(r.column_type) })))
      })
    })
  })

  return { parquetPath, columns }
})

// Execute DuckDB SQL → insert into PG table
ipcMain.handle('pg:write', async (_, config: PgConfig, sql: string, tableName: string, writeMode: string): Promise<{ rowCount: number }> => {
  // 1. Run pipeline SQL in DuckDB to get rows
  const rows: Record<string, unknown>[] = await new Promise((resolve, reject) => {
    conn.all(sql, (err, r) => err ? reject(new Error(err.message)) : resolve(r as Record<string, unknown>[]))
  })
  if (!rows.length) return { rowCount: 0 }

  const columns = Object.keys(rows[0])
  const pool = new Pool({ host: config.host, port: config.port, database: config.database, user: config.user, password: config.password, ssl: config.ssl ? { rejectUnauthorized: false } : false })
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    if (writeMode === 'replace') {
      await client.query(`TRUNCATE TABLE "${tableName}"`)
    }
    // Insert in batches of 100
    const BATCH = 100
    for (let i = 0; i < rows.length; i += BATCH) {
      const batch = rows.slice(i, i + BATCH)
      const colList = columns.map((c) => `"${c}"`).join(', ')
      const placeholders = batch.map((_, ri) =>
        `(${columns.map((_, ci) => `$${ri * columns.length + ci + 1}`).join(', ')})`
      ).join(', ')
      const values = batch.flatMap((row) => columns.map((c) => {
        const v = row[c]
        return (typeof v === 'bigint') ? Number(v) : v
      }))
      await client.query(`INSERT INTO "${tableName}" (${colList}) VALUES ${placeholders}`, values)
    }
    await client.query('COMMIT')
    return { rowCount: rows.length }
  } catch (err) {
    await client.query('ROLLBACK')
    throw err
  } finally {
    client.release()
    await pool.end()
  }
})

// ─── Helpers ─────────────────────────────────────────────────────────────────

function normalizeType(raw: string): string {
  const t = raw.toUpperCase()
  if (t.includes('INT')) return 'INTEGER'
  if (t.includes('FLOAT') || t.includes('DOUBLE') || t.includes('DECIMAL') || t.includes('NUMERIC')) return 'FLOAT'
  if (t.includes('VARCHAR') || t.includes('TEXT') || t.includes('CHAR')) return 'TEXT'
  if (t.includes('BOOL')) return 'BOOLEAN'
  if (t.includes('TIMESTAMP')) return 'TIMESTAMP'
  if (t === 'DATE') return 'DATE'
  if (t === 'TIME') return 'TIME'
  return raw
}

// ─── Shared types ─────────────────────────────────────────────────────────────

export interface ColumnInfo {
  name: string
  type: string
}

export interface CSVSelectResult {
  filePath: string
  fileName: string
  columns: ColumnInfo[]
}

export interface PreviewResult {
  columns: string[]
  rows: (string | null)[][]
}

export interface ExportResult {
  filePath: string
  rowCount: number | null
}

interface DescribeRow {
  column_name: string
  column_type: string
}
