import { create, all } from 'mathjs'

export const math = create(all)

// Convert a LaTeX string to a math.js-evaluable string.
// Handles the structures MathLive produces for basic algebra/calculus.
export function latexToMathjs(latex: string): string {
  let s = latex

  // \frac{num}{den} → (num)/(den)
  // Applied repeatedly to handle nested fractions
  let prev = ''
  while (prev !== s) {
    prev = s
    s = s.replace(/\\frac\{([^{}]*)\}\{([^{}]*)\}/g, '($1)/($2)')
  }

  s = s.replace(/\\cdot/g, '*')
  s = s.replace(/\\times/g, '*')
  s = s.replace(/\\div/g, '/')
  s = s.replace(/\\left\(/g, '(')
  s = s.replace(/\\right\)/g, ')')
  s = s.replace(/\\left\[/g, '(')
  s = s.replace(/\\right\]/g, ')')
  s = s.replace(/\\pi/g, 'pi')
  s = s.replace(/\\infty/g, 'Infinity')
  s = s.replace(/\\sqrt\{([^{}]*)\}/g, 'sqrt($1)')
  s = s.replace(/\\sin/g, 'sin')
  s = s.replace(/\\cos/g, 'cos')
  s = s.replace(/\\tan/g, 'tan')
  s = s.replace(/\\ln/g, 'log')
  s = s.replace(/\\log/g, 'log10')
  s = s.replace(/\^{([^{}]*)}/g, '^($1)')  // x^{2} → x^(2)
  s = s.replace(/\^([A-Za-z0-9])/g, '^$1') // x^2 stays x^2
  // Strip remaining backslash commands we don't handle (e.g. \left, \right remnants)
  s = s.replace(/\\[a-zA-Z]+/g, '')
  // Strip leftover braces
  s = s.replace(/[{}]/g, '')

  return s.trim()
}

export function evaluateCell(
  input: string,
  customScope: Record<string, unknown> = {}
): { result: string; error: string | null } {
  try {
    const result = math.evaluate(input, customScope)
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
