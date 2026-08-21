export interface GraphicsObject {
  points?: {
    x: number;
    y: number;
    color?: string;
    label?: string;
    layer?: string;
    step?: number;
  }[];
  lines?: {
    points: { x: number; y: number; stroke?: number }[];
    layer?: string;
    step?: number;
    stroke?: string;
  }[];
  rects?: Array<{
    center: { x: number; y: number };
    width: number;
    height: number;
    fill?: string;
    stroke?: string;
    label?: string;
    layer?: string;
    step?: number;
  }>;
  circles?: Array<{
    center: { x: number; y: number };
    radius: number;
    fill?: string;
    stroke?: string;
    layer?: string;
    step?: number;
  }>;
  grid?: { cellSize: number; label?: boolean };
  coordinateSystem?: "cartesian" | "screen";
  title?: string;
}
