/// <reference types="vite/client" />
import type { Entries } from 'type-fest'

declare module '*.csv' {
  const src: string
  export default src
}

declare global {
  interface ObjectConstructor {
    entries<T extends object>(o: T): Entries<T>
  }
}
