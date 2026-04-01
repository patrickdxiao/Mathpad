import { useRef, useState, useLayoutEffect, createRef } from 'react'
import type { CellData } from '../types'

interface CellProps {
  cell: CellData
  index: number
  onUpdate: (id: string, input: string) => void
  onEnter: (id: string) => void
  onDelete: (id: string) => void
  onDragStart: (index: number) => void
  onDrop: (index: number) => void
}

const STYLE = `
.frac {
  display: inline-flex; flex-direction: column; align-items: center;
  vertical-align: middle; font-size: 0.85em; line-height: 1.2; margin: 0 0.1em;
}
.frac .num { border-bottom: 1px solid #111; padding: 0 2px 1px; min-width: 0.5em; text-align: center; }
.frac .den { padding: 1px 2px 0; min-width: 0.5em; text-align: center; }
.frac sup { font-size: 0.8em; vertical-align: super; }
@keyframes blink { 0%,100%{opacity:1} 50%{opacity:0} }
`
if (!document.getElementById('cell-style')) {
  const tag = document.createElement('style')
  tag.id = 'cell-style'
  tag.textContent = STYLE
  document.head.appendChild(tag)
}

// Used to find where numerator token starts (walk left from /)
const NUM_BOUNDARY = new Set(['+', '-', '=', '(', ',', '*', '/', '^', ')'])

// Parse fractions and superscripts from flat input string
interface Frac { fracStart: number; slashPos: number; denStart: number; denEnd: number }
interface Sup { caretPos: number; expStart: number; expEnd: number }

const FRAC_END = '\x01' // sentinel marking end of fraction denominator

function parseFracs(input: string): Frac[] {
  const fracs: Frac[] = []
  let i = 0
  while (i < input.length) {
    if (input[i] === '/') {
      const slashPos = i
      let denEnd = slashPos + 1
      if (input[denEnd] === '(') {
        let depth = 1; denEnd++
        while (denEnd < input.length && depth > 0) {
          if (input[denEnd] === '(') depth++
          else if (input[denEnd] === ')') depth--
          denEnd++
        }
      } else if (input.indexOf(FRAC_END, slashPos) !== -1) {
        // Sentinel exists somewhere after slash — consume until sentinel
        while (denEnd < input.length && input[denEnd] !== FRAC_END) denEnd++
      } else {
        // No sentinel — consume only alphanumeric (conservative parse for plain strings)
        while (denEnd < input.length && /[A-Za-z0-9_.]/.test(input[denEnd])) denEnd++
      }
      const hasSentinel = input[denEnd] === FRAC_END
      let fracStart = slashPos
      for (let j = slashPos - 1; j >= 0; j--) {
        if (NUM_BOUNDARY.has(input[j])) { fracStart = j + 1; break }
        if (j === 0) { fracStart = 0; break }
      }
      fracs.push({ fracStart, slashPos, denStart: slashPos + 1, denEnd: hasSentinel ? denEnd + 1 : denEnd })
      i = hasSentinel ? denEnd + 1 : denEnd
      continue
    }
    i++
  }
  return fracs
}

function parseSups(input: string, fracs: Frac[]): Sup[] {
  const fracRanges = fracs.map(f => [f.fracStart, f.denEnd])
  const sups: Sup[] = []
  let i = 0
  while (i < input.length) {
    const inFrac = fracRanges.some(([s, e]) => i >= s && i < e)
    if (!inFrac && input[i] === '^') {
      const caretPos = i; i++
      const expStart = i
      if (input[i] === '(') {
        let depth = 1; i++
        while (i < input.length && depth > 0) {
          if (input[i] === '(') depth++
          else if (input[i] === ')') depth--
          i++
        }
      } else {
        while (i < input.length && /[A-Za-z0-9_.]/.test(input[i])) i++
      }
      sups.push({ caretPos, expStart, expEnd: i })
      continue
    }
    i++
  }
  return sups
}

// A logical cursor stop: a flat-string position and a ref to a DOM anchor at that visual location
interface Stop { pos: number; ref: React.RefObject<HTMLSpanElement | null> }

