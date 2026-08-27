import type { Meta, StoryObj } from '@storybook/react'
import { ColorFieldComponent } from '../../field-components'
import { createMockColorField } from '../../../../../.storybook/mocks/field-mocks'

const meta: Meta<typeof ColorFieldComponent> = {
  title: 'Fields/ColorField',
  component: ColorFieldComponent,
  parameters: {
    layout: 'centered',
  },
  tags: ['autodocs'],
}

export default meta
type Story = StoryObj<typeof ColorFieldComponent>

export const Default: Story = {
  args: {
    id: '/test-node',
    field: createMockColorField('#3b82f6'),
    disabled: false,
  },
}

export const Red: Story = {
  args: {
    id: '/test-node',
    field: createMockColorField('#ef4444'),
    disabled: false,
  },
}

export const Green: Story = {
  args: {
    id: '/test-node',
    field: createMockColorField('#10b981'),
    disabled: false,
  },
}

export const Disabled: Story = {
  args: {
    id: '/test-node',
    field: createMockColorField('#3b82f6'),
    disabled: true,
  },
}

export const AllStates: Story = {
  render: () => (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', minWidth: '300px' }}>
      <div>
        <h3 style={{ margin: '0 0 8px 0', fontSize: '14px', fontWeight: 600 }}>Blue (Default)</h3>
        <ColorFieldComponent id="/test" field={createMockColorField('#3b82f6')} disabled={false} />
      </div>
      <div>
        <h3 style={{ margin: '0 0 8px 0', fontSize: '14px', fontWeight: 600 }}>Red</h3>
        <ColorFieldComponent id="/test" field={createMockColorField('#ef4444')} disabled={false} />
      </div>
      <div>
        <h3 style={{ margin: '0 0 8px 0', fontSize: '14px', fontWeight: 600 }}>Green</h3>
        <ColorFieldComponent id="/test" field={createMockColorField('#10b981')} disabled={false} />
      </div>
      <div>
        <h3 style={{ margin: '0 0 8px 0', fontSize: '14px', fontWeight: 600 }}>Purple</h3>
        <ColorFieldComponent id="/test" field={createMockColorField('#a855f7')} disabled={false} />
      </div>
      <div>
        <h3 style={{ margin: '0 0 8px 0', fontSize: '14px', fontWeight: 600 }}>Disabled</h3>
        <ColorFieldComponent id="/test" field={createMockColorField('#3b82f6')} disabled={true} />
      </div>
    </div>
  ),
}
