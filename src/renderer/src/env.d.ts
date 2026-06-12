/// <reference types="vite/client" />

import type { PipelinesApi } from '../../shared/ipc'

declare global {
  interface Window {
    api: PipelinesApi
  }
}

export {}
