import { useEffect, useRef, useState } from 'react'

interface Props {
  color: string
  onChange: (color: string) => void
  onClose: () => void
  anchorPos: { top: number; left: number }
}

function hexToHsv(hex: string): [number, number, number] {
  const clean = hex.replace('#', '').padEnd(6, '0')
  const r = parseInt(clean.slice(0, 2), 16) / 255
  const g = parseInt(clean.slice(2, 4), 16) / 255
  const b = parseInt(clean.slice(4, 6), 16) / 255
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min
  let h = 0
  if (d !== 0) {
    if (max === r) h = ((g - b) / d) % 6
    else if (max === g) h = (b - r) / d + 2
    else h = (r - g) / d + 4
    h = ((h * 60) + 360) % 360
  }
  return [h, max === 0 ? 0 : d / max, max]
}

function hsvToHex(h: number, s: number, v: number): string {
  const f = (n: number) => {
    const k = (n + h / 60) % 6
    return v - v * s * Math.max(0, Math.min(k, 4 - k, 1))
  }
  const toHex = (x: number) => Math.round(Math.max(0, Math.min(1, x)) * 255).toString(16).padStart(2, '0')
  return `#${toHex(f(5))}${toHex(f(3))}${toHex(f(1))}`
}

function hsvToRgb(h: number, s: number, v: number): [number, number, number] {
  const f = (n: number) => {
    const k = (n + h / 60) % 6
    return v - v * s * Math.max(0, Math.min(k, 4 - k, 1))
  }
  return [Math.round(f(5) * 255), Math.round(f(3) * 255), Math.round(f(1) * 255)]
}

const SQ = 160  // square size
const HUE_H = 12 // hue slider height