// Render the input as React elements, collecting cursor stops with refs
function renderMath(input: string, stops: Stop[]): React.ReactNode[] {
  const fracs = parseFracs(input)
  const sups = parseSups(input, fracs)
  const nodes: React.ReactNode[] = []
  let i = 0
  let keyCounter = 0

  const addStop = (pos: number): React.ReactNode => {
    const key = `stop-${keyCounter++}`
    const ref = createRef<HTMLSpanElement>()
    stops.push({ pos, ref })
    return <span key={key} ref={ref} style={{ display: 'inline-block', width: 0, overflow: 'visible', verticalAlign: 'text-bottom' }}>{'\u200B'}</span>
  }

  while (i <= input.length) {
    const frac = fracs.find(f => f.fracStart === i)
    if (frac) {
      // Build num content with stops
      const numNodes: React.ReactNode[] = []
      for (let k = frac.fracStart; k < frac.slashPos; k++) {
        numNodes.push(input[k])
        numNodes.push(addStop(k + 1))
      }
      if (frac.fracStart === frac.slashPos) numNodes.push(addStop(frac.slashPos))

      // Build den content with stops
      const denNodes: React.ReactNode[] = [addStop(frac.denStart)]
      for (let k = frac.denStart; k < frac.denEnd; k++) {
        denNodes.push(input[k])
        denNodes.push(addStop(k + 1))
      }

      nodes.push(
        <span key={`frac-${frac.fracStart}`} className="frac">
          <span className="num">{numNodes}</span>
          <span className="den">{denNodes}</span>
        </span>
      )
      // Stop after the fraction
      nodes.push(addStop(frac.denEnd))
      i = frac.denEnd
      continue
    }

    const sup = sups.find(s => s.caretPos === i)
    if (sup) {
      const expNodes: React.ReactNode[] = [addStop(sup.expStart)]
      for (let k = sup.expStart; k < sup.expEnd; k++) {
        expNodes.push(input[k])
        expNodes.push(addStop(k + 1))
      }
      nodes.push(<sup key={`sup-${sup.caretPos}`}>{expNodes}</sup>)
      i = sup.expEnd
      continue
    }

    if (i === input.length) break

    if (input[i] === FRAC_END) { i++; continue } // sentinel is invisible

    nodes.push(addStop(i))
    nodes.push(<span key={`ch-${i}`}>{input[i]}</span>)
    i++
  }
  nodes.push(addStop(input.length))
  return nodes
}

