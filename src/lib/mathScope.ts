import { create, all } from 'mathjs'

export const math = create(all)

const defaultScope: Record<string, unknown> = {}

export function evaluateCell(
  input: string,
  customScope?: Record<string, unknown>
): { result: string; error: string | null } {
  try {
    const result = math.evaluate(input, customScope ?? defaultScope)
    return { result: result !== undefined ? String(result) : '', error: null }
  } catch (e) {
    return { result: '', error: (e as Error).message }
  }
}

const MATH_BUILTINS = ['pi', 'e', 'i', 'Infinity', 'NaN', 'true', 'false']

// Returns true if the expression can be plotted on the graph
export function isGraphable(input: string, scope: Record<string, unknown>): boolean {
  try {
    const node = math.parse(input)

    // x = <number> is a vertical line — graphable
    if (node.type === 'AssignmentNode' && (node as any).name === 'x') return true

    const symbols = new Set<string>()
    node.traverse((n: any) => {
      if (n.type === 'SymbolNode') symbols.add(n.name)
    })
    const undefinedSymbols = [...symbols].filter(
      (s) => s !== 'x' && s !== 'y' && !(s in scope) && !MATH_BUILTINS.includes(s) && typeof (math as any)[s] === 'undefined'
    )
    const graphVars = [...symbols].filter((s) => s === 'x' || s === 'y')
    return undefinedSymbols.length === 0 && graphVars.length > 0
  } catch {
    return false
  }
}
