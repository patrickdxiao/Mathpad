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
  s = s.replace(/𝑧/g, 'z')
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

// Returns the numeric RHS if input is a plain constant assignment like "days = 30", else null
export function getConstantValue(input: string): number | null {
  const mathInput = latexToMathjs(input).trim()
  const m = mathInput.match(/^[a-zA-Z_\u0080-\uFFFF][a-zA-Z0-9_\u0080-\uFFFF]*\s*=\s*(.+)$/)
  if (!m) return null
  const n = Number(m[1].trim())
  return isFinite(n) ? n : null
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
      (s) => s !== 'x' && s !== 'y' && s !== 'r' && s !== 'θ' && !(s in scope) && !MATH_BUILTINS.includes(s) && typeof (math as any)[s] === 'undefined'
    )
  } catch {
    return false
  }
}

interface Hole { x: number; y: number }

// Numerically find zeros of a compiled function over [lo, hi] using sign-change + bisection.
// Returns x values where fn(x) ≈ 0.
function findZeros(fn: (x: number) => number, lo: number, hi: number, steps: number): number[] {
  const zeros: number[] = []
  const dx = (hi - lo) / steps
  let prev = fn(lo)

  for (let s = 1; s <= steps; s++) {
    const x = lo + s * dx
    const curr = fn(x)
    if (!isFinite(prev) || !isFinite(curr)) { prev = curr; continue }

    if (Math.abs(curr) < 1e-12) {
      if (!zeros.some(z => Math.abs(z - x) < dx * 2)) zeros.push(x)
    } else if (prev * curr < 0) {
      let a = x - dx, b = x
      for (let i = 0; i < 52; i++) {
        const mid = (a + b) / 2
        const fmid = fn(mid)
        if (!isFinite(fmid)) break
        if (fn(a) * fmid < 0) b = mid
        else a = mid
      }
      const root = (a + b) / 2
      if (!zeros.some(z => Math.abs(z - root) < dx * 2)) zeros.push(root)
    }
    prev = curr
  }
  return zeros
}

// Walk a math.js AST node and collect all DivideNode sub-expressions (numerator, denominator pairs).
function collectDivisions(node: any): Array<{ num: any; den: any }> {
  const results: Array<{ num: any; den: any }> = []
  node.traverse((n: any) => {
    if (n.type === 'OperatorNode' && n.op === '/' && n.args?.length === 2) {
      results.push({ num: n.args[0], den: n.args[1] })
    }
  })
  return results
}

// Find removable discontinuities (holes) in expr over [xMin, xMax].
// A hole exists where the denominator = 0 AND the numerator = 0 (0/0 form).
// y is approximated by evaluating just inside the discontinuity with a tiny epsilon offset.
export function findHoles(
  expr: string,
  scope: Record<string, unknown>,
  xMin: number,
  xMax: number
): Hole[] {
  const EPS = 1e-7
  const STEPS = 2000
  const holes: Hole[] = []

  let node: any
  try {
    node = math.parse(expr)
  } catch {
    return []
  }

  // Unwrap assignment (y = ...) to just the RHS
  const plotNode = node.type === 'AssignmentNode' ? node.value : node

  const divisions = collectDivisions(plotNode)
  if (divisions.length === 0) return []

  for (const { num, den } of divisions) {
    const denFn = (x: number) => {
      try { const r = den.evaluate({ ...scope, x }); return typeof r === 'number' ? r : NaN }
      catch { return NaN }
    }
    const numFn = (x: number) => {
      try { const r = num.evaluate({ ...scope, x }); return typeof r === 'number' ? r : NaN }
      catch { return NaN }
    }

    const denZeros = findZeros(denFn, xMin, xMax, STEPS)

    for (const xz of denZeros) {
      const numVal = numFn(xz)
      // Only a hole if numerator also ≈ 0 at this point (0/0 form)
      if (!isFinite(numVal) || Math.abs(numVal) > 1e-6) continue

      // Approximate the limit by evaluating the full expression at xz ± epsilon
      const evalFull = (x: number) => {
        try { const r = plotNode.evaluate({ ...scope, x }); return typeof r === 'number' ? r : NaN }
        catch { return NaN }
      }
      const yPlus = evalFull(xz + EPS)
      const yMinus = evalFull(xz - EPS)

      if (!isFinite(yPlus) && !isFinite(yMinus)) continue

      // Take the average of the two-sided estimates
      const y = isFinite(yPlus) && isFinite(yMinus)
        ? (yPlus + yMinus) / 2
        : isFinite(yPlus) ? yPlus : yMinus

      // Deduplicate
      if (!holes.some(h => Math.abs(h.x - xz) < (xMax - xMin) / STEPS * 4)) {
        holes.push({ x: xz, y })
      }
    }
  }

  return holes
}

