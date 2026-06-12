import { contextBridge, ipcRenderer } from 'electron'
import type { PipelinesApi } from '../shared/ipc'

// Implementing PipelinesApi here means any drift between the bridge and the
// shared contract (src/shared/ipc.ts) is a compile error in this file.
const api: PipelinesApi = {
  // CSV / JSON / files
  selectCSV: () => ipcRenderer.invoke('csv:select'),
  selectJSON: () => ipcRenderer.invoke('json:select'),
  exportCSV: (sql, delimiter, includeHeader, defaultPath, skipDialogIfDefaultPath) =>
    ipcRenderer.invoke('csv:export', { sql, delimiter, includeHeader, defaultPath, skipDialogIfDefaultPath }),
  pickCSVPath: (defaultPath) => ipcRenderer.invoke('csv:pick-path', { defaultPath }),
  selectFileBase64: (filters) => ipcRenderer.invoke('file:select-base64', { filters }),
  rowsToBase64: (sql) => ipcRenderer.invoke('db:rows-to-base64', { sql }),

  // DuckDB
  dbPreview: (sql) => ipcRenderer.invoke('db:preview', { sql }),
  dbProfile: (sql, columns, topN) => ipcRenderer.invoke('db:profile', { sql, columns, topN }),
  materializeRun: (sql, existingPath) => ipcRenderer.invoke('materialize:run', { sql, existingPath }),

  // Project files
  saveProject: (data) => ipcRenderer.invoke('project:save', { data }),
  saveToPath: (path, data) => ipcRenderer.invoke('project:saveToPath', { path, data }),
  loadProject: () => ipcRenderer.invoke('project:load'),
  loadFromPath: (path) => ipcRenderer.invoke('project:loadFromPath', path),
  getLastFilePath: () => ipcRenderer.invoke('project:getLastPath'),
  setLastFilePath: (path) => ipcRenderer.invoke('project:setLastPath', path),

  // Secrets
  secureEncrypt: (plain) => ipcRenderer.invoke('secure:encrypt', plain),
  secureDecrypt: (encrypted) => ipcRenderer.invoke('secure:decrypt', encrypted),

  // PostgreSQL
  pgTest: (config) => ipcRenderer.invoke('pg:test', config),
  pgFetch: (config, query) => ipcRenderer.invoke('pg:fetch', config, query),
  pgFetchCached: (config, query, force) => ipcRenderer.invoke('pg:fetch-cached', config, query, force),
  pgClearCache: (csvPath) => ipcRenderer.invoke('pg:clear-cache', csvPath),
  pgWrite: (config, sql, target, writeMode) => ipcRenderer.invoke('pg:write', config, sql, target, writeMode),
  onPgWriteProgress: (cb) =>
    ipcRenderer.on('pg:write-progress', (_e, written: number, total: number) => cb(written, total)),
  offPgWriteProgress: () => ipcRenderer.removeAllListeners('pg:write-progress'),
  pgListTables: (config) => ipcRenderer.invoke('pg:list-tables', config),
  pgDescribeTable: (config, schema, table) => ipcRenderer.invoke('pg:describe-table', config, schema, table),

  pgUpdateRows: (config, sql, target, pkColumn, updateColumns) =>
    ipcRenderer.invoke('pg:update-rows', config, sql, target, pkColumn, updateColumns),
  onPgUpdateProgress: (cb) =>
    ipcRenderer.on('pg:update-progress', (_e, written: number, total: number) => cb(written, total)),
  offPgUpdateProgress: () => ipcRenderer.removeAllListeners('pg:update-progress'),
  pgExecQuery: (config, sql) => ipcRenderer.invoke('pg:exec-query', config, sql),

  // HTTP API nodes
  apiFetch: (params) => ipcRenderer.invoke('api:fetch', params),
  apiAuth: (params) => ipcRenderer.invoke('api:auth', params),
  apiPaginated: (params) => ipcRenderer.invoke('api:paginated', params),

  // Execution control
  execCancel: () => ipcRenderer.invoke('exec:cancel'),
}

contextBridge.exposeInMainWorld('api', api)
