import { useState, useRef, useEffect } from 'react'
import Cell, { type CellHandle } from './Cell'
import Graph from './Graph'
import type { CellData, TabData } from '../types'
import { evaluateCell, isGraphable, hasUndefinedSymbols, latexToMathjs, UNICODE_CONSTANTS, math, SUM_RE } from '../lib/mathScope'

const PALETTE = ['#1e1b4b', '#1a73e8', '#b71c1c', '#188038', '#e37400', '#a142f4', '#007b83', '#c2185b']
let colorIndex = 0

function makeCell(): CellData {
  const color = PALETTE[colorIndex % PALETTE.length]
  colorIndex++
  return { id: crypto.randomUUID(), input: '', output: null, error: null, graphEnabled: false, graphVisible: true, color }
}

function makeTab(label: string): TabData {
  return { id: crypto.randomUUID(), label, cells: [makeCell()] }
}

// Returns the variable name being assigned, or null if not an assignment.
// Summation expressions are never assignments — their index variable is local to the sum.
function getAssignedVar(latex: string): string | null {
  if (SUM_RE.test(latex)) return null
  const mathInput = latexToMathjs(latex).trim()
  const m = mathInput.match(/^([a-zA-Z_\u0080-\uFFFF][a-zA-Z0-9_\u0080-\uFFFF]*)\s*=/)
  return m ? m[1] : null
}

