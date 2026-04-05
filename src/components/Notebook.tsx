import { useState, useRef, useEffect } from 'react'
import Cell, { type CellHandle } from './Cell'
import Graph from './Graph'
import type { CellData, TabData, SliderConfig } from '../types'
import { evaluateCell, isGraphable, hasUndefinedSymbols, latexToMathjs, UNICODE_CONSTANTS, math, SUM_RE, getConstantValue } from '../lib/mathScope'

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

// Pick sensible default slider bounds for a given value
function defaultBounds(value: number): SliderConfig {
  if (value === 0) return { min: -10, max: 10, visible: true }
  const abs = Math.abs(value)
  const magnitude = Math.pow(10, Math.floor(Math.log10(abs)))
  const raw = Math.ceil(abs / magnitude) * magnitude * 2
  // Round to 1 decimal if fractional, else integer — avoids floating point noise like 1.2000000000000002
  const bound = Number.isInteger(raw) ? raw : Math.round(raw * 10) / 10
  if (value >= 0) return { min: 0, max: bound, visible: true }
  return { min: -bound, max: 0, visible: true }
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

    const constantValue = getConstantValue(cell.input)
    const existingSlider = cell.slider
    const badBounds = existingSlider && (
      (constantValue !== null && constantValue >= 0 && existingSlider.min < 0) ||
      (constantValue !== null && constantValue <= 0 && existingSlider.max > 0) ||
      (constantValue !== null && constantValue > existingSlider.max) ||
      (constantValue !== null && constantValue < existingSlider.min)
    )
    const slider: SliderConfig | undefined = constantValue !== null
      ? (existingSlider && !badBounds ? existingSlider : defaultBounds(constantValue))
      : undefined

    const silent = hasUndefined || graphEnabled
    return {
      ...cell,
      output: silent ? null : (result || null),
      error: silent ? null : error,
      graphEnabled,
      slider,
    }
  })
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
  const [saveModalOpen, setSaveModalOpen] = useState(false)
  const [saveModalName, setSaveModalName] = useState('')
  const isDirty = useRef(false)

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

  function recomputeAllTabs(tabsSnapshot: TabData[], changedTabId: string, changedCells: CellData[]): TabData[] {
    // Build one global scope across all tabs.
    // Repeat until stable — handles chains where tab A uses tab B's variable which uses tab C's.
    const globalScope: Record<string, unknown> = { ...UNICODE_CONSTANTS }
    for (let pass = 0; pass < 4; pass++) {
      tabsSnapshot.forEach((tab) => {
        const cells = tab.id === changedTabId ? changedCells : tab.cells
        cells.forEach((c) => {
          const mathInput = latexToMathjs(c.input).trim()
          if (!mathInput || /^[xy]\s*=/.test(mathInput)) return
          try { evaluateCell(c.input, globalScope) } catch { /* skip */ }
        })
      })
    }

    // Recompute each tab — pass global scope minus this tab's own assignments as base
    // so recomputeAll can detect same-variable-in-two-tabs conflicts
    return tabsSnapshot.map((tab) => {
      const cells = tab.id === changedTabId ? changedCells : tab.cells
      const thisTabVars = new Set(cells.map((c) => getAssignedVar(c.input)).filter(Boolean))
      const base: Record<string, unknown> = Object.fromEntries(
        Object.entries(globalScope).filter(([k]) => !thisTabVars.has(k))
      )
      return { ...tab, cells: recomputeAll(cells, base) }
    })
  }

  function handleUpdate(id: string, input: string) {
    isDirty.current = true
    const updated = cells.map((c) => (c.id === id ? { ...c, input } : c))
    setTabs((prev) => recomputeAllTabs(prev, activeTab.id, updated))
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
    const updated = next.length > 0 ? next : [makeCell()]
    setTabs((prev) => recomputeAllTabs(prev, activeTab.id, updated))
  }

  function handleToggleVisible(id: string) {
    updateCells(cells.map((c) => c.id === id ? { ...c, graphVisible: !c.graphVisible } : c))
  }

  function handleColorChange(id: string, color: string) {
    updateCells(cells.map((c) => c.id === id ? { ...c, color } : c))
  }

  function handleSliderChange(id: string, value: number) {
    const cell = cells.find((c) => c.id === id)
    if (!cell) return
    const varName = getAssignedVar(cell.input)
    if (!varName) return
    // Format cleanly — avoid floating point noise like 1.0000000000001
    const formatted = parseFloat(value.toPrecision(4)).toString()
    const newInput = `${varName}=${formatted}`
    const updated = cells.map((c) => c.id === id ? { ...c, input: newInput } : c)
    setTabs((prev) => recomputeAllTabs(prev, activeTab.id, updated))
    // Sync MathLive field to show updated value
    setTimeout(() => cellRefs.current.get(id)?.setValue(newInput), 0)
  }

  function handleSliderBoundsChange(id: string, min: number, max: number) {
    updateCells(cells.map((c) => c.id === id && c.slider ? { ...c, slider: { ...c.slider, min, max } } : c))
  }

  function handleSliderToggle(id: string) {
    updateCells(cells.map((c) => c.id === id && c.slider ? { ...c, slider: { ...c.slider, visible: !c.slider.visible } } : c))
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
          const activeTabInPrev = prevTabs.find((t) => t.id === activeTab.id)!
          const next = [...activeTabInPrev.cells]
          const [moved] = next.splice(dragIndex, 1)
          next.splice(targetIndex, 0, moved)
          return recomputeAllTabs(prevTabs, activeTab.id, next)
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

  useEffect(() => {
    function handleBeforeUnload(e: BeforeUnloadEvent) {
      if (!isDirty.current) return
      e.preventDefault()
    }
    window.addEventListener('beforeunload', handleBeforeUnload)
    return () => window.removeEventListener('beforeunload', handleBeforeUnload)
  }, [])

  function doSave(name: string) {
    isDirty.current = false
    const json = JSON.stringify({ projectName: name, tabs }, null, 2)
    const blob = new Blob([json], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${name}.json`
    a.click()
    URL.revokeObjectURL(url)
  }

  function handleSave() {
    if (projectName === 'Untitled') {
      setSaveModalName('')
      setSaveModalOpen(true)
    } else {
      doSave(projectName)
    }
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
        const loadedTabs: TabData[] = (parsed.tabs as TabData[]).map((tab) => ({
          ...tab,
          cells: tab.cells.map((c) => ({ ...c, slider: undefined })),
        }))
        const recomputed = recomputeAllTabs(loadedTabs, '', [])
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
    <>
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
              onSliderChange={handleSliderChange}
              onSliderBoundsChange={handleSliderBoundsChange}
              onSliderToggle={handleSliderToggle}
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

    {/* Save-as modal */}
    {saveModalOpen && (
      <div
        onClick={() => setSaveModalOpen(false)}
        style={{
          position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 2000,
        }}
      >
        <div
          onClick={(e) => e.stopPropagation()}
          style={{
            background: '#fff', borderRadius: '8px', padding: '1.5rem',
            width: '320px', boxShadow: '0 8px 32px rgba(0,0,0,0.18)',
            display: 'flex', flexDirection: 'column', gap: '1rem',
          }}
        >
          <div style={{ fontSize: '1rem', fontWeight: 600, color: '#1e1b4b' }}>Name your project</div>
          <input
            autoFocus
            value={saveModalName}
            onChange={(e) => setSaveModalName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                const v = saveModalName.trim()
                if (!v) return
                const name = v
                setProjectName(name); setTitleValue(name)
                setSaveModalOpen(false); doSave(name)
              }
              if (e.key === 'Escape') setSaveModalOpen(false)
            }}
            placeholder="Project name"
            style={{
              border: 'none', borderBottom: '2px solid #1e1b4b', outline: 'none',
              fontSize: '1rem', padding: '0.25rem 0', width: '100%',
              fontFamily: 'inherit', color: '#111',
            }}
          />
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.5rem' }}>
            <button
              onClick={() => setSaveModalOpen(false)}
              style={{
                padding: '0.4rem 1rem', border: '1px solid #ddd', borderRadius: '5px',
                background: '#f5f5f5', cursor: 'pointer', fontSize: '0.875rem', color: '#555',
              }}
            >Cancel</button>
            <button
              onClick={() => {
                const v = saveModalName.trim()
                if (!v) return
                const name = v
                setProjectName(name); setTitleValue(name)
                setSaveModalOpen(false); doSave(name)
              }}
              style={{
                padding: '0.4rem 1rem', border: 'none', borderRadius: '5px',
                background: '#1e1b4b', color: '#fff', cursor: 'pointer', fontSize: '0.875rem',
              }}
            >Save</button>
          </div>
        </div>
      </div>
    )}
    </>
  )
}
