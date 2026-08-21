export interface MHPoint {
  x: number;
  y: number;
  // If a via, z1 is the layer of the start point, z2 is the layer of the end
  // point
  // If not a via, z1 and z2 are the same
  z1: number;
  z2: number;
}

export interface PolyLine {
  connectionName: string;
  start: MHPoint;
  end: MHPoint;
  mPoints: MHPoint[];
}

export interface Candidate {
  polyLines: PolyLine[];
  g: number;
  h: number;
  f: number;
  minGaps: number[];
  // Store forces applied TO mPoints, keyed by a string identifying the source
  // e.g., "via:lineIdx:pointIdx", "seg:lineIdx:p1Idx:p2Idx"
  forces?: Array<Array<Map<string, { fx: number; fy: number }>>>;
  viaCount: number;
  magForceApplied?: number;

  // Temporary/optional for debugging early candidate elimination
  hasClosedSameLayerFace?: boolean;
}