function recomputeAll(cells: CellData[], baseScope: Record<string, unknown> = {}): CellData[] {
  // Find variables defined more than once — within this tab or already in baseScope (another tab)
  const assignCounts = new Map<string, number>()
  cells.forEach((cell) => {
    const v = getAssignedVar(cell.input)
    if (v) assignCounts.set(v, (assignCounts.get(v) ?? 0) + 1)
  })
  // Any variable also present in baseScope counts as a cross-tab duplicate
  const duplicates = new Set([
    ...[...assignCounts.entries()].filter(([, n]) => n > 1).map(([v]) => v),
    ...[...assignCounts.keys()].filter((v) => v in baseScope),
  ])

  // Start from the shared base scope (variables from all other tabs)
  const fullScope: Record<string, unknown> = { ...UNICODE_CONSTANTS, ...baseScope }
  // Two passes so later cells can reference variables defined in earlier cells
  for (let pass = 0; pass < 2; pass++) {
    cells.forEach((cell) => {
      if (!cell.input.trim()) return
      const mathInput = latexToMathjs(cell.input).trim()
      if (/^[xy]\s*=/.test(mathInput)) return
      const v = getAssignedVar(cell.input)
      if (v && duplicates.has(v)) return
      try { evaluateCell(cell.input, fullScope) } catch { /* skip */ }
    })
  }

  return cells.map((cell) => {
    const mathInput = latexToMathjs(cell.input)
    if (!mathInput.trim()) return { ...cell, output: null, error: null, graphEnabled: false }

    const assignedVar = getAssignedVar(cell.input)

    // Assignment duplicated within this tab — error on that cell
    if (assignedVar && duplicates.has(assignedVar) && !(assignedVar in baseScope)) {
      return { ...cell, output: null, error: `'${assignedVar}' is defined more than once`, graphEnabled: false }
    }

    // Non-assignment cell (or cross-tab conflict): check if it references any duplicate variable
    if (duplicates.size > 0) {
      try {
        const referencedDup = [...duplicates].find((v) => {
          const symbols = new Set<string>()
          math.parse(mathInput).traverse((n: any) => { if (n.type === 'SymbolNode') symbols.add(n.name) })
          return symbols.has(v)
        })
        if (referencedDup) {
          return { ...cell, output: null, error: `'${referencedDup}' is defined more than once`, graphEnabled: false }
        }
      } catch { /* skip */ }
    }

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

// Scope from all tabs except the given one — shared variables available everywhere
function buildBaseScope(excludeTabId: string, allTabs: TabData[]): Record<string, unknown> {
  const base: Record<string, unknown> = {}
  allTabs.forEach((tab) => {
    if (tab.id === excludeTabId) return
    tab.cells.forEach((c) => {
      const mathInput = latexToMathjs(c.input).trim()
      if (!mathInput || /^[xy]\s*=/.test(mathInput)) return
      try { evaluateCell(c.input, base) } catch { /* skip */ }
    })
  })
  return base
}

// Drag state tracked in a ref so mousemove never causes re-renders
interface DragState {
  dragIndex: number
  startY: number
  currentY: number
  cellHeight: number
}

export default function Notebook() {
  const [tabs, setTabs] = useState<TabData[]>([makeTab('Sheet 1')])
  const [activeTabId, setActiveTabId] = useState<string>(() => tabs[0].id)
  const [renamingTabId, setRenamingTabId] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const [projectName, setProjectName] = useState('Untitled')
  const [editingTitle, setEditingTitle] = useState(false)
  const [titleValue, setTitleValue] = useState('Untitled')
  const [panelWidth, setPanelWidth] = useState(400)
  const cellRefs = useRef<Map<string, CellHandle>>(new Map())

  const [drag, setDrag] = useState<DragState | null>(null)
  const dragRef = useRef<DragState | null>(null)

  const resizing = useRef(false)
  const resizeStartX = useRef(0)
  const resizeStartWidth = useRef(0)

  const activeTab = tabs.find((t) => t.id === activeTabId) ?? tabs[0]
  const cells = activeTab.cells

  function updateCells(newCells: CellData[]) {
    setTabs((prev) => prev.map((t) => t.id === activeTab.id ? { ...t, cells: newCells } : t))
  }

  function handleUpdate(id: string, input: string) {
    const updated = cells.map((c) => (c.id === id ? { ...c, input } : c))
    const base = buildBaseScope(activeTab.id, tabs)
    updateCells(recomputeAll(updated, base))
  }

  function handleEnter(id: string) {
    const idx = cells.findIndex((c) => c.id === id)
    const newCell = makeCell()
    const next = [...cells]
    next.splice(idx + 1, 0, newCell)
    updateCells(next)
    setTimeout(() => cellRefs.current.get(newCell.id)?.focus(), 0)
  }

  function handleDelete(id: string) {
    const next = cells.filter((c) => c.id !== id)
    const base = buildBaseScope(activeTab.id, tabs)
    updateCells(next.length > 0 ? recomputeAll(next, base) : [makeCell()])
  }

  function handleToggleVisible(id: string) {
    updateCells(cells.map((c) => c.id === id ? { ...c, graphVisible: !c.graphVisible } : c))
  }

  function handleColorChange(id: string, color: string) {
    updateCells(cells.map((c) => c.id === id ? { ...c, color } : c))
  }

  function handleDragStart(index: number, clientY: number, cellHeight: number) {
    const state: DragState = { dragIndex: index, startY: clientY, currentY: clientY, cellHeight }
    dragRef.current = state
    setDrag(state)
  }

  function addTab() {
    const newTab = makeTab(`Sheet ${tabs.length + 1}`)
    setTabs((prev) => [...prev, newTab])
    setActiveTabId(newTab.id)
  }

  function closeTab(id: string) {
    if (tabs.length === 1) return // keep at least one tab
    const idx = tabs.findIndex((t) => t.id === id)
    const next = tabs.filter((t) => t.id !== id)
    setTabs(next)
    if (activeTabId === id) {
      setActiveTabId(next[Math.max(0, idx - 1)].id)
    }
  }

  function startRename(tab: TabData) {
    setRenamingTabId(tab.id)
    setRenameValue(tab.label)
  }

  function commitRename() {
    if (!renamingTabId) return
    const trimmed = renameValue.trim()
    if (trimmed) {
      setTabs((prev) => prev.map((t) => t.id === renamingTabId ? { ...t, label: trimmed } : t))
    }
    setRenamingTabId(null)
  }

  useEffect(() => {
    function onMouseMove(e: MouseEvent) {
      if (resizing.current) {
        const delta = e.clientX - resizeStartX.current
        setPanelWidth(Math.max(0, Math.min(window.innerWidth, resizeStartWidth.current + delta)))
        return
      }
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
        setTabs((prevTabs) => {
          const base = buildBaseScope(activeTab.id, prevTabs)
          return prevTabs.map((t) => {
            if (t.id !== activeTab.id) return t
            const next = [...t.cells]
            const [moved] = next.splice(dragIndex, 1)
            next.splice(targetIndex, 0, moved)
            return { ...t, cells: recomputeAll(next, base) }
          })
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
  }, [cells.length, activeTab.id])

  function handleSave() {
    const json = JSON.stringify({ projectName, tabs }, null, 2)
    const blob = new Blob([json], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${projectName}.json`
    a.click()
    URL.revokeObjectURL(url)
  }

  const loadInputRef = useRef<HTMLInputElement>(null)

  function handleLoad(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = (ev) => {
      try {
        const parsed = JSON.parse(ev.target?.result as string)
        if (!Array.isArray(parsed.tabs)) return
        const loadedTabs: TabData[] = parsed.tabs
        const base: Record<string, unknown> = {}
        const recomputed = loadedTabs.map((tab) => ({
          ...tab,
          cells: recomputeAll(tab.cells, base),
        }))
        setTabs(recomputed)
        setActiveTabId(recomputed[0].id)
        const name = parsed.projectName ?? 'Untitled'
        setProjectName(name)
        setTitleValue(name)
      } catch { /* invalid file — silently ignore */ }
    }
    reader.readAsText(file)
    e.target.value = ''
  }

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

    const steps = Math.round(delta / cellHeight)
    const targetIndex = Math.max(0, Math.min(cells.length - 1, dragIndex + steps))

    if (steps > 0 && index > dragIndex && index <= targetIndex) {
      return { transform: 'translateY(-100%)', transition: 'transform 0.15s ease' }
    }
    if (steps < 0 && index < dragIndex && index >= targetIndex) {
      return { transform: 'translateY(100%)', transition: 'transform 0.15s ease' }
    }

    return { transform: 'translateY(0)', transition: 'transform 0.15s ease' }
  }

  // Build scope from all tabs so variables defined in any tab are available everywhere
  const scopeSnapshot: Record<string, unknown> = { ...UNICODE_CONSTANTS }
  tabs.forEach((tab) => {
    tab.cells.forEach((c) => {
      const mathInput = latexToMathjs(c.input).trim()
      if (!mathInput || /^[xy]\s*=/.test(mathInput)) return
      try { evaluateCell(c.input, scopeSnapshot) } catch { /* skip */ }
    })
  })

  // Build graphable cells with their tab/cell ids so we can focus them on curve click
  const graphableCells = tabs.flatMap((tab) =>
    tab.cells.filter((c) => c.graphEnabled && c.graphVisible).map((c) => ({ tabId: tab.id, cellId: c.id, expr: latexToMathjs(c.input), color: c.color }))
  )
  const graphExpressions = graphableCells.map((g) => g.expr)
  const graphColors = graphableCells.map((g) => g.color)

  function handleCurveClick(index: number) {
    const entry = graphableCells[index]
    if (!entry) return
    setActiveTabId(entry.tabId)
    setTimeout(() => cellRefs.current.get(entry.cellId)?.focus(), 0)
  }

  return (
    <div style={{ display: 'flex', height: '100vh', overflow: 'hidden' }}>
      {/* Notebook panel */}
      <div style={{ width: `${panelWidth}px`, flexShrink: 0, display: 'flex', flexDirection: 'column', background: '#fff', borderLeft: '1px solid #111', borderRight: '1px solid #111' }}>

        {/* Header */}
        <div style={{ background: '#1e1b4b', padding: '0.5rem 0.75rem', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          {editingTitle ? (
            <input
              autoFocus
              value={titleValue}
              onChange={(e) => setTitleValue(e.target.value)}
              onBlur={() => { const v = titleValue.trim() || 'Untitled'; setProjectName(v); setTitleValue(v); setEditingTitle(false) }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') { const v = titleValue.trim() || 'Untitled'; setProjectName(v); setTitleValue(v); setEditingTitle(false) }
                if (e.key === 'Escape') { setTitleValue(projectName); setEditingTitle(false) }
              }}
              style={{
                background: 'transparent', border: 'none', borderBottom: '1px solid rgba(255,255,255,0.5)',
                color: '#fff', fontSize: '1.1rem', fontWeight: 700, outline: 'none',
                width: '160px', fontFamily: 'inherit',
              }}
            />
          ) : (
            <h1
              onClick={() => { setTitleValue(projectName); setEditingTitle(true) }}
              title="Click to rename"
              style={{ fontSize: '1.1rem', fontWeight: 700, margin: 0, color: '#fff', cursor: 'text' }}
            >{projectName}</h1>
          )}
          <div style={{ display: 'flex', gap: '6px' }}>
            <button onClick={handleSave} title="Save to file" style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'rgba(255,255,255,0.7)', padding: '2px', lineHeight: 1, display: 'flex', alignItems: 'center' }}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                <polyline points="7 10 12 15 17 10"/>
                <line x1="12" y1="15" x2="12" y2="3"/>
              </svg>
            </button>
            <button onClick={() => loadInputRef.current?.click()} title="Load from file" style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'rgba(255,255,255,0.7)', padding: '2px', lineHeight: 1, display: 'flex', alignItems: 'center' }}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                <polyline points="17 8 12 3 7 8"/>
                <line x1="12" y1="3" x2="12" y2="15"/>
              </svg>
            </button>
            <input ref={loadInputRef} type="file" accept=".json" onChange={handleLoad} style={{ display: 'none' }} />
          </div>
        </div>

        {/* Tab bar */}
        <div style={{
          display: 'flex', alignItems: 'center', borderBottom: '1px solid #111',
          overflowX: 'auto', flexShrink: 0, background: '#fff',
          scrollbarWidth: 'none',
        }}>
          {tabs.map((tab) => {
            const isActive = tab.id === activeTabId
            return (
              <div
                key={tab.id}
                onClick={() => setActiveTabId(tab.id)}
                onDoubleClick={() => startRename(tab)}
                style={{
                  display: 'flex', alignItems: 'center', gap: '4px',
                  padding: '0.4rem 0.6rem', cursor: 'pointer', flexShrink: 0,
                  borderRight: '1px solid #e5e5e5',
                  background: isActive ? '#fff' : '#f7f7f7',
                  borderBottom: isActive ? '2px solid #1e1b4b' : '2px solid transparent',
                  fontSize: '0.78rem', fontWeight: isActive ? 600 : 400,
                  color: isActive ? '#1e1b4b' : '#666',
                  userSelect: 'none',
                }}
              >
                {renamingTabId === tab.id ? (
                  <input
                    autoFocus
                    value={renameValue}
                    onChange={(e) => setRenameValue(e.target.value)}
                    onBlur={commitRename}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') commitRename()
                      if (e.key === 'Escape') setRenamingTabId(null)
                    }}
                    onClick={(e) => e.stopPropagation()}
                    style={{
                      border: 'none', outline: '1px solid #1e1b4b', borderRadius: '2px',
                      fontSize: '0.78rem', fontWeight: 600, width: '72px', padding: '0 2px',
                    }}
                  />
                ) : (
                  <span>{tab.label}</span>
                )}
                {tabs.length > 1 && (
                  <span
                    onClick={(e) => { e.stopPropagation(); closeTab(tab.id) }}
                    style={{ color: '#aaa', fontSize: '0.85rem', lineHeight: 1, padding: '0 1px', cursor: 'pointer' }}
                  >×</span>
                )}
              </div>
            )
          })}
          {/* Add tab button */}
          <button
            onClick={addTab}
            style={{
              flexShrink: 0, border: 'none', background: 'none', cursor: 'pointer',
              padding: '0.4rem 0.6rem', fontSize: '1rem', color: '#aaa', lineHeight: 1,
            }}
          >+</button>
        </div>

        {/* Cells */}
        <div style={{ flex: 1, overflowY: 'auto', borderTop: 'none' }}>
          {cells.map((cell, i) => (
            <Cell
              key={cell.id}
              ref={(handle) => {
                if (handle) cellRefs.current.set(cell.id, handle)
                else cellRefs.current.delete(cell.id)
              }}
              cell={cell}
              index={i}
              style={getCellStyle(i)}
              onUpdate={handleUpdate}
              onEnter={handleEnter}
              onDelete={handleDelete}
              onDragStart={handleDragStart}
              onToggleVisible={handleToggleVisible}
              onColorChange={handleColorChange}
            />
          ))}
        </div>
      </div>

      {/* Resize handle */}
      <div style={{ width: '12px', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div
          onMouseDown={(e) => {
            resizing.current = true
            resizeStartX.current = e.clientX
            resizeStartWidth.current = panelWidth
          }}
          style={{
            width: '3px', height: '48px', borderRadius: '2px',
            background: '#1e1b4b', cursor: 'col-resize', transition: 'background 0.15s',
          }}
        />
      </div>

      {/* Graph panel */}
      <div style={{ flex: 1, minWidth: 0, height: '100vh' }}>
        <Graph expressions={graphExpressions} colors={graphColors} scope={scopeSnapshot} onCurveClick={handleCurveClick} />
      </div>
    </div>
  )
}
