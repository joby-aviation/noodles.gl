# Greptile Review Rules

## Field Values Are Immutable by Convention

Field values (`field.value`) in the operator system are treated as immutable. All mutations
go through `field.setValue(newValue)` which replaces the reference entirely. In-place mutation
of field values (e.g., `arr.push(item); field.setValue(arr)`) is a bug and never intentional.

This means code that stores `field.value` references (like the property history snapshot system)
can safely rely on reference stability for equality checks (`Object.is`) and only needs deep
comparison for fields whose getters create new wrapper objects (e.g., `CompoundPropsField`).

## Connected Fields Hold Upstream Data

Fields with active subscriptions (`field.subscriptions.size > 0`) receive their values from
upstream operator connections. These fields can hold very large datasets (e.g., parsed CSV
arrays with thousands of rows) and should be excluded from serialization or snapshot operations
that iterate all fields.
