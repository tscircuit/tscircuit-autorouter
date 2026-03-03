import type { Point } from "polyanya"

export interface PolyanyaPathResult {
  connectionName: string
  path: Point[]
  cost: number
}

export interface Crossing {
  pathIndexA: number
  pathIndexB: number
  segIndexA: number
  segIndexB: number
  point: Point
  angle: number
}

export interface Bundle {
  pathIndices: number[]
  direction: Point
  perpendicular: Point
  crossings: Crossing[]
}

export interface ResolvedPath {
  connectionName: string
  route: Array<{ x: number; y: number; z: number }>
  vias: Array<{ x: number; y: number }>
}
