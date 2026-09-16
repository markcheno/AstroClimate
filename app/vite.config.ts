import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

// Deployed to https://markcheno.github.io/AstroClimate/, a GitHub *project* page,
// so every asset URL needs the repo name as a prefix. Without this the built
// site loads index.html and then 404s on every script and JSON file.
// Overridable so a user fork or a custom domain can build with a different base.
const base = process.env.ASTROCLIMATE_BASE ?? '/AstroClimate/'

export default defineConfig({
  base,
  plugins: [react()],
  build: {
    outDir: 'dist',
    sourcemap: true,
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
})