export default function ColorPicker({ color, onChange, onClose, anchorPos }: Props) {
  const [hsv, setHsv] = useState<[number, number, number]>(() => hexToHsv(color))
  const sqRef = useRef<HTMLCanvasElement>(null)
  const hueRef = useRef<HTMLCanvasElement>(null)
  const draggingSq = useRef(false)
  const draggingHue = useRef(false)
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose

  // Draw saturation/value square
  useEffect(() => {
    const canvas = sqRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')!
    // White → hue gradient (left to right)
    const hGrad = ctx.createLinearGradient(0, 0, SQ, 0)
    hGrad.addColorStop(0, '#fff')
    hGrad.addColorStop(1, `hsl(${hsv[0]}, 100%, 50%)`)
    ctx.fillStyle = hGrad
    ctx.fillRect(0, 0, SQ, SQ)
    // Transparent → black gradient (top to bottom)
    const vGrad = ctx.createLinearGradient(0, 0, 0, SQ)
    vGrad.addColorStop(0, 'rgba(0,0,0,0)')
    vGrad.addColorStop(1, 'rgba(0,0,0,1)')
    ctx.fillStyle = vGrad
    ctx.fillRect(0, 0, SQ, SQ)
    // Selector circle
    const cx = hsv[1] * SQ
    const cy = (1 - hsv[2]) * SQ
    ctx.beginPath()
    ctx.arc(cx, cy, 6, 0, Math.PI * 2)
    ctx.strokeStyle = '#fff'
    ctx.lineWidth = 2
    ctx.stroke()
    ctx.beginPath()
    ctx.arc(cx, cy, 6, 0, Math.PI * 2)
    ctx.strokeStyle = 'rgba(0,0,0,0.4)'
    ctx.lineWidth = 1
    ctx.stroke()
  }, [hsv])

  // Draw hue slider
  useEffect(() => {
    const canvas = hueRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')!
    const grad = ctx.createLinearGradient(0, 0, SQ, 0)
    for (let i = 0; i <= 6; i++) grad.addColorStop(i / 6, `hsl(${i * 60}, 100%, 50%)`)
    ctx.fillStyle = grad
    ctx.fillRect(0, 0, SQ, HUE_H)
    // Hue indicator
    const x = (hsv[0] / 360) * SQ
    ctx.beginPath()
    ctx.arc(x, HUE_H / 2, 6, 0, Math.PI * 2)
    ctx.fillStyle = `hsl(${hsv[0]}, 100%, 50%)`
    ctx.fill()
    ctx.strokeStyle = '#fff'
    ctx.lineWidth = 2
    ctx.stroke()
    ctx.strokeStyle = 'rgba(0,0,0,0.3)'
    ctx.lineWidth = 1
    ctx.stroke()
  }, [hsv])

  // Global mouse tracking so dragging outside the canvas still works
  const hsvRef = useRef(hsv)
  hsvRef.current = hsv
  const onChangeRef = useRef(onChange)
  onChangeRef.current = onChange

  useEffect(() => {
    function onMove(e: MouseEvent) {
      if (draggingSq.current && sqRef.current) {
        const rect = sqRef.current.getBoundingClientRect()
        const s = Math.max(0, Math.min(1, (e.clientX - rect.left) / SQ))
        const v = Math.max(0, Math.min(1, 1 - (e.clientY - rect.top) / SQ))
        const next: [number, number, number] = [hsvRef.current[0], s, v]
        setHsv(next)
        onChangeRef.current(hsvToHex(...next))
      }
      if (draggingHue.current && hueRef.current) {
        const rect = hueRef.current.getBoundingClientRect()
        const h = Math.max(0, Math.min(360, ((e.clientX - rect.left) / SQ) * 360))
        const next: [number, number, number] = [h, hsvRef.current[1], hsvRef.current[2]]
        setHsv(next)
        onChangeRef.current(hsvToHex(...next))
      }
    }
    function onUp() {
      draggingSq.current = false
      draggingHue.current = false
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    return () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
  }, [])

  useEffect(() => {
    function onDown(e: MouseEvent) {
      const el = document.getElementById('color-picker-popover')
      if (el && !el.contains(e.target as Node)) onCloseRef.current()
    }
    const t = setTimeout(() => window.addEventListener('mousedown', onDown), 0)
    return () => { clearTimeout(t); window.removeEventListener('mousedown', onDown) }
  }, [])

  const [r, g, b] = hsvToRgb(...hsv)
  const hex = hsvToHex(...hsv)

  return (
    <div
      id="color-picker-popover"
      onMouseDown={(e) => e.stopPropagation()}
      style={{
        position: 'fixed', top: anchorPos.top, left: anchorPos.left, zIndex: 1000,
        background: '#fff', border: '1px solid #ddd', borderRadius: '8px',
        boxShadow: '0 4px 20px rgba(0,0,0,0.15)',
        display: 'flex', flexDirection: 'column',
        overflow: 'hidden', width: `${SQ}px`,
      }}
    >
      {/* SV square */}
      <canvas
        ref={sqRef} width={SQ} height={SQ}
        style={{ display: 'block', cursor: 'crosshair' }}
        onMouseDown={() => { draggingSq.current = true }}
      />

      <div style={{ padding: '10px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
        {/* Hue slider */}
        <canvas
          ref={hueRef} width={SQ} height={HUE_H * 2}
          style={{ display: 'block', borderRadius: '4px', cursor: 'crosshair', width: '100%' }}
          onMouseDown={() => { draggingHue.current = true }}
        />

        {/* Preview + hex */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <div style={{ width: '28px', height: '28px', borderRadius: '50%', background: hex, border: '1px solid #ddd', flexShrink: 0 }} />
          <input
            value={hex}
            onChange={(e) => {
              const v = e.target.value
              if (/^#[0-9a-fA-F]{6}$/.test(v)) {
                const next = hexToHsv(v)
                setHsv(next)
                onChange(v)
              }
            }}
            style={{ flex: 1, border: '1px solid #ddd', borderRadius: '4px', padding: '3px 6px', fontFamily: 'monospace', fontSize: '0.8rem' }}
          />
        </div>

        {/* RGB readout */}
        <div style={{ display: 'flex', gap: '6px' }}>
          {[['R', r], ['G', g], ['B', b]].map(([label, val]) => (
            <div key={label as string} style={{ flex: 1, textAlign: 'center' }}>
              <div style={{ border: '1px solid #ddd', borderRadius: '4px', padding: '3px', fontSize: '0.8rem', fontFamily: 'monospace' }}>{val}</div>
              <div style={{ fontSize: '0.7rem', color: '#888', marginTop: '2px' }}>{label}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
