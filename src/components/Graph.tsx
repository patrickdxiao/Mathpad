import { useEffect, useRef, useCallback } from 'react'
import { math } from '../lib/mathScope'

const COLORS = ['#1e1b4b', '#1a73e8', '#e8340a', '#188038', '#e37400', '#007b83']
const GRID_COLOR = '#ebebeb'
const AXIS_COLOR = '#111'
const LABEL_COLOR = '#888'
const LABEL_FONT = '11px system-ui, sans-serif'

function formatLabel(n: number): string {
  const abs = Math.abs(n)
  if (abs === 0) return '0'
  if (abs >= 1e5 || (abs < 1e-4 && abs > 0)) return n.toExponential(2).replace('e+', 'e').replace('e0', 'e').replace(/\.?0+e/, 'e')
  return parseFloat(n.toPrecision(8)).toString()
}

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
      try {
        const r = plotNode.evaluate({ ...scope, x })
        return typeof r === 'number' ? r : NaN
      } catch {
        return NaN
      }
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

interface Intersection { x: number; y: number }
interface TaggedIntersection extends Intersection { curves: Set<number> }

// Find intersections between two functions over [xMin, xMax] using sign-change detection + bisection
function findIntersections(
  f: (x: number) => number,
  g: (x: number) => number,
  xMin: number,
  xMax: number,
  steps: number
): Intersection[] {
  const results: Intersection[] = []
  const dx = (xMax - xMin) / steps
  let prev = f(xMin) - g(xMin)

  for (let s = 1; s <= steps; s++) {
    const x = xMin + s * dx
    const curr = f(x) - g(x)
    if (!isFinite(prev) || !isFinite(curr)) { prev = curr; continue }

    if (prev * curr < 0) {
      // Sign change — bisect to find precise x
      let lo = x - dx, hi = x
      for (let i = 0; i < 42; i++) {
        const mid = (lo + hi) / 2
        const fmid = f(mid) - g(mid)
        if (!isFinite(fmid)) break
        if ((f(lo) - g(lo)) * fmid < 0) hi = mid
        else lo = mid
      }
      const ix = (lo + hi) / 2
      const iy = f(ix)
      // Deduplicate — skip if too close to an existing result
      if (!results.some(r => Math.abs(r.x - ix) < dx * 2)) {
        results.push({ x: ix, y: iy })
      }
    }
    prev = curr
  }
  return results
}

const ICON_BTN_STYLE: React.CSSProperties = {
  width: '30px', height: '30px', borderRadius: '6px',
  border: '1px solid #ddd', background: 'rgba(255,255,255,0.9)',
  display: 'flex', alignItems: 'center', justifyContent: 'center',
  cursor: 'pointer', color: '#555', padding: 0,
  boxShadow: '0 1px 3px rgba(0,0,0,0.08)',
}

