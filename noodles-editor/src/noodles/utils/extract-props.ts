import type z from 'zod'
import type { CompoundPropsField, DataField, Field, GeoJsonField, ListField } from '../fields'

// { foo: new NumberField(0), bar: new StringField('') } -> { foo: number, bar: string }
// DataField<D, TElement> -> TElement[] (array of element type via phantom type)
// GeoJsonField<D, TElement> -> TElement (the GeoJSON type via phantom type)
export type ExtractProps<T> = {
  [K in keyof T]: T[K] extends DataField<infer _D, infer TElement>
    ? TElement[] // DataField extracts to TElement[] via phantom type
    : T[K] extends GeoJsonField<infer _D, infer TElement>
      ? TElement // GeoJsonField extracts to TElement via phantom type
      : T[K] extends ListField<infer F>
        ? F extends Field<infer U>
          ? U extends z.ZodType
            ? z.output<U>[]
            : unknown[]
          : unknown[]
        : T[K] extends CompoundPropsField
          ? T[K] extends { fields: infer F }
            ? // biome-ignore lint/suspicious/noExplicitAny: Generic field type extraction requires any
              F extends Record<string, Field<any>>
              ? {
                  [P in keyof F]: F[P] extends Field<infer U>
                    ? U extends z.ZodType
                      ? z.output<U>
                      : F[P] extends { value: infer V }
                        ? V
                        : unknown
                    : never
                }
              : Record<string, unknown>
            : Record<string, unknown>
          : T[K] extends Field<infer U>
            ? U extends z.ZodType
              ? z.output<U>
              : T[K] extends { value: infer V }
                ? V
                : unknown
            : never
}
