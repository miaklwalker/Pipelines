import { contextBridge, ipcRenderer } from 'electron'

export type ColumnInfo     = { name: string; type: string }
export type CSVSelectResult = { filePath: string; fileName: string; columns: ColumnInfo[] }
export type PreviewResult   = { columns: string[]; rows: (string | null)[][] }
export type ExportResult    = { filePath: string; rowCount: number | null }

const api = {
  // CSV
  selectCSV: (): Promise<CSVSelectResult | null> => ipcRenderer.invoke('csv:select'),
  exportCSV: (sql: string, delimiter?: string): Promise<ExportResult | null> => ipcRenderer.invoke('csv:export', { sql, delimiter }),
  // DB
  dbPreview: (sql: string): Promise<PreviewResult> => ipcRenderer.invoke('db:preview', { sql }),
  // Project
  saveProject: (data: string): Promise<string | null> => ipcRenderer.invoke('project:save', { data }),
  saveToPath: (path: string, data: string): Promise<void> => ipcRenderer.invoke('project:saveToPath', { path, data }),
  loadProject: (): Promise<string | null> => ipcRenderer.invoke('project:load'),
}

contextBridge.exposeInMainWorld('api', api)

declare global {
  interface Window { api: typeof api }
}
