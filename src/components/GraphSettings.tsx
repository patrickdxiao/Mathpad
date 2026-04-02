import React from 'react'

interface GraphSettingsProps {
  open: boolean
  onClose: () => void
  anchorRef: React.RefObject<HTMLDivElement | null>
  showXAxis: boolean
  onShowXAxisChange: (v: boolean) => void
  showYAxis: boolean
  onShowYAxisChange: (v: boolean) => void
  xLabel: string
  onXLabelChange: (v: string) => void
  yLabel: string
  onYLabelChange: (v: string) => void
  xMinStr: string
  onXMinChange: (v: string) => void
  xMaxStr: string
  onXMaxChange: (v: string) => void
  yMinStr: string
  onYMinChange: (v: string) => void
  yMaxStr: string
  onYMaxChange: (v: string) => void
  onCommitRange: (xMin: string, xMax: string, yMin: string, yMax: string) => void
  lockViewport: boolean
  onLockViewportChange: (v: boolean) => void
}

const INPUT_STYLE: React.CSSProperties = {
  border: '1px solid #ddd', borderRadius: '4px', padding: '4px 8px',
  fontSize: '0.8rem', fontFamily: 'ui-monospace, Consolas, monospace',
  boxSizing: 'border-box', width: '80px',
}

function Checkbox({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', userSelect: 'none', fontWeight: 500 }}>
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)}
        style={{ width: '14px', height: '14px', cursor: 'pointer', accentColor: '#1e1b4b' }} />
      {label}
    </label>
  )
}

function AxisRow({
  axis, show, onShowChange, label, onLabelChange,
  minStr, onMinChange, maxStr, onMaxChange,
  onBlur, onKeyDown, disabled,
}: {
  axis: 'x' | 'y'
  show: boolean
  onShowChange: (v: boolean) => void
  label: string
  onLabelChange: (v: string) => void
  minStr: string
  onMinChange: (v: string) => void
  maxStr: string
  onMaxChange: (v: string) => void
  onBlur: () => void
  onKeyDown: (e: React.KeyboardEvent) => void
  disabled: boolean
}) {
  const rangeStyle: React.CSSProperties = {
    ...INPUT_STYLE,
    background: disabled ? '#f5f5f5' : '#fff',
    color: disabled ? '#aaa' : '#111',
    cursor: disabled ? 'not-allowed' : 'text',
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
        <Checkbox checked={show} onChange={onShowChange} label={`${axis.toUpperCase()}-Axis`} />
        <input
          value={label} onChange={(e) => onLabelChange(e.target.value)}
          placeholder="Label"
          style={{ ...INPUT_STYLE, width: '80px', marginLeft: 'auto', fontFamily: 'system-ui, sans-serif' }}
        />
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.8rem', paddingLeft: '2px' }}>
        <input value={minStr} onChange={(e) => !disabled && onMinChange(e.target.value)} onBlur={onBlur} onKeyDown={onKeyDown} style={rangeStyle} readOnly={disabled} />
        <span style={{ color: disabled ? '#bbb' : '#555', whiteSpace: 'nowrap' }}>≤ {axis} ≤</span>
        <input value={maxStr} onChange={(e) => !disabled && onMaxChange(e.target.value)} onBlur={onBlur} onKeyDown={onKeyDown} style={rangeStyle} readOnly={disabled} />
      </div>
    </div>
  )
}

export default function GraphSettings({
  open, anchorRef,
  showXAxis, onShowXAxisChange,
  showYAxis, onShowYAxisChange,
  xLabel, onXLabelChange,
  yLabel, onYLabelChange,
  xMinStr, onXMinChange,
  xMaxStr, onXMaxChange,
  yMinStr, onYMinChange,
  yMaxStr, onYMaxChange,
  onCommitRange,
  lockViewport, onLockViewportChange,
}: GraphSettingsProps) {
  if (!open) return null

  const anchor = anchorRef.current?.getBoundingClientRect()
  const top = anchor ? anchor.top : 60
  const right = anchor ? window.innerWidth - anchor.left + 8 : 60

  function handleRangeKey(e: React.KeyboardEvent) {
    if (e.key === 'Enter') onCommitRange(xMinStr, xMaxStr, yMinStr, yMaxStr)
  }

  function handleRangeBlur() {
    onCommitRange(xMinStr, xMaxStr, yMinStr, yMaxStr)
  }

  return (
    <div
      onMouseDown={(e) => e.stopPropagation()}
      style={{
        position: 'fixed', top, right, zIndex: 1000,
        background: '#fff', border: '1px solid #ddd', borderRadius: '8px',
        boxShadow: '0 4px 20px rgba(0,0,0,0.12)',
        width: '260px', padding: '14px',
        fontFamily: 'system-ui, sans-serif', fontSize: '0.875rem', color: '#111',
        display: 'flex', flexDirection: 'column', gap: '12px',
      }}
    >
      <AxisRow
        axis="x" show={showXAxis} onShowChange={onShowXAxisChange}
        label={xLabel} onLabelChange={onXLabelChange}
        minStr={xMinStr} onMinChange={onXMinChange}
        maxStr={xMaxStr} onMaxChange={onXMaxChange}
        onBlur={handleRangeBlur} onKeyDown={handleRangeKey}
        disabled={lockViewport}
      />

      <div style={{ borderTop: '1px solid #eee' }} />

      <AxisRow
        axis="y" show={showYAxis} onShowChange={onShowYAxisChange}
        label={yLabel} onLabelChange={onYLabelChange}
        minStr={yMinStr} onMinChange={onYMinChange}
        maxStr={yMaxStr} onMaxChange={onYMaxChange}
        onBlur={handleRangeBlur} onKeyDown={handleRangeKey}
        disabled={lockViewport}
      />

      <div style={{ borderTop: '1px solid #eee' }} />

      <Checkbox checked={lockViewport} onChange={onLockViewportChange} label="Lock Viewport" />
    </div>
  )
}