export default function Cell({ cell, index, onUpdate, onEnter, onDelete, onDragStart, onDrop }: CellProps) {
  const inputRef = useRef<HTMLInputElement>(null)
  const displayRef = useRef<HTMLDivElement>(null)
  const [focused, setFocused] = useState(false)
  const [cursorPos, setCursorPos] = useState(0)
  const [cursorStyle, setCursorStyle] = useState<{ left: number; top: number; height: number } | null>(null)
  const [hovering, setHovering] = useState(false)
  const [showTooltip, setShowTooltip] = useState(false)
  const stopsRef = useRef<Stop[]>([])

  // Measure fake caret position after layout (deps only; avoid setState every render → infinite loop)
  useLayoutEffect(() => {
    if (!focused || !displayRef.current) {
      setCursorStyle((prev) => (prev === null ? prev : null))
      return
    }
    const stop = stopsRef.current.find((s) => s.pos === cursorPos)
    if (!stop?.ref.current) {
      setCursorStyle((prev) => (prev === null ? prev : null))
      return
    }
    const stopRect = stop.ref.current.getBoundingClientRect()
    const parentRect = displayRef.current.getBoundingClientRect()
    // Round — subpixel rect values change every layout pass and would otherwise retrigger setState forever
    const next = {
      left: Math.round(stopRect.left - parentRect.left),
      top: Math.round(stopRect.top - parentRect.top),
      height: Math.round(Math.max(stopRect.height, 14)),
    }
    setCursorStyle((prev) =>
      prev && prev.left === next.left && prev.top === next.top && prev.height === next.height
        ? prev
        : next,
    )
  }, [focused, cursorPos, cell.input])

  const fracs = parseFracs(cell.input)

  function syncCursor() {
    const pos = inputRef.current?.selectionStart ?? 0
    setCursorPos(pos)
  }

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const newVal = e.target.value
    const newPos = e.target.selectionStart ?? 0
    onUpdate(cell.id, newVal)
    setCursorPos(newPos)
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') { e.preventDefault(); onEnter(cell.id); return }

    // If cursor is at denEnd with no sentinel and user types an operator,
    // insert it into the denominator by allowing the default browser insertion.
    // The operator will be part of the den since parseFracs stops at non-alphanumeric
    // only when no sentinel is present — but we want operators INSIDE the den.
    // So we manually insert: operator goes into den, sentinel inserted after it.
    if (e.key.length === 1 && NUM_BOUNDARY.has(e.key)) {
      const inp = inputRef.current
      if (!inp) return
      const pos = inp.selectionStart ?? 0
      for (const f of fracs) {
        if (pos === f.denEnd && cell.input[f.denEnd - 1] !== FRAC_END) {
          e.preventDefault()
          // Insert operator + sentinel so parseFracs uses sentinel branch and treats operator as part of den
          const newVal = cell.input.slice(0, f.denEnd) + e.key + FRAC_END + cell.input.slice(f.denEnd)
          onUpdate(cell.id, newVal)
          const newPos = f.denEnd + 1
          setCursorPos(newPos)
          setTimeout(() => inp.setSelectionRange(newPos, newPos), 0)
          return
        }
      }
    }

    if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
      const inp = inputRef.current
      if (!inp) return
      const pos = inp.selectionStart ?? 0
      const jump = (to: number) => { e.preventDefault(); inp.setSelectionRange(to, to); setCursorPos(to) }

      if (e.key === 'ArrowRight') {
        for (const f of fracs) {
          if (pos === f.fracStart) { jump(f.fracStart + 1 <= f.slashPos ? f.fracStart + 1 : f.slashPos); return }
          if (pos > f.fracStart && pos <= f.slashPos) { jump(f.denStart); return }
          if (pos >= f.denStart && pos <= f.denEnd) {
            e.preventDefault()
            const raw = cell.input
            const hasSentinel = raw[f.denEnd - 1] === FRAC_END
            if (hasSentinel) {
              // Already have sentinel, cursor at end of den → jump past sentinel
              jump(f.denEnd)
            } else {
              // Insert sentinel after den, jump past it
              const newVal = raw.slice(0, f.denEnd) + FRAC_END + raw.slice(f.denEnd)
              onUpdate(cell.id, newVal)
              setTimeout(() => { inp.setSelectionRange(f.denEnd + 1, f.denEnd + 1); setCursorPos(f.denEnd + 1) }, 0)
            }
            return
          }
        }
      } else {
        for (const f of fracs) {
          if (pos === f.denEnd) { jump(f.denStart); return }
          if (pos > f.denStart && pos <= f.denEnd) { jump(f.slashPos); return }
          if (pos > f.fracStart && pos <= f.slashPos) { jump(f.fracStart); return }
        }
      }
    }
  }

  // Rebuild stops on every render
  stopsRef.current = []
  const displayNodes = renderMath(cell.input, stopsRef.current)

  return (
    <div
      style={{ display: 'flex', alignItems: 'stretch', borderBottom: '1px solid #111', background: '#fff' }}
      onDragOver={(e) => e.preventDefault()}
      onDrop={() => onDrop(index)}
      onMouseEnter={() => setHovering(true)}
      onMouseLeave={() => setHovering(false)}
    >
      <div
        draggable
        onDragStart={() => onDragStart(index)}
        style={{
          width: '1.75rem', display: 'flex', alignItems: 'center', justifyContent: 'center',
          flexShrink: 0, cursor: 'grab', color: hovering ? '#bbb' : 'transparent',
          fontSize: '0.75rem', userSelect: 'none',
        }}
      >⠿</div>

      <div
        style={{
          flex: 1, display: 'flex', alignItems: 'center',
          borderLeft: focused ? '2px solid #1a73e8' : '2px solid transparent',
          padding: '0.35rem 0', cursor: 'text', minHeight: '2.2rem', overflow: 'hidden',
          position: 'relative',
        }}
        onClick={() => inputRef.current?.focus()}
      >
        {/* Formatted display */}
        <div
          ref={displayRef}
          style={{
            position: 'absolute', left: 0, top: 0, bottom: 0,
            display: 'flex', alignItems: 'center', pointerEvents: 'none',
            fontSize: '1rem', fontFamily: 'ui-monospace, Consolas, monospace',
            color: '#111', whiteSpace: 'pre',
          }}
        >
          {displayNodes}
        </div>

        {/* Blinking cursor */}
        {focused && cursorStyle && (
          <div style={{
            position: 'absolute',
            left: cursorStyle.left,
            top: cursorStyle.top,
            width: '1px',
            height: Math.max(cursorStyle.height, 16),
            background: '#111',
            pointerEvents: 'none',
            animation: 'blink 1s step-start infinite',
          }} />
        )}

        {/* Hidden input captures keystrokes */}
        <input
          ref={inputRef}
          value={cell.input}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          onKeyUp={syncCursor}
          onClick={syncCursor}
          onSelect={syncCursor}
          onFocus={() => { setFocused(true); syncCursor() }}
          onBlur={() => { setFocused(false); setCursorStyle(null) }}
          style={{
            position: 'relative', flex: 1, width: '100%',
            border: 'none', outline: 'none', background: 'transparent',
            fontSize: '1rem', fontFamily: 'ui-monospace, Consolas, monospace',
            color: 'transparent', caretColor: 'transparent', padding: 0,
          }}
        />

        {cell.error ? (
          <div
            style={{ position: 'relative', marginLeft: '0.75rem', flexShrink: 0 }}
            onMouseEnter={() => setShowTooltip(true)}
            onMouseLeave={() => setShowTooltip(false)}
          >
            <span style={{ color: '#e53e3e', cursor: 'help' }}>⚠</span>
            {showTooltip && (
              <div style={{
                position: 'absolute', bottom: '130%', right: 0, background: '#333', color: '#fff',
                padding: '0.3rem 0.6rem', borderRadius: '4px', fontSize: '0.75rem',
                whiteSpace: 'nowrap', zIndex: 10, pointerEvents: 'none',
              }}>{cell.error}</div>
            )}
          </div>
        ) : cell.output && !cell.graphEnabled ? (
          <div style={{
            color: '#111', marginLeft: '1rem', whiteSpace: 'nowrap', flexShrink: 0,
            fontFamily: 'ui-monospace, Consolas, monospace', fontSize: '1rem',
          }}>= {cell.output}</div>
        ) : null}
      </div>

      <div style={{
        width: '1.75rem', display: 'flex', alignItems: 'center', justifyContent: 'center',
        flexShrink: 0, opacity: hovering ? 1 : 0, transition: 'opacity 0.1s',
      }}>
        <button
          onClick={() => onDelete(cell.id)}
          style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#aaa', fontSize: '1.1rem', lineHeight: 1, padding: '0.1rem 0.2rem' }}
        >×</button>
      </div>
    </div>
  )
}
