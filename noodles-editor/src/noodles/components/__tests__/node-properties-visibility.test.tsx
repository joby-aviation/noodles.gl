// Component tests for NodeProperties field visibility editing UI
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { Edge } from '@xyflow/react'
import { ReactFlowProvider } from '@xyflow/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SheetContext } from '../../../utils/sheet-context'
import type { DeckRendererOp, GeoJsonLayerOp } from '../../operators'
import { clearOps, getOp } from '../../store'
import { transformGraph } from '../../transform-graph'
import { NodeProperties } from '../node-properties'

// Mock edges for tests - will be updated per test
let mockEdges: Edge[] = []

// Mock useReactFlow and useEdges
vi.mock('@xyflow/react', async () => {
  const actual = await vi.importActual('@xyflow/react')
  return {
    ...actual,
    useReactFlow: () => ({
      setEdges: vi.fn(),
      getEdges: () => mockEdges,
      setNodes: vi.fn(),
      getNodes: vi.fn(() => []),
      getNode: vi.fn(),
    }),
    useEdges: () => mockEdges,
    useNodes: () => [],
  }
})

// Mock rebindOperatorToTheatre
vi.mock('../../theatre-bindings', () => ({
  rebindOperatorToTheatre: vi.fn(),
}))

// Mock CSS modules
vi.mock('../node-properties.module.css', () => ({
  default: new Proxy({}, { get: (_, prop) => prop }),
}))

vi.mock('../menu.module.css', () => ({
  default: new Proxy({}, { get: (_, prop) => prop }),
}))

// Mock navigator.clipboard using vi.stubGlobal for browser compatibility
const mockClipboard = {
  writeText: vi.fn().mockResolvedValue(undefined),
  readText: vi.fn().mockResolvedValue(''),
}
vi.stubGlobal('navigator', {
  ...navigator,
  clipboard: mockClipboard,
})

