import { useEffect, useRef, useCallback, useState } from 'react'
import { math, findHoles, isGraphablePolar, isXofY, get3DForm } from '../lib/mathScope'
import GraphSettings from './GraphSettings'
import type { GraphMode } from '../types'

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
  colors: string[]
  scope: Record<string, unknown>
  onCurveClick: (index: number) => void
  graphMode: GraphMode
  onGraphModeChange: (mode: GraphMode) => void
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
    // z = anything is 3D only — never plot as a 2D curve
    if (node.type === 'AssignmentNode' && (node as any).name === 'z') return null
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

// Returns (a, b) => [x, y, z] world coordinates for 3D surface/ribbon rendering.
// a and b are the two grid sweep axes; the third is computed by evaluating the expression.
type SurfaceForm = 'yxz' | 'zxy' | 'xyz' | 'zx' | 'yx' | 'zy' | 'xy' | 'xz' | 'yz'
function build3DFn(expr: string, scope: Record<string, unknown>, form: SurfaceForm): ((a: number, b: number) => [number, number, number]) | null {
  try {
    const node = math.parse(expr)
    const plotNode = node.type === 'AssignmentNode' ? (node as any).value : node
    return (a: number, b: number) => {
      try {
        let vars: Record<string, number>
        let x: number, y: number, z: number
        switch (form) {
          case 'zxy': vars = { x: a, y: b }; z = plotNode.evaluate({ ...scope, ...vars }); return [a, b, typeof z === 'number' ? z : NaN]
          case 'yxz': vars = { x: a, z: b }; y = plotNode.evaluate({ ...scope, ...vars }); return [a, typeof y === 'number' ? y : NaN, b]
          case 'xyz': vars = { y: a, z: b }; x = plotNode.evaluate({ ...scope, ...vars }); return [typeof x === 'number' ? x : NaN, a, b]
          case 'zx':  vars = { x: a };        z = plotNode.evaluate({ ...scope, ...vars }); return [a, b, typeof z === 'number' ? z : NaN]
          case 'yx':  vars = { x: a };        y = plotNode.evaluate({ ...scope, ...vars }); return [a, typeof y === 'number' ? y : NaN, b]
          case 'zy':  vars = { y: a };        z = plotNode.evaluate({ ...scope, ...vars }); return [b, a, typeof z === 'number' ? z : NaN]
          case 'xy':  vars = { y: a };        x = plotNode.evaluate({ ...scope, ...vars }); return [typeof x === 'number' ? x : NaN, a, b]
          case 'xz':  vars = { z: a };        x = plotNode.evaluate({ ...scope, ...vars }); return [typeof x === 'number' ? x : NaN, b, a]
          case 'yz':  vars = { z: a };        y = plotNode.evaluate({ ...scope, ...vars }); return [b, typeof y === 'number' ? y : NaN, a]
        }
      } catch {
        return [NaN, NaN, NaN]
      }
    }
  } catch {
    return null
  }
}

