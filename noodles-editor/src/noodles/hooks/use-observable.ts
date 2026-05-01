import { type Observable } from 'rxjs'
import { useEffect, useRef, useState } from 'react'

export function useObservable<T>(observable: Observable<T>, initialValue: T): T {
  const [value, setValue] = useState<T>(initialValue)
  const observableRef = useRef(observable)

  // Update ref on every render but only re-subscribe if needed
  useEffect(() => {
    observableRef.current = observable
  })

  useEffect(() => {
    const sub = observableRef.current.subscribe(setValue)
    return () => sub.unsubscribe()
  }, [])

  return value
}
