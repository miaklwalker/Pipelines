/// <reference types="vite/client" />

import type { CSVSelectResult, PreviewResult, ExportResult, ProjectLoadResult } from './lib/types'

declare global {
  interface Window {
    api: {
      selectCSV:   () => Promise<CSVSelectResult | null>
      exportCSV:   (sql: string, delimiter?: string) => Promise<ExportResult | null>
      dbPreview:   (sql: string) => Promise<PreviewResult>
      saveProject: (data: string) => Promise<string | null>
      saveToPath:  (path: string, data: string) => Promise<void>
      loadProject: () => Promise<ProjectLoadResult | null>
    }
  }
}

export {}
