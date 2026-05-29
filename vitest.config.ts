import { defineConfig } from 'vitest/config'
import path from 'path'

export default defineConfig({
  test: {
    environment: 'node',
    pool: 'forks',        // required for native .node modules (duckdb)
    testTimeout: 30_000,
    include: ['tests/**/*.test.ts'],
    reporters: ['verbose'],
  },
  resolve: {
    alias: {
      '@lib': path.resolve(__dirname, 'src/renderer/src/lib'),
    },
  },
})
