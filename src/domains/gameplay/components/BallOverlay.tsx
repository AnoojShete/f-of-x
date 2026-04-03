import { useEffect, useRef } from 'react';
import type { Vec2 } from '../../../shared/types';
import { worldToCanvas } from '../../../shared/geometry/curveGeometry';

export type BallOverlayProps = {
  width: number;
  height: number;
  scale: number;
  ballPosition: Vec2;
  tangent?: Vec2;
  isOnCurve?: boolean;
  cameraCenter?: Vec2;

  /** Ball radius in pixels */
  radiusPx?: number;

  /** Fill color */
  fillStyle?: string;

  /** Rolling angle in radians. */
  rotationRad?: number;
};

export default function BallOverlay({
  width,
  height,
  scale,
  ballPosition,
  tangent = { x: 1, y: 0 },
  isOnCurve = false,
  cameraCenter = { x: 0, y: 0 },
  radiusPx = 6,
  fillStyle = '#ff2d55',
  rotationRad = 0,
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

    let renderWorld = ballPosition;
    if (isOnCurve) {
      const tanLength = Math.hypot(tangent.x, tangent.y);
      if (tanLength > 1e-8 && Number.isFinite(tanLength)) {
        const tx = tangent.x / tanLength;
        const ty = tangent.y / tanLength;

        // Left-hand normal in world-space.
        let nx = -ty;
        let ny = tx;

        // Force normal to point upward in world-space.
        if (ny < 0) {
          nx = -nx;
          ny = -ny;
        }

        const offsetWorld = radiusPx / Math.max(1e-6, scale);
        renderWorld = {
          x: ballPosition.x + nx * offsetWorld,
          y: ballPosition.y + ny * offsetWorld,
        };
      }
    }

    const canvasPoint = worldToCanvas(renderWorld, width, height, scale, cameraCenter);
    ctx.clearRect(0, 0, width, height);

    ctx.fillStyle = fillStyle;
    ctx.beginPath();
    ctx.arc(canvasPoint.x, canvasPoint.y, radiusPx, 0, Math.PI * 2);
    ctx.fill();

    ctx.save();
    ctx.translate(canvasPoint.x, canvasPoint.y);
    ctx.rotate(rotationRad);
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.9)';
    ctx.lineWidth = 2;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(-radiusPx * 0.75, 0);
    ctx.lineTo(radiusPx * 0.75, 0);
    ctx.stroke();
    ctx.restore();

    ctx.strokeStyle = 'rgba(0,0,0,0.25)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(canvasPoint.x, canvasPoint.y, radiusPx, 0, Math.PI * 2);
    ctx.stroke();

    return () => {};
  }, [
    width,
    height,
    ballPosition,
    tangent,
    isOnCurve,
    radiusPx,
    fillStyle,
    rotationRad,
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
