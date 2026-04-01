export type Vec2 = Readonly<{ x: number; y: number }>;

export type GraphSegment = ReadonlyArray<Vec2>;

export type GraphFunction = {
  id: string;
  expression: string;
  strokeStyle?: string;
  lineWidth?: number;
};

// A render-ready plot: evaluated + sampled into polyline segments.
export type GraphPlot = GraphFunction & {
  segments: ReadonlyArray<GraphSegment>;
  error?: string;
};

export type Goal = Readonly<{ x: number; y: number }>;

export type Star = Readonly<{ id: string; x: number; y: number }>;

export type LevelRecord = Readonly<{
  id: string;
  type: 'sine' | 'custom';
  start: Vec2;
  goal: Vec2;
  stars: ReadonlyArray<Vec2>;
  solution?: string;
}>;
