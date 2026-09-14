import type { SerializedHyperGraph } from "@tscircuit/hypergraph"
import type {
  TinyHyperGraphTopology,
  TinyHyperGraphProblem,
  TinyHyperGraphSolution,
  TinyHyperGraphSolverOptions,
  TinyHyperGraphRoutingSnapshot,
} from "../../../../rust/tiny-hypergraph-bindings/ts/index"
import type {
  RouteMetadata,
  TinyPortMetadata,
  TinyRegionMetadata,
} from "./TinyHypergraphPortPointPathingSolver"

export type LoadedTinyHypergraph = {
  topology: Omit<TinyHyperGraphTopology, "portMetadata" | "regionMetadata"> & {
    portMetadata?: TinyPortMetadata[]
    regionMetadata?: Array<TinyRegionMetadata & { _tinyTerminalNetId?: string }>
  }
  problem: Omit<
    TinyHyperGraphProblem,
    | "routeMetadata"
    | "routeNet"
    | "regionNetId"
    | "portPenalty"
    | "portSectionMask"
  > & {
    routeMetadata?: RouteMetadata[]
    routeNet: Int32Array
    regionNetId: Int32Array
    portPenalty?: Float64Array
    portSectionMask: Int8Array
    metadataPortPenaltiesApplied?: boolean
  }
  solution: TinyHyperGraphSolution
}

export type TinyHypergraphSolverView = Pick<
  LoadedTinyHypergraph,
  "topology" | "problem"
> & {
  iterations: number
  stats: Record<string, unknown>
  solved: boolean
  failed: boolean
  state: Pick<TinyHyperGraphRoutingSnapshot, "regionSegments">
}

export interface TinyHyperGraphSectionSolverOptions
  extends TinyHyperGraphSolverOptions {
  MAX_RIPS?: number
  MAX_RIPS_WITHOUT_MAX_REGION_COST_IMPROVEMENT?: number
  EXTRA_RIPS_AFTER_BEATING_BASELINE_MAX_REGION_COST?: number
  MAX_HOT_REGIONS?: number
}

export type TinyHypergraphRoutingInput = {
  serializedHyperGraph: SerializedHyperGraph
  solveGraphOptions?: TinyHyperGraphSolverOptions
  sectionSolverOptions?: TinyHyperGraphSectionSolverOptions
}

export type TinyHyperGraphSectionPipelineInput = TinyHypergraphRoutingInput

export type TinyHypergraphPolicyCounts = {
  duplicatePortPenaltyCount: number
  metadataPortPenaltyCount: number
  crampedPortPenaltyCount: number
  preloadedPortCount: number
  preloadedFixedSegmentCount: number
  crampedPortTraversalPenalty: number
}
