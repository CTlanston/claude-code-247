import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    port: 7248,
    proxy: {
      '/api': { target: 'http://localhost:7247', rewrite: (p) => p.replace(/^\/api/, '') },
    },
  },
  build: { outDir: 'dist' },
})
