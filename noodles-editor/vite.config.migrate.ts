import { defineConfig } from 'vite'
import { nodePolyfills } from 'vite-plugin-node-polyfills'

export default defineConfig({
  build: {
    lib: {
      entry: './scripts/migrate-project-files.ts',
      formats: ['es'],
      fileName: 'migrate-project-files',
    },
    outDir: './dist',
    emptyOutDir: false,
    rollupOptions: {
      external: ['node:fs/promises', 'node:path'],
    },
    ssr: true,
  },
  plugins: [
    nodePolyfills({
      protocolImports: true,
    }),
  ],
})
