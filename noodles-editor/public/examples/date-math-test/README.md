# Date Math Test Example

This example demonstrates the **DateMathOp** operator for date/time arithmetic and manipulation.

## What's Demonstrated

1. **Adding durations** - Add 5 days to a base date
2. **Subtracting durations** - Subtract 2 hours from a base date
3. **Date comparisons** - Check if one date is before another
4. **Formatting dates** - Format dates as strings (YYYY-MM-DD HH:mm:ss)
5. **Extracting components** - Get the year from a date

## DateMathOp Operations

The DateMathOp supports the following operations:

### Arithmetic (returns Date)
- `add` - Add duration to date
- `subtract` - Subtract duration from date

### Difference (returns Number)
- `difference` - Calculate difference between two dates in specified units

### Comparisons (returns Boolean)
- `isBefore` - Check if date is before another date
- `isAfter` - Check if date is after another date
- `equals` - Check if dates are equal

### Formatting (returns String)
- `format` - Format date with custom format string (YYYY-MM-DD HH:mm:ss)

### Component Extraction (returns Number)
- `year`, `month`, `day` - Date components
- `hour`, `minute`, `second`, `millisecond` - Time components
- `dayOfWeek`, `dayOfYear`, `weekOfYear` - Computed properties

## Duration Units

The duration input supports:
- `years`
- `months`
- `weeks`
- `days`
- `hours`
- `minutes`
- `seconds`
- `milliseconds`

## Timeline Integration

DateMathOp can be animated via the timeline by keyframing the duration value. This allows you to create dynamic date-based animations and visualizations that change over time.
