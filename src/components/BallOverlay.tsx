import { useEffect, useRef } from 'react';
import type { Vec2 } from '../types';
import { worldToCanvas } from '../utils/curveGeometry';

export type BallOverlayProps = {
  width: number;
  height: number;
  scale: number;
  ballPosition: Vec2;
  cameraCenter?: Vec2;

  /** Ball radius in pixels */
  radiusPx?: number;

  /** Fill color */
  fillStyle?: string;
};

export default function BallOverlay({
  width,
  height,
  scale,
  ballPosition,
  cameraCenter = { x: 0, y: 0 },
  radiusPx = 6,
  fillStyle = '#ff2d55',
}: BallOverlayProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = window.devicePixelRatio ?? 1;
    canvas.width = Math.floor(width * dpr);
    canvas.height = Math.floor(height * dpr);
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const canvasPoint = worldToCanvas(ballPosition, width, height, scale, cameraCenter);
    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = fillStyle;
    ctx.beginPath();
    ctx.arc(canvasPoint.x, canvasPoint.y, radiusPx, 0, Math.PI * 2);
    ctx.fill();

    return () => {};
  }, [
    width,
    height,
    ballPosition,
    radiusPx,
    fillStyle,
    cameraCenter,
  ]);

  return (
    <canvas
      ref={canvasRef}
      style={{
        position: 'absolute',
        inset: 0,
        pointerEvents: 'none',
      }}
    />
  );
}
