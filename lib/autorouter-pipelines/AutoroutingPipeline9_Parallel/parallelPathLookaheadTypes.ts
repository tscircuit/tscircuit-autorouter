import type { NativeSourceAliasProvenance } from "./nativeSourceAliasProvenance"
import type { HighDensityRoute } from "../../types/high-density-types"
import type { ParallelPathWaveContext } from "./parallelStageWorkerTypes"

export type ParallelPathQueryPoint = { x: number; y: number; z: number }
export type ParallelPathQueryObservation = {
  start: ParallelPathQueryPoint
  end: ParallelPathQueryPoint
  valid: boolean
  /** A fixed obstacle independently returned the same native false predicate. */
  immutableObstacleFailure: boolean
}
export type ParallelPathQueryFootprint = {
  complete: boolean
  queries: ParallelPathQueryObservation[]
  nativeQueryCount: number
  obstacleWitnessTests: number
}

/** Only committed earlier routes appear in updates; every other peer is original. */
export type ParallelPathLookaheadJob = {
  kind: "simplifyPathLookahead"
  contextId: number
  context?: ParallelPathWaveContext
  index: number
  committedPrefix: number
  updates: Array<{ index: number; route: HighDensityRoute }>
  cancellationBuffer: SharedArrayBuffer
  nativePhaseStepLimit: number
}
export type ParallelPathLookaheadResult = {
  kind: "simplifyPathLookahead"
  contextId: number
  index: number
  committedPrefix: number
  nativeSteps: number
  nativeQueryCount: number
  obstacleWitnessTests: number
} & (
  | { status: "prepared"; route: HighDensityRoute; footprint: ParallelPathQueryFootprint; sourceAliases: NativeSourceAliasProvenance }
  | { status: "algorithmError"; error: string }
  | { status: "cancelled" }
)

export type ParallelPathCertificateStats = {
  nativeFilterConstructors: number
  nativeFilterSegments: number
  nativeFilterVias: number
  lineBucketTests: number
  lineDistanceTests: number
  viaDistanceTests: number
}
export type ParallelPathQueryCertificate = {
  certified: boolean
  stats: ParallelPathCertificateStats
  /** A native certificate query must be replayed at its actual ordered position. */
  nativeQueryError?: boolean
}
