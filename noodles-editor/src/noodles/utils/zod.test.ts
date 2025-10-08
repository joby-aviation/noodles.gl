import { describe, expect, it } from 'vitest'
import z from 'zod/v4'

describe('z.function helper', () => {
  it('matches function signatures', () => {
    const schema = z
      .function()
      .input(z.tuple([z.string(), z.number()]))
      .output(z.string())

    const fn = (a: string, b: number) => `${a}${b}`

    const result = schema.safeParse(fn)
    expect(result.success).toBe(true)
  })

  it('correctly handles invalid functions', () => {
    const schema = z
      .function()
      .input(z.tuple([z.string(), z.number()]))
      .output(z.string())

    const fn = (a: string) => `${a}`

    const result = schema.safeParse(fn)
    expect(() => result.data(1, 2)).toThrow()
  })

  // Blocked on https://github.com/colinhacks/zod/issues/4143
  it('finds the correct branch of a union', () => {
    const schema = z.union([
      z.string(),
      z
        .function()
        .input(
          z.union([
            z.tuple([]),
            z.tuple([z.unknown()]),
            z.tuple([z.unknown(), z.unknown()]),
            z.tuple([z.unknown(), z.unknown(), z.unknown()]),
          ])
        )
        .output(z.string()),
    ])

    const fn = (a: string) => `${a}`

    const result1 = schema.safeParse(fn)
    expect(result1.success).toBe(true)
    expect(result1.error?.message).toBeUndefined()

    const fn2 = (a: string, b: number) => `${a}${b}`

    const result2 = schema.safeParse(fn2)
    expect(result2.success).toBe(true)

    const result3 = schema.safeParse('hello')
    expect(result3.success).toBe(true)

    const result4 = schema.safeParse(1)
    expect(result4.success).toBe(false)
    expect(result4.error.message).toContain('Invalid input: expected string, received number')
  })

  it('uses the correct branch of an or', () => {
    const schema = z.string().or(
      z
        .function()
        .input(
          z.union([
            z.tuple([]),
            z.tuple([z.unknown()]),
            z.tuple([z.unknown(), z.unknown()]),
            z.tuple([z.unknown(), z.unknown(), z.unknown()]),
          ])
        )
        .output(z.string())
    )

    const result1 = schema.safeParse('hello')
    expect(result1.success).toBe(true)

    const result2 = schema.safeParse(1)
    expect(result2.success).toBe(false)
    expect(() => result2.data()).toThrow()
    expect(result2).toMatchInlineSnapshot(`
      {
        "error": [ZodError: [
        {
          "code": "invalid_union",
          "errors": [
            [
              {
                "expected": "string",
                "code": "invalid_type",
                "path": [],
                "message": "Invalid input: expected string, received number"
              }
            ],
            [
              {
                "code": "invalid_type",
                "expected": "function",
                "path": [],
                "message": "Invalid input: expected function, received number"
              }
            ]
          ],
          "path": [],
          "message": "Invalid input"
        }
      ]],
        "success": false,
      }
    `)

    const result3 = schema.safeParse(() => 'hello')
    expect(result3.success).toBe(true)
    expect(result3.data()).toBe('hello')

    const result4 = schema.safeParse((a: string) => `${a}`)
    expect(result4.success).toBe(true)
    expect(result4.data('hi')).toBe('hi')

    const result5 = schema.safeParse((a: string, b: number) => `${a}-${b}`)
    expect(result5.success).toBe(true)
    expect(result5.data('hi', 1)).toBe('hi-1')

    const result6 = schema.safeParse((a: string, b: number, c: string) => `${a}${b}${c}`)
    expect(result6.success).toBe(true)
    expect(result6.data('hi', 1, '2')).toBe('hi12')
  })
})
