import { ReactFlowProvider } from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import type { Preview } from '@storybook/react'
import { MockStoreProviders } from './mocks/store-mocks'
import '../src/index.css'
import '../src/noodles/noodles.module.css'
import 'primereact/resources/themes/lara-dark-blue/theme.css'
import 'primereact/resources/primereact.min.css'
import 'primeicons/primeicons.css'

const preview: Preview = {
  parameters: {
    controls: {
      matchers: {
        color: /(background|color)$/i,
        date: /Date$/i,
      },
    },
    backgrounds: {
      default: 'dark',
      values: [
        { name: 'dark', value: '#1a1a1a' },
        { name: 'light', value: '#ffffff' },
      ],
    },
  },
  decorators: [
    (Story) => (
      <MockStoreProviders>
        <ReactFlowProvider>
          <div style={{ padding: '20px' }}>
            <Story />
          </div>
        </ReactFlowProvider>
      </MockStoreProviders>
    ),
  ],
}

export default preview
