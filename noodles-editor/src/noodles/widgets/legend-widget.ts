import {Widget} from '@deck.gl/core'
import type {WidgetPlacement, WidgetProps} from '@deck.gl/core'

export type LegendWidgetProps = WidgetProps & {
  placement?: WidgetPlacement
  viewId?: string | null
  colorStops?: string[]
  label?: string
  minValue?: number
  maxValue?: number
  scale?: number
}

export class LegendWidget extends Widget<LegendWidgetProps> {
  static defaultProps: Required<LegendWidgetProps> = {
    ...Widget.defaultProps,
    id: 'legend',
    placement: 'bottom-right',
    viewId: null,
    colorStops: [],
    label: '',
    minValue: 0,
    maxValue: 1,
    scale: 1,
  }

  className = 'deck-widget-legend'
  placement: WidgetPlacement = 'bottom-right'

  constructor(props: LegendWidgetProps = {}) {
    super(props)
    this.setProps(this.props)
  }

  setProps(props: Partial<LegendWidgetProps>): void {
    if (props.placement !== undefined) this.placement = props.placement
    if (props.viewId !== undefined) this.viewId = props.viewId
    super.setProps(props)
  }

  onRenderHTML(rootElement: HTMLElement): void {
    const {colorStops = [], label = '', minValue = 0, maxValue = 1, scale = 1, placement = 'bottom-right'} = this.props

    const originMap: Record<string, string> = {
      'top-left': 'top left',
      'top-right': 'top right',
      'bottom-left': 'bottom left',
      'bottom-right': 'bottom right',
    }
    rootElement.style.transform = `scale(${scale})`
    rootElement.style.transformOrigin = originMap[placement] ?? 'bottom right'

    // Outer container styles
    rootElement.style.background = 'rgba(20, 20, 20, 0.82)'
    rootElement.style.border = '1px solid rgba(255,255,255,0.12)'
    rootElement.style.borderRadius = '6px'
    rootElement.style.padding = '8px 10px'
    rootElement.style.minWidth = '140px'
    rootElement.style.maxWidth = '200px'
    rootElement.style.fontFamily = 'system-ui, sans-serif'
    rootElement.style.fontSize = '11px'
    rootElement.style.color = 'rgba(255,255,255,0.85)'
    rootElement.style.pointerEvents = 'none'
    rootElement.style.userSelect = 'none'
    rootElement.style.margin = '8px'

    const gradient = colorStops.join(', ')
    const minLabel = formatValue(minValue)
    const maxLabel = formatValue(maxValue)

    rootElement.innerHTML = `
      ${label ? `<div style="margin-bottom:5px;font-weight:600;letter-spacing:0.02em;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${escapeHtml(label)}</div>` : ''}
      <div style="height:10px;border-radius:3px;background:linear-gradient(to right,${gradient});margin-bottom:4px;"></div>
      <div style="display:flex;justify-content:space-between;gap:8px;opacity:0.75;">
        <span>${escapeHtml(minLabel)}</span>
        <span>${escapeHtml(maxLabel)}</span>
      </div>
    `
  }
}

function formatValue(v: number): string {
  if (!Number.isFinite(v)) return String(v)
  const s = v.toPrecision(4)
  return String(parseFloat(s))
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}
