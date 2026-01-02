// Manual mock for @radix-ui/react-tooltip to fix vitest browser test hangs
// Vitest automatically uses this mock when importing @radix-ui/react-tooltip

export const Provider = ({ children }: any) => children
export const Root = ({ children }: any) => children
export const Trigger = ({ children }: any) => children
export const Portal = () => null
export const Content = () => null
export const Arrow = () => null
