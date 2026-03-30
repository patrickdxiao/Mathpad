import { useState, useRef } from 'react'
import katex from 'katex'
import 'katex/dist/katex.min.css'
import { evaluateCell, math } from './lib/mathScope'

function renderLatex(tex: string) {
  try {
    return katex.renderToString(tex, { throwOnError: false, displayMode: false })
  } catch {
    return tex
  }
}

function App() {
  const [input, setInput] = useState('')
  const [result, setResult] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [inputLatex, setInputLatex] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const value = e.target.value
    setInput(value)

    const { result, error } = evaluateCell(value)
    setResult(result)
    setError(error)

    try {
      setInputLatex(math.parse(value).toTex())
    } catch {
      setInputLatex('')
    }
  }

  const displayHtml = inputLatex ? renderLatex(inputLatex) : ''

  return (
    <div style={{ padding: '2rem', maxWidth: '800px', margin: '0 auto' }}>
      <h1 style={{ fontSize: '1.5rem', marginBottom: '1.5rem', fontWeight: 600 }}>MathPad</h1>

      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          border: '1px solid #ddd',
          borderRadius: '6px',
          background: '#fff',
          padding: '0.5rem 0.75rem',
          cursor: 'text',
          position: 'relative',
        }}
        onClick={() => inputRef.current?.focus()}
      >
        <input
          ref={inputRef}
          type="text"
          value={input}
          onChange={handleChange}
          style={{ position: 'absolute', opacity: 0, width: 0, height: 0 }}
        />

        {/* Expression display */}
        <div
          style={{ flex: 1, fontSize: '1rem', minHeight: '1.5rem' }}
          dangerouslySetInnerHTML={{
            __html: displayHtml || `<span style="color:#aaa">Type a math expression...</span>`,
          }}
        />

        {/* Result on the right */}
        {error ? (
          <div style={{ color: 'red', fontSize: '0.85rem', marginLeft: '1rem', whiteSpace: 'nowrap' }}>
            {error}
          </div>
        ) : result ? (
          <div
            style={{ color: '#555', marginLeft: '1rem', whiteSpace: 'nowrap' }}
            dangerouslySetInnerHTML={{ __html: '= ' + renderLatex(result) }}
          />
        ) : null}
      </div>
    </div>
  )
}

export default App
