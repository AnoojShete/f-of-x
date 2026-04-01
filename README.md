# f-of-x Engine

Interactive function-graph playground with gameplay and physics.

The app lets you define one or more functions, renders them as world-space geometry,
and simulates a ball that can move, detach, and reattach across multiple curves.

## Current capabilities

- Multi-function input (one expression per line)
- Independent compile/error handling per function
- Multi-curve rendering with separate colors
- Unified collision space from all valid plotted segments
- World-space sampling (scale/zoom independent geometry)
- Discontinuity-aware segmentation (no fake continuity across asymptotes)
- Physics mode and deterministic mode toggle
- Air/on-curve motion states with segment attachment
- Continuous collision detection (sweep test) to reduce tunneling
- Physics sub-stepping per frame for stability/accuracy
- Goal + stars gameplay state, with completion handling
- Camera follow toggle and debug tuning panel

## Tech stack

- React 18 + TypeScript
- Vite
- HTML5 Canvas + SVG overlays
- mathjs

## Run locally

```bash
npm install
npm run dev
```

Useful scripts:

```bash
npm run typecheck
npm run build
npm run preview
```

## Input format

- Use the function textarea in the UI.
- Each non-empty line is treated as one function.
- Example:

```txt
sin(x)
0.3*x^2 - 1
1/x
```

Invalid lines do not block valid ones. Each function compiles independently.

## Physics and geometry notes

- Sampling uses constant world-space step (`stepWorld`) so geometry is consistent at any zoom.
- Physics and rendering consume the same sampled segments.
- Invalid/clipped regions are hard-broken into separate segments.
- Degenerate segments are discarded.
- Collision filters reject invalid/overlong segments and above-surface contacts.

This prevents most sticking/tunneling issues on discontinuities such as `1/x` and `tan(x)`.

## Controls

- Play / Restart
- Physics ON/OFF
- Camera Follow ON/OFF
- Debug panel (gravity, friction, initial velocity, speed multiplier)
- Scale slider (view zoom; does not change world geometry sampling resolution)

## Architecture (current)

```txt
src/
	App.tsx
	components/
		Graph.tsx
		BallOverlay.tsx
		GameObjectsOverlay.tsx
		AdminPanel.tsx
	core/
		game/
			gameState.ts
	physics/
		traversal.ts
		collision.ts
		motion.ts
	utils/
		evaluate.ts
		sample.ts
		curveGeometry.ts
		collision.ts
		levelGenerator.ts
	types.ts
```

Layer intent:

- Math/sampling: parse, evaluate, sample, segment
- Physics: traversal, collision, motion updates
- Game state: stars/goal progression
- Rendering: graph and overlays

## Known limitations

- Function parsing/evaluation is expression-based (`y = f(x)`), not implicit curves.
- Extremely pathological expressions may still require tighter sampling thresholds.
- Physics constants are tuned for gameplay, not strict real-world simulation.