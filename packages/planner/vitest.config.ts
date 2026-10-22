import { defineConfig } from 'vitest/config'

// The planner is headless, so its tests run in Node, unlike the editor's browser suite.
export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
  },
})
