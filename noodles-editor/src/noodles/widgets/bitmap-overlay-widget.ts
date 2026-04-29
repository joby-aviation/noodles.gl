import type { WidgetPlacement, WidgetProps } from '@deck.gl/core'
import { Widget } from '@deck.gl/core'
import { escapeHtml } from './utils'

export type BitmapOverlayWidgetProps = WidgetProps & {
  placement?: WidgetPlacement | 'fill'
  viewId?: string | null
  image?: string
  width?: number
  height?: number
  opacity?: number
  scale?: number
  offsetX?: number
  offsetY?: number
}

export class BitmapOverlayWidget extends Widget<BitmapOverlayWidgetProps> {
  static defaultProps: Required<BitmapOverlayWidgetProps> = {
    ...Widget.defaultProps,
    id: 'bitmap-overlay',
    placement: 'top-right',
    viewId: null,
    image: '',
    width: 200,
    height: 200,
    opacity: 1,
    scale: 1,
    offsetX: 0,
    offsetY: 0,
  }

  className = 'deck-widget-bitmap-overlay'
  placement: WidgetPlacement | 'fill' = 'top-right'

  constructor(props: BitmapOverlayWidgetProps = {}) {
    super(props)
    this.setProps(this.props)
  }

  setProps(props: Partial<BitmapOverlayWidgetProps>): void {
    if (props.placement !== undefined) this.placement = props.placement
    if (props.viewId !== undefined) this.viewId = props.viewId
    super.setProps(props)
  }

  onRenderHTML(rootElement: HTMLElement): void {
    const {
      image = '',
      width = 200,
      height = 200,
      opacity = 1,
      scale = 1,
      placement = 'top-right',
      offsetX = 0,
      offsetY = 0,
    } = this.props

    const originMap: Record<string, string> = {
      'top-left': 'top left',
      'top-right': 'top right',
      'bottom-left': 'bottom left',
      'bottom-right': 'bottom right',
      fill: 'center',
    }

    // For 'fill' placement, use absolute positioning with offsets
    if (placement === 'fill') {
      rootElement.style.position = 'absolute'
      rootElement.style.left = '50%'
      rootElement.style.top = '50%'
      rootElement.style.transform = `translate(calc(-50% + ${offsetX}px), calc(-50% + ${offsetY}px)) scale(${scale})`
      rootElement.style.transformOrigin = 'center'
      rootElement.style.margin = '0'
    } else {
      // Corner placement with optional offsets - clear fill-specific styles
      rootElement.style.position = ''
      rootElement.style.left = ''
      rootElement.style.top = ''
      rootElement.style.transform = `translate(${offsetX}px, ${offsetY}px) scale(${scale})`
      rootElement.style.transformOrigin = originMap[placement] ?? 'top right'
      rootElement.style.margin = '8px'
    }

    rootElement.style.pointerEvents = 'none'
    rootElement.style.userSelect = 'none'

    if (!image) {
      rootElement.innerHTML = ''
      return
    }

    rootElement.innerHTML = `
      <img
        src="${escapeHtml(image)}"
        style="
          display: block;
          width: ${width}px;
          height: ${height}px;
          opacity: ${opacity};
          object-fit: contain;
          border-radius: 4px;
        "
        alt="Bitmap overlay"
      />
    `
  }
}
