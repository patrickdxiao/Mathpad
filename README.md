# MathPad

A math notebook with live graphing. Inspired by the multi-character variable names of Jupyter and the visual expression editing of Desmos.

**Live:** https://mathpad-pi.vercel.app

---

## Stack

React · TypeScript · Vite · MathLive · math.js

```
src/
├── components/
│   ├── Notebook.tsx      # Cell state, tabs, shared scope, drag-to-reorder, save/load
│   ├── Cell.tsx          # MathLive input, output display, error tooltip, color picker
│   ├── Graph.tsx         # Canvas graphing, zoom, pan, intersection nodes, settings
│   ├── GraphSettings.tsx # Axis controls, range inputs, lock viewport
│   └── ColorPicker.tsx   # HSV color picker for graph curves
├── lib/
│   └── mathScope.ts      # LaTeX → math.js, evaluation, graphability detection
└── types.ts              # CellData, TabData
```

---

## Features

- **Structured math input** — fractions, exponents, Greek letters, summations via MathLive
- **Shared variable scope** — define `mass = 9.8` in one cell, use it anywhere
- **Multi-tab notebook** — multiple sheets with cross-tab variable sharing
- **Live graphing** — any expression in `x` auto-detects and plots; `y = f(x)` and vertical lines supported
- **Intersection nodes** — click a curve to reveal x-intercepts, y-intercepts, and curve-curve intersections
- **Graph settings** — show/hide axes, axis labels, set exact x/y range, lock viewport
- **Drag-to-reorder cells** with smooth animated reordering
- **Save/load** — export notebook to JSON, reload from file
- **Custom canvas graph** — zoom anchored to cursor, pan, snap crosshair, smart grid intervals

---

## Running Locally

```bash
git clone https://github.com/patrickdxiao/Mathpad.git
cd Mathpad
npm install
npm run dev
```

Open http://localhost:5173
