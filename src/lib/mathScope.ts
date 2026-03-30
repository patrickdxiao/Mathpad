import { create, all } from 'mathjs'

// Create a single math.js instance with all functions/constants available
export const math = create(all)

// The shared scope object. All cells read from and write to this.
// math.evaluate("velocity = 5", scope) mutates this object directly,
// storing { velocity: 5 }. Subsequent evaluations can then use `velocity`.
export const scope: Record<string, unknown> = {}

export function evaluateCell(input: string): { result: string; error: string | null } {
  try {
    const result = math.evaluate(input, scope)
    return {
      result: result !== undefined ? String(result) : '',
      error: null,
    }
  } catch (e) {
    return { result: '', error: (e as Error).message }
  }
}
