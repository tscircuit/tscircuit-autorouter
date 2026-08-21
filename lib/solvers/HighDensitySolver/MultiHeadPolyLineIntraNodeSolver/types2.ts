export interface MHPoint2 {
  x: number;
  y: number;
  // If a via, z1 is the layer of the start point, z2 is the layer of the end
  // point
  // If not a via, z1 and z2 are the same
  z1: number;
  z2: number;
}

export interface PolyLine2 {
  connectionName: string;
  start: MHPoint2;
  end: MHPoint2;
  mPoints: MHPoint2[];
  // Removed hash
}

export interface Candidate2 {
  polyLines: PolyLine2[];
  g: number;
  h: number;
  f: number;
  minGaps: number[];
  viaCount: number;

  magForceApplied?: number;
}
