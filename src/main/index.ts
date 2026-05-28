import { app, BrowserWindow, ipcMain, dialog } from 'electron'
import { join } from 'path'
import { promises as fs } from 'fs'
import { is } from '@electron-toolkit/utils'
import * as duckdb from 'duckdb'

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
ipcMain.handle('csv:export', async (_, { sql, delimiter = ',' }: { sql: string; delimiter?: string }): Promise<ExportResult | null> => {
  const { canceled, filePath } = await dialog.showSaveDialog({
    title: 'Export CSV',
    defaultPath: 'output.csv',
    filters: [{ name: 'CSV File', extensions: ['csv'] }]
  })
  if (canceled || !filePath) return null

  const safe      = filePath.replace(/'/g, "''")
  const safeDelim = delimiter.replace(/'/g, "''")

  return new Promise((resolve, reject) => {
    conn.run(
      `COPY (${sql}) TO '${safe}' (FORMAT CSV, HEADER true, DELIMITER '${safeDelim}')`,
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
ipcMain.handle('project:load', async (): Promise<string | null> => {
  const { canceled, filePaths } = await dialog.showOpenDialog({
    title: 'Open Pipeline',
    filters: [
      { name: 'Pipeline File', extensions: ['pipes'] },
      { name: 'JSON', extensions: ['json'] }
    ]
  })
  if (canceled || !filePaths[0]) return null
  return fs.readFile(filePaths[0], 'utf-8')
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