describe('NodeProperties field visibility editing', () => {
  beforeEach(() => {
    clearOps()
    mockEdges = []
  })

  afterEach(() => {
    cleanup()
    clearOps()
  })

  // Helper to setup a graph and return a node for rendering
  const setupOperator = (
    type: string,
    id: string,
    inputs: Record<string, unknown> = {},
    visibleInputs?: string[]
  ) => {
    const nodes = [
      {
        id,
        type,
        position: { x: 0, y: 0 },
        data: {
          inputs,
          ...(visibleInputs ? { visibleInputs } : {}),
        },
      },
    ]
    transformGraph({ nodes, edges: [] })
    return {
      id,
      type,
      position: { x: 0, y: 0 },
      data: { inputs },
    }
  }

  // Helper to render NodeProperties with contexts
  const renderNodeProperties = (node: {
    id: string
    type: string
    position: { x: number; y: number }
    data: unknown
  }) => {
    return render(
      <SheetContext.Provider value={null}>
        <ReactFlowProvider>
          <NodeProperties node={node as any} />
        </ReactFlowProvider>
      </SheetContext.Provider>
    )
  }

  // Helper to find the edit (pencil) SVG button
  const findEditButton = () => {
    // Find the SVG element with class containing 'editIcon'
    const svgs = document.querySelectorAll('svg[class*="editIcon"]')
    if (svgs.length === 0) {
      throw new Error('Edit button not found')
    }
    return svgs[0] as HTMLElement
  }

  describe('Edit mode toggle', () => {
    it('shows edit (pencil) button in inputs section', () => {
      const node = setupOperator('DeckRendererOp', '/deck')
      renderNodeProperties(node)

      // Find the edit button by its class
      const editButton = findEditButton()
      expect(editButton).toBeInTheDocument()
    })

    it('toggles edit mode when pencil icon is clicked', () => {
      const node = setupOperator('DeckRendererOp', '/deck')
      renderNodeProperties(node)

      // Initially, "Hidden fields" divider should not be visible
      expect(screen.queryByText('Hidden fields')).not.toBeInTheDocument()

      // Click the edit button
      const editButton = findEditButton()
      fireEvent.click(editButton)

      // Now "Hidden fields" should be visible (DeckRendererOp has many hidden fields)
      expect(screen.getByText('Hidden fields')).toBeInTheDocument()
    })

    it('shows hide buttons (−) for visible fields in edit mode', () => {
      const node = setupOperator('DeckRendererOp', '/deck')
      renderNodeProperties(node)

      // Enter edit mode
      fireEvent.click(findEditButton())

      // Find hide buttons (the − buttons) - they have type="button" and contain '−'
      const allButtons = screen.getAllByRole('button')
      const hideButtons = allButtons.filter(btn => btn.textContent === '−')
      expect(hideButtons.length).toBeGreaterThan(0)
    })

    it('shows add buttons (+) for hidden fields in edit mode', () => {
      const node = setupOperator('DeckRendererOp', '/deck')
      renderNodeProperties(node)

      // Enter edit mode
      fireEvent.click(findEditButton())

      // Find add buttons (the + buttons)
      const allButtons = screen.getAllByRole('button')
      const addButtons = allButtons.filter(btn => btn.textContent === '+')
      expect(addButtons.length).toBeGreaterThan(0)
    })
  })

  describe('Showing hidden fields', () => {
    it('clicking + button shows a hidden field', () => {
      const node = setupOperator('DeckRendererOp', '/deck')
      renderNodeProperties(node)

      const op = getOp('/deck') as DeckRendererOp
      // 'effects' is hidden by default
      expect(op.inputs.effects.showByDefault).toBe(false)
      expect(op.isFieldVisible('effects')).toBe(false)

      // Enter edit mode
      fireEvent.click(findEditButton())

      // Find the 'effects' text element
      const effectsText = screen.getByText('effects')
      // Navigate up to find the property container and then find the + button
      const propertyContainer = effectsText.closest('[class*="property"]')
      expect(propertyContainer).toBeInTheDocument()

      const addButton = propertyContainer?.querySelector('button')
      expect(addButton?.textContent).toBe('+')
      fireEvent.click(addButton!)

      // Now the field should be visible
      expect(op.isFieldVisible('effects')).toBe(true)
    })

    it('search filters hidden fields', () => {
      const node = setupOperator('DeckRendererOp', '/deck')
      renderNodeProperties(node)

      // Enter edit mode
      fireEvent.click(findEditButton())

      // Find search input
      const searchInput = screen.getByPlaceholderText('Search fields...')
      expect(searchInput).toBeInTheDocument()

      // Type a search term that matches 'effects' but not 'widgets'
      fireEvent.change(searchInput, { target: { value: 'effect' } })

      // The 'effects' field should still be visible
      expect(screen.getByText('effects')).toBeInTheDocument()

      // 'widgets' should not be visible in hidden fields section (doesn't match search)
      // We need to check if it's present in the document at all
      const widgetsElements = screen.queryAllByText('widgets')
      // If widgets is in hidden fields section after search, it should be filtered out
      // The search filters the hidden fields list
      expect(
        widgetsElements.filter(el => {
          // Check if this element is in the hidden fields section
          const container = el.closest('[class*="property"]')
          const addButton = container?.querySelector('button')
          return addButton?.textContent === '+'
        }).length
      ).toBe(0)
    })

    it('Show all button shows all hidden fields', () => {
      const node = setupOperator('DeckRendererOp', '/deck')
      renderNodeProperties(node)

      const op = getOp('/deck') as DeckRendererOp

      // Count initially hidden fields
      const initiallyHiddenCount = Object.entries(op.inputs).filter(
        ([name]) => !op.isFieldVisible(name)
      ).length
      expect(initiallyHiddenCount).toBeGreaterThan(0)

      // Enter edit mode
      fireEvent.click(findEditButton())

      // Click "Show all" button
      const showAllButton = screen.getByText('Show all')
      fireEvent.click(showAllButton)

      // All fields should now be visible
      const nowHiddenCount = Object.entries(op.inputs).filter(
        ([name]) => !op.isFieldVisible(name)
      ).length
      expect(nowHiddenCount).toBe(0)
    })
  })

  describe('Hiding visible fields', () => {
    it('clicking − button hides a field without custom value', () => {
      // Start with 'effects' explicitly visible
      const node = setupOperator('DeckRendererOp', '/deck', {}, [
        'layers',
        'views',
        'basemap',
        'effects',
      ])
      renderNodeProperties(node)

      const op = getOp('/deck') as DeckRendererOp
      expect(op.isFieldVisible('effects')).toBe(true)

      // Enter edit mode
      fireEvent.click(findEditButton())

      // Find the effects field - it should be in visible fields section (has − button)
      const effectsText = screen.getByText('effects')
      const propertyContainer = effectsText.closest('[class*="property"]')
      const hideButton = propertyContainer?.querySelector('button')
      expect(hideButton?.textContent).toBe('−')
      fireEvent.click(hideButton!)

      // Now the field should be hidden
      expect(op.isFieldVisible('effects')).toBe(false)
    })

    it('cannot hide a field that has an incoming connection', () => {
      // Setup with a connection to 'layers' field
      const nodes = [
        {
          id: '/source',
          type: 'NumberOp',
          position: { x: 0, y: 0 },
          data: { inputs: {} },
        },
        {
          id: '/deck',
          type: 'DeckRendererOp',
          position: { x: 100, y: 0 },
          data: { inputs: {} },
        },
      ]
      const edges: Edge[] = [
        {
          id: '/source.out.val->/deck.par.layers',
          source: '/source',
          target: '/deck',
          sourceHandle: 'out.val',
          targetHandle: 'par.layers',
        },
      ]
      transformGraph({ nodes, edges })
      mockEdges = edges

      const node = {
        id: '/deck',
        type: 'DeckRendererOp',
        position: { x: 100, y: 0 },
        data: { inputs: {} },
      }
      renderNodeProperties(node)

      // Enter edit mode
      fireEvent.click(findEditButton())

      // Find the layers field and its − button
      const layersText = screen.getByText('layers')
      const propertyContainer = layersText.closest('[class*="property"]')
      const hideButton = propertyContainer?.querySelector('button')
      expect(hideButton?.textContent).toBe('−')

      // Button should be disabled
      expect(hideButton).toBeDisabled()
    })

    // Note: This test requires Radix UI Dialog portal support in test environment
    // The underlying logic is tested via operator state changes
    it.skip('shows warning dialog when hiding field with non-default value', async () => {
      // Setup with a non-default value for 'opacity'
      const node = setupOperator('GeoJsonLayerOp', '/geojson', { opacity: 0.5 })
      renderNodeProperties(node)

      const op = getOp('/geojson') as GeoJsonLayerOp
      expect(op.inputs.opacity.value).toBe(0.5)
      expect(op.inputs.opacity.defaultValue).toBe(1)

      // Enter edit mode
      fireEvent.click(findEditButton())

      // Find the opacity field and click its − button
      const opacityText = screen.getByText('opacity')
      const propertyContainer = opacityText.closest('[class*="property"]')
      const hideButton = propertyContainer?.querySelector('button')
      fireEvent.click(hideButton!)

      // Warning dialog should appear
      await waitFor(() => {
        expect(screen.getByText('Hide Field?')).toBeInTheDocument()
      })
    })
  })

  describe('Reset to defaults', () => {
    it('shows Reset button when visibility differs from defaults', () => {
      // Setup with explicitly visible 'effects' (which is hidden by default)
      const node = setupOperator('DeckRendererOp', '/deck', {}, [
        'layers',
        'views',
        'basemap',
        'effects',
      ])
      renderNodeProperties(node)

      // Enter edit mode
      fireEvent.click(findEditButton())

      // Reset button should be visible
      expect(screen.getByRole('button', { name: 'Reset' })).toBeInTheDocument()
    })

    it('does not show Reset button when visibility matches defaults (null)', () => {
      const node = setupOperator('NumberOp', '/num')
      renderNodeProperties(node)

      // Enter edit mode
      fireEvent.click(findEditButton())

      // Reset button should not be visible (NumberOp has all fields visible by default
      // and visibleFields.value is null)
      expect(screen.queryByRole('button', { name: 'Reset' })).not.toBeInTheDocument()
    })

    // Note: These tests require Radix UI Dialog portal support in test environment
    // The underlying reset logic is tested via operator state changes in other tests
    it.skip('shows confirmation dialog with changes preview when Reset clicked', async () => {
      // Setup with explicitly visible 'effects' (which is hidden by default)
      const node = setupOperator('DeckRendererOp', '/deck', {}, [
        'layers',
        'views',
        'basemap',
        'effects',
      ])
      renderNodeProperties(node)

      // Enter edit mode
      fireEvent.click(findEditButton())

      // Click Reset
      fireEvent.click(screen.getByRole('button', { name: 'Reset' }))

      // Confirmation dialog should appear with preview
      await waitFor(() => {
        expect(screen.getByText('Reset Field Visibility')).toBeInTheDocument()
        expect(screen.getByText('Will be hidden:')).toBeInTheDocument()
      })
    })

    it.skip('resets visibility when confirmed', async () => {
      // Setup with explicitly visible 'effects' (which is hidden by default)
      const node = setupOperator('DeckRendererOp', '/deck', {}, [
        'layers',
        'views',
        'basemap',
        'effects',
      ])
      renderNodeProperties(node)

      const op = getOp('/deck') as DeckRendererOp
      expect(op.isFieldVisible('effects')).toBe(true)

      // Enter edit mode
      fireEvent.click(findEditButton())

      // Click Reset
      fireEvent.click(screen.getByRole('button', { name: 'Reset' }))

      // Confirm in dialog - find the Reset button inside the dialog
      await waitFor(() => {
        expect(screen.getByText('Reset Field Visibility')).toBeInTheDocument()
      })

      // The dialog has two Reset buttons - one in the dialog actions
      const dialogButtons = screen.getAllByRole('button', { name: 'Reset' })
      const confirmButton = dialogButtons[dialogButtons.length - 1]
      fireEvent.click(confirmButton)

      // Visibility should be reset (effects should be hidden again)
      expect(op.visibleFields.value).toBe(null)
      expect(op.isFieldVisible('effects')).toBe(false)
    })
  })

  describe('Visibility state persistence', () => {
    it('visibility changes persist on operator', () => {
      const node = setupOperator('DeckRendererOp', '/deck')
      renderNodeProperties(node)

      const op = getOp('/deck') as DeckRendererOp
      expect(op.isFieldVisible('effects')).toBe(false)

      // Enter edit mode
      fireEvent.click(findEditButton())

      // Show the effects field
      const effectsText = screen.getByText('effects')
      const propertyContainer = effectsText.closest('[class*="property"]')
      const addButton = propertyContainer?.querySelector('button')
      fireEvent.click(addButton!)

      // Verify the operator's visibility state was updated
      expect(op.visibleFields.value).toBeInstanceOf(Set)
      expect(op.visibleFields.value?.has('effects')).toBe(true)
    })
  })
})
