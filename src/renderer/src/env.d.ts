/// <reference types="vite/client" />

import type { CSVSelectResult, PreviewResult, ExportResult, ProjectLoadResult, ReportResult, ColumnInfo } from './lib/types'

declare global {
  interface Window {
    api: {
      selectCSV:   () => Promise<CSVSelectResult | null>
      selectJSON:  () => Promise<CSVSelectResult | null>
      exportCSV:   (sql: string, delimiter?: string) => Promise<ExportResult | null>
      dbPreview:   (sql: string) => Promise<PreviewResult>
      dbProfile:   (sql: string, columns: ColumnInfo[], topN?: number) => Promise<ReportResult>
      saveProject: (data: string) => Promise<string | null>
      saveToPath:  (path: string, data: string) => Promise<void>
      loadProject: () => Promise<ProjectLoadResult | null>
    }
  }
}

export {}
