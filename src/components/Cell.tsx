import { useRef, useState } from 'react'
import katex from 'katex'
import 'katex/dist/katex.min.css'
import type { CellData } from '../types'

interface CellProps {
  cell: CellData
  index: number
  onUpdate: (id: string, input: string) => void
  onEnter: (id: string) => void
}

function renderLatex(tex: string) {
  try {
    return katex.renderToString(tex, { throwOnError: false, displayMode: false })
  } catch {
    return tex
  }
}

export default function Cell({ cell, index, onUpdate, onEnter }: CellProps) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [focused, setFocused] = useState(false)
  const [showTooltip, setShowTooltip] = useState(false)

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    onUpdate(cell.id, e.target.value)
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') onEnter(cell.id)
  }

  // Show raw input text instead of KaTeX to avoid inconsistent italics
  const displayHtml = ''

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '0.5rem' }}>
      <div style={{ color: '#aaa', fontSize: '0.85rem', width: '1.5rem', textAlign: 'right', flexShrink: 0 }}>
        {index + 1}
      </div>

      <div
        style={{
          flex: 1,
          display: 'flex',
          alignItems: 'center',
          border: '1px solid #ddd',
          borderRadius: '6px',
          background: '#fff',
          padding: '0.4rem 0.75rem',
          cursor: 'text',
          position: 'relative',
          minHeight: '2.2rem',
        }}
        onClick={() => inputRef.current?.focus()}
      >
        <input
          ref={inputRef}
          type="text"
          value={cell.input}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          style={{
            position: 'absolute',
            inset: 0,
            padding: '0.4rem 0.75rem',
            fontSize: '1rem',
            fontFamily: 'ui-monospace, Consolas, monospace',
            border: 'none',
            outline: 'none',
            background: 'transparent',
            color: focused ? '#111' : 'transparent',
            caretColor: '#111',
            width: '100%',
            boxSizing: 'border-box',
          }}
        />

        {!focused && (
          <div
            style={{ flex: 1, fontSize: '1rem', minHeight: '1.5rem', pointerEvents: 'none' }}
            dangerouslySetInnerHTML={{
              __html: displayHtml || `<span style="color:#aaa">${cell.input || 'Expression...'}</span>`,
            }}
          />
        )}

        {focused && <div style={{ flex: 1 }} />}

        {cell.error ? (
          <div
            style={{ position: 'relative', marginLeft: '0.75rem', flexShrink: 0 }}
            onMouseEnter={() => setShowTooltip(true)}
            onMouseLeave={() => setShowTooltip(false)}
          >
            <span style={{ color: '#e53e3e', cursor: 'help', fontSize: '1rem' }}>⚠</span>
            {showTooltip && (
              <div style={{
                position: 'absolute',
                bottom: '130%',
                right: 0,
                background: '#333',
                color: '#fff',
                padding: '0.3rem 0.6rem',
                borderRadius: '4px',
                fontSize: '0.75rem',
                whiteSpace: 'nowrap',
                zIndex: 10,
                pointerEvents: 'none',
              }}>
                {cell.error}
              </div>
            )}
          </div>
        ) : cell.output && !cell.graphEnabled ? (
          <div
            style={{ color: '#555', marginLeft: '1rem', whiteSpace: 'nowrap', position: 'relative', zIndex: 1 }}
            dangerouslySetInnerHTML={{ __html: '= ' + renderLatex(cell.output) }}
          />
        ) : null}
      </div>
    </div>
  )
}
