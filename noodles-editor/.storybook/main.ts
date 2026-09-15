import type { StorybookConfig } from '@storybook/react-vite'
import { mergeConfig } from 'vite'

const config: StorybookConfig = {
  stories: ['../src/**/__stories__/**/*.stories.@(ts|tsx)'],
  addons: ['@storybook/addon-essentials', '@storybook/addon-interactions'],
  framework: {
    name: '@storybook/react-vite',
    options: {},
  },
  viteFinal: async config => {
    return mergeConfig(config, {
      css: {
        modules: {
          localsConvention: 'camelCaseOnly',
        },
      },
      plugins: [
        {
          name: 'duckdb-wasm-stub',
          enforce: 'pre',
          resolveId(id) {
            if (id.startsWith('@duckdb/duckdb-wasm')) {
              return '\0duckdb-stub:' + id
            }
          },
          load(id) {
            if (id.startsWith('\0duckdb-stub:')) {
              return 'export default ""'
            }
          },
        },
      ],
    })
  },
}

export default config
