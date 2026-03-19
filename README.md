# f-of-x (Phase 1: Graph Engine)

A React + TypeScript + Canvas “function graph engine” for a math-based game.

Phase 1 focuses only on:
- Safe parsing + evaluation of user input functions (via `mathjs`)
- Robust graph rendering on an HTML5 Canvas
- Discontinuity-aware sampling (don’t connect across undefined/jumpy regions)

## Tech
- React (TypeScript)
- Vite
- HTML5 Canvas (no chart/graph libraries)
- mathjs

## Getting started

```bash
npm install
npm run dev
```

Then open the printed local URL.

## Notes
- Canvas center is world (0,0)
- Scale is in pixels per unit
- Try `1/x` to verify discontinuity handling near x=0

## Project structure
- `src/utils/evaluate.ts` — safe parse/compile + evaluation guards
- `src/utils/sample.ts` — sampling + discontinuity segmentation
- `src/components/Graph.tsx` — canvas rendering (axes, grid, plotting)
- `src/App.tsx` — minimal UI (expression + scale)