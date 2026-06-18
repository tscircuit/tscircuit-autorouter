import type { SerializedHyperGraph } from "@tscircuit/hypergraph"
import type { BasePipelineSolver } from "@tscircuit/solver-utils"
import type {
  InputNodeWithPortPoints,
  InputPortPoint,
} from "lib/solvers/PortPointPathingSolver/PortPointPathingSolver"
import type { CapacityMeshNodeId } from "lib/types"
import type {
  NodeWithPortPoints,
  PortPoint,
} from "lib/types/high-density-types"
import type {
  TinyHyperGraphSectionPipelineInput,
  TinyHyperGraphSectionSolverOptions,
  TinyHyperGraphSolverOptions,
} from "tiny-hypergraph/lib/index"
import type { HgPortPointPathingSolverParams } from "../../hgportpointpathingsolver/types"

export type RouteMetadata = {
  connectionId: string
  mutuallyConnectedNetworkId?: string
  simpleRouteConnection?: HgPortPointPathingSolverParams["connections"][number]["simpleRouteConnection"]
}

export type SerializedTinyConnection = NonNullable<
  SerializedHyperGraph["connections"]
>[number]

export type SerializedTinySolvedRoute = NonNullable<
  SerializedHyperGraph["solvedRoutes"]
>[number]

export type SimpleRouteConnectionPoint = NonNullable<
  HgPortPointPathingSolverParams["connections"][number]["simpleRouteConnection"]
>["pointsToConnect"][number]

export type TinyBounds = {
  minX: number
  maxX: number
  minY: number
  maxY: number
}

export type TinyRegionMetadata = {
  bounds?: TinyBounds
  _qfpRegionType?: InputNodeWithPortPoints["_qfpRegionType"]
  _isNarrowQfpPadGap?: boolean
  _offBoardConnectionId?: string
}

export type TinyPortMetadata = {
  x?: number
  y?: number
  z?: number
  prevPortPointId?: string
  nextPortPointId?: string
  distToCentermostPortOnZ?: number
  cramped?: boolean
  _tinyTerminal?: boolean
  tinyHypergraphPortPenalty?: number
  duplicatedFromPortId?: string
}

export type SharedConnectionZInput = {
  routeMetadata: RouteMetadata
  endpointIndex: 0 | 1
  fallbackZ: number
  regionAvailableZ: number[]
  layerCount: number
}

export type LoadedTinyGraph = {
  topology: {
    portCount: number
    portMetadata?: TinyPortMetadata[]
    regionMetadata?: Array<TinyRegionMetadata & { _tinyTerminalNetId?: string }>
  }
  problem: {
    routeMetadata?: RouteMetadata[]
    routeNet: Int32Array
    regionNetId: Int32Array
    portPenalty?: Float64Array
    metadataPortPenaltiesApplied?: boolean
  }
}

export type TinyHypergraphPortPointPathingOutput = {
  nodesWithPortPoints: NodeWithPortPoints[]
  inputNodeWithPortPoints: InputNodeWithPortPoints[]
}

export type TinyHypergraphPortPointPathingStats = {
  duplicateCongestedPortSourceCount: number
  duplicateCongestedPortCount: number
  duplicateCongestedPortFallbackToOriginal: boolean
  duplicateCongestedPortPenalty: number
  duplicateCongestedPortError?: string
  duplicateCongestedPortProgress: number
  currentStage: string
  stageStats: ReturnType<BasePipelineSolver<unknown>["getStageStats"]>
} & Record<string, unknown>

export type DuplicateCongestedPortPrepassInput = {
  serializedGraph: SerializedHyperGraph
  effort: number
  minViaPadDiameter?: number
  connectionCount: number
}

export type DuplicateCongestedPortPrepassOutput = {
  graphForTiny: SerializedHyperGraph
  duplicateCongestedPortReport?: import("tiny-hypergraph/lib/index").DuplicateCongestedPortSolverReport
  duplicateCongestedPortError?: string
  duplicatedPortCount: number
}

export type TinyHypergraphSolveStageInput = {
  pathingProblem: HgPortPointPathingSolverParams
  serializedGraph: SerializedHyperGraph
  graphForTiny: SerializedHyperGraph
}

export {
  type CapacityMeshNodeId,
  type HgPortPointPathingSolverParams,
  type InputNodeWithPortPoints,
  type InputPortPoint,
  type NodeWithPortPoints,
  type PortPoint,
  type TinyHyperGraphSectionPipelineInput,
  type TinyHyperGraphSectionSolverOptions,
  type TinyHyperGraphSolverOptions,
}

export const TINY_TERMINAL_REGION_SIZE = 1e-6

export const TINY_SOLVE_GRAPH_BASE_OPTIONS: TinyHyperGraphSolverOptions = {
  DISTANCE_TO_COST: 0.05,
  RIP_THRESHOLD_START: 0.05,
  RIP_THRESHOLD_END: 0.8,
  RIP_CONGESTION_REGION_COST_FACTOR: 0.1,
  ACCEPT_BEST_SOLUTION_ON_TIMEOUT: true,
  GREEDY_FINAL_ROUTE_ITERS: 4,
}

export const TINY_SECTION_SOLVER_BASE_OPTIONS: TinyHyperGraphSectionSolverOptions =
  {
    DISTANCE_TO_COST: 0.05,
    RIP_THRESHOLD_START: 0.05,
    RIP_THRESHOLD_END: 0.8,
    RIP_CONGESTION_REGION_COST_FACTOR: 0.1,
    ACCEPT_BEST_SOLUTION_ON_TIMEOUT: true,
    GREEDY_FINAL_ROUTE_ITERS: 4,
    MAX_RIPS_WITHOUT_MAX_REGION_COST_IMPROVEMENT: 6,
    EXTRA_RIPS_AFTER_BEATING_BASELINE_MAX_REGION_COST:
      Number.POSITIVE_INFINITY,
  }

export const DUPLICATE_PORT_TRAVERSAL_PENALTY = 150
export const CRAMPED_PORT_TRAVERSAL_PENALTY = 150
export const MAX_CONNECTIONS_FOR_DUPLICATE_CONGESTED_PORT_PREPASS = 180
