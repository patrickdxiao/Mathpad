import { useState } from 'react'
import Cell from './Cell'
import Graph from './Graph'
import type { CellData } from '../types'
import { math, evaluateCell, isGraphable } from '../lib/mathScope'

function makeCell(): CellData {
  return { id: crypto.randomUUID(), input: '', output: null, error: null, latex: null, graphEnabled: false }
}

function recomputeAll(cells: CellData[]): CellData[] {
  // Pass 1: run twice to resolve chained assignments like a = b where b is defined later
  const fullScope: Record<string, unknown> = {}
  for (let pass = 0; pass < 2; pass++) {
    cells.forEach((cell) => {
      if (!cell.input.trim()) return
      // Never let x or y pollute the scope — they are reserved as graph variables
      const input = cell.input.trim()
      if (/^[xy]\s*=/.test(input)) return
      try { evaluateCell(input, fullScope) } catch { /* skip */ }
    })
  }

  // Pass 2: evaluate each cell for display using the full scope
  return cells.map((cell) => {
    if (!cell.input.trim()) return { ...cell, output: null, error: null, latex: null, graphEnabled: false }

    let latex: string | null = null
    try { latex = math.parse(cell.input).toTex() } catch { /* leave null */ }

    const graphEnabled = isGraphable(cell.input, fullScope)
    const { result, error } = evaluateCell(cell.input, { ...fullScope })

    const isUndefinedSymbol = error?.startsWith('Undefined symbol')
    return {
      ...cell,
      output: result || null,
      error: isUndefinedSymbol ? null : error,
      latex,
      graphEnabled,
    }
  })
}

export default function Notebook() {
  const [cells, setCells] = useState<CellData[]>([makeCell()])

  function handleUpdate(id: string, input: string) {
    const updated = cells.map((c) => (c.id === id ? { ...c, input } : c))
    setCells(recomputeAll(updated))
  }

  function handleEnter(id: string) {
    const idx = cells.findIndex((c) => c.id === id)
    const next = [...cells]
    next.splice(idx + 1, 0, makeCell())
    setCells(next)
  }

  const scopeSnapshot: Record<string, unknown> = {}
  cells.forEach((c) => {
    const input = c.input.trim()
    if (!input || /^[xy]\s*=/.test(input)) return
    try { evaluateCell(input, scopeSnapshot) } catch { /* skip */ }
  })

  const graphExpressions = cells.filter((c) => c.graphEnabled).map((c) => c.input)

  return (
    <div style={{ display: 'flex', height: '100vh', overflow: 'hidden' }}>
      <div style={{ width: '420px', flexShrink: 0, padding: '1.5rem', overflowY: 'auto', borderRight: '1px solid #e5e5e5' }}>
        <h1 style={{ fontSize: '1.25rem', fontWeight: 600, marginBottom: '1.25rem', marginTop: 0 }}>MathPad</h1>
        {cells.map((cell, i) => (
          <Cell key={cell.id} cell={cell} index={i} onUpdate={handleUpdate} onEnter={handleEnter} />
        ))}
      </div>

      <div style={{ flex: 1, minWidth: 0, background: '#fff', overflow: 'hidden', height: '100vh' }}>
        <Graph expressions={graphExpressions} scope={scopeSnapshot} />
      </div>
    </div>
  )
}
