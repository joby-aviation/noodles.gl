const MAX_SIGNIFICANT_DIGITS = 17
const FLOAT_NOISE_ULPS = 4

type DecimalParts = {
  coefficient: bigint
  exponent: number
}

// Find the shortest decimal representation that is within a few ULPs of the
// stored double. This removes arithmetic residue such as 0.1 + 0.2 while the
// significant-digit search remains relative to the value's scientific exponent.
function normalizeFloatingPointNoise(value: number): number {
  if (!Number.isFinite(value) || value === 0) return value

  const tolerance = Math.max(Number.MIN_VALUE, Number.EPSILON * Math.abs(value) * FLOAT_NOISE_ULPS)
  for (
    let significantDigits = 1;
    significantDigits <= MAX_SIGNIFICANT_DIGITS;
    significantDigits++
  ) {
    const candidate = Number(value.toPrecision(significantDigits))
    if (Math.abs(value - candidate) <= tolerance) return candidate
  }

  return value
}

function toDecimalParts(value: number): DecimalParts | undefined {
  if (!Number.isFinite(value)) return undefined

  const normalized = normalizeFloatingPointNoise(value)
  const match = normalized.toExponential().match(/^(-?)(\d)(?:\.(\d+))?e([+-]?\d+)$/)
  if (!match) return undefined

  const [, sign, leadingDigit, fractionalDigits = '', scientificExponent] = match
  const digits = `${leadingDigit}${fractionalDigits}`
  return {
    coefficient: BigInt(`${sign}${digits}`),
    exponent: Number(scientificExponent) - fractionalDigits.length,
  }
}

function pow10(exponent: number): bigint {
  return 10n ** BigInt(exponent)
}

// Returns the place-value of the least-significant meaningful decimal digit.
// Integer and zero values have no decimal precision, so they use the field's
// declared fallback step.
export function deriveDecimalStep(value: number, fallback = 1): number {
  const fallbackStep = Number.isFinite(fallback) && fallback > 0 ? fallback : 1
  if (!Number.isFinite(value) || value === 0) return fallbackStep

  const normalized = normalizeFloatingPointNoise(value)
  if (Number.isInteger(normalized)) return fallbackStep

  const parts = toDecimalParts(normalized)
  if (!parts) return fallbackStep

  const step = 10 ** parts.exponent
  if (Number.isFinite(step) && step > 0) return step
  return parts.exponent < 0 ? Number.MIN_VALUE : fallbackStep
}

// Adds an integer number of steps using aligned decimal coefficients. Converting
// to Number only after the exact BigInt addition prevents binary residue while
// retaining any meaningful decimals finer than the selected step in `start`.
export function addDecimalSteps(start: number, step: number, delta: number): number {
  const roundedDelta = Math.round(delta)
  if (
    !Number.isFinite(start) ||
    !Number.isFinite(step) ||
    step <= 0 ||
    !Number.isSafeInteger(roundedDelta)
  ) {
    return start + roundedDelta * step
  }

  const startParts = toDecimalParts(start)
  const stepParts = toDecimalParts(step)
  if (!startParts || !stepParts) return start + roundedDelta * step

  const commonExponent = Math.min(startParts.exponent, stepParts.exponent)
  const startCoefficient = startParts.coefficient * pow10(startParts.exponent - commonExponent)
  const deltaCoefficient =
    BigInt(roundedDelta) * stepParts.coefficient * pow10(stepParts.exponent - commonExponent)

  return Number(`${startCoefficient + deltaCoefficient}e${commonExponent}`)
}
