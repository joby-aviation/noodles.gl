import type { ISheetObject, UnknownShorthandCompoundProps } from '@theatre/core'
import { useEffect, useState } from 'react'

// TODO make SheetProvider / useCurrentSheet agnostic to r3f - maybe use @theatre/react?
export default function useSheetValue<T extends UnknownShorthandCompoundProps>(
  sheet: ISheetObject<T>
) {
  const [_, setValue] = useState(0)

  useEffect(() => {
    const unsubscribe = sheet?.onValuesChange(_ => {
      setValue(Math.random())
    })

    return () => {
      unsubscribe()
    }
  }, [sheet])

  return sheet.value
}

export type PropsValue<T extends UnknownShorthandCompoundProps> = ReturnType<
  typeof useSheetValue<T>
>
