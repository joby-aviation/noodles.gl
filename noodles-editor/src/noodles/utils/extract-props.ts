import type z from 'zod'
import type { CompoundPropsField, DataField, Field, ListField } from '../fields'

// { foo: new NumberField(0), bar: new StringField('') } -> { foo: number, bar: string }
export type ExtractProps<T> = {
  [K in keyof T]: T[K] extends DataField<infer _>
    ? unknown // DataField always resolves to unknown since it can contain any data
    : T[K] extends ListField<infer F>
      ? F extends Field<infer U>
        ? U extends z.ZodType
          ? z.output<U>[]
          : unknown[]
        : unknown[]
      : T[K] extends CompoundPropsField
        ? T[K] extends { fields: infer F }
          ? F extends Record<string, Field<any>>
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
