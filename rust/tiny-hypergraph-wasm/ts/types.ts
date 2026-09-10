export type IntegerArray = readonly number[] | Int32Array
export type FloatArray = readonly number[] | Float64Array
export type SectionMask = IntegerArray | Int8Array

export interface TinyHyperGraphTopology {
  portCount: number
  regionCount: number
  regionIncidentPorts: readonly (readonly number[])[]
  incidentPortRegion: readonly (readonly number[])[]
  regionWidth: FloatArray
  regionHeight: FloatArray
  regionCenterX: FloatArray
  regionCenterY: FloatArray
  regionAvailableZMask?: IntegerArray
  regionMetadata?: readonly unknown[]
  portAngleForRegion1: IntegerArray
  portAngleForRegion2?: IntegerArray
  portX: FloatArray
  portY: FloatArray
  portZ: IntegerArray
  portMetadata?: readonly unknown[]
}

export interface TinyHyperGraphInitialAssignment {
  routeId: number
  regionId: number
  fromPortId: number
  toPortId: number
}

export interface TinyHyperGraphProblem {
  routeCount: number
  portSectionMask: SectionMask
  routeMetadata?: readonly unknown[]
  routeStartPort: IntegerArray
  routeEndPort: IntegerArray
  routeNet: IntegerArray
  regionNetId: IntegerArray
  portPenalty?: FloatArray
  initialAssignments?: readonly TinyHyperGraphInitialAssignment[]
}

export interface TinyHyperGraphStatus {
  solved: boolean
  failed: boolean
  error: string | null
  iterations: number
  pendingRouteCount: number
  ripCount: number
}

export interface TinyHyperGraphRoutingSnapshot {
  portAssignment: number[]
  regionSegments: [routeId: number, fromPortId: number, toPortId: number][][]
  currentRouteId: number | undefined
  unroutedRoutes: number[]
}

export type TinyHyperGraphStats = Record<string, unknown>

export interface TinyHyperGraphSolverOptions {
  minViaPadDiameter?: number
  DISTANCE_TO_COST?: number
  RIP_THRESHOLD_START?: number
  RIP_THRESHOLD_END?: number
  RIP_THRESHOLD_RAMP_ATTEMPTS?: number
  RIP_CONGESTION_REGION_COST_FACTOR?: number
  USE_LAZY_ROUTE_HEURISTIC?: boolean
  USE_SPARSE_CANDIDATE_STORAGE?: boolean
  MAX_ITERATIONS?: number
  VERBOSE?: boolean
  STATIC_REACHABILITY_PRECHECK?: boolean
  STATIC_REACHABILITY_PRECHECK_MAX_HOPS?: number
  ACCEPT_BEST_SOLUTION_ON_TIMEOUT?: boolean
  GREEDY_FINAL_ROUTE_ITERS?: number
  PARTIAL_RIP_ENABLED?: boolean
  PARTIAL_RIP_MIN_ROUTE_COUNT?: number
  PARTIAL_RIP_MAX_ROUTE_COUNT?: number
  PARTIAL_RIP_MAX_DISTANCE?: number
  PARTIAL_RIP_QUALITY_MAX_DISTANCE?: number
  PARTIAL_RIP_MAX_ATTEMPTS?: number
  PARTIAL_RIP_WARMUP_FULL_RIP_ATTEMPTS?: number
  PARTIAL_RIP_COMPLEXITY_SELECTION_MIN_ROUTE_COUNT?: number
  PARTIAL_RIP_TARGET_MAX_COST_IMPROVEMENT_RATIO?: number
  PARTIAL_RIP_MAX_REGION_COST_GROWTH_RATIO?: number
  PARTIAL_RIP_MAX_TOTAL_COST_GROWTH_RATIO?: number
  OUTSIDE_IN_ROUTING?: boolean
  OUTSIDE_IN_MAX_DISTANCE?: number
}
