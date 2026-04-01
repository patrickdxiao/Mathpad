import { useEffect, useRef } from 'react'
import functionPlotLib from 'function-plot'
const functionPlot = (functionPlotLib as any).default ?? functionPlotLib
import { math } from '../lib/mathScope'

const COLORS = ['#1a73e8', '#e8340a', '#188038', '#e37400', '#a142f4', '#007b83']

interface GraphProps {
  expressions: string[]
  scope: Record<string, unknown>
}

function toFunctionPlotDatum(expr: string, scope: Record<string, unknown>, color: string) {
  try {
    const node = math.parse(expr)

    if (node.type === 'AssignmentNode' && (node as any).name === 'x') {
      const val = (node as any).value.evaluate({ ...scope })
      if (typeof val === 'number') {
        return { fn: `x - ${val}`, fnType: 'implicit' as const, color }
      }
    }

    const plotNode = node.type === 'AssignmentNode' ? (node as any).value : node
    let fnStr = plotNode.toString()
    for (const [key, val] of Object.entries(scope)) {
      if (typeof val === 'number') {
        fnStr = fnStr.replace(new RegExp(`\\b${key}\\b`, 'g'), String(val))
      }
    }
    return { fn: fnStr, color }
  } catch {
    return null
  }
}

export default function Graph({ expressions, scope }: GraphProps) {
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const el = containerRef.current
    if (!el) return

    function render() {
      if (!el) return
      const width = el.clientWidth
      const height = el.clientHeight
      console.log('render called', { width, height, expressions })
      if (width === 0 || height === 0) return

      const data = expressions
        .map((expr, i) => toFunctionPlotDatum(expr, scope, COLORS[i % COLORS.length]))
        .filter(Boolean)

      try {
        functionPlot({
          target: el,
          width,
          height,
          grid: true,
          data: (data.length ? data : []) as any,
        })
      } catch (e) { console.error('functionPlot error:', e) }
    }

    const observer = new ResizeObserver(render)
    observer.observe(el)

    return () => observer.disconnect()
  }, [expressions, scope])

  return <div ref={containerRef} style={{ width: '100%', height: '100%', display: 'block' }} />
}
