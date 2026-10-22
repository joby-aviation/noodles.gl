# Enable Expressions Documentation

Enable expressions allow you to conditionally show/hide custom parameters based on the values of other parameters. This creates dynamic UIs where fields appear only when relevant.

## Basic Syntax

Enable expressions are JavaScript expressions that return a truthy/falsy value:

```javascript
// Show field when 'mode' parameter equals 'advanced'
par.mode === 'advanced'

// Show field when 'enabled' parameter is true
par.enabled

// Show field when 'count' parameter is greater than 0
par.count > 0
```

## Available Context

### Local Parameters (`par`)

Access parameters from the same operator using `par.fieldName`:

```javascript
// Show when showAdvanced checkbox is checked
par.showAdvanced === true

// Show when mode is not 'simple'
par.mode !== 'simple'

// Show when value is within range
par.value > 10 && par.value < 100
```

### Cross-Operator References (`op()`)

Reference parameters or outputs from other operators:

```javascript
// Show when another operator's parameter is true
op('/config').par.enableFeature === true

// Show when data source has loaded
op('/data-loader').out.data !== null

// Combine with local parameters
par.useRemoteConfig && op('/remote-config').par.url !== ''
```

## Examples

### Show Advanced Options

```javascript
// Basic toggle
par.showAdvanced

// Or more explicit
par.showAdvanced === true
```

### Conditional by Mode

```javascript
// Show only in 'expert' mode
par.mode === 'expert'

// Show in 'advanced' or 'expert' mode
par.mode === 'advanced' || par.mode === 'expert'

// Show in any mode except 'simple'
par.mode !== 'simple'
```

### Numeric Ranges

```javascript
// Show when count is positive
par.count > 0

// Show when value is in range
par.min <= par.value && par.value <= par.max

// Show when threshold exceeded
par.temperature > 100
```

### String Matching

```javascript
// Exact match
par.format === 'csv'

// Multiple options
['csv', 'json', 'xml'].includes(par.format)

// String length check
par.name.length > 0

// Case-insensitive check (requires method call)
par.format.toLowerCase() === 'csv'
```

### Complex Conditions

```javascript
// Ternary operator
par.useCustom ? par.customValue > 0 : true

// Nested conditions
(par.mode === 'advanced' && par.enabled) || par.forceShow

// Cross-operator dependency
par.useRemoteData && op('/data-source').par.url !== ''
```

## Debugging

### Visual Indicators

When an enable expression has an error:
- An error icon (👁️‍🗨️) appears in the operator's header
- Hover over the icon to see the error message
- The field remains visible (fail-open behavior)

### Common Errors

**Syntax Error**
```javascript
// ❌ Missing right-hand side
par.value ===

// ✓ Fixed
par.value === 10
```

**Operator Not Found**
```javascript
// ❌ Referencing non-existent operator
op('/nonexistent').par.field === true

// ✓ Check operator path is correct
op('/actual-path').par.field === true
```

**Field Not Found**
```javascript
// ❌ Field doesn't exist
par.nonExistentField === true

// ✓ Use correct field name
par.existingField === true
```

**Type Mismatch**
```javascript
// ⚠️ Comparing wrong types (still works, but might not behave as expected)
par.count === '10'  // string vs number

// ✓ Use correct types
par.count === 10
```

### Dependency Tracking

The parameter editor shows which fields your expression depends on:

```javascript
// Expression:
par.mode === 'advanced' && op('/config').par.enabled

// Dependencies shown:
// - par.mode
// - /config.par.enabled
```

This helps you understand what will trigger re-evaluation of the expression.

## Best Practices

### Keep It Simple

```javascript
// ✓ Good - easy to understand
par.showAdvanced

// ⚠️ Works but harder to debug
(par.mode === 'advanced' || par.mode === 'expert') && 
(par.enabled || par.forceShow) &&
op('/config').par.globalEnable !== false
```

### Use Meaningful Parameter Names

```javascript
// ✓ Clear intent
par.showAdvancedOptions

// ⚠️ Unclear
par.flag1
```

### Avoid Side Effects

```javascript
// ❌ Don't try to modify values
par.count++  // Won't work and may cause errors

// ✓ Just read and compare
par.count > 0
```

### Handle Null/Undefined

```javascript
// ⚠️ May fail if field is null
par.config.nested.value === 'test'

// ✓ Check for existence
par.config && par.config.nested && par.config.nested.value === 'test'
```

## Limitations

1. **No Assignments**: You cannot modify values in expressions
2. **No Declarations**: Cannot use `let`, `const`, `var`
3. **Template Literals**: Interpolated expressions in template literals are not dependency-tracked
4. **Async Operations**: Expressions are evaluated synchronously, no `await`
5. **Scope**: Only `par` and `op()` are available, no access to global scope (except Math, etc.)

## Error Handling

All enable expressions use **fail-open** behavior:
- If an expression throws an error, the field **remains visible**
- Errors are logged and displayed in the operator header
- This prevents fields from becoming permanently hidden due to bugs

## Performance Considerations

- Expressions are re-evaluated when any dependency changes
- Complex expressions with many dependencies may impact performance
- Consider simplifying expressions that depend on many remote operators

## Security Note

Enable expressions execute arbitrary JavaScript code. This feature is designed for **trusted users** only (developers working on their own projects). Do not allow untrusted users to create or modify enable expressions.

## Future Enhancements

Potential improvements being considered:
- Expression templates/presets
- Visual expression builder
- Better error recovery
- Expression profiling/performance metrics
