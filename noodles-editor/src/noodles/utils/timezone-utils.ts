// Common timezones (without local - computed at render time to avoid SSR issues)
export const COMMON_TIMEZONES_BASE = [
  'UTC',
  'America/New_York',
  'America/Chicago',
  'America/Denver',
  'America/Los_Angeles',
  'Europe/London',
  'Europe/Paris',
  'Asia/Tokyo',
  'Asia/Shanghai',
  'Australia/Sydney',
]

// Get all supported timezones from Intl API
export const ALL_TIMEZONES = Intl.supportedValuesOf('timeZone')

// Build timezone options list with common timezones first, then alphabetically
// Local timezone is computed at render time to avoid SSR hydration mismatches
export function getTimezoneOptions(): string[] {
  const localTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone
  const commonTimezones = Array.from(new Set(['UTC', localTimezone, ...COMMON_TIMEZONES_BASE]))

  return [
    ...commonTimezones.filter((tz) => ALL_TIMEZONES.includes(tz)),
    ...ALL_TIMEZONES.filter((tz) => !commonTimezones.includes(tz)).sort(),
  ]
}
