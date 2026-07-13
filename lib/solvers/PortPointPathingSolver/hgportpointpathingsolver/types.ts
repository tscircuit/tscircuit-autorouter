import type {
  Candidate,
  Connection,
  HyperGraph,
  Region,
  RegionPort,
  RegionPortAssignment,
  SolvedRoute,
} from "@tscircuit/hypergraph"

import type {
  CapacityMeshNode,
  CapacityMeshNodeId,
  SimpleRouteConnection,
} from "lib/types"

export type RawPort = {
  portId: string
  x: number
  y: number
  z: number
  distToCentermostPortOnZ: number
  cramped?: boolean
  regions: RegionHg[]
  tinyHypergraphPortPenalty?: number
  /** Physical prefab endpoint adjacent to this port before endpoints are collapsed. */
  offBoardEndpointCapacityMeshNodeId?: CapacityMeshNodeId
}

export type RegionPortHg = Omit<RegionPort, "d" | "port"> & {
  d: RawPort
}

export type RegionHg = Omit<Region, "d" | "assignments" | "ports"> & {
  d: CapacityMeshNode
  assignments?: RegionPortAssignmentHg[]
  ports: RegionPortHg[]
}

export type HyperGraphHg = Omit<HyperGraph, "ports" | "regions"> & {
  ports: RegionPortHg[]
  regions: RegionHg[]
}

export type ConnectionHg = Omit<Connection, "startRegion" | "endRegion"> & {
  startRegion: RegionHg
  endRegion: RegionHg
  simpleRouteConnection?: SimpleRouteConnection
}

export type CandidateHg = Omit<
  Candidate,
  "port" | "parent" | "lastPort" | "lastRegion" | "nextRegion"
> & {
  port: RegionPortHg
  parent?: CandidateHg
  lastPort?: RegionPortHg
  lastRegion?: RegionHg
  nextRegion?: RegionHg
  ripRequired: boolean
}

export type SolvedRoutesHg = Omit<SolvedRoute, "path" | "connection"> & {
  path: CandidateHg[]
  connection: ConnectionHg
}

export type RegionPortAssignmentHg = Omit<
  RegionPortAssignment,
  "regionPort1" | "regionPort2" | "region" | "connection" | "solvedRoute"
> & {
  regionPort1: RegionPortHg
  regionPort2: RegionPortHg
  region: RegionHg
  connection: ConnectionHg
  solvedRoute: SolvedRoutesHg
}

export type RegionId = CapacityMeshNodeId
export type RegionMemoryPfMap = Map<RegionId, number>
export type RegionRipCountMap = Map<RegionId, number>

export interface HgPortPointPathingSolverParams {
  graph: HyperGraphHg
  connections: ConnectionHg[]
  colorMap?: Record<string, string>
  inputSolvedRoutes?: SolvedRoutesHg[]
  layerCount: number
  effort: number
  minViaPadDiameter?: number
  flags: {
    FORCE_CENTER_FIRST: boolean
    RIPPING_ENABLED: boolean
    USE_SELECTIVE_RERIP_ROUTING?: boolean
    MAX_OFF_BOARD_CONNECTIONS_PER_PATH?: number
    /** Connections that must traverse one prefab/off-board region. */
    FORCE_OFF_BOARD_CONNECTION_NAMES?: string[]
    /** Use an admissible region-hop heuristic instead of geometric distance. */
    USE_TOPOLOGY_ONLY_HEURISTIC?: boolean
    /** Never commit a physical intersection; conflicting routes must be ripped. */
    ALWAYS_RIP_INTERSECTIONS?: boolean
    /** Treat same-net chord intersections as conflicts instead of junctions. */
    ALWAYS_RIP_SAME_NET_INTERSECTIONS?: boolean
  }
  weights: {
    /** Seed used for deterministic shuffling in rip-selection ordering. */
    SHUFFLE_SEED: number
    /** Multiplier for center-offset penalty in heuristic h (larger = prefer centermost ports). */
    CENTER_OFFSET_DIST_PENALTY_FACTOR: number
    /** Center-offset amount ignored before penalty starts in heuristic h. */
    CENTER_OFFSET_FOCUS_SHIFT: number
    /** A* greediness factor: f = g + GREEDY_MULTIPLIER * h. */
    GREEDY_MULTIPLIER: number
    /** Scales exact Pf-delta step cost in g (higher = stronger congestion avoidance). */
    NODE_PF_FACTOR: number
    /** Flat added cost when transition changes layer (z differs). */
    LAYER_CHANGE_COST: number
    /** Cost associated with ripping a region due to Pf threshold. */
    RIPPING_PF_COST: number
    /** Maximum cap applied to Pf-derived costs to avoid explosive scores. */
    NODE_PF_MAX_PENALTY: number
    /** Scales memory-Pf contribution in heuristic h (bias away from historically bad regions). */
    MEMORY_PF_FACTOR: number
    /** Base geometric transition multiplier used by auxiliary step penalties. */
    BASE_CANDIDATE_COST: number
    /** Uniform cost per hypergraph transition; independent of XY distance. */
    TOPOLOGY_STEP_COST?: number
    /** Topology-hop A* ordering cost; independent of XY distance. */
    TOPOLOGY_HEURISTIC_COST?: number
    /** Fixed cost per different-net chord intersection in a physical region. */
    CROSSING_PENALTY?: number
    /** Negotiated-congestion cost each time the same two routes conflict. */
    CONFLICT_HISTORY_COST?: number
    /** Cost per prior rip at a port; breaks repeated rip-and-reroute cycles. */
    RIP_HISTORY_COST?: number
    /** Soft board-score guard for candidate filtering; more negative allows riskier paths. */
    MIN_ALLOWED_BOARD_SCORE: number
    /** Per-connection candidate queue cap (0 means use default queue size). */
    MAX_ITERATIONS_PER_PATH: number
    /** Distance threshold where heuristic is suppressed to encourage initial exploration. */
    RANDOM_WALK_DISTANCE: number
    /** Initial region Pf threshold for ripping decisions. */
    START_RIPPING_PF_THRESHOLD: number
    /** Final region Pf threshold as region rip-count approaches its cap. */
    END_RIPPING_PF_THRESHOLD: number
    /** Global limit for total rip operations in one solve run. */
    MAX_RIPS: number
    /** Fraction of extra random rips added when ripping is triggered. */
    RANDOM_RIP_FRACTION: number
    /** Multiplier for straight-line deviation penalty in heuristic h. */
    STRAIGHT_LINE_DEVIATION_PENALTY_FACTOR: number
  }
  opts?: {
    regionMemoryPfMap?: RegionMemoryPfMap
  }
}
