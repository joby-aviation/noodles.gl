import { createContext, type ReactNode } from 'react'

// Mock operator store
interface MockOperatorStore {
  operators: Map<string, unknown>
  getOp: (id: string) => unknown
  setOp: (id: string, op: unknown) => void
}

const OperatorStoreContext = createContext<MockOperatorStore | null>(null)

export function MockOperatorStoreProvider({ children }: { children: ReactNode }) {
  const store: MockOperatorStore = {
    operators: new Map(),
    getOp: (id) => store.operators.get(id),
    setOp: (id, op) => store.operators.set(id, op),
  }

  return <OperatorStoreContext.Provider value={store}>{children}</OperatorStoreContext.Provider>
}

// Mock UI store
const UIStoreContext = createContext({ darkMode: true, sidebarOpen: false })

export function MockUIStoreProvider({ children }: { children: ReactNode }) {
  return <UIStoreContext.Provider value={{ darkMode: true, sidebarOpen: false }}>{children}</UIStoreContext.Provider>
}

// Mock keys store (API keys)
const KeysStoreContext = createContext({})

export function MockKeysStoreProvider({ children }: { children: ReactNode }) {
  return <KeysStoreContext.Provider value={{}}>{children}</KeysStoreContext.Provider>
}

// Combined provider
export function MockStoreProviders({ children }: { children: ReactNode }) {
  return (
    <MockOperatorStoreProvider>
      <MockUIStoreProvider>
        <MockKeysStoreProvider>{children}</MockKeysStoreProvider>
      </MockUIStoreProvider>
    </MockOperatorStoreProvider>
  )
}