export default function Graph({ expressions, scope }: GraphProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const view = useRef({ cx: 0, cy: 0, scale: 50 })
  const drag = useRef<{ x: number; y: number; cx: number; cy: number } | null>(null)
  const size = useRef({ w: 0, h: 0 })
  const mouse = useRef<{ px: number; py: number } | null>(null)
  // Which intersection node is currently showing its label (index into allIntersections)
  const activeNode = useRef<number | null>(null)
  // Which curve indices have their nodes visible
  const visibleCurves = useRef<Set<number>>(new Set())
  // Cached intersections and plot functions so click handler can use them
  const intersectionsRef = useRef<TaggedIntersection[]>([])
  const plotFnsRef = useRef<(((x: number) => number) | null)[]>([])

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

    const dpr = window.devicePixelRatio
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)

    // Background
    ctx.fillStyle = '#fff'
    ctx.fillRect(0, 0, w, h)

    // Grid interval targeting ~80px between major lines; minor lines split each segment into 5
    const interval = niceInterval(80 / scale)
    const minorInterval = interval / 5

    ctx.font = LABEL_FONT

    // Minor vertical grid lines
    ctx.lineWidth = 0.3
    ctx.strokeStyle = '#f0f0f0'
    const mx0 = Math.ceil(xMin / minorInterval) * minorInterval
    for (let x = mx0; x <= xMax + minorInterval * 0.01; x += minorInterval) {
      if (Math.abs(x % interval) < minorInterval * 0.01) continue // skip major lines
      const px = toX(x)
      ctx.beginPath(); ctx.moveTo(px, 0); ctx.lineTo(px, h); ctx.stroke()
    }

    // Minor horizontal grid lines
    const yMin = cy - h / 2 / scale
    const yMax = cy + h / 2 / scale
    const my0 = Math.ceil(yMin / minorInterval) * minorInterval
    for (let y = my0; y <= yMax + minorInterval * 0.01; y += minorInterval) {
      if (Math.abs(y % interval) < minorInterval * 0.01) continue // skip major lines
      const py = toY(y)
      ctx.beginPath(); ctx.moveTo(0, py); ctx.lineTo(w, py); ctx.stroke()
    }

    ctx.lineWidth = 0.8

    // Vertical major grid lines + x labels (skip axis)
    const x0 = Math.ceil(xMin / interval) * interval
    for (let x = x0; x <= xMax + interval * 0.01; x += interval) {
      if (Math.abs(x) < interval * 0.01) continue
      const px = toX(x)
      ctx.strokeStyle = GRID_COLOR
      ctx.beginPath(); ctx.moveTo(px, 0); ctx.lineTo(px, h); ctx.stroke()
      ctx.fillStyle = LABEL_COLOR
      ctx.textAlign = 'center'
      ctx.textBaseline = 'top'
      const ly = Math.min(Math.max(toY(0) + 3, 2), h - 14)
      ctx.fillText(formatLabel(x), px, ly)
    }

    // Horizontal major grid lines + y labels (skip axis)
    const y0 = Math.ceil(yMin / interval) * interval
    for (let y = y0; y <= yMax + interval * 0.01; y += interval) {
      if (Math.abs(y) < interval * 0.01) continue
      const py = toY(y)
      ctx.strokeStyle = GRID_COLOR
      ctx.beginPath(); ctx.moveTo(0, py); ctx.lineTo(w, py); ctx.stroke()
      ctx.fillStyle = LABEL_COLOR
      ctx.textAlign = 'right'
      ctx.textBaseline = 'middle'
      const lx = Math.min(Math.max(toX(0) - 4, 28), w - 4)
      ctx.fillText(formatLabel(y), lx, py)
    }

    // Draw axes on top of all grid lines
    ctx.strokeStyle = AXIS_COLOR
    ctx.lineWidth = 0.8
    const axisX = toX(0)
    const axisY = toY(0)
    ctx.beginPath(); ctx.moveTo(axisX, 0); ctx.lineTo(axisX, h); ctx.stroke()
    ctx.beginPath(); ctx.moveTo(0, axisY); ctx.lineTo(w, axisY); ctx.stroke()

    // Build plot functions
    const plotFns = expressions.map(expr => buildPlotFn(expr, scope))
    plotFnsRef.current = plotFns

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

      const fn = plotFns[i]
      if (!fn) return

      const plotSteps = Math.ceil(w * 2)
      const dx = (xMax - xMin) / plotSteps
      ctx.beginPath()
      let penDown = false
      for (let s = 0; s <= plotSteps; s++) {
        const x = xMin + s * dx
        const y = fn(x)
        if (!isFinite(y)) { penDown = false; continue }
        const px = toX(x), py = toY(y)
        if (!penDown) { ctx.moveTo(px, py); penDown = true }
        else ctx.lineTo(px, py)
      }
      ctx.stroke()
    })

    // Compute all notable points per curve: x-axis roots, y-axis crossings, curve-curve intersections
    const steps = Math.ceil(w * 2)
    const zero = (_x: number) => 0

    const allIntersections: TaggedIntersection[] = []
    const tol = (xMax - xMin) / steps * 2

    const addPt = (pt: Intersection, curveIdx: number) => {
      const existing = allIntersections.find(r => Math.abs(r.x - pt.x) < tol && Math.abs(r.y - pt.y) < tol)
      if (existing) { existing.curves.add(curveIdx) }
      else allIntersections.push({ ...pt, curves: new Set([curveIdx]) })
    }

    plotFns.forEach((fn, i) => {
      if (!fn) return
      findIntersections(fn, zero, xMin, xMax, steps).forEach(pt => addPt(pt, i))
      if (xMin <= 0 && xMax >= 0) {
        const y0val = fn(0)
        if (isFinite(y0val)) addPt({ x: 0, y: y0val }, i)
      }
    })
    for (let a = 0; a < plotFns.length; a++) {
      for (let b = a + 1; b < plotFns.length; b++) {
        const fa = plotFns[a], fb = plotFns[b]
        if (!fa || !fb) continue
        findIntersections(fa, fb, xMin, xMax, steps).forEach(pt => { addPt(pt, a); addPt(pt, b) })
      }
    }
    intersectionsRef.current = allIntersections

    // Draw nodes — only for curves that are toggled visible
    allIntersections.forEach((pt, idx) => {
      const belongsToVisible = [...pt.curves].some(c => visibleCurves.current.has(c))
      if (!belongsToVisible) return

      const px = toX(pt.x), py = toY(pt.y)
      const isActive = activeNode.current === idx

      ctx.beginPath()
      ctx.arc(px, py, isActive ? 5 : 4, 0, Math.PI * 2)
      ctx.fillStyle = isActive ? '#111' : '#aaa'
      ctx.fill()

      // Label for active node (only if visible)
      if (isActive && belongsToVisible) {
        const label = `(${formatLabel(pt.x)}, ${formatLabel(pt.y)})`
        ctx.font = '12px system-ui, sans-serif'
        const tw = ctx.measureText(label).width
        const lx = px + 12 + tw + 10 > w ? px - tw - 16 : px + 12
        const ly = py - 24 < 0 ? py + 10 : py - 28

        // White pill with shadow
        ctx.shadowColor = 'rgba(0,0,0,0.15)'
        ctx.shadowBlur = 6
        ctx.fillStyle = '#fff'
        ctx.beginPath()
        ctx.roundRect(lx - 6, ly - 4, tw + 12, 22, 4)
        ctx.fill()
        ctx.shadowBlur = 0

        ctx.strokeStyle = '#ddd'
        ctx.lineWidth = 1
        ctx.beginPath()
        ctx.roundRect(lx - 6, ly - 4, tw + 12, 22, 4)
        ctx.stroke()

        ctx.fillStyle = '#111'
        ctx.textAlign = 'left'
        ctx.textBaseline = 'top'
        ctx.fillText(label, lx, ly)
      }
    })

    // Crosshair + coordinate label
    if (mouse.current) {
      const { px, py } = mouse.current
      const wx = cx + (px - w / 2) / scale

      // Try to snap to nearest curve within 20px
      const SNAP_PX = 20
      let snapY: number | null = null
      let snapPy = py
      let bestDist = SNAP_PX

      expressions.forEach((expr) => {
        const fn = buildPlotFn(expr, scope)
        if (!fn) return
        const fy = fn(wx)
        if (!isFinite(fy)) return
        const candidatePy = toY(fy)
        const dist = Math.abs(candidatePy - py)
        if (dist < bestDist) { bestDist = dist; snapY = fy; snapPy = candidatePy }
      })

      const displayY = snapY !== null ? snapY : cy - (py - h / 2) / scale
      const displayPy = snapPy
      const label = `(${formatLabel(wx)}, ${formatLabel(displayY)})`

      ctx.strokeStyle = 'rgba(0,0,0,0.2)'
      ctx.lineWidth = 1
      ctx.setLineDash([4, 4])
      ctx.beginPath(); ctx.moveTo(px, 0); ctx.lineTo(px, h); ctx.stroke()
      ctx.beginPath(); ctx.moveTo(0, displayPy); ctx.lineTo(w, displayPy); ctx.stroke()
      ctx.setLineDash([])

      if (snapY !== null) {
        ctx.fillStyle = '#111'
        ctx.beginPath()
        ctx.arc(px, displayPy, 3.5, 0, Math.PI * 2)
        ctx.fill()
      }

      ctx.font = '11px system-ui, sans-serif'
      const tw = ctx.measureText(label).width
      const lx = px + 10 + tw + 6 > w ? px - tw - 14 : px + 10
      const ly = displayPy - 20 < 0 ? displayPy + 8 : displayPy - 20

      ctx.fillStyle = snapY !== null ? 'rgba(0,0,0,0.75)' : 'rgba(0,0,0,0.65)'
      ctx.beginPath()
      ctx.roundRect(lx - 4, ly - 2, tw + 8, 18, 3)
      ctx.fill()
      ctx.fillStyle = '#fff'
      ctx.textAlign = 'left'
      ctx.textBaseline = 'top'
      ctx.fillText(label, lx, ly)
    }
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

  // Reset node state only when the set of expressions actually changes
  useEffect(() => {
    visibleCurves.current = new Set()
    activeNode.current = null
  }, [expressions])

  // Redraw whenever the draw function updates (expressions, scope, or view changes)
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
      const newScale = scale * factor
      const mouseX = cx + (e.offsetX - w / 2) / scale
      const mouseY = cy - (e.offsetY - h / 2) / scale
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
    const canvas = canvasRef.current
    if (!canvas) return
    const rect = canvas.getBoundingClientRect()
    mouse.current = { px: e.clientX - rect.left, py: e.clientY - rect.top }
    if (drag.current) {
      view.current.cx = drag.current.cx - (e.clientX - drag.current.x) / view.current.scale
      view.current.cy = drag.current.cy + (e.clientY - drag.current.y) / view.current.scale
    }
    draw()
  }

  function handleMouseUp(e: React.MouseEvent) {
    if (drag.current) {
      const moved = Math.abs(e.clientX - drag.current.x) + Math.abs(e.clientY - drag.current.y)
      if (moved < 4) {
        const canvas = canvasRef.current
        if (canvas) {
          const rect = canvas.getBoundingClientRect()
          const px = e.clientX - rect.left
          const py = e.clientY - rect.top
          const { cx, cy, scale } = view.current
          const toX = (x: number) => (x - cx) * scale + rect.width / 2
          const toY = (y: number) => -(y - cy) * scale + rect.height / 2

          // 1. Check if clicking a visible node
          const NODE_HIT = 10
          const nodeHit = intersectionsRef.current.findIndex((pt, idx) => {
            const belongsToVisible = [...pt.curves].some(c => visibleCurves.current.has(c))
            return belongsToVisible && Math.hypot(toX(pt.x) - px, toY(pt.y) - py) < NODE_HIT
          })
          if (nodeHit >= 0) {
            activeNode.current = nodeHit === activeNode.current ? null : nodeHit
            draw()
            drag.current = null
            return
          }

          // 2. Check if clicking a curve — toggle its nodes
          const CURVE_HIT = 6
          const wx = cx + (px - rect.width / 2) / scale
          const curveHit = plotFnsRef.current.findIndex(fn => {
            if (!fn) return false
            const fy = fn(wx)
            if (!isFinite(fy)) return false
            return Math.abs(toY(fy) - py) < CURVE_HIT
          })
          if (curveHit >= 0) {
            if (visibleCurves.current.has(curveHit)) visibleCurves.current.delete(curveHit)
            else visibleCurves.current.add(curveHit)
            // Clear active node if it no longer belongs to a visible curve
            if (activeNode.current !== null) {
              const pt = intersectionsRef.current[activeNode.current]
              if (pt && ![...pt.curves].some(c => visibleCurves.current.has(c)))
                activeNode.current = null
            }
            draw()
          }
        }
      }
    }
    drag.current = null
  }

  function handleResetView() {
    view.current = { cx: 0, cy: 0, scale: 50 }
    draw()
  }

  function handleMouseLeave() {
    drag.current = null
    mouse.current = null
    draw()
  }

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%' }}>
      <canvas
        ref={canvasRef}
        style={{ width: '100%', height: '100%', display: 'block', cursor: 'default' }}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseLeave}
      />
      {/* Top-right controls */}
      <div style={{ position: 'absolute', top: '12px', right: '14px', display: 'flex', flexDirection: 'column', gap: '6px' }}>
        <button onClick={() => {}} style={ICON_BTN_STYLE} title="Settings">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="3"/>
            <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>
          </svg>
        </button>
        <button onClick={handleResetView} style={ICON_BTN_STYLE} title="Reset view">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>
            <polyline points="9 22 9 12 15 12 15 22"/>
          </svg>
        </button>
      </div>
    </div>
  )
}
