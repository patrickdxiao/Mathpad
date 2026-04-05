import { create, all } from 'mathjs'

export const math = create(all)

// Unicode constants with known mathematical values, injected into every scope
export const UNICODE_CONSTANTS: Record<string, number> = {
  π: Math.PI,
  τ: 2 * Math.PI,
  φ: (1 + Math.sqrt(5)) / 2,
}

// Matches \sum_{var=start}^{end}{body} — always expects braced upper bound.
// We pre-parse the sum manually to handle both bare and braced bounds correctly.
// Captures: 1=var, 2=start, 3=end, 4=everything after bounds
export const SUM_RE = /\\sum_\{([a-zA-Z\u0080-\uFFFF]+)=([^}]+)\}\^(\{[^}]+\}|[^\s\\{])(.*)/

// Extract the end bound value from the raw captured group (strips braces if present)
function extractBound(raw: string): string {
  return raw.startsWith('{') ? raw.slice(1, -1) : raw
}

// Split the raw string after the sum bounds into [bodyLatex, outsideLatex].
//
// Rules (match standard math notation):
//   - If the entire after-bounds string is wrapped in parens → whole thing is body, nothing outside
//   - Otherwise body ends at the first top-level + or - (not inside parens/braces)
//   - If no top-level +/- found → entire string is the body
//
// "Top-level" means depth 0 — we track paren/brace nesting as we scan.
function splitSumBody(raw: string): [string, string] {
  const s = raw.trim()
  if (!s) return ['', '']

  // Whole thing in parens → entire content is the body, nothing outside
  if (s.startsWith('(') || s.startsWith('{')) {
    let depth = 0
    const open = s[0], close = open === '(' ? ')' : '}'
    for (let i = 0; i < s.length; i++) {
      if (s[i] === open) depth++
      else if (s[i] === close) {
        depth--
        if (depth === 0) {
          const body = s.slice(1, i)           // strip outer delimiters
          const outside = s.slice(i + 1).trim()
          // Only treat as "whole body in parens" if the closing delimiter ends at or near the end
          // e.g. (5i)*2 — the *2 is outside too, but (5i) alone wraps the body
          // We return body=inner, outside=rest after the closing delimiter
          return [body, outside]
        }
      }
    }
  }

  // Scan for first top-level + or - to find where body ends
  let depth = 0
  for (let i = 0; i < s.length; i++) {
    const ch = s[i]
    if (ch === '(' || ch === '{') depth++
    else if (ch === ')' || ch === '}') depth--
    else if (depth === 0 && (ch === '+' || ch === '-') && i > 0) {
      return [s.slice(0, i).trim(), s.slice(i).trim()]
    }
  }

  // No top-level +/- found — entire string is the body
  return [s, '']
}

// Evaluate a LaTeX summation by compiling the body and looping in JS.
// Returns null if the input doesn't match the sum pattern.
function evaluateSum(
  latex: string,
  scope: Record<string, unknown>
): { result: string; error: string | null } | null {
  const m = latex.match(SUM_RE)
  if (!m) return null

  // Groups: 1=var, 2=start, 3=end (braced or single char), 4=everything after bounds
  const [, varName, startLatex, endRaw, afterBounds] = m
  const endLatex = extractBound(endRaw)

  const [bodyLatex, outsideLatex] = splitSumBody(afterBounds ?? '')
  const resolvedBody = bodyLatex || varName   // fall back to bare index variable

  try {
    const start = Math.round(Number(math.evaluate(latexToMathjs(startLatex), scope)))
    const end = Math.round(Number(math.evaluate(latexToMathjs(endLatex), scope)))

    // Compile body with index variable excluded from MATH_BUILTINS collision
    const bodyExpr = math.compile(latexToMathjs(resolvedBody))
    let acc = 0
    for (let i = start; i <= end; i++) {
      acc += Number(bodyExpr.evaluate({ ...scope, [varName]: i }))
    }

    // If there's an expression outside the sum (e.g. \sum_{i=0}^{5}5i + 3), evaluate it
    // and combine with the sum result
    if (outsideLatex) {
      const total = math.evaluate(`${acc}${latexToMathjs(outsideLatex)}`, scope)
      return { result: String(parseFloat(Number(total).toPrecision(14))), error: null }
    }

    return { result: String(acc), error: null }
  } catch (e) {
    return { result: '', error: (e as Error).message }
  }
}

