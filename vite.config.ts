import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
export default defineConfig({
  plugins: [react()], base: '/fang/',
  worker: { format: 'es' },
  build: { chunkSizeWarningLimit: 1700 },
  test: { environment: 'node', include: ['tests/**/*.test.ts'] }
})
