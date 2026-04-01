import { useState, useRef, useEffect } from 'react'
import Cell from './Cell'
import Graph from './Graph'
import type { CellData } from '../types'
import { evaluateCell, isGraphable, hasUndefinedSymbols, latexToMathjs, UNICODE_CONSTANTS } from '../lib/mathScope'

function makeCell(): CellData {
  return { id: crypto.randomUUID(), input: '', output: null, error: null, graphEnabled: false }
}

function recomputeAll(cells: CellData[]): CellData[] {
  const fullScope: Record<string, unknown> = { ...UNICODE_CONSTANTS }
  // Two passes so later cells can reference variables defined in earlier cells
  for (let pass = 0; pass < 2; pass++) {
    cells.forEach((cell) => {
      if (!cell.input.trim()) return
      const mathInput = latexToMathjs(cell.input).trim()
      if (/^[xy]\s*=/.test(mathInput)) return
      try { evaluateCell(cell.input, fullScope) } catch { /* skip */ }
    })
  }

  return cells.map((cell) => {
    const mathInput = latexToMathjs(cell.input)
    if (!mathInput.trim()) return { ...cell, output: null, error: null, graphEnabled: false }

    const graphEnabled = isGraphable(cell.input, fullScope)
    const hasUndefined = hasUndefinedSymbols(cell.input, fullScope)
    const { result, error } = evaluateCell(cell.input, { ...fullScope })

    const silent = hasUndefined || graphEnabled
    return {
      ...cell,
      output: silent ? null : (result || null),
      error: silent ? null : error,
      graphEnabled,
    }
  })
}

// Drag state tracked in a ref so mousemove never causes re-renders
interface DragState {
  dragIndex: number       // which cell is being dragged
  startY: number         // mouseY when drag began
  currentY: number       // current mouseY
  cellHeight: number     // height of each cell in px
}

export default function Notebook() {
  const [cells, setCells] = useState<CellData[]>([makeCell()])
  const [panelWidth, setPanelWidth] = useState(400)

  // Drag state — stored in state so Cell components re-render with updated transforms
  const [drag, setDrag] = useState<DragState | null>(null)
  const dragRef = useRef<DragState | null>(null) // mirror for use inside mousemove closure

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

  // Called when the user presses down on a drag handle
  function handleDragStart(index: number, clientY: number, cellHeight: number) {
    const state: DragState = { dragIndex: index, startY: clientY, currentY: clientY, cellHeight }
    dragRef.current = state
    setDrag(state)
  }

  useEffect(() => {
    function onMouseMove(e: MouseEvent) {
      // Panel resize
      if (resizing.current) {
        const delta = e.clientX - resizeStartX.current
        setPanelWidth(Math.max(200, Math.min(800, resizeStartWidth.current + delta)))
        return
      }

      // Cell drag
      if (!dragRef.current) return
      const updated = { ...dragRef.current, currentY: e.clientY }
      dragRef.current = updated
      setDrag({ ...updated })
    }

    function onMouseUp() {
      resizing.current = false

      if (!dragRef.current) return
      const { dragIndex, startY, currentY, cellHeight } = dragRef.current
      const delta = currentY - startY
      const steps = Math.round(delta / cellHeight)
      const targetIndex = Math.max(0, Math.min(cells.length - 1, dragIndex + steps))

      if (targetIndex !== dragIndex) {
        setCells(prev => {
          const next = [...prev]
          const [moved] = next.splice(dragIndex, 1)
          next.splice(targetIndex, 0, moved)
          return recomputeAll(next)
        })
      }

      dragRef.current = null
      setDrag(null)
    }

    window.addEventListener('mousemove', onMouseMove)
    window.addEventListener('mouseup', onMouseUp)
    return () => {
      window.removeEventListener('mousemove', onMouseMove)
      window.removeEventListener('mouseup', onMouseUp)
    }
  }, [cells.length])

  // Compute per-cell transform and z-index based on drag state
  function getCellStyle(index: number): React.CSSProperties {
    if (!drag) return {}
    const { dragIndex, startY, currentY, cellHeight } = drag
    const delta = currentY - startY

    if (index === dragIndex) {
      return {
        transform: `translateY(${delta}px)`,
        zIndex: 100,
        boxShadow: '0 4px 16px rgba(0,0,0,0.12)',
        opacity: 0.95,
        position: 'relative',
        transition: 'box-shadow 0.15s',
      }
    }

    // How many slots has the dragged cell moved over this cell?
    const steps = Math.round(delta / cellHeight)
    const targetIndex = Math.max(0, Math.min(cells.length - 1, dragIndex + steps))

    // Shift other cells out of the way
    if (steps > 0 && index > dragIndex && index <= targetIndex) {
      return { transform: 'translateY(-100%)', transition: 'transform 0.15s ease' }
    }
    if (steps < 0 && index < dragIndex && index >= targetIndex) {
      return { transform: 'translateY(100%)', transition: 'transform 0.15s ease' }
    }

    return { transform: 'translateY(0)', transition: 'transform 0.15s ease' }
  }

  const scopeSnapshot: Record<string, unknown> = { ...UNICODE_CONSTANTS }
  cells.forEach((c) => {
    const mathInput = latexToMathjs(c.input).trim()
    if (!mathInput || /^[xy]\s*=/.test(mathInput)) return
    try { evaluateCell(c.input, scopeSnapshot) } catch { /* skip */ }
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
              style={getCellStyle(i)}
              onUpdate={handleUpdate}
              onEnter={handleEnter}
              onDelete={handleDelete}
              onDragStart={handleDragStart}
            />
          ))}
        </div>
      </div>

      {/* Resize handle */}
      <div
        style={{ width: '4px', cursor: 'col-resize', background: '#e5e5e5', flexShrink: 0, transition: 'background 0.15s' }}
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