// Returns the 3D form of an expression, or null if not 3D graphable.
// 'zxy' = z = f(x,y):  surface, x/y as inputs
// 'yxz' = y = f(x,z):  surface, x/z as inputs
// 'xyz' = x = f(y,z):  surface, y/z as inputs
// 'zx'  = z = f(x):   ribbon along y axis
// 'yx'  = y = f(x):   ribbon along z axis
// 'zy'  = z = f(y):   ribbon along x axis
// 'xy'  = x = f(y):   ribbon along z axis
// 'xz'  = x = f(z):   ribbon along y axis
// 'yz'  = y = f(z):   ribbon along x axis
export function get3DForm(input: string, scope: Record<string, unknown>): 'yxz' | 'zxy' | 'xyz' | 'zx' | 'yx' | 'zy' | 'xy' | 'xz' | 'yz' | null {
  if (SUM_RE.test(input)) return null
  try {
    const node = math.parse(latexToMathjs(input))
    const assignedVar = node.type === 'AssignmentNode' ? (node as any).name : null
    const plotNode = node.type === 'AssignmentNode' ? (node as any).value : node
    const symbols = new Set<string>()
    plotNode.traverse((n: any) => { if (n.type === 'SymbolNode') symbols.add(n.name) })

    const reserved = new Set(['x', 'y', 'z', 'r', 'θ'])
    const hasUndef = (allowed: string[]) => [...symbols].some(
      (s) => !allowed.includes(s) && !reserved.has(s) && !(s in scope) && !MATH_BUILTINS.includes(s) && typeof (math as any)[s] === 'undefined'
    )

    // Surfaces (two free variables)
    if (assignedVar === 'z' && symbols.has('x') && symbols.has('y') && !hasUndef(['x', 'y'])) return 'zxy'
    if (assignedVar === 'y' && symbols.has('x') && symbols.has('z') && !hasUndef(['x', 'z'])) return 'yxz'
    if (assignedVar === 'x' && symbols.has('y') && symbols.has('z') && !hasUndef(['y', 'z'])) return 'xyz'

    // Ribbons (one free variable)
    if (assignedVar === 'z' && symbols.has('x') && !symbols.has('y') && !hasUndef(['x'])) return 'zx'
    if (assignedVar === 'y' && symbols.has('x') && !symbols.has('z') && !hasUndef(['x'])) return 'yx'
    if (assignedVar === 'z' && symbols.has('y') && !symbols.has('x') && !hasUndef(['y'])) return 'zy'
    if (assignedVar === 'x' && symbols.has('y') && !symbols.has('z') && !hasUndef(['y'])) return 'xy'
    if (assignedVar === 'x' && symbols.has('z') && !symbols.has('y') && !hasUndef(['z'])) return 'xz'
    if (assignedVar === 'y' && symbols.has('z') && !symbols.has('x') && !hasUndef(['z'])) return 'yz'

    // Constant planes: y = c, x = c, z = c (no free 3D variables in RHS)
    const has3DVar = symbols.has('x') || symbols.has('y') || symbols.has('z')
    if (!has3DVar && !hasUndef([])) {
      if (assignedVar === 'y') return 'yxz'
      if (assignedVar === 'x') return 'xyz'
      if (assignedVar === 'z') return 'zxy'
    }

    return null
  } catch {
    return null
  }
}

export function isGraphable3D(input: string, scope: Record<string, unknown>): boolean {
  return get3DForm(input, scope) !== null
}

// Returns true if the expression is a polar curve: r = f(theta) or bare f(theta)
export function isGraphablePolar(input: string, scope: Record<string, unknown>): boolean {
  if (SUM_RE.test(input)) return false
  try {
    const node = math.parse(latexToMathjs(input))
    const assignedVar = node.type === 'AssignmentNode' ? (node as any).name : null
    const plotNode = node.type === 'AssignmentNode' ? (node as any).value : node
    const symbols = new Set<string>()
    plotNode.traverse((n: any) => { if (n.type === 'SymbolNode') symbols.add(n.name) })

    const polarReserved = new Set(['r', 'θ', 'x', 'y', 'z'])
    const hasUndef = [...symbols].some(
      (s) => !polarReserved.has(s) && !(s in scope) && !MATH_BUILTINS.includes(s) && typeof (math as any)[s] === 'undefined'
    )
    if (hasUndef) return false

    // r = f(θ): explicit polar curve
    if (assignedVar === 'r' && symbols.has('θ')) return true
    // bare f(θ): expression using θ only
    if (!assignedVar && symbols.has('θ')) return true

    return false
  } catch {
    return false
  }
}

// Returns true if the expression is x = f(y) (parametric horizontal sweep)
export function isXofY(input: string, scope: Record<string, unknown>): boolean {
  if (SUM_RE.test(input)) return false
  try {
    const node = math.parse(latexToMathjs(input))
    if (node.type !== 'AssignmentNode' || (node as any).name !== 'x') return false
    const symbols = new Set<string>()
    ;(node as any).value.traverse((n: any) => { if (n.type === 'SymbolNode') symbols.add(n.name) })
    return symbols.has('y') && !hasUndefinedSymbols(input, scope)
  } catch {
    return false
  }
}

// Returns true if the expression can be plotted on the graph
export function isGraphable(input: string, scope: Record<string, unknown>): boolean {
  if (SUM_RE.test(input)) return false

  try {
    const node = math.parse(latexToMathjs(input))

    // x = f(y): horizontal sweep — graphable
    if (node.type === 'AssignmentNode' && (node as any).name === 'x') return !hasUndefinedSymbols(input, scope)

    const symbols = new Set<string>()
    node.traverse((n: any) => {
      if (n.type === 'SymbolNode') symbols.add(n.name)
    })
    const hasX = symbols.has('x')

    // y = f(x): assignment to y — graphable as a curve
    if (node.type === 'AssignmentNode' && (node as any).name === 'y') return !hasUndefinedSymbols(input, scope)
    // f(x): expression containing x — graphable as y = f(x)
    if (hasX) return !hasUndefinedSymbols(input, scope)
    return false
  } catch {
    return false
  }
}
