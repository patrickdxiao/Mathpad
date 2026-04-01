import { useRef, useState, useEffect } from 'react'
import 'mathlive'
import type { MathfieldElement } from 'mathlive'
import type { CellData } from '../types'

// Tell TypeScript that <math-field> is a valid JSX element
declare global {
  namespace JSX {
    interface IntrinsicElements {
      'math-field': React.DetailedHTMLProps<React.HTMLAttributes<MathfieldElement>, MathfieldElement>
    }
  }
}

interface CellProps {
  cell: CellData
  index: number
  onUpdate: (id: string, latex: string) => void
  onEnter: (id: string) => void
  onDelete: (id: string) => void
  onDragStart: (index: number) => void
  onDrop: (index: number) => void
}

export default function Cell({ cell, index, onUpdate, onEnter, onDelete, onDragStart, onDrop }: CellProps) {
  const mathfieldRef = useRef<MathfieldElement>(null)
  const [focused, setFocused] = useState(false)
  const [hovering, setHovering] = useState(false)
  const [showTooltip, setShowTooltip] = useState(false)

  // Sync value into the math-field when it changes externally (e.g. cell reorder)
  useEffect(() => {
    const mf = mathfieldRef.current
    if (!mf) return
    if (mf.getValue() !== cell.input) {
      mf.setValue(cell.input, { suppressChangeNotifications: true })
    }
  }, [cell.input])

  // Wire up MathLive event listeners after mount
  useEffect(() => {
    const mf = mathfieldRef.current
    if (!mf) return
    mf.mathVirtualKeyboardPolicy = 'manual'

    function handleInput() {
      onUpdate(cell.id, mf!.getValue())
    }

    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Enter') {
        e.preventDefault()
        onEnter(cell.id)
      }
    }

    mf.addEventListener('input', handleInput)
    mf.addEventListener('keydown', handleKeyDown)
    return () => {
      mf.removeEventListener('input', handleInput)
      mf.removeEventListener('keydown', handleKeyDown)
    }
  }, [cell.id, onUpdate, onEnter])

  return (
    <div
      style={{ display: 'flex', alignItems: 'stretch', borderBottom: '1px solid #111', background: '#fff' }}
      onDragOver={(e) => e.preventDefault()}
      onDrop={() => onDrop(index)}
      onMouseEnter={() => setHovering(true)}
      onMouseLeave={() => setHovering(false)}
    >
      {/* Drag handle */}
      <div
        draggable
        onDragStart={() => onDragStart(index)}
        style={{
          width: '1.75rem', display: 'flex', alignItems: 'center', justifyContent: 'center',
          flexShrink: 0, cursor: 'grab', color: hovering ? '#bbb' : 'transparent',
          fontSize: '0.75rem', userSelect: 'none',
        }}
      >⠿</div>

      {/* Input + output row */}
      <div style={{
        flex: 1, display: 'flex', alignItems: 'center',
        borderLeft: focused ? '2px solid #1a73e8' : '2px solid transparent',
        padding: '0.35rem 0', minHeight: '2.2rem', overflow: 'hidden',
      }}>
        <math-field
          ref={mathfieldRef}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          style={{
            flex: 1,
            fontSize: '1rem',
            fontFamily: 'ui-monospace, Consolas, monospace',
            border: 'none',
            outline: 'none',
            padding: 0,
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

      {/* Delete button */}
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
