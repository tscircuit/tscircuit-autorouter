// Adapted from MIT-licensed @tscircuit/repair04, pinned 4273e945.
import type {
  HighDensityRoute,
  SimpleRouteJson,
} from "high-density-repair03/lib"

export type Bounds = SimpleRouteJson["bounds"]
export type RepairRoutePoint = HighDensityRoute["route"][number] & {
  traceThickness?: number
  toNextSegmentCircuitJsonMetadata?: Record<string, unknown>
}

/** Everything the repair algorithm needs; this object contains no full board. */
export type RepairRegionInput = {
  srj: SimpleRouteJson
  routes: HighDensityRoute[]
  bounds: Bounds
  boundaryMargin: number
  lockedPointIndices: boolean[][]
}

export type RepairRoutePosition = { segmentIndex: number; t: number }

/** Kept by the caller, independently of the region passed to the solver. */
export type RepairRegionRouteMapping = {
  sourceRouteIndex: number
  start: RepairRoutePosition
  end: RepairRoutePosition
  /** Source identity, copper widths, local span and vias, for stale checks. */
  sourceGeometryKey: string
  originalFragment: HighDensityRoute
}

export type ExtractedRepairRegion = RepairRegionInput & {
  contextBounds: Bounds
  mutableBounds: Bounds
  routeMappings: RepairRegionRouteMapping[]
}

export type ExtractRepairRegionOptions = {
  srj: SimpleRouteJson
  routes: HighDensityRoute[]
  bounds: Bounds
  /** The immutable collar. Increased when copper widths require more space. */
  boundaryMargin?: number
  /** Fixed geometry loaded around the requested region. */
  clearanceHalo?: number
}

export type MergeRepairRegionOptions = {
  routes: HighDensityRoute[]
  region: ExtractedRepairRegion
  repairedRoutes: HighDensityRoute[]
}
