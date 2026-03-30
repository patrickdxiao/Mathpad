import { useState } from 'react'
import Cell from './Cell'
import type { CellData } from '../types'
import { math, evaluateCell } from '../lib/mathScope'

function makeCell(): CellData {
  return { id: crypto.randomUUID(), input: '', output: null, error: null, latex: null }
}

// Reset scope and re-evaluate all cells in order so downstream cells pick up upstream changes
function recomputeAll(cells: CellData[]): CellData[] {
  const scope: Record<string, unknown> = {}

  return cells.map((cell) => {
    if (!cell.input.trim()) return { ...cell, output: null, error: null, latex: null }

    let latex: string | null = null
    try { latex = math.parse(cell.input).toTex() } catch { /* leave null */ }

    // Pass scope directly so math.js mutates it with any assignments
    const { result, error } = evaluateCell(cell.input, scope)
    return { ...cell, output: result || null, error, latex }
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

  return (
    <div style={{ padding: '2rem', maxWidth: '800px', margin: '0 auto' }}>
      <h1 style={{ fontSize: '1.5rem', marginBottom: '1.5rem', fontWeight: 600 }}>MathPad</h1>
      {cells.map((cell, i) => (
        <Cell key={cell.id} cell={cell} index={i} onUpdate={handleUpdate} onEnter={handleEnter} />
      ))}
    </div>
  )
}
