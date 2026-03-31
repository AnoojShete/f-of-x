import { useEffect, useMemo, useRef } from 'react';
import type { ReactNode } from 'react';
import type { GraphPlot, GraphSegment, Vec2 } from '../types';

export type GraphProps = {
  width: number;
  height: number;
  scale: number; // pixels per unit
  plots: ReadonlyArray<GraphPlot>;
  children?: ReactNode;
};

const AXIS_STYLE = '#444';
const GRID_STYLE = 'rgba(0,0,0,0.08)';
const TICK_STYLE = 'rgba(0,0,0,0.45)';
const LABEL_STYLE = 'rgba(0,0,0,0.72)';

function worldToCanvas(p: Vec2, width: number, height: number, scale: number): Vec2 {
  // Canvas origin is top-left; we want world origin at center.
  return {
    x: width / 2 + p.x * scale,
    y: height / 2 - p.y * scale,
  };
}

function drawAxes(ctx: CanvasRenderingContext2D, width: number, height: number) {
  ctx.save();
  ctx.strokeStyle = AXIS_STYLE;
  ctx.lineWidth = 1;

  // X axis
  ctx.beginPath();
  ctx.moveTo(0, height / 2);
  ctx.lineTo(width, height / 2);
  ctx.stroke();

  // Y axis
  ctx.beginPath();
  ctx.moveTo(width / 2, 0);
  ctx.lineTo(width / 2, height);
  ctx.stroke();

  ctx.restore();
}

function formatTickLabel(value: number): string {
  if (Math.abs(value) < 1e-8) return '0';
  if (Math.abs(value - Math.PI) < 1e-8) return 'π';
  if (Math.abs(value + Math.PI) < 1e-8) return '-π';
  if (Math.abs(value - Math.PI / 2) < 1e-8) return 'π/2';
  if (Math.abs(value + Math.PI / 2) < 1e-8) return '-π/2';
  return Number.isInteger(value) ? String(value) : String(value.toFixed(2));
}

function drawGridAndTicks(ctx: CanvasRenderingContext2D, width: number, height: number, scale: number) {
  const xMin = -width / 2 / scale;
  const xMax = width / 2 / scale;
  const yMin = -height / 2 / scale;
  const yMax = height / 2 / scale;

  const xIntMin = Math.ceil(xMin);
  const xIntMax = Math.floor(xMax);
  const yIntMin = Math.ceil(yMin);
  const yIntMax = Math.floor(yMax);

  ctx.save();
  ctx.strokeStyle = GRID_STYLE;
  ctx.lineWidth = 1;

  for (let x = xIntMin; x <= xIntMax; x++) {
    const px = width / 2 + x * scale;
    ctx.beginPath();
    ctx.moveTo(px, 0);
    ctx.lineTo(px, height);
    ctx.stroke();
  }

  for (let y = yIntMin; y <= yIntMax; y++) {
    const py = height / 2 - y * scale;
    ctx.beginPath();
    ctx.moveTo(0, py);
    ctx.lineTo(width, py);
    ctx.stroke();
  }

  ctx.strokeStyle = TICK_STYLE;
  const tickSize = 4;
  const axisX = width / 2;
  const axisY = height / 2;

  for (let x = xIntMin; x <= xIntMax; x++) {
    const px = axisX + x * scale;
    ctx.beginPath();
    ctx.moveTo(px, axisY - tickSize);
    ctx.lineTo(px, axisY + tickSize);
    ctx.stroke();
  }

  for (let y = yIntMin; y <= yIntMax; y++) {
    const py = axisY - y * scale;
    ctx.beginPath();
    ctx.moveTo(axisX - tickSize, py);
    ctx.lineTo(axisX + tickSize, py);
    ctx.stroke();
  }

  ctx.fillStyle = LABEL_STYLE;
  ctx.font = '11px ui-sans-serif, system-ui, -apple-system, Segoe UI';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';

  // Integer labels near axes for quick position reading.
  for (const x of [xIntMin, -1, 0, 1, xIntMax]) {
    if (x < xIntMin || x > xIntMax) continue;
    const px = axisX + x * scale;
    ctx.fillText(formatTickLabel(x), px, axisY + tickSize + 3);
  }

  ctx.textAlign = 'right';
  ctx.textBaseline = 'middle';
  for (const y of [yIntMin, -1, 0, 1, yIntMax]) {
    if (y < yIntMin || y > yIntMax) continue;
    const py = axisY - y * scale;
    ctx.fillText(formatTickLabel(y), axisX - tickSize - 3, py);
  }

  // Trig landmarks for sine-style levels.
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  const specialX = [-Math.PI, -Math.PI / 2, Math.PI / 2, Math.PI];
  for (const x of specialX) {
    if (x < xMin || x > xMax) continue;
    const px = axisX + x * scale;
    // Draw explicit special-value ticks so labels are anchored to visible marks.
    ctx.beginPath();
    ctx.moveTo(px, axisY - tickSize - 2);
    ctx.lineTo(px, axisY + tickSize + 2);
    ctx.stroke();
    ctx.fillText(formatTickLabel(x), px, axisY + tickSize + 16);
  }

  ctx.restore();
}

function drawSegments(
  ctx: CanvasRenderingContext2D,
  segments: ReadonlyArray<GraphSegment>,
  width: number,
  height: number,
  scale: number
) {
  ctx.beginPath();
  for (const segment of segments) {
    if (segment.length === 0) continue;
    const first = worldToCanvas(segment[0]!, width, height, scale);
    ctx.moveTo(first.x, first.y);
    for (let i = 1; i < segment.length; i++) {
      const p = worldToCanvas(segment[i]!, width, height, scale);
      ctx.lineTo(p.x, p.y);
    }
  }
  ctx.stroke();
}

export default function Graph({ width, height, scale, plots, children }: GraphProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  const firstError = useMemo(() => {
    for (const plot of plots) {
      if (plot.error) return plot.error;
    }
    return undefined;
  }, [plots]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = window.devicePixelRatio ?? 1;

    // Scale the backing store for crisp lines.
    canvas.width = Math.floor(width * dpr);
    canvas.height = Math.floor(height * dpr);
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    let raf = requestAnimationFrame(() => {
      ctx.clearRect(0, 0, width, height);
      drawGridAndTicks(ctx, width, height, scale);
      drawAxes(ctx, width, height);

      for (const plot of plots) {
        if (plot.error) continue;
        ctx.save();
        ctx.strokeStyle = plot.strokeStyle ?? '#0b5fff';
        ctx.lineWidth = plot.lineWidth ?? 2;
        drawSegments(ctx, plot.segments, width, height, scale);
        ctx.restore();
      }
    });

    return () => cancelAnimationFrame(raf);
  }, [width, height, scale, plots]);

  return (
    <div style={{ display: 'grid', gap: 8 }}>
      {firstError ? (
        <div
          role="alert"
          style={{
            padding: '8px 10px',
            border: '1px solid rgba(0,0,0,0.15)',
            background: 'rgba(255,0,0,0.06)',
            fontSize: 12,
          }}
        >
          {firstError}
        </div>
      ) : null}

      <div
        style={{
          position: 'relative',
          width,
          height,
          border: '1px solid rgba(0,0,0,0.15)',
          borderRadius: 6,
          overflow: 'hidden',
        }}
      >
        <canvas
          ref={canvasRef}
          style={{
            position: 'absolute',
            inset: 0,
            display: 'block',
          }}
        />
        {children}
      </div>
    </div>
  );
}
