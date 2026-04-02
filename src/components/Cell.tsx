import { useRef, useState, useEffect, forwardRef, useImperativeHandle } from 'react'
import 'mathlive'
import type { MathfieldElement } from 'mathlive'
import type { CellData } from '../types'
import ColorPicker from './ColorPicker'

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
  style?: React.CSSProperties
  onUpdate: (id: string, latex: string) => void
  onEnter: (id: string) => void
  onDelete: (id: string) => void
  onDragStart: (index: number, clientY: number, cellHeight: number) => void
  onToggleVisible: (id: string) => void
  onColorChange: (id: string, color: string) => void
}


export interface CellHandle { focus: () => void }

export default forwardRef<CellHandle, CellProps>(function Cell({ cell, index, style, onUpdate, onEnter, onDelete, onDragStart, onToggleVisible, onColorChange }, ref) {
  const mathfieldRef = useRef<MathfieldElement>(null)
  const rowRef = useRef<HTMLDivElement>(null)

  useImperativeHandle(ref, () => ({
    focus: () => mathfieldRef.current?.focus(),
  }))
  const [focused, setFocused] = useState(false)
  const [hovering, setHovering] = useState(false)
  const [showTooltip, setShowTooltip] = useState(false)
  const [tooltipPos, setTooltipPos] = useState<{ top: number; right: number } | null>(null)
  const [showColorPicker, setShowColorPicker] = useState(false)
  const [pickerPos, setPickerPos] = useState<{ top: number; left: number } | null>(null)
  const errorRef = useRef<HTMLDivElement>(null)

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
    mf.letterShapeStyle = 'upright'
    mf.inlineShortcuts = {}

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
      ref={rowRef}
      style={{
        display: 'flex', alignItems: 'stretch', borderBottom: '1px solid #111', background: '#fff',
        ...style,
      }}
      onMouseEnter={() => setHovering(true)}
      onMouseLeave={() => setHovering(false)}
    >
      {/* Drag handle + color picker */}
      <div
        onMouseDown={(e) => {
          if ((e.target as HTMLElement).closest('[data-colorwheel]')) return
          e.preventDefault()
          const height = rowRef.current?.getBoundingClientRect().height ?? 40
          onDragStart(index, e.clientY, height)
        }}
        style={{
          width: '1.75rem', display: 'flex', alignItems: 'center', justifyContent: 'center',
          flexShrink: 0, cursor: 'grab', userSelect: 'none',
          background: (hovering || focused) ? '#1e1b4b' : 'transparent',
          transition: 'background 0.15s', position: 'relative',
        }}
      >
        {cell.graphEnabled ? (
          (hovering || focused) ? (
            <div
              data-colorwheel
              onClick={(e) => {
                e.stopPropagation()
                const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
                setPickerPos({ top: rect.bottom + 4, left: rect.left })
                setShowColorPicker((v) => !v)
              }}
              style={{
                width: '14px', height: '14px', borderRadius: '50%', cursor: 'pointer',
                background: 'conic-gradient(red, yellow, lime, cyan, blue, magenta, red)',
              }}
            />
          ) : (
            <div style={{ width: '8px', height: '8px', borderRadius: '50%', background: cell.color, opacity: 0.7 }} />
          )
        ) : (
          <span style={{ color: (hovering || focused) ? '#aaa' : 'transparent', fontSize: '0.75rem' }}>⠿</span>
        )}
      </div>

      {showColorPicker && pickerPos && cell.graphEnabled && (
        <ColorPicker
          color={cell.color}
          onChange={(c) => onColorChange(cell.id, c)}
          onClose={() => setShowColorPicker(false)}
          anchorPos={pickerPos}
        />
      )}

      {/* Input + output row */}
      <div style={{
        flex: 1, display: 'flex', alignItems: 'center',
        borderLeft: '2px solid transparent',
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
            ref={errorRef}
            style={{ position: 'relative', marginLeft: '0.75rem', flexShrink: 0 }}
            onMouseEnter={() => {
              const rect = errorRef.current?.getBoundingClientRect()
              if (rect) setTooltipPos({ top: rect.top - 8, right: window.innerWidth - rect.right })
              setShowTooltip(true)
            }}
            onMouseLeave={() => setShowTooltip(false)}
          >
            <span style={{ color: '#e53e3e', cursor: 'help' }}>⚠</span>
            {showTooltip && tooltipPos && (
              <div style={{
                position: 'fixed',
                top: tooltipPos.top,
                right: tooltipPos.right,
                transform: 'translateY(-100%)',
                background: '#333', color: '#fff',
                padding: '0.3rem 0.6rem', borderRadius: '4px', fontSize: '0.75rem',
                whiteSpace: 'nowrap', zIndex: 1000, pointerEvents: 'none',
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

      {/* Right side: visibility toggle (if graphable) + delete */}
      <div style={{
        display: 'flex', alignItems: 'center', flexShrink: 0,
        opacity: (hovering || !cell.graphVisible) ? 1 : 0,
        transition: 'opacity 0.1s',
      }}>
        {cell.graphEnabled && (
          <button
            onClick={() => onToggleVisible(cell.id)}
            title={cell.graphVisible ? 'Hide from graph' : 'Show on graph'}
            style={{
              background: 'none', border: 'none', cursor: 'pointer', padding: '0.1rem 0.2rem',
              color: cell.graphVisible ? '#1e1b4b' : '#ccc', fontSize: '0.85rem', lineHeight: 1,
            }}
          >
            {cell.graphVisible ? (
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
                <circle cx="12" cy="12" r="3"/>
              </svg>
            ) : (
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"/>
                <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"/>
                <line x1="1" y1="1" x2="23" y2="23"/>
              </svg>
            )}
          </button>
        )}
        <button
          onClick={() => onDelete(cell.id)}
          style={{
            background: 'none', border: 'none', cursor: 'pointer', color: '#aaa',
            fontSize: '1.1rem', lineHeight: 1, padding: '0.1rem 0.3rem',
            opacity: hovering ? 1 : 0, transition: 'opacity 0.1s',
          }}
        >×</button>
      </div>
    </div>
  )
})
