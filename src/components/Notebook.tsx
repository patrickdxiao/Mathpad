import { useState, useRef, useEffect } from 'react'
import Cell from './Cell'
import Graph from './Graph'
import type { CellData } from '../types'
import { evaluateCell, isGraphable, latexToMathjs } from '../lib/mathScope'

function makeCell(): CellData {
  return { id: crypto.randomUUID(), input: '', output: null, error: null, graphEnabled: false }
}

function recomputeAll(cells: CellData[]): CellData[] {
  const fullScope: Record<string, unknown> = {}
  for (let pass = 0; pass < 2; pass++) {
    cells.forEach((cell) => {
      if (!cell.input.trim()) return
      const input = latexToMathjs(cell.input).trim()
      if (/^[xy]\s*=/.test(input)) return
      try { evaluateCell(input, fullScope) } catch { /* skip */ }
    })
  }

  return cells.map((cell) => {
    const mathInput = latexToMathjs(cell.input)
    if (!mathInput.trim()) return { ...cell, output: null, error: null, graphEnabled: false }

    const graphEnabled = isGraphable(mathInput, fullScope)
    const { result, error } = evaluateCell(mathInput, { ...fullScope })

    const isUndefinedSymbol = error?.startsWith('Undefined symbol')
    return {
      ...cell,
      output: result || null,
      error: isUndefinedSymbol ? null : error,
      graphEnabled,
    }
  })
}

export default function Notebook() {
  const [cells, setCells] = useState<CellData[]>([makeCell()])
  const [panelWidth, setPanelWidth] = useState(400)
  const dragIndex = useRef<number | null>(null)
  const resizing = useRef(false)
  const resizeStartX = useRef(0)
  const resizeStartWidth = useRef(0)

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

  function handleDelete(id: string) {
    const next = cells.filter((c) => c.id !== id)
    setCells(next.length > 0 ? recomputeAll(next) : [makeCell()])
  }

  function handleDragStart(index: number) {
    dragIndex.current = index
  }

  function handleDrop(dropIndex: number) {
    if (dragIndex.current === null || dragIndex.current === dropIndex) return
    const next = [...cells]
    const [moved] = next.splice(dragIndex.current, 1)
    next.splice(dropIndex, 0, moved)
    dragIndex.current = null
    setCells(recomputeAll(next))
  }

  // Resizable panel drag logic
  useEffect(() => {
    function onMouseMove(e: MouseEvent) {
      if (!resizing.current) return
      const delta = e.clientX - resizeStartX.current
      setPanelWidth(Math.max(200, Math.min(800, resizeStartWidth.current + delta)))
    }
    function onMouseUp() { resizing.current = false }
    window.addEventListener('mousemove', onMouseMove)
    window.addEventListener('mouseup', onMouseUp)
    return () => {
      window.removeEventListener('mousemove', onMouseMove)
      window.removeEventListener('mouseup', onMouseUp)
    }
  }, [])

  const scopeSnapshot: Record<string, unknown> = {}
  cells.forEach((c) => {
    const input = latexToMathjs(c.input).trim()
    if (!input || /^[xy]\s*=/.test(input)) return
    try { evaluateCell(input, scopeSnapshot) } catch { /* skip */ }
  })

  const graphExpressions = cells.filter((c) => c.graphEnabled).map((c) => latexToMathjs(c.input))

  return (
    <div style={{ display: 'flex', height: '100vh', overflow: 'hidden' }}>
      {/* Notebook panel */}
      <div style={{ width: `${panelWidth}px`, flexShrink: 0, overflowY: 'auto', display: 'flex', flexDirection: 'column', background: '#fff', borderLeft: '1px solid #111', borderRight: '1px solid #111' }}>
        <div style={{ padding: '1rem 0.5rem 0.5rem 0.5rem' }}>
          <h1 style={{ fontSize: '1.1rem', fontWeight: 600, marginBottom: '0.75rem', marginTop: 0, paddingLeft: '2rem' }}>MathPad</h1>
        </div>
        <div style={{ flex: 1, borderTop: '1px solid #111' }}>
          {cells.map((cell, i) => (
            <Cell
              key={cell.id}
              cell={cell}
              index={i}
              onUpdate={handleUpdate}
              onEnter={handleEnter}
              onDelete={handleDelete}
              onDragStart={handleDragStart}
              onDrop={handleDrop}
            />
          ))}
        </div>
      </div>

      {/* Resize handle */}
      <div
        style={{
          width: '4px',
          cursor: 'col-resize',
          background: '#e5e5e5',
          flexShrink: 0,
          transition: 'background 0.15s',
        }}
        onMouseDown={(e) => {
          resizing.current = true
          resizeStartX.current = e.clientX
          resizeStartWidth.current = panelWidth
        }}
        onMouseEnter={(e) => { (e.target as HTMLElement).style.background = '#bbb' }}
        onMouseLeave={(e) => { (e.target as HTMLElement).style.background = '#e5e5e5' }}
      />

      {/* Graph panel */}
      <div style={{ flex: 1, minWidth: 0, height: '100vh' }}>
        <Graph expressions={graphExpressions} scope={scopeSnapshot} />
      </div>
    </div>
  )
}
