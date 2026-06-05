/// <reference types="vite/client" />

import type {
  CSVSelectResult,
  PreviewResult,
  ExportResult,
  ProjectLoadResult,
  ReportResult,
  ColumnInfo,
  PgConfig,
  PgFetchResult,
  TableEntry,
} from './lib/types'

// ── Types that live in the preload but aren't in lib/types ───────────────────
interface PgWriteResult    { rowCount: number }
interface PgTestResult     { ok: boolean; error?: string }
interface MaterializeResult { parquetPath: string; columns: ColumnInfo[] }

declare global {
  interface Window {
    api: {
      // ── CSV / JSON ─────────────────────────────────────────────────────────
      selectCSV:    () => Promise<CSVSelectResult | null>
      selectJSON:   () => Promise<CSVSelectResult | null>
      exportCSV:    (
        sql: string,
        delimiter?: string,
        includeHeader?: boolean,
        defaultPath?: string,
        skipDialogIfDefaultPath?: boolean
      ) => Promise<ExportResult | null>
      pickCSVPath:  (defaultPath?: string) => Promise<string | null>

      // ── DuckDB ─────────────────────────────────────────────────────────────
      dbPreview:    (sql: string) => Promise<PreviewResult>
      dbProfile:    (sql: string, columns: ColumnInfo[], topN?: number) => Promise<ReportResult>

      // ── Materialize ────────────────────────────────────────────────────────
      materializeRun: (sql: string, existingPath?: string) => Promise<MaterializeResult>

      // ── Project ────────────────────────────────────────────────────────────
      saveProject:  (data: string) => Promise<string | null>
      saveToPath:   (path: string, data: string) => Promise<void>
      loadProject:  () => Promise<ProjectLoadResult | null>

      // ── PostgreSQL ─────────────────────────────────────────────────────────
      pgTest:          (config: PgConfig) => Promise<PgTestResult>
      pgFetch:         (config: PgConfig, query: string) => Promise<PgFetchResult>
      pgFetchCached:   (config: PgConfig, query: string, force: boolean) => Promise<PgFetchResult>
      pgClearCache:    (csvPath: string) => Promise<void>
      pgWrite:         (config: PgConfig, sql: string, tableName: string, writeMode: string) => Promise<PgWriteResult>
      pgListTables:    (config: PgConfig) => Promise<TableEntry[]>
      pgDescribeTable: (config: PgConfig, schema: string, table: string) => Promise<ColumnInfo[]>
    }
  }
}

export {}
