import { useRef, useState, useEffect, forwardRef, useImperativeHandle } from 'react'
import 'mathlive'
import type { MathfieldElement } from 'mathlive'
import type { CellData } from '../types'
import { getConstantValue } from '../lib/mathScope'
import ColorPicker from './ColorPicker'


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
  onSliderChange: (id: string, value: number) => void
  onSliderBoundsChange: (id: string, min: number, max: number) => void
  onSliderToggle: (id: string) => void
}


export interface CellHandle { focus: () => void; setValue: (latex: string) => void }
export default forwardRef<CellHandle, CellProps>(function Cell({ cell, index, style, onUpdate, onEnter, onDelete, onDragStart, onToggleVisible, onColorChange, onSliderChange, onSliderBoundsChange, onSliderToggle }, ref) {
  const mathfieldRef = useRef<MathfieldElement>(null)
  const rowRef = useRef<HTMLDivElement>(null)

  useImperativeHandle(ref, () => ({
    focus: () => mathfieldRef.current?.focus(),
    setValue: (latex: string) => {
      mathfieldRef.current?.setValue(latex, { silenceNotifications: true } as any)
    },
  }))
  const [focused, setFocused] = useState(false)
  const [hovering, setHovering] = useState(false)
  const [showTooltip, setShowTooltip] = useState(false)
  const [tooltipPos, setTooltipPos] = useState<{ top: number; right: number } | null>(null)
  const [showColorPicker, setShowColorPicker] = useState(false)
  const [pickerPos, setPickerPos] = useState<{ top: number; left: number } | null>(null)
  const [editingMin, setEditingMin] = useState<string | null>(null)
  const [editingMax, setEditingMax] = useState<string | null>(null)
  const errorRef = useRef<HTMLDivElement>(null)

  // Sync value into the math-field when it changes externally (e.g. cell reorder)
  useEffect(() => {
    const mf = mathfieldRef.current
    if (!mf) return
    if (mf.getValue() !== cell.input) {
      mf.setValue(cell.input, { silenceNotifications: true } as any)
    }
  }, [cell.input])

  // Wire up MathLive event listeners after mount
  useEffect(() => {
    const mf = mathfieldRef.current
    if (!mf) return
    mf.mathVirtualKeyboardPolicy = 'manual'
    mf.letterShapeStyle = 'upright'
    mf.smartFence = true
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

  const sliderValue = cell.slider ? (() => {
    const v = getConstantValue(cell.input)
    return v !== null ? v : cell.slider.min
  })() : 0

  return (
    <div
      ref={rowRef}
      style={{
        display: 'flex', flexDirection: 'row', borderBottom: '1px solid #111', background: '#fff',
        ...style,
      }}
      onMouseEnter={() => setHovering(true)}
      onMouseLeave={() => setHovering(false)}
    >
      {/* Drag handle — spans full cell height, split into top (drag) and bottom (slider eye) */}
      <div
        style={{
          width: '1.75rem', flexShrink: 0, display: 'flex', flexDirection: 'column',
          background: (hovering || focused) ? '#1e1b4b' : 'transparent',
          transition: 'background 0.15s',
        }}
      >
        {/* Top: drag grip or color dot */}
        <div
          onMouseDown={(e) => {
            if ((e.target as HTMLElement).closest('[data-colorwheel]')) return
            e.preventDefault()
            const height = rowRef.current?.getBoundingClientRect().height ?? 40
            onDragStart(index, e.clientY, height)
          }}
          style={{
            flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center',
            cursor: 'grab', userSelect: 'none',
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
              <div style={{ width: '8px', height: '8px', borderRadius: '50%', background: cell.color }} />
            )
          ) : (
            <span style={{ color: (hovering || focused) ? '#aaa' : 'transparent', fontSize: '0.75rem' }}>⠿</span>
          )}
        </div>

        {/* Bottom: eye toggle for slider (only when slider exists) */}
        {cell.slider && (
          <div
            onClick={() => onSliderToggle(cell.id)}
            title={cell.slider.visible ? 'Hide slider' : 'Show slider'}
            style={{
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              padding: '0.3rem 0', cursor: 'pointer',
              color: cell.slider.visible ? (hovering || focused ? '#fff' : '#888') : '#555',
            }}
          >
            {cell.slider.visible ? (
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
                <circle cx="12" cy="12" r="3"/>
              </svg>
            ) : (
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"/>
                <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"/>
                <line x1="1" y1="1" x2="23" y2="23"/>
              </svg>
            )}
          </div>
        )}
      </div>

      {/* Content: input row + slider */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>

      {showColorPicker && pickerPos && cell.graphEnabled && (
        <ColorPicker
          color={cell.color}
          onChange={(c) => onColorChange(cell.id, c)}
          onClose={() => setShowColorPicker(false)}
          anchorPos={pickerPos}
        />
      )}
    {/* Main input row */}
    <div style={{ display: 'flex', alignItems: 'stretch' }}>

      {/* Input + output row */}
      <div style={{
        flex: 1, display: 'flex', alignItems: 'center',
        borderLeft: '2px solid transparent',
        padding: '0.35rem 0', minHeight: '2.2rem', overflow: 'hidden',
      }}>
        {/* @ts-expect-error math-field is a custom element registered by mathlive */}
        <math-field
          ref={mathfieldRef}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          style={{
            flexShrink: 999,
            flexGrow: 1,
            flexBasis: 0,
            minWidth: 0,
            overflow: 'hidden',
            fontSize: '1rem',
            fontFamily: 'KaTeX_Main, serif',
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
            color: '#111', marginLeft: '1rem', whiteSpace: 'nowrap',
            flexShrink: 1, flexGrow: 0, flexBasis: 'auto', minWidth: 0,
            overflow: 'hidden',
            fontFamily: 'KaTeX_Main, serif', fontSize: '1rem',
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
    </div>{/* end main input row */}

    {/* Slider row — shown when slider exists and is visible */}
    {cell.slider?.visible && (
      <div style={{
        display: 'flex', alignItems: 'center', gap: '0.5rem',
        padding: '0.2rem 0.75rem 0.4rem 0.5rem',
      }}>
        {/* Min bound */}
        {editingMin !== null ? (
          <input
            autoFocus
            type="number"
            value={editingMin}
            onChange={(e) => setEditingMin(e.target.value)}
            onBlur={() => {
              const n = parseFloat(editingMin ?? '')
              if (isFinite(n) && n < cell.slider!.max) onSliderBoundsChange(cell.id, n, cell.slider!.max)
              setEditingMin(null)
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === 'Escape') (e.target as HTMLInputElement).blur()
            }}
            style={{
              width: '4rem', border: 'none', borderBottom: '1px solid #aaa',
              outline: 'none', fontSize: '0.72rem', color: '#888',
              fontFamily: 'KaTeX_Main, serif', background: 'transparent',
              textAlign: 'right',
            }}
          />
        ) : (
          <span
            onClick={() => setEditingMin(String(cell.slider!.min))}
            style={{ fontSize: '0.72rem', color: '#888', cursor: 'text', userSelect: 'none', flexShrink: 0, fontFamily: 'KaTeX_Main, serif' }}
          >{cell.slider.min}</span>
        )}

        {/* Track */}
        <input
          type="range"
          min={cell.slider.min}
          max={cell.slider.max}
          step={(cell.slider.max - cell.slider.min) / 1000}
          value={sliderValue}
          onChange={(e) => onSliderChange(cell.id, parseFloat(e.target.value))}
          style={{ flex: 1, accentColor: '#1e1b4b', cursor: 'pointer', height: '4px' }}
        />

        {/* Max bound */}
        {editingMax !== null ? (
          <input
            autoFocus
            type="number"
            value={editingMax}
            onChange={(e) => setEditingMax(e.target.value)}
            onBlur={() => {
              const n = parseFloat(editingMax ?? '')
              if (isFinite(n) && n > cell.slider!.min) onSliderBoundsChange(cell.id, cell.slider!.min, n)
              setEditingMax(null)
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === 'Escape') (e.target as HTMLInputElement).blur()
            }}
            style={{
              width: '4rem', border: 'none', borderBottom: '1px solid #aaa',
              outline: 'none', fontSize: '0.72rem', color: '#888',
              fontFamily: 'KaTeX_Main, serif', background: 'transparent',
            }}
          />
        ) : (
          <span
            onClick={() => setEditingMax(String(cell.slider!.max))}
            style={{ fontSize: '0.72rem', color: '#888', cursor: 'text', userSelect: 'none', flexShrink: 0, fontFamily: 'KaTeX_Main, serif' }}
          >{cell.slider.max}</span>
        )}
      </div>
    )}
    </div>{/* end content column */}
    </div>
  )
})
