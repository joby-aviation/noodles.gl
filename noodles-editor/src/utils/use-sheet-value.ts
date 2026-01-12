import type { ISheetObject, UnknownShorthandCompoundProps } from '@theatre/core'
import { useVal } from '@theatre/react'

// Uses @theatre/react's useVal to properly subscribe to sheet object changes,
// keeping the underlying prisms "hot" and avoiding cold prism warnings.
export default function useSheetValue<T extends UnknownShorthandCompoundProps>(
  sheet: ISheetObject<T>
): ISheetObject<T>['value'] {
  // Cast needed because useVal's conditional return type doesn't resolve to PropsValue<T>
  return useVal(sheet.props) as ISheetObject<T>['value']
}

export type PropsValue<T extends UnknownShorthandCompoundProps> = ReturnType<
  typeof useSheetValue<T>
>
