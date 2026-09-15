import type { Meta, StoryObj } from '@storybook/react'
import { NumberFieldComponent } from '../../field-components'
import { createMockNumberField } from '../../../../../.storybook/mocks/field-mocks'

const meta: Meta<typeof NumberFieldComponent> = {
  title: 'Fields/NumberField',
  component: NumberFieldComponent,
  parameters: {
    layout: 'centered',
  },
  tags: ['autodocs'],
}

export default meta
type Story = StoryObj<typeof NumberFieldComponent>

export const Default: Story = {
  args: {
    id: '/test-node',
    field: createMockNumberField(42),
    disabled: false,
  },
}

export const WithRange: Story = {
  args: {
    id: '/test-node',
    field: createMockNumberField(50, { min: 0, max: 100, step: 5 }),
    disabled: false,
  },
}

export const Disabled: Story = {
  args: {
    id: '/test-node',
    field: createMockNumberField(42),
    disabled: true,
  },
}

export const NegativeValue: Story = {
  args: {
    id: '/test-node',
    field: createMockNumberField(-123.45),
    disabled: false,
  },
}

export const Zero: Story = {
  args: {
    id: '/test-node',
    field: createMockNumberField(0),
    disabled: false,
  },
}

// Visual diffing: all states in one story
export const AllStates: Story = {
  render: () => (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', minWidth: '300px' }}>
      <div>
        <h3 style={{ margin: '0 0 8px 0', fontSize: '14px', fontWeight: 600 }}>Default</h3>
        <NumberFieldComponent id="/test" field={createMockNumberField(42)} disabled={false} />
      </div>
      <div>
        <h3 style={{ margin: '0 0 8px 0', fontSize: '14px', fontWeight: 600 }}>With Range</h3>
        <NumberFieldComponent
          id="/test"
          field={createMockNumberField(50, { min: 0, max: 100, step: 5 })}
          disabled={false}
        />
      </div>
      <div>
        <h3 style={{ margin: '0 0 8px 0', fontSize: '14px', fontWeight: 600 }}>Disabled</h3>
        <NumberFieldComponent id="/test" field={createMockNumberField(42)} disabled={true} />
      </div>
      <div>
        <h3 style={{ margin: '0 0 8px 0', fontSize: '14px', fontWeight: 600 }}>Negative</h3>
        <NumberFieldComponent id="/test" field={createMockNumberField(-123.45)} disabled={false} />
      </div>
      <div>
        <h3 style={{ margin: '0 0 8px 0', fontSize: '14px', fontWeight: 600 }}>Zero</h3>
        <NumberFieldComponent id="/test" field={createMockNumberField(0)} disabled={false} />
      </div>
    </div>
  ),
}