// Convert a LaTeX string to a math.js-evaluable string.
// Handles the structures MathLive produces for basic algebra/calculus.
export function latexToMathjs(latex: string): string {
  let s = latex

  // \frac{num}{den} → (num)/(den)
  // Applied repeatedly to handle nested fractions
  let prev = ''
  while (prev !== s) {
    prev = s
    // Handle shorthand \frac57 (no braces, single char numerator/denominator)
    s = s.replace(/\\frac([^{\\])([^{\\])/g, '($1)/($2)')
    s = s.replace(/\\frac\{([^{}]*)\}\{([^{}]*)\}/g, '($1)/($2)')
  }

  // Unicode math italic x/y (used by MathLive macro rendering) → plain x/y for evaluation
  s = s.replace(/𝑥/g, 'x')
  s = s.replace(/𝑦/g, 'y')
  s = s.replace(/\\cdot/g, '*')
  s = s.replace(/\\times/g, '*')
  s = s.replace(/\\div/g, '/')
  s = s.replace(/\\left\(/g, '(')
  s = s.replace(/\\right\)/g, ')')
  s = s.replace(/\\left\[/g, '(')
  s = s.replace(/\\right\]/g, ')')

  // Greek letters → Unicode identifiers (math.js accepts Unicode variable names)
  // This keeps \theta distinct from a user variable named "theta"
  const greekLetters: Record<string, string> = {
    alpha: 'α', beta: 'β', gamma: 'γ', delta: 'δ', epsilon: 'ε',
    zeta: 'ζ', eta: 'η', theta: 'θ', lambda: 'λ', mu: 'μ',
    nu: 'ν', xi: 'ξ', rho: 'ρ', sigma: 'σ', tau: 'τ',
    phi: 'φ', omega: 'ω', pi: 'π',
  }
  for (const [name, unicode] of Object.entries(greekLetters)) {
    s = s.replace(new RegExp(`\\\\${name}`, 'g'), unicode)
  }

  s = s.replace(/\\infty/g, 'Infinity')
  s = s.replace(/\\sqrt\{([^{}]*)\}/g, 'sqrt($1)')
  s = s.replace(/\\sin/g, 'sin')
  s = s.replace(/\\cos/g, 'cos')
  s = s.replace(/\\tan/g, 'tan')
  s = s.replace(/\\arcsin/g, 'asin')
  s = s.replace(/\\arccos/g, 'acos')
  s = s.replace(/\\arctan/g, 'atan')
  s = s.replace(/\\ln/g, 'log')
  s = s.replace(/\\log/g, 'log10')
  s = s.replace(/\^{([^{}]*)}/g, '^($1)')  // x^{2} → x^(2)
  s = s.replace(/\^([A-Za-z0-9])/g, '^$1') // x^2 stays x^2
  // Strip remaining backslash commands we don't handle
  s = s.replace(/\\[a-zA-Z]+/g, '')
  // Strip leftover braces
  s = s.replace(/[{}]/g, '')

  return s.trim()
}

export function evaluateCell(
  input: string,
  customScope: Record<string, unknown> = {}
): { result: string; error: string | null } {
  // Handle summation before converting LaTeX
  const sumResult = evaluateSum(input, customScope)
  if (sumResult) return sumResult

  try {
    const result = math.evaluate(latexToMathjs(input), customScope)
    if (result === undefined) return { result: '', error: null }
    const formatted = typeof result === 'number'
      ? parseFloat(result.toPrecision(14)).toString()
      : String(result)
    return { result: formatted, error: null }
  } catch (e) {
    return { result: '', error: (e as Error).message }
  }
}

const MATH_BUILTINS = ['pi', 'e', 'i', 'Infinity', 'NaN', 'true', 'false', ...Object.keys(UNICODE_CONSTANTS)]

// Returns true if the expression references any symbol not in scope and not a known builtin/function
export function hasUndefinedSymbols(input: string, scope: Record<string, unknown>): boolean {
  const sumMatch = input.match(SUM_RE)
  if (sumMatch) {
    // The index variable is local — exclude it from the undefined check.
    // Check the body and outside expression with the index var added to scope.
    const [, varName, , , afterBounds] = sumMatch
    const [bodyLatex, outsideLatex] = splitSumBody(afterBounds ?? '')
    const innerScope = { ...scope, [varName]: 0 }
    const checkParts = [bodyLatex, outsideLatex].filter(Boolean)
    return checkParts.some((part) => hasUndefinedSymbols(part, innerScope))
  }

  try {
    const symbols = new Set<string>()
    math.parse(latexToMathjs(input)).traverse((n: any) => {
      if (n.type === 'SymbolNode') symbols.add(n.name)
    })
    return [...symbols].some(
      (s) => s !== 'x' && s !== 'y' && !(s in scope) && !MATH_BUILTINS.includes(s) && typeof (math as any)[s] === 'undefined'
    )
  } catch {
    return false
  }
}

// Returns true if the expression can be plotted on the graph
export function isGraphable(input: string, scope: Record<string, unknown>): boolean {
  if (SUM_RE.test(input)) return false

  try {
    const node = math.parse(latexToMathjs(input))

    // x = <number> is a vertical line — graphable
    if (node.type === 'AssignmentNode' && (node as any).name === 'x') return true

    const symbols = new Set<string>()
    node.traverse((n: any) => {
      if (n.type === 'SymbolNode') symbols.add(n.name)
    })
    const hasX = symbols.has('x')

    // y = f(x): assignment to y — graphable as a curve
    if (node.type === 'AssignmentNode' && (node as any).name === 'y') return !hasUndefinedSymbols(input, scope)
    // f(x): expression containing x — graphable as y = f(x)
    if (hasX) return !hasUndefinedSymbols(input, scope)
    // bare y or y in expression without x — not a curve we can plot
    return false
  } catch {
    return false
  }
}
