# MathPad

A math notebook with live graphing. Inspired by the multi-character variable names of Jupyter and the visual expression editing of Desmos.

---

## Stack & Structure

React · TypeScript · Vite · MathLive · math.js

```
mathpad/
├── src/
│   ├── components/
│   │   ├── Notebook.tsx   # Cell state, shared scope evaluation, drag-to-reorder
│   │   ├── Cell.tsx       # MathLive math-field input, output display, error tooltip
│   │   └── Graph.tsx      # Canvas-based graphing, zoom-to-cursor, pan, smart grid
│   ├── lib/
│   │   └── mathScope.ts   # LaTeX → math.js conversion, evaluation, graphability detection
│   └── types.ts           # CellData interface
```

---

## Features

- Structured math input — fractions, exponents, Greek letters, summations via MathLive
- Shared variable scope across all cells — define `a = 4` in one cell, use it in the next
- Live graphing — any expression in `x` or `y` auto-detects and plots on the canvas
- Custom canvas graph — zoom anchored to cursor, pan, smart grid intervals
- Drag-to-reorder cells with smooth animated reordering
- Backslash commands only — plain text like `sin` is a user variable, `\sin` is the function

---

## Running Locally

**Prerequisites:** Node.js

```bash
git clone https://github.com/Patrick57761/mathpad.git
cd mathpad
npm install
npm run dev
```

Open http://localhost:5173