// Returns (theta) => r for polar curve rendering.
function buildPolarFn(expr: string, scope: Record<string, unknown>): ((theta: number) => number) | null {
  try {
    const node = math.parse(expr)
    const plotNode = node.type === 'AssignmentNode' ? (node as any).value : node
    return (theta: number) => {
      try {
        const r = plotNode.evaluate({ ...scope, θ: theta })
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

// Parse a hex color string like '#1a73e8' into [r, g, b]
function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '')
  const n = parseInt(h.length === 3 ? h.split('').map(c => c+c).join('') : h, 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

// Compute lighting for a triangle face given its 3D world vertices and the view-space normal.
// Returns [r, g, b] with lighting applied.
// Front face (toward viewer): ambient + diffuse + subtle specular highlight → brighter, slightly washed
// Back face (away from viewer): ambient only → darker, matte
function litColor(
  rgb: [number, number, number],
  // view-space normal direction: positive nz = facing viewer
  nz: number
): [number, number, number] {
  const facing = nz > 0  // true = front face (toward camera)
  const ndot = Math.abs(nz)  // 0..1

  if (facing) {
    // Front: diffuse term lifts toward white, small specular pop at high angles
    const diffuse = 0.55 + 0.30 * ndot
    const specular = 0.18 * Math.pow(ndot, 6)
    return [
      Math.min(255, rgb[0] * diffuse + 255 * specular),
      Math.min(255, rgb[1] * diffuse + 255 * specular),
      Math.min(255, rgb[2] * diffuse + 255 * specular),
    ]
  } else {
    // Back: flat dark shading, no specular
    const diffuse = 0.30 + 0.20 * ndot
    return [rgb[0] * diffuse, rgb[1] * diffuse, rgb[2] * diffuse]
  }
}

// Software rasterize a triangle into a shared depth+color buffer.
// v0/v1/v2 have screen pixel coords (px, py), depth (d), and view-space nz for lighting.
// Only writes a pixel if its interpolated depth is less than what's stored (closer = smaller d).
function rasterizeTriangle(
  depthBuf: Float32Array,
  colorBuf: Uint8ClampedArray,
  iw: number, ih: number,
  v0: { px: number; py: number; d: number },
  v1: { px: number; py: number; d: number },
  v2: { px: number; py: number; d: number },
  rgb: [number, number, number],
  nz: number
) {
  const [lr, lg, lb] = litColor(rgb, nz)

  // Bounding box clipped to image bounds
  const minX = Math.max(0, Math.floor(Math.min(v0.px, v1.px, v2.px)))
  const maxX = Math.min(iw - 1, Math.ceil(Math.max(v0.px, v1.px, v2.px)))
  const minY = Math.max(0, Math.floor(Math.min(v0.py, v1.py, v2.py)))
  const maxY = Math.min(ih - 1, Math.ceil(Math.max(v0.py, v1.py, v2.py)))
  if (minX > maxX || minY > maxY) return

  // Edge function: positive when p is on the left side of edge a→b
  const edge = (ax: number, ay: number, bx: number, by: number, px: number, py: number) =>
    (bx - ax) * (py - ay) - (by - ay) * (px - ax)

  const area = edge(v0.px, v0.py, v1.px, v1.py, v2.px, v2.py)
  if (Math.abs(area) < 0.5) return  // degenerate

  for (let py = minY; py <= maxY; py++) {
    for (let px = minX; px <= maxX; px++) {
      const w0 = edge(v1.px, v1.py, v2.px, v2.py, px, py)
      const w1 = edge(v2.px, v2.py, v0.px, v0.py, px, py)
      const w2 = edge(v0.px, v0.py, v1.px, v1.py, px, py)
      // Check same sign as area (inside triangle)
      if (area > 0 ? (w0 < 0 || w1 < 0 || w2 < 0) : (w0 > 0 || w1 > 0 || w2 > 0)) continue

      const b0 = w0 / area, b1 = w1 / area, b2 = w2 / area
      const depth = b0 * v0.d + b1 * v1.d + b2 * v2.d

      const i = py * iw + px
      if (depth >= depthBuf[i]) continue
      depthBuf[i] = depth

      const ci = i * 4
      colorBuf[ci]     = lr
      colorBuf[ci + 1] = lg
      colorBuf[ci + 2] = lb
      colorBuf[ci + 3] = 220
    }
  }
}

interface Intersection { x: number; y: number }
interface TaggedIntersection extends Intersection { curves: Set<number>; axisNode: boolean }

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

    if (curr === 0) {
      if (!results.some(r => Math.abs(r.x - x) < dx * 2)) {
        results.push({ x, y: f(x) })
      }
    } else if (prev * curr < 0) {
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
      if (!results.some(r => Math.abs(r.x - ix) < dx * 2)) {
        results.push({ x: ix, y: iy })
      }
    }
    prev = curr
  }
  return results
}

const SNAP_PX = 15

const ICON_BTN_STYLE: React.CSSProperties = {
  width: '30px', height: '30px', borderRadius: '6px',
  border: '1px solid #ddd', background: 'rgba(255,255,255,0.9)',
  display: 'flex', alignItems: 'center', justifyContent: 'center',
  cursor: 'pointer', color: '#555', padding: 0,
  boxShadow: '0 1px 3px rgba(0,0,0,0.08)',
}

// Convex hull (gift wrapping) of 2D points, returns CCW ordered hull.
function convexHull(pts: { x: number; y: number }[]): { x: number; y: number }[] {
  if (pts.length < 3) return pts
  // Start from bottom-most (highest y on screen), then leftmost
  let start = pts[0]
  for (const p of pts) {
    if (p.y > start.y || (p.y === start.y && p.x < start.x)) start = p
  }
  const hull: typeof pts = []
  let cur = start
  do {
    hull.push(cur)
    let next = pts.find(p => p !== cur) ?? pts[0]
    for (const p of pts) {
      if (p === cur) continue
      const cross = (next.x - cur.x) * (p.y - cur.y) - (next.y - cur.y) * (p.x - cur.x)
      const distNext = Math.hypot(next.x - cur.x, next.y - cur.y)
      const distP = Math.hypot(p.x - cur.x, p.y - cur.y)
      if (cross < 0 || (cross === 0 && distP > distNext)) next = p
    }
    cur = next
  } while (cur !== start && hull.length <= pts.length + 1)
  return hull
}

// Project a 3D point to 2D canvas given rotation angles and scale.
// Origin always maps to canvas center.
// perspective=true applies a mild perspective divide; false = pure orthographic.
function project3D(
  x: number, y: number, z: number,
  rotX: number, rotY: number,
  scale: number,
  w: number, h: number,
  perspective = true
): { px: number; py: number; depth: number } {
  const cosY = Math.cos(rotY), sinY = Math.sin(rotY)
  const x1 = x * cosY + z * sinY
  const z1 = -x * sinY + z * cosY

  const cosX = Math.cos(rotX), sinX = Math.sin(rotX)
  const y2 = y * cosX - z1 * sinX
  const z2 = y * sinX + z1 * cosX

  let px: number, py: number
  if (perspective) {
    const fov = 6
    const dz = fov + z2 * 0.3
    const p = fov / Math.max(dz, 0.1)
    px = w / 2 + x1 * scale * p
    py = h / 2 - y2 * scale * p
  } else {
    px = w / 2 + x1 * scale
    py = h / 2 - y2 * scale
  }

  return { px, py, depth: z2 }
}

export default function Graph({ expressions, colors, scope, onCurveClick, graphMode, onGraphModeChange }: GraphProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const view = useRef({ cx: 0, cy: 0, scale: 50 })
  const view3D = useRef({ rotX: 0.4, rotY: -0.6, unitsPerHalf: 0 })
  const drag = useRef<{ x: number; y: number; cx: number; cy: number } | null>(null)
  const drag3D = useRef<{ x: number; y: number; rotX: number; rotY: number } | null>(null)
  const size = useRef({ w: 0, h: 0 })
  const mouse = useRef<{ px: number; py: number } | null>(null)
  const [mouseCoords, setMouseCoords] = useState<{ x: number; y: number } | null>(null)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const settingsAnchorRef = useRef<HTMLDivElement>(null)
  const [showXAxis, setShowXAxis] = useState(true)
  const [showYAxis, setShowYAxis] = useState(true)
  const [xLabel, setXLabel] = useState('')
  const [yLabel, setYLabel] = useState('')
  const [lockViewport, setLockViewport] = useState(false)
  const [modeMenuOpen, setModeMenuOpen] = useState(false)
  const [fit3D, setFit3D] = useState(true)
  const is3D = graphMode === '3d'
  const isPolar = graphMode === 'polar'

  const [xMinStr, setXMinStr] = useState('')
  const [xMaxStr, setXMaxStr] = useState('')
  const [yMinStr, setYMinStr] = useState('')
  const [yMaxStr, setYMaxStr] = useState('')
  const activeNode = useRef<Set<number>>(new Set())
  const visibleCurves = useRef<Set<number>>(new Set())
  const intersectionsRef = useRef<TaggedIntersection[]>([])
  const plotFnsRef = useRef<(((x: number) => number) | null)[]>([])
  // For x=f(y) curves: array of {x,y} sample points used for hover/intersections
  const xofYSamplesRef = useRef<({ x: number; y: number }[] | null)[]>([])
  const polarFnsRef = useRef<(((theta: number) => number) | null)[]>([])

  const draw3D = useCallback(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const { w, h } = size.current
    if (w === 0 || h === 0) return
    if (view3D.current.unitsPerHalf === 0) view3D.current.unitsPerHalf = 6
    const { rotX, rotY, unitsPerHalf } = view3D.current

    const RANGE = unitsPerHalf * 1.5
    const interval = niceInterval(unitsPerHalf / 4)

    // In box mode, render into a virtual viewport (60% of shorter dim) centered on canvas.
    // Scale is fixed so RANGE always fills the virtual viewport — zoom only changes labels/intervals.
    const vw = fit3D ? w : Math.min(w, h) * 0.6
    const vh = fit3D ? h : Math.min(w, h) * 0.6
    const scale = fit3D
      ? Math.min(vw, vh) / 2 / unitsPerHalf
      : Math.min(vw, vh) / 2 / RANGE

    const dpr = window.devicePixelRatio
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)

    ctx.fillStyle = '#fff'
    ctx.fillRect(0, 0, w, h)

    const GRID = 100

    // Semantic axis convention: x=out-of-page, y=right, z=up
    // Map to project3D which treats its second arg as up:
    // sem(x, y, z) → proj(y_sem, z_sem, x_sem)
    // project3D centers on vw/2, vh/2 — then we offset to canvas center
    const offX = (w - vw) / 2
    const offY = (h - vh) / 2
    const sem = (x: number, y: number, z: number) => {
      const p = project3D(y, z, x, rotX, rotY, scale, vw, vh, false)
      return { px: p.px + offX, py: p.py + offY, d: p.depth }
    }

    const origin = sem(0, 0, 0)
    const axisEnd = RANGE

    // Compute cube corners (used for both clip hull and wireframe)
    const cubeR = RANGE
    const cubeCorners = [
      sem(-cubeR,-cubeR,-cubeR), sem( cubeR,-cubeR,-cubeR), sem( cubeR, cubeR,-cubeR), sem(-cubeR, cubeR,-cubeR),
      sem(-cubeR,-cubeR, cubeR), sem( cubeR,-cubeR, cubeR), sem( cubeR, cubeR, cubeR), sem(-cubeR, cubeR, cubeR),
    ]

    // Box mode: draw back wireframe edges first (behind content)
    if (!fit3D) {
      const allEdges = [
        [0,1],[1,2],[2,3],[3,0],
        [4,5],[5,6],[6,7],[7,4],
        [0,4],[1,5],[2,6],[3,7],
      ]
      ctx.strokeStyle = 'rgba(180,185,200,0.55)'
      ctx.lineWidth = 0.8
      allEdges.forEach(([a, b]) => {
        ctx.beginPath()
        ctx.moveTo(cubeCorners[a].px, cubeCorners[a].py)
        ctx.lineTo(cubeCorners[b].px, cubeCorners[b].py)
        ctx.stroke()
      })

      // Clip all subsequent drawing to the convex hull of the cube projection
      const pts2d = cubeCorners.map(p => ({ x: p.px, y: p.py }))
      const hull = convexHull(pts2d)
      ctx.save()
      ctx.beginPath()
      ctx.moveTo(hull[0].x, hull[0].y)
      hull.slice(1).forEach(p => ctx.lineTo(p.x, p.y))
      ctx.closePath()
      ctx.clip()
    }

    const drawPlane = (
      corners: ReturnType<typeof sem>[],
      fill: string,
      stroke: string,
      gridFn: (t: number) => [ReturnType<typeof sem>, ReturnType<typeof sem>, ReturnType<typeof sem>, ReturnType<typeof sem>]
    ) => {
      ctx.beginPath()
      ctx.moveTo(corners[0].px, corners[0].py)
      corners.slice(1).forEach(p => ctx.lineTo(p.px, p.py))
      ctx.closePath()
      ctx.fillStyle = fill; ctx.fill()
      ctx.strokeStyle = stroke; ctx.lineWidth = 0.5
      const i0 = Math.ceil(-RANGE / interval) * interval
      for (let t = i0; t <= RANGE + interval * 0.01; t += interval) {
        const [a, b, c, d] = gridFn(t)
        ctx.beginPath(); ctx.moveTo(a.px, a.py); ctx.lineTo(b.px, b.py); ctx.stroke()
        ctx.beginPath(); ctx.moveTo(c.px, c.py); ctx.lineTo(d.px, d.py); ctx.stroke()
      }
    }

    // XY plane (z=0, floor)
    drawPlane(
      [sem(-RANGE, -RANGE, 0), sem(RANGE, -RANGE, 0), sem(RANGE, RANGE, 0), sem(-RANGE, RANGE, 0)],
      'rgba(200,220,255,0.13)', '#dde4f0',
      t => [sem(t, -RANGE, 0), sem(t, RANGE, 0), sem(-RANGE, t, 0), sem(RANGE, t, 0)]
    )

    // XZ plane (y=0)
    drawPlane(
      [sem(-RANGE, 0, -RANGE), sem(RANGE, 0, -RANGE), sem(RANGE, 0, RANGE), sem(-RANGE, 0, RANGE)],
      'rgba(200,255,210,0.10)', 'rgba(100,200,120,0.25)',
      t => [sem(t, 0, -RANGE), sem(t, 0, RANGE), sem(-RANGE, 0, t), sem(RANGE, 0, t)]
    )

    // YZ plane (x=0)
    drawPlane(
      [sem(0, -RANGE, -RANGE), sem(0, RANGE, -RANGE), sem(0, RANGE, RANGE), sem(0, -RANGE, RANGE)],
      'rgba(255,210,200,0.10)', 'rgba(220,120,100,0.25)',
      t => [sem(0, t, -RANGE), sem(0, t, RANGE), sem(0, -RANGE, t), sem(0, RANGE, t)]
    )

    // drawAxesAndLabels is defined after the depth buffer so it can sample it
    // Depth buffer rasterizer — one depth+color buffer shared across all surfaces
    const iw = Math.ceil(w * dpr), ih = Math.ceil(h * dpr)
    const depthBuf = new Float32Array(iw * ih).fill(Infinity)
    const colorBuf = new Uint8ClampedArray(iw * ih * 4)

    expressions.forEach((expr, ei) => {
      const form3D = get3DForm(expr, scope)
      const fn3D = form3D ? build3DFn(expr, scope, form3D) : null
      if (!fn3D) return

      // Sample grid: a and b sweep over [-RANGE, RANGE]
      // fn3D(a, b) returns [x, y, z] world coordinates
      type V3 = [number, number, number]
      const pts: V3[][] = []
      for (let ia = 0; ia <= GRID; ia++) {
        pts[ia] = []
        for (let ib = 0; ib <= GRID; ib++) {
          const av = -RANGE + (2 * RANGE * ia) / GRID
          const bv = -RANGE + (2 * RANGE * ib) / GRID
          pts[ia][ib] = fn3D(av, bv)
        }
      }

      const clipPlanes: [number, number][] = fit3D
        ? [[2, 1], [2, -1]]
        : [[0, 1], [0, -1], [1, 1], [1, -1], [2, 1], [2, -1]]

      const clipPoly = (poly: V3[]): V3[] => {
        for (const [axis, sign] of clipPlanes) {
          if (poly.length === 0) return poly
          const clipped: V3[] = []
          for (let i = 0; i < poly.length; i++) {
            const a = poly[i], b = poly[(i + 1) % poly.length]
            const da = sign * a[axis] - RANGE
            const db = sign * b[axis] - RANGE
            if (da <= 0) clipped.push(a)
            if ((da < 0 && db > 0) || (da > 0 && db < 0)) {
              const t = da / (da - db)
              clipped.push([a[0] + t*(b[0]-a[0]), a[1] + t*(b[1]-a[1]), a[2] + t*(b[2]-a[2])])
            }
          }
          poly = clipped
        }
        return poly
      }

      for (let ia = 0; ia < GRID; ia++) {
        for (let ib = 0; ib < GRID; ib++) {
          const p00 = pts[ia][ib], p10 = pts[ia+1][ib]
          const p01 = pts[ia][ib+1], p11 = pts[ia+1][ib+1]
          if (!p00.every(isFinite) || !p10.every(isFinite) || !p01.every(isFinite) || !p11.every(isFinite)) continue

          const poly = clipPoly([p00, p10, p11, p01])
          if (poly.length < 3) continue

          // Compute face normal in world space from unclipped quad corners
          // e1 = p10-p00, e2 = p01-p00, N = e1 × e2
          const e1x = p10[0]-p00[0], e1y = p10[1]-p00[1], e1z = p10[2]-p00[2]
          const e2x = p01[0]-p00[0], e2y = p01[1]-p00[1], e2z = p01[2]-p00[2]
          const nx = e1y*e2z - e1z*e2y
          const ny = e1z*e2x - e1x*e2z
          const nz_world = e1x*e2y - e1y*e2x
          // Transform normal to view space using the same rotY then rotX as project3D
          // project3D receives (worldY, worldZ, worldX) as (x,y,z) — apply same transform
          const cosY = Math.cos(rotY), sinY = Math.sin(rotY)
          const cosX = Math.cos(rotX), sinX = Math.sin(rotX)
          // Remap world normal (nx,ny,nz_world) to project3D input space (py=ny, pz=nz, px=nx)
          const px_ = ny, py_ = nz_world, pz_ = nx
          const z1n = -px_*sinY + pz_*cosY
          const nViewZ = py_*sinX + z1n*cosX  // z2 component = view-space depth = nz toward camera
          const nLen = Math.sqrt(nx*nx + ny*ny + nz_world*nz_world) || 1
          const nz = nViewZ / nLen  // normalized: positive = facing camera

          // Project to physical pixels (depth buffer is in physical pixels)
          const proj = poly.map(([x, y, z]) => { const s = sem(x, y, z); return { px: s.px * dpr, py: s.py * dpr, d: s.d } })

          // Triangulate fan from vertex 0 and rasterize each triangle into depth buffer
          const faceRgb = hexToRgb(colors[ei])
          for (let t = 1; t < proj.length - 1; t++) {
            const v0 = proj[0], v1 = proj[t], v2 = proj[t + 1]
            rasterizeTriangle(depthBuf, colorBuf, iw, ih, v0, v1, v2, faceRgb, nz)
          }
        }
      }
    })

    // Sample the depth buffer at a projected point to check if it's occluded by a surface.
    // Returns true if a surface is closer (in front) at that pixel.
    const isOccluded = (p: { px: number; py: number; d: number }) => {
      const ix = Math.round(p.px * dpr), iy = Math.round(p.py * dpr)
      if (ix < 0 || ix >= iw || iy < 0 || iy >= ih) return false
      return depthBuf[iy * iw + ix] < p.d
    }

    const drawAxesAndLabels = () => {
      const AXIS_SEGMENTS = 40
      const ARROW = 7  // arrowhead size in CSS px
      const PAD = 14   // label padding from canvas edge in CSS px

      const drawArrow = (tip: { px: number; py: number }, from: { px: number; py: number }, color: string) => {
        const dx = tip.px - from.px, dy = tip.py - from.py
        const len = Math.sqrt(dx*dx + dy*dy) || 1
        const ux = dx/len, uy = dy/len  // unit vector toward tip
        const px = -uy, py = ux         // perpendicular
        ctx.fillStyle = color
        ctx.beginPath()
        ctx.moveTo(tip.px, tip.py)
        ctx.lineTo(tip.px - ux*ARROW + px*ARROW*0.35, tip.py - uy*ARROW + py*ARROW*0.35)
        ctx.lineTo(tip.px - ux*ARROW - px*ARROW*0.35, tip.py - uy*ARROW - py*ARROW*0.35)
        ctx.closePath()
        ctx.fill()
      }

      const drawAxis = (sx: number, sy: number, sz: number, color: string, fadeColor: string, label: string) => {
        const posEnd = sem(sx * axisEnd, sy * axisEnd, sz * axisEnd)
        const negEnd = sem(-sx * RANGE, -sy * RANGE, -sz * RANGE)

        // Negative half — always faded
        ctx.strokeStyle = fadeColor
        ctx.lineWidth = 1.5
        ctx.beginPath()
        ctx.moveTo(origin.px, origin.py)
        ctx.lineTo(negEnd.px, negEnd.py)
        ctx.stroke()

        // Positive half — draw segment by segment, each faded if occluded at that point
        let prevPt = origin
        let tipColor = color
        for (let s = 1; s <= AXIS_SEGMENTS; s++) {
          const t = s / AXIS_SEGMENTS
          const wpt = sem(sx * axisEnd * t, sy * axisEnd * t, sz * axisEnd * t)
          const behind = isOccluded(wpt)
          const segColor = behind ? fadeColor : color
          if (s === AXIS_SEGMENTS) tipColor = segColor
          ctx.strokeStyle = segColor
          ctx.lineWidth = 1.5
          ctx.beginPath()
          ctx.moveTo(prevPt.px, prevPt.py)
          ctx.lineTo(wpt.px, wpt.py)
          ctx.stroke()
          prevPt = wpt
        }

        // Arrowhead at tip
        const nearTip = sem(sx * axisEnd * 0.97, sy * axisEnd * 0.97, sz * axisEnd * 0.97)
        drawArrow(posEnd, nearTip, tipColor)

        // Label — offset beyond tip, clamped to canvas bounds
        const rawLx = posEnd.px + (posEnd.px - origin.px) * 0.18
        const rawLy = posEnd.py + (posEnd.py - origin.py) * 0.18
        const lx = Math.max(PAD, Math.min(w - PAD, rawLx))
        const ly = Math.max(PAD, Math.min(h - PAD, rawLy))

        const labelBehind = isOccluded(posEnd)
        ctx.fillStyle = labelBehind ? fadeColor : color
        ctx.font = 'bold 12px system-ui, sans-serif'
        ctx.textAlign = 'center'
        ctx.textBaseline = 'middle'
        ctx.fillText(label, lx, ly)
      }

      drawAxis(1, 0, 0, '#e53', 'rgba(238,85,51,0.25)', 'x')
      drawAxis(0, 1, 0, '#3a3', 'rgba(51,170,51,0.25)', 'y')
      drawAxis(0, 0, 1, '#36e', 'rgba(51,102,238,0.25)', 'z')

      ctx.font = '10px system-ui, sans-serif'
      ctx.fillStyle = '#999'
      let tickCount = 0
      for (let v = interval; v <= RANGE + interval * 0.01; v += interval) {
        tickCount++
        if (tickCount % 2 !== 0) continue
        const lbl = formatLabel(v)
        const xp = sem(v, 0, 0)
        ctx.textAlign = 'center'; ctx.textBaseline = 'top'
        ctx.fillText(lbl, xp.px, xp.py + 3)
        const yp = sem(0, v, 0)
        ctx.textAlign = 'left'; ctx.textBaseline = 'middle'
        ctx.fillText(lbl, yp.px + 4, yp.py)
        const zp = sem(0, 0, v)
        ctx.textAlign = 'right'; ctx.textBaseline = 'middle'
        ctx.fillText(lbl, zp.px - 4, zp.py)
      }
    }

    // Composite depth-tested surfaces onto canvas via offscreen ImageData
    // putImageData always uses physical pixels and ignores canvas transform
    const imgData = new ImageData(colorBuf, iw, ih)
    const offscreen = document.createElement('canvas')
    offscreen.width = iw; offscreen.height = ih
    offscreen.getContext('2d')!.putImageData(imgData, 0, 0)
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.drawImage(offscreen, 0, 0)
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)

    drawAxesAndLabels()

    // Box mode: restore clip and draw front edges on top of content
    if (!fit3D) {
      ctx.restore()
      const frontEdges = [[4,5],[5,6],[6,7],[7,4],[2,6],[3,7],[1,2],[2,3]]
      ctx.strokeStyle = 'rgba(160,165,185,0.8)'
      ctx.lineWidth = 0.8
      frontEdges.forEach(([a, b]) => {
        ctx.beginPath()
        ctx.moveTo(cubeCorners[a].px, cubeCorners[a].py)
        ctx.lineTo(cubeCorners[b].px, cubeCorners[b].py)
        ctx.stroke()
      })
    }

    ctx.font = LABEL_FONT
    ctx.textAlign = 'left'
    ctx.textBaseline = 'top'
    ctx.fillStyle = '#aaa'
    ctx.fillText('Drag to rotate · Scroll to zoom', 8, 8)

  }, [expressions, colors, scope, fit3D])

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

    ctx.fillStyle = '#fff'
    ctx.fillRect(0, 0, w, h)

    const interval = niceInterval(80 / scale)
    const minorInterval = interval / 5

    ctx.font = LABEL_FONT

    ctx.lineWidth = 0.3
    ctx.strokeStyle = '#f0f0f0'
    const mx0 = Math.ceil(xMin / minorInterval) * minorInterval
    for (let x = mx0; x <= xMax + minorInterval * 0.01; x += minorInterval) {
      if (Math.abs(x % interval) < minorInterval * 0.01) continue
      const px = toX(x)
      ctx.beginPath(); ctx.moveTo(px, 0); ctx.lineTo(px, h); ctx.stroke()
    }

    const yMin = cy - h / 2 / scale
    const yMax = cy + h / 2 / scale
    const my0 = Math.ceil(yMin / minorInterval) * minorInterval
    for (let y = my0; y <= yMax + minorInterval * 0.01; y += minorInterval) {
      if (Math.abs(y % interval) < minorInterval * 0.01) continue
      const py = toY(y)
      ctx.beginPath(); ctx.moveTo(0, py); ctx.lineTo(w, py); ctx.stroke()
    }

    ctx.lineWidth = 0.8

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

    ctx.strokeStyle = AXIS_COLOR
    ctx.lineWidth = 0.8
    const axisX = toX(0)
    const axisY = toY(0)
    ctx.beginPath(); ctx.moveTo(axisX, 0); ctx.lineTo(axisX, h); ctx.stroke()
    ctx.beginPath(); ctx.moveTo(0, axisY); ctx.lineTo(w, axisY); ctx.stroke()

    const plotFns = expressions.map(expr => isXofY(expr, scope) ? null : buildPlotFn(expr, scope))
    plotFnsRef.current = plotFns
    xofYSamplesRef.current = expressions.map(() => null)

    expressions.forEach((expr, i) => {
      ctx.strokeStyle = colors[i]
      ctx.lineWidth = 2
      ctx.lineJoin = 'round'
      ctx.lineCap = 'round'

      const vx = getVerticalX(expr, scope)
      if (vx !== null) {
        const px = toX(vx)
        ctx.beginPath(); ctx.moveTo(px, 0); ctx.lineTo(px, h); ctx.stroke()
        return
      }

      // x = f(y): sweep y, plot (f(y), y)
      if (isXofY(expr, scope)) {
        const node = math.parse(expr)
        const plotNode = node.type === 'AssignmentNode' ? (node as any).value : node
        const plotSteps = Math.ceil(h * 2)
        const dy = (yMax - yMin) / plotSteps
        const samples: { x: number; y: number }[] = []
        ctx.beginPath()
        let penDown = false
        for (let s = 0; s <= plotSteps; s++) {
          const y = yMin + s * dy
          let x: number
          try { x = plotNode.evaluate({ ...scope, y }); if (typeof x !== 'number') x = NaN } catch { x = NaN }
          if (!isFinite(x)) { penDown = false; continue }
          samples.push({ x, y })
          const px = toX(x), py = toY(y)
          if (!penDown) { ctx.moveTo(px, py); penDown = true }
          else ctx.lineTo(px, py)
        }
        xofYSamplesRef.current[i] = samples
        ctx.stroke()
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

    // Draw holes — always visible, colored outline + white fill
    expressions.forEach((expr, i) => {
      const holes = findHoles(expr, scope, xMin, xMax)
      holes.forEach(({ x, y }) => {
        const px = toX(x), py = toY(y)
        ctx.beginPath()
        ctx.arc(px, py, 3.5, 0, Math.PI * 2)
        ctx.fillStyle = '#fff'
        ctx.fill()
        ctx.strokeStyle = colors[i]
        ctx.lineWidth = 2
        ctx.stroke()
      })
    })

    const steps = Math.ceil(w * 2)
    const zero = () => 0

    const allIntersections: TaggedIntersection[] = []
    const tol = (xMax - xMin) / steps * 2

    const addPt = (pt: Intersection, curveIdx: number, axisNode: boolean) => {
      const existing = allIntersections.find(r => Math.abs(r.x - pt.x) < tol && Math.abs(r.y - pt.y) < tol)
      if (existing) { existing.curves.add(curveIdx) }
      else allIntersections.push({ ...pt, curves: new Set([curveIdx]), axisNode })
    }

    plotFns.forEach((fn, i) => {
      if (!fn) return
      findIntersections(fn, zero, xMin, xMax, steps).forEach(pt => addPt({ x: pt.x, y: 0 }, i, true))
      if (xMin <= 0 && xMax >= 0) {
        const y0val = fn(0)
        if (isFinite(y0val)) addPt({ x: 0, y: y0val }, i, true)
      }
    })
    // x = f(y) axis crossings: sign-change bisection on samples
    xofYSamplesRef.current.forEach((samples, i) => {
      if (!samples || samples.length === 0) return
      let prev = samples[0]
      for (let s = 1; s < samples.length; s++) {
        const curr = samples[s]
        if (!isFinite(prev.x) || !isFinite(prev.y) || !isFinite(curr.x) || !isFinite(curr.y)) { prev = curr; continue }
        // x-axis crossing: y changes sign → interpolate x at y=0
        if (prev.y * curr.y <= 0) {
          const t = prev.y / (prev.y - curr.y)
          const xCross = prev.x + t * (curr.x - prev.x)
          addPt({ x: xCross, y: 0 }, i, true)
        }
        // y-axis crossing: x changes sign → interpolate y at x=0
        if (prev.x * curr.x <= 0) {
          const t = prev.x / (prev.x - curr.x)
          const yCross = prev.y + t * (curr.y - prev.y)
          addPt({ x: 0, y: yCross }, i, true)
        }
        prev = curr
      }
    })
    // y=f(x) vs y=f(x)
    for (let a = 0; a < plotFns.length; a++) {
      for (let b = a + 1; b < plotFns.length; b++) {
        const fa = plotFns[a], fb = plotFns[b]
        if (!fa || !fb) continue
        findIntersections(fa, fb, xMin, xMax, steps).forEach(pt => { addPt(pt, a, false); addPt(pt, b, false) })
      }
    }
    // x=f(y) vs y=g(x): at intersection, sample.y == g(sample.x)
    // diff = g(sample.x) - sample.y; sign change means curves cross
    xofYSamplesRef.current.forEach((samples, i) => {
      if (!samples) return
      plotFns.forEach((fn, j) => {
        if (!fn) return
        let prevDiff = samples[0] ? fn(samples[0].x) - samples[0].y : NaN
        for (let s = 1; s < samples.length; s++) {
          const pt = samples[s]
          const currDiff = fn(pt.x) - pt.y
          if (isFinite(prevDiff) && isFinite(currDiff) && prevDiff * currDiff < 0) {
            const t = prevDiff / (prevDiff - currDiff)
            const xCross = samples[s-1].x + t * (pt.x - samples[s-1].x)
            const yCross = samples[s-1].y + t * (pt.y - samples[s-1].y)
            addPt({ x: xCross, y: yCross }, i, false)
            addPt({ x: xCross, y: yCross }, j, false)
          }
          prevDiff = currDiff
        }
      })
    })
    // x=f(y) vs x=f(y)
    const xofYSamples = xofYSamplesRef.current
    for (let a = 0; a < xofYSamples.length; a++) {
      for (let b = a + 1; b < xofYSamples.length; b++) {
        const sa = xofYSamples[a], sb = xofYSamples[b]
        if (!sa || !sb) continue
        const minLen = Math.min(sa.length, sb.length)
        let prevDiff = sa[0] && sb[0] ? sa[0].x - sb[0].x : NaN
        for (let s = 1; s < minLen; s++) {
          const currDiff = sa[s].x - sb[s].x
          if (isFinite(prevDiff) && isFinite(currDiff) && prevDiff * currDiff < 0) {
            const t = prevDiff / (prevDiff - currDiff)
            const xCross = sa[s-1].x + t * (sa[s].x - sa[s-1].x)
            const yCross = sa[s-1].y + t * (sa[s].y - sa[s-1].y)
            addPt({ x: xCross, y: yCross }, a, false)
            addPt({ x: xCross, y: yCross }, b, false)
          }
          prevDiff = currDiff
        }
      }
    }
    intersectionsRef.current = allIntersections

    allIntersections.forEach((pt, idx) => {
      const curves = [...pt.curves]
      const belongsToVisible = pt.axisNode
        ? curves.some(c => visibleCurves.current.has(c))
        : curves.every(c => visibleCurves.current.has(c))
      if (!belongsToVisible) return

      const px = toX(pt.x), py = toY(pt.y)
      const isActive = activeNode.current.has(idx)

      ctx.beginPath()
      ctx.arc(px, py, isActive ? 5 : 4, 0, Math.PI * 2)
      ctx.fillStyle = isActive ? '#111' : '#aaa'
      ctx.fill()

      if (isActive && belongsToVisible) {
        const label = `(${formatLabel(pt.x)}, ${formatLabel(pt.y)})`
        ctx.font = '12px system-ui, sans-serif'
        const tw = ctx.measureText(label).width
        const lx = px + 12 + tw + 10 > w ? px - tw - 16 : px + 12
        const ly = py - 24 < 0 ? py + 10 : py - 28

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

    if (mouse.current) {
      const { px, py } = mouse.current
      const wx = cx + (px - w / 2) / scale

      // Check if cursor is near any hole — snap to it and show (x, undefined)
      let holeSnap: { hx: number; hy: number } | null = null
      let bestHoleDist = 3.5
      expressions.forEach((expr) => {
        const holes = findHoles(expr, scope, xMin, xMax)
        holes.forEach(({ x, y }) => {
          const dist = Math.hypot(toX(x) - px, toY(y) - py)
          if (dist < bestHoleDist) { bestHoleDist = dist; holeSnap = { hx: x, hy: y } }
        })
      })

      if (holeSnap !== null) {
        const { hx, hy } = holeSnap as { hx: number; hy: number }
        const hpx = toX(hx), hpy = toY(hy)
        const label = `(${formatLabel(hx)}, undefined)`

        ctx.strokeStyle = 'rgba(0,0,0,0.2)'
        ctx.lineWidth = 1
        ctx.setLineDash([4, 4])
        ctx.beginPath(); ctx.moveTo(hpx, 0); ctx.lineTo(hpx, h); ctx.stroke()
        ctx.beginPath(); ctx.moveTo(0, hpy); ctx.lineTo(w, hpy); ctx.stroke()
        ctx.setLineDash([])

        ctx.font = '11px system-ui, sans-serif'
        const tw = ctx.measureText(label).width
        const lx = hpx + 10 + tw + 6 > w ? hpx - tw - 14 : hpx + 10
        const ly = hpy - 20 < 0 ? hpy + 8 : hpy - 20

        ctx.fillStyle = 'rgba(0,0,0,0.75)'
        ctx.beginPath()
        ctx.roundRect(lx - 4, ly - 2, tw + 8, 18, 3)
        ctx.fill()
        ctx.fillStyle = '#fff'
        ctx.textAlign = 'left'
        ctx.textBaseline = 'top'
        ctx.fillText(label, lx, ly)
        return
      }

      let snapX = wx, snapY: number | null = null
      let snapPx = px, snapPy = py
      let bestDist = SNAP_PX

      // y = f(x) curves
      plotFns.forEach((fn) => {
        if (!fn) return
        const fy = fn(wx)
        if (!isFinite(fy)) return
        const candidatePy = toY(fy)
        const dist = Math.abs(candidatePy - py)
        if (dist < bestDist) { bestDist = dist; snapX = wx; snapY = fy; snapPx = px; snapPy = candidatePy }
      })

      // x = f(y) curves — check screen-space distance to each sample
      xofYSamplesRef.current.forEach((samples) => {
        if (!samples) return
        for (const pt of samples) {
          const spx = toX(pt.x), spy = toY(pt.y)
          const dist = Math.hypot(spx - px, spy - py)
          if (dist < bestDist) { bestDist = dist; snapX = pt.x; snapY = pt.y; snapPx = spx; snapPy = spy }
        }
      })

      if (snapY === null) return

      const displayPy = snapPy
      const label = `(${formatLabel(snapX)}, ${formatLabel(snapY)})`

      ctx.strokeStyle = 'rgba(0,0,0,0.2)'
      ctx.lineWidth = 1
      ctx.setLineDash([4, 4])
      ctx.beginPath(); ctx.moveTo(snapPx, 0); ctx.lineTo(snapPx, h); ctx.stroke()
      ctx.beginPath(); ctx.moveTo(0, displayPy); ctx.lineTo(w, displayPy); ctx.stroke()
      ctx.setLineDash([])

      ctx.fillStyle = '#111'
      ctx.beginPath()
      ctx.arc(snapPx, displayPy, 3.5, 0, Math.PI * 2)
      ctx.fill()

      ctx.font = '11px system-ui, sans-serif'
      const tw = ctx.measureText(label).width
      const lx = px + 10 + tw + 6 > w ? px - tw - 14 : px + 10
      const ly = displayPy - 20 < 0 ? displayPy + 8 : displayPy - 20

      ctx.fillStyle = 'rgba(0,0,0,0.75)'
      ctx.beginPath()
      ctx.roundRect(lx - 4, ly - 2, tw + 8, 18, 3)
      ctx.fill()
      ctx.fillStyle = '#fff'
      ctx.textAlign = 'left'
      ctx.textBaseline = 'top'
      ctx.fillText(label, lx, ly)
    }

  }, [expressions, colors, scope])

  const drawPolar = useCallback(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const { w, h } = size.current
    if (w === 0 || h === 0) return

    const dpr = window.devicePixelRatio
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.fillStyle = '#fff'
    ctx.fillRect(0, 0, w, h)

    const { cx, cy, scale } = view.current
    const toX = (x: number) => (x - cx) * scale + w / 2
    const toY = (y: number) => -(y - cy) * scale + h / 2
    const ox = toX(0), oy = toY(0)

    // Grid: concentric circles + radial lines
    const maxR = Math.sqrt(Math.pow(Math.max(w, h) / 2, 2) * 2) / scale
    const interval = niceInterval(maxR / 5)

    // Concentric circles
    ctx.strokeStyle = GRID_COLOR
    ctx.lineWidth = 1
    for (let r = interval; r <= maxR * 1.5; r += interval) {
      const pr = r * scale
      ctx.beginPath()
      ctx.arc(ox, oy, pr, 0, Math.PI * 2)
      ctx.stroke()
    }

    // Radial lines every 30°
    ctx.strokeStyle = GRID_COLOR
    for (let deg = 0; deg < 360; deg += 30) {
      const angle = (deg * Math.PI) / 180
      const far = maxR * 1.5 * scale
      ctx.beginPath()
      ctx.moveTo(ox, oy)
      ctx.lineTo(ox + Math.cos(angle) * far, oy - Math.sin(angle) * far)
      ctx.stroke()
    }

    // Axes
    ctx.strokeStyle = AXIS_COLOR
    ctx.lineWidth = 1
    ctx.beginPath(); ctx.moveTo(0, oy); ctx.lineTo(w, oy); ctx.stroke()
    ctx.beginPath(); ctx.moveTo(ox, 0); ctx.lineTo(ox, h); ctx.stroke()

    // Circle labels (right side of each circle)
    ctx.fillStyle = LABEL_COLOR
    ctx.font = LABEL_FONT
    ctx.textAlign = 'left'
    ctx.textBaseline = 'middle'
    ctx.textBaseline = 'top'
    for (let r = interval; r <= maxR * 1.5; r += interval) {
      const lx = ox + r * scale + 3
      const ly = oy + 3
      if (lx > w) break
      ctx.fillText(formatLabel(r), lx, ly)
    }

    // Angle labels at cardinal directions
    const cardinals = [
      { angle: 0, label: '0', dx: 6, dy: -8, align: 'left' as CanvasTextAlign },
      { angle: Math.PI / 2, label: 'π/2', dx: 6, dy: -8, align: 'left' as CanvasTextAlign },
      { angle: Math.PI, label: 'π', dx: -6, dy: -8, align: 'right' as CanvasTextAlign },
      { angle: 3 * Math.PI / 2, label: '3π/2', dx: 6, dy: 8, align: 'left' as CanvasTextAlign },
    ]
    const labelR = Math.min(maxR * 0.85, interval * 4) * scale
    ctx.font = LABEL_FONT
    cardinals.forEach(({ angle, label, dx, dy, align }) => {
      const lx = ox + Math.cos(angle) * labelR + dx
      const ly = oy - Math.sin(angle) * labelR + dy
      ctx.textAlign = align
      ctx.textBaseline = 'middle'
      ctx.fillStyle = LABEL_COLOR
      ctx.fillText(label, lx, ly)
    })

    // Build polar fns and plot curves
    const maxTheta = Math.max(4 * Math.PI, maxR * 1.5)
    const thetaSteps = Math.min(8000, Math.max(2000, Math.ceil(maxTheta * 200)))

    const polarFns: (((theta: number) => number) | null)[] = expressions.map((expr) =>
      isGraphablePolar(expr, scope) ? buildPolarFn(expr, scope) : null
    )
    polarFnsRef.current = polarFns

    polarFns.forEach((fn, ei) => {
      if (!fn) return
      ctx.strokeStyle = colors[ei]
      ctx.lineWidth = 2
      ctx.beginPath()
      let penDown = false
      for (let i = 0; i <= thetaSteps; i++) {
        const theta = (i / thetaSteps) * maxTheta
        const r = fn(theta)
        if (!isFinite(r)) { penDown = false; continue }
        const px = toX(r * Math.cos(theta))
        const py = toY(r * Math.sin(theta))
        if (!penDown) { ctx.moveTo(px, py); penDown = true }
        else ctx.lineTo(px, py)
      }
      ctx.stroke()
    })

    // Intersection detection in theta space
    const iSteps = 1000
    const allIntersections: TaggedIntersection[] = []
    const tol = maxR * 0.02

    const addPolarPt = (x: number, y: number, curveIdx: number, axisNode: boolean) => {
      const existing = allIntersections.find(p => Math.hypot(p.x - x, p.y - y) < tol)
      if (existing) existing.curves.add(curveIdx)
      else allIntersections.push({ x, y, curves: new Set([curveIdx]), axisNode })
    }

    const bisect = (f: (t: number) => number, lo: number, hi: number): number => {
      let fl = f(lo)
      for (let k = 0; k < 40; k++) {
        const mid = (lo + hi) / 2
        const fm = f(mid)
        if (fl * fm <= 0) { hi = mid } else { lo = mid; fl = fm }
      }
      return (lo + hi) / 2
    }

    // Axis crossings — find where Cartesian y=0 (x-axis) or x=0 (y-axis)
    polarFns.forEach((fn, i) => {
      if (!fn) return
      const cartY = (t: number) => fn(t) * Math.sin(t)   // y = r*sin(θ)
      const cartX = (t: number) => fn(t) * Math.cos(t)   // x = r*cos(θ)
      let prevY = cartY(0), prevX = cartX(0)
      for (let s = 1; s <= iSteps; s++) {
        const theta = (s / iSteps) * maxTheta
        const cy = cartY(theta), cx2 = cartX(theta)
        if (isFinite(prevY) && isFinite(cy) && (Math.abs(cy) < 1e-9 || prevY * cy < 0)) {
          const t0 = bisect(cartY, theta - maxTheta / iSteps, theta)
          const r0 = fn(t0)
          addPolarPt(r0 * Math.cos(t0), 0, i, true)
        }
        if (isFinite(prevX) && isFinite(cx2) && (Math.abs(cx2) < 1e-9 || prevX * cx2 < 0)) {
          const t0 = bisect(cartX, theta - maxTheta / iSteps, theta)
          const r0 = fn(t0)
          addPolarPt(0, r0 * Math.sin(t0), i, true)
        }
        prevY = cy; prevX = cx2
      }
    })

    // Curve-curve crossings: r₁(θ) = r₂(θ) in Cartesian space
    for (let a = 0; a < polarFns.length; a++) {
      for (let b = a + 1; b < polarFns.length; b++) {
        const fa = polarFns[a], fb = polarFns[b]
        if (!fa || !fb) continue
        let prev = fa(0) - fb(0)
        for (let s = 1; s <= iSteps; s++) {
          const theta = (s / iSteps) * maxTheta
          const curr = fa(theta) - fb(theta)
          if (!isFinite(prev) || !isFinite(curr)) { prev = curr; continue }
          if (prev * curr < 0) {
            let lo = theta - maxTheta / iSteps, hi = theta
            let lt = prev
            for (let k = 0; k < 40; k++) {
              const mid = (lo + hi) / 2
              const mt = fa(mid) - fb(mid)
              if (lt * mt <= 0) { hi = mid } else { lo = mid; lt = mt }
            }
            const t0 = (lo + hi) / 2
            const r0 = fa(t0)
            const ix = r0 * Math.cos(t0), iy = r0 * Math.sin(t0)
            addPolarPt(ix, iy, a, false)
            addPolarPt(ix, iy, b, false)
          }
          prev = curr
        }
      }
    }
    intersectionsRef.current = allIntersections

    // Draw intersection nodes
    allIntersections.forEach((pt, idx) => {
      const curves = [...pt.curves]
      const belongsToVisible = pt.axisNode
        ? curves.some(c => visibleCurves.current.has(c))
        : curves.every(c => visibleCurves.current.has(c))
      if (!belongsToVisible) return

      const px = toX(pt.x), py = toY(pt.y)
      const isActive = activeNode.current.has(idx)
      ctx.beginPath()
      ctx.arc(px, py, isActive ? 5 : 4, 0, Math.PI * 2)
      ctx.fillStyle = isActive ? '#111' : '#aaa'
      ctx.fill()

      if (isActive) {
        const r = Math.sqrt(pt.x * pt.x + pt.y * pt.y)
        const theta = Math.atan2(pt.y, pt.x)
        const label = `(${formatLabel(r)}, ${formatLabel(theta)})`
        ctx.font = '12px system-ui, sans-serif'
        const tw = ctx.measureText(label).width
        const lx = px + 12 + tw + 10 > w ? px - tw - 16 : px + 12
        const ly = py - 24 < 0 ? py + 10 : py - 28

        ctx.shadowColor = 'rgba(0,0,0,0.15)'; ctx.shadowBlur = 6
        ctx.fillStyle = '#fff'
        ctx.beginPath(); ctx.roundRect(lx - 6, ly - 4, tw + 12, 22, 4); ctx.fill()
        ctx.shadowBlur = 0
        ctx.strokeStyle = '#ddd'; ctx.lineWidth = 1
        ctx.beginPath(); ctx.roundRect(lx - 6, ly - 4, tw + 12, 22, 4); ctx.stroke()
        ctx.fillStyle = '#111'; ctx.textAlign = 'left'; ctx.textBaseline = 'top'
        ctx.fillText(label, lx, ly)
      }
    })

    // Hover snap — find nearest point on any polar curve in screen space
    if (mouse.current) {
      const { px, py } = mouse.current
      let bestDist = SNAP_PX
      let snapX: number | null = null, snapY: number | null = null
      let snapR: number | null = null, snapTheta: number | null = null

      polarFns.forEach((fn) => {
        if (!fn) return
        for (let i = 0; i <= thetaSteps; i++) {
          const theta = (i / thetaSteps) * maxTheta
          const r = fn(theta)
          if (!isFinite(r)) continue
          const sx = toX(r * Math.cos(theta))
          const sy = toY(r * Math.sin(theta))
          const dist = Math.hypot(sx - px, sy - py)
          if (dist < bestDist) {
            bestDist = dist
            snapX = sx; snapY = sy
            snapR = r; snapTheta = theta
          }
        }
      })

      if (snapX !== null && snapY !== null && snapR !== null && snapTheta !== null) {
        ctx.strokeStyle = 'rgba(0,0,0,0.2)'
        ctx.lineWidth = 1
        ctx.setLineDash([4, 4])
        ctx.beginPath(); ctx.moveTo(snapX, 0); ctx.lineTo(snapX, h); ctx.stroke()
        ctx.beginPath(); ctx.moveTo(0, snapY); ctx.lineTo(w, snapY); ctx.stroke()
        ctx.setLineDash([])

        ctx.fillStyle = '#111'
        ctx.beginPath(); ctx.arc(snapX, snapY, 3.5, 0, Math.PI * 2); ctx.fill()

        const label = `(${formatLabel(snapR)}, ${formatLabel(snapTheta)})`
        ctx.font = '11px system-ui, sans-serif'
        const tw = ctx.measureText(label).width
        const lx = snapX + 10 + tw + 6 > w ? snapX - tw - 14 : snapX + 10
        const ly = snapY - 20 < 0 ? snapY + 8 : snapY - 20
        ctx.fillStyle = 'rgba(0,0,0,0.75)'
        ctx.beginPath(); ctx.roundRect(lx - 4, ly - 2, tw + 8, 18, 3); ctx.fill()
        ctx.fillStyle = '#fff'; ctx.textAlign = 'left'; ctx.textBaseline = 'top'
        ctx.fillText(label, lx, ly)
      }
    }

  }, [expressions, colors, scope])

  const redraw = useCallback(() => {
    if (is3D) draw3D()
    else if (isPolar) drawPolar()
    else draw()
  }, [is3D, isPolar, draw, draw3D, drawPolar])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const observer = new ResizeObserver((entries) => {
      const { width, height } = entries[0].contentRect
      size.current = { w: width, h: height }
      const dpr = window.devicePixelRatio
      canvas.width = width * dpr
      canvas.height = height * dpr
      redraw()
    })
    observer.observe(canvas)
    return () => observer.disconnect()
  }, [redraw])

  const prevExpressionsRef = useRef<string>('')
  const expressionsKey = expressions.join('|')
  useEffect(() => {
    if (expressionsKey === prevExpressionsRef.current) return
    activeNode.current.clear()
    const newCount = expressions.length
    visibleCurves.current = new Set([...visibleCurves.current].filter(i => i < newCount))
    prevExpressionsRef.current = expressionsKey
  }, [expressionsKey])

  useEffect(() => { redraw() }, [redraw])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    function onWheel(e: WheelEvent) {
      e.preventDefault()
      setSettingsOpen(false)
      if (is3D) {
        const factor = e.deltaY > 0 ? 1.08 : 1 / 1.08
        view3D.current.unitsPerHalf = Math.max(0.01, view3D.current.unitsPerHalf * factor)
        draw3D()
        return
      }
      if (lockViewport) return
      const { cx, cy, scale } = view.current
      const { w, h } = size.current
      const factor = e.deltaY > 0 ? 1 / 1.05 : 1.05
      const newScale = scale * factor
      const mouseX = cx + (e.offsetX - w / 2) / scale
      const mouseY = cy - (e.offsetY - h / 2) / scale
      view.current.scale = newScale
      view.current.cx = mouseX - (e.offsetX - w / 2) / newScale
      view.current.cy = mouseY + (e.offsetY - h / 2) / newScale
      if (isPolar) drawPolar()
      else draw()
    }
    canvas.addEventListener('wheel', onWheel, { passive: false })
    return () => canvas.removeEventListener('wheel', onWheel)
  }, [draw, draw3D, drawPolar, lockViewport, is3D, isPolar])

  function handleMouseDown(e: React.MouseEvent) {
    setSettingsOpen(false)
    setModeMenuOpen(false)
    if (is3D) {
      drag3D.current = { x: e.clientX, y: e.clientY, rotX: view3D.current.rotX, rotY: view3D.current.rotY }
      return
    }
    if (!lockViewport) drag.current = { x: e.clientX, y: e.clientY, cx: view.current.cx, cy: view.current.cy }
  }

  function handleMouseMove(e: React.MouseEvent) {
    const canvas = canvasRef.current
    if (!canvas) return
    const rect = canvas.getBoundingClientRect()
    const px = e.clientX - rect.left
    const py = e.clientY - rect.top

    if (is3D) {
      if (drag3D.current) {
        const dx = e.clientX - drag3D.current.x
        const dy = e.clientY - drag3D.current.y
        view3D.current.rotY = drag3D.current.rotY - dx * 0.01
        view3D.current.rotX = Math.max(-Math.PI / 2 + 0.05, Math.min(Math.PI / 2 - 0.05, drag3D.current.rotX - dy * 0.01))
        draw3D()
      }
      return
    }

    mouse.current = { px, py }
    if (!lockViewport && drag.current) {
      view.current.cx = drag.current.cx - (e.clientX - drag.current.x) / view.current.scale
      view.current.cy = drag.current.cy + (e.clientY - drag.current.y) / view.current.scale
    }
    const { cx, cy, scale } = view.current
    const wx = cx + (px - rect.width / 2) / scale
    const wy = cy - (py - rect.height / 2) / scale
    setMouseCoords({ x: wx, y: wy })
    if (isPolar) drawPolar()
    else draw()
  }

  function toggleCurve(index: number) {
    if (visibleCurves.current.has(index)) visibleCurves.current.delete(index)
    else visibleCurves.current.add(index)
    for (const idx of [...activeNode.current]) {
      const pt = intersectionsRef.current[idx]
      if (!pt) { activeNode.current.delete(idx); continue }
      const curves = [...pt.curves]
      const stillVisible = pt.axisNode
        ? curves.some(c => visibleCurves.current.has(c))
        : curves.every(c => visibleCurves.current.has(c))
      if (!stillVisible) activeNode.current.delete(idx)
    }
    onCurveClick(index)
  }

  function handleMouseUp(e: React.MouseEvent) {
    if (is3D) {
      drag3D.current = null
      return
    }
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

          const NODE_HIT = 10
          const nodeHit = intersectionsRef.current.findIndex((pt) => {
            const curves = [...pt.curves]
            const belongsToVisible = pt.axisNode
              ? curves.some(c => visibleCurves.current.has(c))
              : curves.every(c => visibleCurves.current.has(c))
            return belongsToVisible && Math.hypot(toX(pt.x) - px, toY(pt.y) - py) < NODE_HIT
          })
          if (nodeHit >= 0) {
            if (activeNode.current.has(nodeHit)) activeNode.current.delete(nodeHit)
            else activeNode.current.add(nodeHit)
            if (isPolar) drawPolar()
            else draw()
            drag.current = null
            return
          }

          if (isPolar) {
            // Polar curve click — find nearest curve in screen space
            const maxR = Math.sqrt(Math.pow(Math.max(rect.width, rect.height) / 2, 2) * 2) / scale
            const maxTheta = Math.max(4 * Math.PI, maxR * 1.5)
            const thetaSteps = Math.min(8000, Math.max(2000, Math.ceil(maxTheta * 200)))
            let curveHit = -1
            let bestDist = SNAP_PX
            polarFnsRef.current.forEach((fn, i) => {
              if (!fn) return
              for (let s = 0; s <= thetaSteps; s++) {
                const theta = (s / thetaSteps) * maxTheta
                const r = fn(theta)
                if (!isFinite(r)) continue
                const sx = toX(r * Math.cos(theta))
                const sy = toY(r * Math.sin(theta))
                const dist = Math.hypot(sx - px, sy - py)
                if (dist < bestDist) { bestDist = dist; curveHit = i }
              }
            })
            if (curveHit >= 0) {
              toggleCurve(curveHit)
              if (isPolar) drawPolar()
              else draw()
            }
          } else {
            const wx = cx + (px - rect.width / 2) / scale
            let curveHit = -1
            let bestDist = SNAP_PX
            plotFnsRef.current.forEach((fn, i) => {
              if (!fn) return
              const fy = fn(wx)
              if (!isFinite(fy)) return
              const dist = Math.abs(toY(fy) - py)
              if (dist < bestDist) { bestDist = dist; curveHit = i }
            })
            // Also check x=f(y) curves via screen-space distance
            xofYSamplesRef.current.forEach((samples, i) => {
              if (!samples) return
              for (const pt of samples) {
                const dist = Math.hypot(toX(pt.x) - px, toY(pt.y) - py)
                if (dist < bestDist) { bestDist = dist; curveHit = i }
              }
            })
            if (curveHit >= 0) {
              toggleCurve(curveHit)
              draw()
            }
          }
        }
      }
    }
    drag.current = null
  }

  function handleResetView() {
    if (is3D) {
      view3D.current = { rotX: 0.4, rotY: -0.6, unitsPerHalf: 6 }
      draw3D()
    } else {
      view.current = { cx: 0, cy: 0, scale: 50 }
      if (isPolar) drawPolar()
      else draw()
    }
  }

  function syncRangeStrings() {
    const { cx, cy, scale } = view.current
    const { w, h } = size.current
    setXMinStr(formatLabel(cx - w / 2 / scale))
    setXMaxStr(formatLabel(cx + w / 2 / scale))
    setYMinStr(formatLabel(cy - h / 2 / scale))
    setYMaxStr(formatLabel(cy + h / 2 / scale))
  }

  function commitRange(xMin: string, xMax: string, yMin: string, yMax: string) {
    const x0 = parseFloat(xMin), x1 = parseFloat(xMax)
    const y0 = parseFloat(yMin), y1 = parseFloat(yMax)
    if (!isFinite(x0) || !isFinite(x1) || !isFinite(y0) || !isFinite(y1)) return
    if (x1 <= x0 || y1 <= y0) return
    const { w, h } = size.current
    const scaleX = w / (x1 - x0)
    const scaleY = h / (y1 - y0)
    const scale = Math.min(scaleX, scaleY)
    view.current = { cx: (x0 + x1) / 2, cy: (y0 + y1) / 2, scale }
    draw()
  }

  function handleMouseLeave() {
    drag.current = null
    drag3D.current = null
    mouse.current = null
    setMouseCoords(null)
    if (isPolar) drawPolar()
    else if (!is3D) draw()
  }

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%' }}>
      <canvas
        ref={canvasRef}
        style={{ width: '100%', height: '100%', display: 'block', cursor: is3D ? 'grab' : 'default' }}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseLeave}
      />
      {mouseCoords && graphMode === '2d' && (
        <div style={{
          position: 'absolute', bottom: '14px', left: '14px',
          fontSize: '16px', fontFamily: 'KaTeX_Main, serif',
          color: '#1e1b4b', pointerEvents: 'none',
        }}>
          ({formatLabel(mouseCoords.x)}, {formatLabel(mouseCoords.y)})
        </div>
      )}
      <div ref={settingsAnchorRef} style={{ position: 'absolute', top: '12px', right: '14px', display: 'flex', flexDirection: 'column', gap: '6px' }}>
        {/* Mode selector button + dropdown */}
        <div style={{ position: 'relative' }}>
          <button
            onClick={() => setModeMenuOpen((v) => !v)}
            style={{
              ...ICON_BTN_STYLE,
              background: graphMode !== '2d' ? '#1e1b4b' : 'rgba(255,255,255,0.9)',
              color: graphMode !== '2d' ? '#fff' : '#555',
              border: graphMode !== '2d' ? '1px solid #1e1b4b' : '1px solid #ddd',
              fontWeight: 700, fontSize: '11px', letterSpacing: '0.02em',
            }}
            title="Switch graph mode"
          >
            {graphMode === '2d' ? '2D' : graphMode === '3d' ? '3D' : 'POL'}
          </button>
          {modeMenuOpen && (
            <div style={{
              position: 'absolute', right: 0, top: '100%', marginTop: '4px',
              background: '#fff', border: '1px solid #ddd', borderRadius: '6px',
              boxShadow: '0 4px 12px rgba(0,0,0,0.12)', overflow: 'hidden', zIndex: 100,
              minWidth: '80px',
            }}>
              {(['2d', '3d', 'polar'] as GraphMode[]).map((mode) => (
                <button
                  key={mode}
                  onClick={() => { onGraphModeChange(mode); setModeMenuOpen(false) }}
                  style={{
                    display: 'block', width: '100%', padding: '8px 14px',
                    textAlign: 'left', border: 'none', cursor: 'pointer',
                    background: graphMode === mode ? '#f0f0f8' : '#fff',
                    fontWeight: graphMode === mode ? 700 : 400,
                    fontSize: '12px', color: '#333',
                  }}
                >
                  {mode === '2d' ? '2D' : mode === '3d' ? '3D' : 'Polar'}
                </button>
              ))}
            </div>
          )}
        </div>
        {is3D && (
          <button
            onClick={() => setFit3D((v) => !v)}
            style={{
              ...ICON_BTN_STYLE,
              background: fit3D ? '#e8eaf6' : 'rgba(255,255,255,0.9)',
              fontWeight: 600, fontSize: '10px', letterSpacing: '0.02em',
            }}
            title={fit3D ? 'Switch to box mode' : 'Switch to fit mode'}
          >
            {fit3D ? 'FIT' : 'BOX'}
          </button>
        )}
        {graphMode === '2d' && (
          <button onClick={() => { setSettingsOpen((v) => { if (!v) syncRangeStrings(); return !v }) }} style={ICON_BTN_STYLE} title="Settings">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="3"/>
              <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>
            </svg>
          </button>
        )}
        <button onClick={handleResetView} style={ICON_BTN_STYLE} title="Reset view">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>
            <polyline points="9 22 9 12 15 12 15 22"/>
          </svg>
        </button>
      </div>
      {graphMode === '2d' && (
        <GraphSettings
          open={settingsOpen}
          onClose={() => setSettingsOpen(false)}
          anchorRef={settingsAnchorRef}
          showXAxis={showXAxis} onShowXAxisChange={setShowXAxis}
          showYAxis={showYAxis} onShowYAxisChange={setShowYAxis}
          xLabel={xLabel} onXLabelChange={setXLabel}
          yLabel={yLabel} onYLabelChange={setYLabel}
          xMinStr={xMinStr} onXMinChange={setXMinStr}
          xMaxStr={xMaxStr} onXMaxChange={setXMaxStr}
          yMinStr={yMinStr} onYMinChange={setYMinStr}
          yMaxStr={yMaxStr} onYMaxChange={setYMaxStr}
          onCommitRange={commitRange}
          lockViewport={lockViewport} onLockViewportChange={setLockViewport}
        />
      )}
    </div>
  )
}
