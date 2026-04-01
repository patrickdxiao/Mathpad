import { useEffect, useRef, useCallback } from 'react'
import { math } from '../lib/mathScope'

const COLORS = ['#1a73e8', '#e8340a', '#188038', '#e37400', '#a142f4', '#007b83']
const GRID_COLOR = '#ebebeb'
const AXIS_COLOR = '#aaa'
const LABEL_COLOR = '#888'
const LABEL_FONT = '11px system-ui, sans-serif'

interface GraphProps {
  expressions: string[]
  scope: Record<string, unknown>
}

function niceInterval(rawInterval: number): number {
  const mag = Math.pow(10, Math.floor(Math.log10(rawInterval)))
  const n = rawInterval / mag
  if (n < 1.5) return mag
  if (n < 3.5) return 2 * mag
  if (n < 7.5) return 5 * mag
  return 10 * mag
}

function buildPlotFn(expr: string, scope: Record<string, unknown>): ((x: number) => number) | null {
  try {
    const node = math.parse(expr)
    const plotNode = node.type === 'AssignmentNode' ? (node as any).value : node
    return (x: number) => {
      const r = plotNode.evaluate({ ...scope, x })
      return typeof r === 'number' ? r : NaN
    }
  } catch {
    return null
  }
}

function getVerticalX(expr: string, scope: Record<string, unknown>): number | null {
  try {
    const node = math.parse(expr)
    if (node.type === 'AssignmentNode' && (node as any).name === 'x') {
      const val = (node as any).value.evaluate({ ...scope })
      return typeof val === 'number' ? val : null
    }
  } catch { /* */ }
  return null
}

export default function Graph({ expressions, scope }: GraphProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const view = useRef({ cx: 0, cy: 0, scale: 50 })
  const drag = useRef<{ x: number; y: number; cx: number; cy: number } | null>(null)
  const size = useRef({ w: 0, h: 0 })

  const draw = useCallback(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const { w, h } = size.current
    const { cx, cy, scale } = view.current
    if (w === 0 || h === 0) return

    const toX = (x: number) => (x - cx) * scale + w / 2
    const toY = (y: number) => -(y - cy) * scale + h / 2
    const xMin = cx - w / 2 / scale
    const xMax = cx + w / 2 / scale
    const yMin = cy - h / 2 / scale
    const yMax = cy + h / 2 / scale

    const dpr = window.devicePixelRatio
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)

    // Background
    ctx.fillStyle = '#fff'
    ctx.fillRect(0, 0, w, h)

    // Grid interval targeting ~80px between lines
    const interval = niceInterval(80 / scale)

    ctx.font = LABEL_FONT
    ctx.lineWidth = 1

    // Vertical grid lines + x labels
    const x0 = Math.ceil(xMin / interval) * interval
    for (let x = x0; x <= xMax + interval * 0.01; x += interval) {
      const px = toX(x)
      const isAxis = Math.abs(x) < interval * 0.01
      ctx.strokeStyle = isAxis ? AXIS_COLOR : GRID_COLOR
      ctx.beginPath(); ctx.moveTo(px, 0); ctx.lineTo(px, h); ctx.stroke()
      if (!isAxis) {
        ctx.fillStyle = LABEL_COLOR
        ctx.textAlign = 'center'
        ctx.textBaseline = 'top'
        const ly = Math.min(Math.max(toY(0) + 3, 2), h - 14)
        ctx.fillText(parseFloat(x.toPrecision(8)).toString(), px, ly)
      }
    }

    // Horizontal grid lines + y labels
    const y0 = Math.ceil(yMin / interval) * interval
    for (let y = y0; y <= yMax + interval * 0.01; y += interval) {
      const py = toY(y)
      const isAxis = Math.abs(y) < interval * 0.01
      ctx.strokeStyle = isAxis ? AXIS_COLOR : GRID_COLOR
      ctx.beginPath(); ctx.moveTo(0, py); ctx.lineTo(w, py); ctx.stroke()
      if (!isAxis) {
        ctx.fillStyle = LABEL_COLOR
        ctx.textAlign = 'right'
        ctx.textBaseline = 'middle'
        const lx = Math.min(Math.max(toX(0) - 4, 28), w - 4)
        ctx.fillText(parseFloat(y.toPrecision(8)).toString(), lx, py)
      }
    }

    // Plot each expression
    expressions.forEach((expr, i) => {
      ctx.strokeStyle = COLORS[i % COLORS.length]
      ctx.lineWidth = 2
      ctx.lineJoin = 'round'
      ctx.lineCap = 'round'

      const vx = getVerticalX(expr, scope)
      if (vx !== null) {
        const px = toX(vx)
        ctx.beginPath(); ctx.moveTo(px, 0); ctx.lineTo(px, h); ctx.stroke()
        return
      }

      const fn = buildPlotFn(expr, scope)
      if (!fn) return

      const steps = Math.ceil(w * 2)
      const dx = (xMax - xMin) / steps
      ctx.beginPath()
      let penDown = false
      for (let s = 0; s <= steps; s++) {
        const x = xMin + s * dx
        const y = fn(x)
        if (!isFinite(y) || Math.abs(y) > 1e10) { penDown = false; continue }
        const px = toX(x), py = toY(y)
        if (!penDown) { ctx.moveTo(px, py); penDown = true }
        else ctx.lineTo(px, py)
      }
      ctx.stroke()
    })
  }, [expressions, scope])

  // Handle canvas sizing with devicePixelRatio for sharp rendering
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const observer = new ResizeObserver((entries) => {
      const { width, height } = entries[0].contentRect
      size.current = { w: width, h: height }
      const dpr = window.devicePixelRatio
      canvas.width = width * dpr
      canvas.height = height * dpr
      draw()
    })
    observer.observe(canvas)
    return () => observer.disconnect()
  }, [draw])

  useEffect(() => { draw() }, [draw])

  // Must be a non-passive native listener so preventDefault() actually works
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    function onWheel(e: WheelEvent) {
      e.preventDefault()
      const { cx, cy, scale } = view.current
      const { w, h } = size.current
      const factor = e.deltaY > 0 ? 1 / 1.1 : 1.1
      const newScale = Math.max(0.5, Math.min(scale * factor, 1e6))

      // World coords under cursor before zoom
      const mouseX = cx + (e.offsetX - w / 2) / scale
      const mouseY = cy - (e.offsetY - h / 2) / scale

      // After zoom, adjust center so mouseX/Y stays under cursor
      view.current.scale = newScale
      view.current.cx = mouseX - (e.offsetX - w / 2) / newScale
      view.current.cy = mouseY + (e.offsetY - h / 2) / newScale
      draw()
    }
    canvas.addEventListener('wheel', onWheel, { passive: false })
    return () => canvas.removeEventListener('wheel', onWheel)
  }, [draw])

  function handleMouseDown(e: React.MouseEvent) {
    drag.current = { x: e.clientX, y: e.clientY, cx: view.current.cx, cy: view.current.cy }
  }

  function handleMouseMove(e: React.MouseEvent) {
    if (!drag.current) return
    view.current.cx = drag.current.cx - (e.clientX - drag.current.x) / view.current.scale
    view.current.cy = drag.current.cy + (e.clientY - drag.current.y) / view.current.scale
    draw()
  }

  function handleMouseUp() { drag.current = null }

  return (
    <canvas
      ref={canvasRef}
      style={{ width: '100%', height: '100%', display: 'block', cursor: 'grab' }}
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onMouseLeave={handleMouseUp}
    />
  )
}
