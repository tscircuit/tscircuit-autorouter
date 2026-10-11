import type { HighDensityIntraNodeRoute, NodeWithPortPoints } from "../../types/high-density-types"
import type { Pipeline9ParallelHighDensityContext } from "./parallelWorkerTypes"
import type { FirstValidHighDensityStats } from "./parallelHighDensityPolicyTypes"

export type FirstValidA13NodeJob = {
  kind: "highDensityA13Node"
  contextId: number
  context: Pipeline9ParallelHighDensityContext
  nodeWithPortPoints: NodeWithPortPoints
  nodePf: number | null
  cancellationBuffer: SharedArrayBuffer
}
export type FirstValidA13NodeWork = {
  iterations: number
  maxIterations: number
  routingIterations: number
  sourceStats: Record<string, unknown>
}
export type FirstValidA13NodeResult = {
  kind: "highDensityA13Node"
  work: FirstValidA13NodeWork
} & (
  | { status: "solved"; routes: HighDensityIntraNodeRoute[]; nodeStats: Record<string, number>; firstValidStats: FirstValidHighDensityStats }
  | { status: "rejected"; reason: string }
  | { status: "failed"; error: string }
  | { status: "cancelled" }
  | { status: "exception"; exception: { name: string; message: string } }
)
export type FirstValidNodeFrontierStats = {
  pairedNodeCount: number
  loserCancellationSignals: number
  rejectedA13Count: number
  rejectionReasons: Record<string, number>
  winners: Array<{ nodeId: string; source: "generic-native" | "validated-a13"; elapsedTimeMs: number }>
  candidateWork: Array<{ nodeId: string; source: "generic-native" | "validated-a13";
    status: string; iterations?: number; routingIterations?: number; sourceStats: Record<string, unknown> }>
}
