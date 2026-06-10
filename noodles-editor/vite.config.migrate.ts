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
      external: [
        'node:fs/promises',
        'node:path',
        // External all UI/React dependencies to avoid bundling them
        'react',
        'react-dom',
        'react/jsx-runtime',
        /^@xyflow\//,
        /^primereact\//,
        /^@radix-ui\//,
        'validator',
        // External large data dependencies
        /^@duckdb\//,
        '@loaders.gl/core',
        '@loaders.gl/csv',
        '@turf/turf',
        'deck.gl',
        /^@deck.gl\//,
        'maplibre-gl',
      ],
    },
    ssr: true,
  },
  plugins: [
    nodePolyfills({
      protocolImports: true,
    }),
  ],
})
