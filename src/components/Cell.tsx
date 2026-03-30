import { useRef } from 'react'
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

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    onUpdate(cell.id, e.target.value)
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') onEnter(cell.id)
  }

  const displayHtml = cell.latex ? renderLatex(cell.latex) : ''

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '0.5rem' }}>
      {/* Cell number */}
      <div style={{ color: '#aaa', fontSize: '0.85rem', width: '1.5rem', textAlign: 'right', flexShrink: 0 }}>
        {index + 1}
      </div>

      {/* Input + result bar */}
      <div
        style={{
          flex: 1,
          display: 'flex',
          alignItems: 'center',
          border: `1px solid ${cell.error ? '#f99' : '#ddd'}`,
          borderRadius: '6px',
          background: '#fff',
          padding: '0.5rem 0.75rem',
          cursor: 'text',
        }}
        onClick={() => inputRef.current?.focus()}
      >
        <input
          ref={inputRef}
          type="text"
          value={cell.input}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          style={{ position: 'absolute', opacity: 0, width: 0, height: 0 }}
        />

        <div
          style={{ flex: 1, fontSize: '1rem', minHeight: '1.5rem' }}
          dangerouslySetInnerHTML={{
            __html: displayHtml || `<span style="color:#aaa">${cell.input || 'Expression...'}</span>`,
          }}
        />

        {cell.error ? (
          <div style={{ color: 'red', fontSize: '0.85rem', marginLeft: '1rem', whiteSpace: 'nowrap' }}>
            {cell.error}
          </div>
        ) : cell.output ? (
          <div
            style={{ color: '#555', marginLeft: '1rem', whiteSpace: 'nowrap' }}
            dangerouslySetInnerHTML={{ __html: '= ' + renderLatex(cell.output) }}
          />
        ) : null}
      </div>
    </div>
  )
}
