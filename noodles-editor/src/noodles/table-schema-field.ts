import type { Subscription } from 'rxjs'
import { type DataField, type Field, UnknownField } from './fields'
import { inferSchema, isTableSchema, mergeTableSchemas, type TableSchema } from './table-schema'
import { deepEqual } from './utils/deep-equal'

/** A schema input that overlays connected schemas while retaining the last accepted snapshot. */
export class TableSchemaField extends UnknownField {
  serializeWhenConnected = true

  addConnection<F extends Field>(
    id: string,
    field: F,
    connectionType: 'reference' | 'value' = 'value'
  ): Subscription | undefined {
    if (connectionType === 'reference') return super.addConnection(id, field, connectionType)
    if (this.subscriptions.has(id)) return undefined

    const subscription = field.subscribe(value => {
      if (!isTableSchema(value)) {
        if (value !== null && value !== undefined) {
          this.op?.addConnectionError(id, 'Incoming table schema is invalid.', true)
        } else {
          this.op?.removeConnectionError(id)
        }
        return
      }

      const dataField = this.op?.inputs.data as DataField | undefined
      const data = Array.isArray(dataField?.value) ? dataField.value : []
      const currentSchema: TableSchema = isTableSchema(this.value) ? this.value : inferSchema(data)
      const result = mergeTableSchemas(currentSchema, value, data)

      if (!deepEqual(this.value, result.schema)) this.setValue(result.schema)
      if (dataField && !deepEqual(data, result.data)) dataField.setValue(result.data)

      if (result.warnings.length > 0) {
        this.op?.addConnectionError(id, result.warnings.join('\n'), true)
      } else {
        this.op?.removeConnectionError(id)
      }
    })
    this.subscriptions.set(id, subscription)
    return subscription
  }

  removeConnection(id: string, _connectionType: 'reference' | 'value' = 'value'): void {
    this.subscriptions.get(id)?.unsubscribe()
    this.subscriptions.delete(id)
    this.op?.removeConnectionError(id)
  }
}
