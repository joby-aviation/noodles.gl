import type { Meta, StoryObj } from '@storybook/react'
import { BooleanFieldComponent } from '../../field-components'
import { createMockBooleanField } from '../../../../../.storybook/mocks/field-mocks'

const meta: Meta<typeof BooleanFieldComponent> = {
  title: 'Fields/BooleanField',
  component: BooleanFieldComponent,
  parameters: {
    layout: 'centered',
  },
  tags: ['autodocs'],
}

export default meta
type Story = StoryObj<typeof BooleanFieldComponent>

export const Unchecked: Story = {
  args: {
    id: '/test-node',
    field: createMockBooleanField(false),
    disabled: false,
  },
}

export const Checked: Story = {
  args: {
    id: '/test-node',
    field: createMockBooleanField(true),
    disabled: false,
  },
}

export const DisabledUnchecked: Story = {
  args: {
    id: '/test-node',
    field: createMockBooleanField(false),
    disabled: true,
  },
}

export const DisabledChecked: Story = {
  args: {
    id: '/test-node',
    field: createMockBooleanField(true),
    disabled: true,
  },
}

export const AllStates: Story = {
  render: () => (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', minWidth: '300px' }}>
      <div>
        <h3 style={{ margin: '0 0 8px 0', fontSize: '14px', fontWeight: 600 }}>Unchecked</h3>
        <BooleanFieldComponent id="/test" field={createMockBooleanField(false)} disabled={false} />
      </div>
      <div>
        <h3 style={{ margin: '0 0 8px 0', fontSize: '14px', fontWeight: 600 }}>Checked</h3>
        <BooleanFieldComponent id="/test" field={createMockBooleanField(true)} disabled={false} />
      </div>
      <div>
        <h3 style={{ margin: '0 0 8px 0', fontSize: '14px', fontWeight: 600 }}>Disabled Unchecked</h3>
        <BooleanFieldComponent id="/test" field={createMockBooleanField(false)} disabled={true} />
      </div>
      <div>
        <h3 style={{ margin: '0 0 8px 0', fontSize: '14px', fontWeight: 600 }}>Disabled Checked</h3>
        <BooleanFieldComponent id="/test" field={createMockBooleanField(true)} disabled={true} />
      </div>
    </div>
  ),
}
