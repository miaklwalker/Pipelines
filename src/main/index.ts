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

// Select and analyze a JSON file containing an array of objects
ipcMain.handle('json:select', async (): Promise<CSVSelectResult | null> => {
  const { canceled, filePaths } = await dialog.showOpenDialog({
    title: 'Select JSON File',
    properties: ['openFile'],
    filters: [{ name: 'JSON Files', extensions: ['json'] }]
  })
  if (canceled || !filePaths[0]) return null

  const filePath = filePaths[0]
  const safe = filePath.replace(/'/g, "''")

  return new Promise((resolve, reject) => {
    conn.run(
      `CREATE OR REPLACE VIEW __json_sniff AS SELECT * FROM read_json_auto('${safe}', format='array') LIMIT 0`,
      (err) => {
        if (err) return reject(new Error(`Failed to read JSON: ${err.message}`))
        conn.all('DESCRIBE __json_sniff', (descErr, rows) => {
          if (descErr) return reject(new Error(descErr.message))
          const columns: ColumnInfo[] = (rows as DescribeRow[]).map((r) => ({
            name: r.column_name,
            type: normalizeType(r.column_type)
          }))
          resolve({ filePath, fileName: filePath.split('\\').pop() ?? filePath, columns })
        })
      }
    )
  })
})

// Preview a node's SQL output (first 50 rows)
ipcMain.handle('db:preview', async (_, { sql }: { sql: string }): Promise<PreviewResult> => {
  return new Promise((resolve, reject) => {
    conn.all(`SELECT COUNT(*) AS cnt FROM (${sql}) __preview_count`, (countErr, countRows) => {
      if (countErr) return reject(new Error(countErr.message))
      const totalCountRow = (countRows as { cnt: number | bigint }[] | null)?.[0]
      const rowCount = totalCountRow == null ? null : Number(totalCountRow.cnt)

      conn.all(`SELECT * FROM (${sql}) __preview LIMIT 50`, (err, rows) => {
        if (err) return reject(new Error(err.message))
        try {
          if (!rows?.length) return resolve({ columns: [], rows: [], rowCount })
          const columns = Object.keys(rows[0] as object)
          const data = (rows as Record<string, unknown>[]).map((r) =>
            columns.map((c) => {
              const v = r[c]
              if (v === null || v === undefined) return null
              if (v instanceof Date) return v.toISOString()
              if (typeof v === 'bigint') return String(v)
              // DuckDB STRUCT/LIST/JSON types come back as JS objects — sanitize
              // BigInts inside them before stringifying (JSON.stringify(BigInt) is fatal)
              if (typeof v === 'object') return JSON.stringify(sanitizeBigInts(v))
              return String(v)
            })
          )
          resolve({ columns, rows: data, rowCount })
        } catch (e) {
          reject(e instanceof Error ? e : new Error(String(e)))
        }
      })
    })
  })
})

// Profile a SQL query — per-column data-quality stats for the Report node.
ipcMain.handle('db:profile', async (_, { sql, columns, topN = 5 }: {
  sql: string
  columns: ColumnInfo[]
  topN?: number
}): Promise<ReportResult> => {
  const cols = columns ?? []
  const src = `(${sql})`
  const quote = (name: string) => `"${name.replace(/"/g, '""')}"`
  const num = (v: unknown): number => (v == null ? 0 : Number(v))
  const str = (v: unknown): string | null =>
    v == null ? null : v instanceof Date ? v.toISOString() : String(v)

  const all = (q: string) => new Promise<Record<string, unknown>[]>((resolve, reject) => {
    conn.all(q, (err, rows) => (err ? reject(new Error(err.message)) : resolve((rows ?? []) as Record<string, unknown>[])))
  })

  if (!cols.length) {
    const totalRows = await all(`SELECT COUNT(*) AS __total FROM ${src} __profile`)
    return { rowCount: num(totalRows[0]?.__total), columns: [] }
  }

  // One aggregate pass for non-null / distinct / min / max / blank-string counts.
  // CAST(... AS VARCHAR) keeps MIN/MAX stringifiable and blank detection type-safe.
  const aggParts = ['COUNT(*) AS __total']
  cols.forEach((c, i) => {
    const q = quote(c.name)
    aggParts.push(`COUNT(${q}) AS "c${i}_nn"`)
    aggParts.push(`COUNT(DISTINCT ${q}) AS "c${i}_dc"`)
    aggParts.push(`CAST(MIN(${q}) AS VARCHAR) AS "c${i}_min"`)
    aggParts.push(`CAST(MAX(${q}) AS VARCHAR) AS "c${i}_max"`)
    aggParts.push(`COUNT(*) FILTER (WHERE CAST(${q} AS VARCHAR) = '') AS "c${i}_bl"`)
  })
  const aggRows = await all(`SELECT ${aggParts.join(', ')} FROM ${src} __profile`)
  const agg = aggRows[0] ?? {}
  const total = num(agg.__total)

  // Top values: one grouped query per column, capped so wide tables stay responsive.
  const TOP_COL_CAP = 40
  const limit = Math.max(1, Math.min(20, topN))
  const out = []
  for (let i = 0; i < cols.length; i++) {
    const c = cols[i]
    const q = quote(c.name)
    let top: { value: string | null; count: number }[] = []
    if (i < TOP_COL_CAP && total > 0) {
      const rows = await all(
        `SELECT CAST(${q} AS VARCHAR) AS v, COUNT(*) AS n FROM ${src} __p ` +
        `WHERE ${q} IS NOT NULL GROUP BY 1 ORDER BY n DESC, v LIMIT ${limit}`
      )
      top = rows.map((r) => ({ value: str(r.v), count: num(r.n) }))
    }
    out.push({
      name: c.name,
      type: c.type,
      nonNull: num(agg[`c${i}_nn`]),
      distinct: num(agg[`c${i}_dc`]),
      min: str(agg[`c${i}_min`]),
      max: str(agg[`c${i}_max`]),
      blank: num(agg[`c${i}_bl`]),
      top,
    })
  }
  return { rowCount: total, columns: out }
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

// Select any file and return its contents as a base64 string
ipcMain.handle('file:select-base64', async (_, { filters }: { filters?: { name: string; extensions: string[] }[] }): Promise<{ filePath: string; fileName: string; base64: string } | null> => {
  const { canceled, filePaths } = await dialog.showOpenDialog({
    title: 'Select File',
    properties: ['openFile'],
    filters: filters ?? [{ name: 'All Files', extensions: ['*'] }],
  })
  if (canceled || !filePaths[0]) return null
  const filePath = filePaths[0]
  const buffer = await fs.readFile(filePath)
  const fileName = filePath.split('/').pop() ?? filePath.split('\\').pop() ?? filePath
  return { filePath, fileName, base64: buffer.toString('base64') }
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

// ─── App settings (last opened file, etc.) ───────────────────────────────────
const settingsPath = join(app.getPath('userData'), 'settings.json')

async function readSettings(): Promise<Record<string, unknown>> {
  try { return JSON.parse(await fs.readFile(settingsPath, 'utf-8')) } catch { return {} }
}
async function writeSettings(patch: Record<string, unknown>): Promise<void> {
  const current = await readSettings()
  await fs.writeFile(settingsPath, JSON.stringify({ ...current, ...patch }, null, 2), 'utf-8')
}

ipcMain.handle('project:getLastPath', async (): Promise<string | null> => {
  const s = await readSettings()
  return typeof s.lastFilePath === 'string' ? s.lastFilePath : null
})

ipcMain.handle('project:setLastPath', async (_, path: string): Promise<void> => {
  await writeSettings({ lastFilePath: path })
})

// Load a pipeline from a known path — no dialog (used for auto-load on startup)
ipcMain.handle('project:loadFromPath', async (_, path: string): Promise<{ path: string; data: string } | null> => {
  try {
    if (!existsSync(path)) return null
    const data = await fs.readFile(path, 'utf-8')
    return { path, data }
  } catch { return null }
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
ipcMain.handle('pg:write', async (event, config: PgConfig, sql: string, tableName: string, writeMode: string): Promise<{ rowCount: number }> => {
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
      await client.query(`TRUNCATE TABLE ${tableName} CASCADE`)
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
      await client.query(`INSERT INTO ${tableName} (${colList}) VALUES ${placeholders}`, values)
      event.sender.send('pg:write-progress', i + batch.length, rows.length)
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

// ─── API fetch helpers ────────────────────────────────────────────────────────

function sanitizeBigInts(obj: unknown): unknown {
  if (typeof obj === 'bigint') return Number(obj)
  if (Array.isArray(obj)) return obj.map(sanitizeBigInts)
  if (obj !== null && typeof obj === 'object')
    return Object.fromEntries(Object.entries(obj as Record<string, unknown>).map(([k, v]) => [k, sanitizeBigInts(v)]))
  return obj
}

function extractByPath(obj: unknown, path: string): unknown {
  if (!path || path === '$') return obj
  const parts = path.replace(/^\$\.?/, '').split('.')
  let current = obj
  for (const part of parts) {
    if (current == null) return null
    current = (current as Record<string, unknown>)[part]
  }
  return current
}

function addQueryParam(url: string, name: string, value: string): string {
  try {
    const u = new URL(url)
    u.searchParams.set(name, value)
    return u.toString()
  } catch {
    const sep = url.includes('?') ? '&' : '?'
    return `${url}${sep}${encodeURIComponent(name)}=${encodeURIComponent(value)}`
  }
}

function parseLinkHeader(header: string | null): string | null {
  if (!header) return null
  const match = header.match(/<([^>]+)>;\s*rel="next"/)
  return match ? match[1] : null
}

function ensureApiCacheDir(): string {
  const dir = join(app.getPath('userData'), 'api-cache')
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  return dir
}

async function inferApiColumns(jsonPath: string): Promise<ColumnInfo[]> {
  const safe = jsonPath.replace(/'/g, "''")
  return new Promise((resolve, reject) => {
    conn.run(
      `CREATE OR REPLACE VIEW __api_schema_sniff AS SELECT * FROM read_json_auto('${safe}', format='array') LIMIT 0`,
      (err) => {
        if (err) return reject(new Error(`Schema inference failed: ${err.message}`))
        conn.all('DESCRIBE __api_schema_sniff', (descErr, rows) => {
          if (descErr) return reject(new Error(descErr.message))
          resolve((rows as DescribeRow[]).map((r) => ({
            name: r.column_name,
            type: normalizeType(r.column_type),
          })))
        })
      }
    )
  })
}

// ─── api:fetch ────────────────────────────────────────────────────────────────

interface ApiFetchParams {
  url: string
  method: string
  headers: Record<string, string>
  body?: string
  upstreamSQL?: string
  nodeId: string
}

interface ApiFetchResult {
  jsonPath: string
  columns: ColumnInfo[]
  rowCount: number
}

ipcMain.handle('api:fetch', async (_, params: ApiFetchParams): Promise<ApiFetchResult> => {
  const { url, method, headers, body, upstreamSQL, nodeId } = params

  let requestBody: string | undefined = body || undefined
  if (upstreamSQL) {
    const rows: Record<string, unknown>[] = await new Promise((resolve, reject) => {
      conn.all(upstreamSQL, (err, r) => err ? reject(new Error(err.message)) : resolve(r as Record<string, unknown>[]))
    })
    requestBody = JSON.stringify(sanitizeBigInts(rows))
  }

  const response = await fetch(url, {
    method,
    headers: { 'Content-Type': 'application/json', ...headers },
    body: requestBody,
  })

  if (!response.ok) throw new Error(`HTTP ${response.status}: ${response.statusText}`)

  const json = await response.json()
  const array = Array.isArray(json) ? json : [json]

  const cacheDir = ensureApiCacheDir()
  const jsonPath = join(cacheDir, `${nodeId}.json`)
  await fs.writeFile(jsonPath, JSON.stringify(sanitizeBigInts(array)))

  const columns = array.length > 0 ? await inferApiColumns(jsonPath) : []
  return { jsonPath, columns, rowCount: array.length }
})

// ─── api:auth ─────────────────────────────────────────────────────────────────

interface ApiAuthParams {
  url: string
  method: string
  headers: Record<string, string>
  body?: string
  tokenPath: string
}

ipcMain.handle('api:auth', async (_, params: ApiAuthParams): Promise<{ token: string }> => {
  const { url, method, headers, body, tokenPath } = params

  const response = await fetch(url, {
    method,
    headers: { 'Content-Type': 'application/json', ...headers },
    body: body || undefined,
  })

  if (!response.ok) throw new Error(`HTTP ${response.status}: ${response.statusText}`)

  const json = await response.json()
  const token = extractByPath(json, tokenPath)

  if (!token || typeof token !== 'string')
    throw new Error(`Token not found at path "${tokenPath}"`)

  return { token }
})

// ─── api:paginated ────────────────────────────────────────────────────────────

interface ApiPaginatedParams {
  url: string
  headers: Record<string, string>
  strategy: 'page' | 'offset' | 'cursor' | 'link-header'
  pageParam?: string
  pageStart?: number
  offsetParam?: string
  limitParam?: string
  limitValue?: number
  cursorPath?: string
  cursorParam?: string
  cursorIn?: 'query' | 'body'
  dataPath?: string
  maxPages?: number
  failOnError?: boolean
  nodeId: string
}

interface ApiPaginatedResult {
  jsonPath: string
  columns: ColumnInfo[]
  rowCount: number
  pagesFetched: number
  hadErrors: boolean
}

ipcMain.handle('api:paginated', async (_, params: ApiPaginatedParams): Promise<ApiPaginatedResult> => {
  const {
    url, headers, strategy, nodeId,
    pageParam = 'page', pageStart = 1,
    offsetParam = 'offset', limitParam = 'limit', limitValue = 100,
    cursorPath = '', cursorParam = 'cursor', cursorIn = 'query',
    dataPath = '', maxPages = 100, failOnError = false,
  } = params

  const allRows: unknown[] = []
  let pagesFetched = 0
  let hadErrors = false
  let done = false
  let cursor: string | null = null
  let nextUrl: string = url

  while (!done && pagesFetched < maxPages) {
    let requestUrl = url
    let requestBody: string | undefined

    if (strategy === 'page') {
      requestUrl = addQueryParam(url, pageParam, String(pageStart + pagesFetched))
    } else if (strategy === 'offset') {
      requestUrl = addQueryParam(url, offsetParam, String(pagesFetched * limitValue))
      requestUrl = addQueryParam(requestUrl, limitParam, String(limitValue))
    } else if (strategy === 'cursor') {
      if (pagesFetched > 0 && cursor) {
        if (cursorIn === 'query') requestUrl = addQueryParam(url, cursorParam, cursor)
        else requestBody = JSON.stringify({ [cursorParam]: cursor })
      }
    } else if (strategy === 'link-header') {
      requestUrl = nextUrl
    }

    try {
      const response = await fetch(requestUrl, {
        method: 'GET',
        headers: { 'Content-Type': 'application/json', ...headers },
        body: requestBody,
      })

      if (!response.ok) {
        if (failOnError) throw new Error(`HTTP ${response.status}: ${response.statusText}`)
        hadErrors = true
        done = true
        break
      }

      const json = await response.json()
      const data = dataPath ? extractByPath(json, dataPath) : json
      const rows = Array.isArray(data) ? data : (data != null ? [data] : [])

      if (rows.length === 0) { done = true; break }

      allRows.push(...rows)
      pagesFetched++

      if (strategy === 'page' || strategy === 'offset') {
        if (rows.length < limitValue) done = true
      } else if (strategy === 'cursor') {
        cursor = extractByPath(json, cursorPath) as string | null
        if (!cursor) done = true
      } else if (strategy === 'link-header') {
        const linkHdr = response.headers.get('link')
        const link = parseLinkHeader(linkHdr)
        if (link) nextUrl = link
        else done = true
      }
    } catch (err) {
      if (failOnError) throw err
      hadErrors = true
      done = true
    }
  }

  const cacheDir = ensureApiCacheDir()
  const jsonPath = join(cacheDir, `${nodeId}.json`)
  await fs.writeFile(jsonPath, JSON.stringify(sanitizeBigInts(allRows)))

  const columns = allRows.length > 0 ? await inferApiColumns(jsonPath) : []
  return { jsonPath, columns, rowCount: allRows.length, pagesFetched, hadErrors }
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
  if (t === 'JSON') return 'JSON'
  // DuckDB complex types from read_json_auto: STRUCT(...), MAP(...), []
  if (t.startsWith('STRUCT') || t.startsWith('MAP') || t.startsWith('UNION')) return 'JSON'
  if (t.endsWith('[]') || t.startsWith('LIST') || t.startsWith('[')) return 'ARRAY'
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
  rowCount: number | null
}

export interface ExportResult {
  filePath: string
  rowCount: number | null
}

export interface ReportColumnStat {
  name: string
  type: string
  nonNull: number
  distinct: number
  min: string | null
  max: string | null
  blank: number
  top: { value: string | null; count: number }[]
}

export interface ReportResult {
  rowCount: number
  columns: ReportColumnStat[]
}

interface DescribeRow {
  column_name: string
  column_type: string
}
