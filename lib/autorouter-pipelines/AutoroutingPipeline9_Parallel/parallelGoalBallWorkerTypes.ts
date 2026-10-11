import type { TinyLandmarkGraph } from "./TinyLandmarkHeuristic"

export type TinyGoalBallGraph = TinyLandmarkGraph & {
  edgeRegionIds: Int32Array
  regionNetIds: Int32Array
  halfPenalties: Float64Array
}

export type TinyGoalBallGroup = {
  netId: number
  targetPortId: number
  startPortIds: number[]
  usablePorts: Int8Array
}

export type TinyGoalBallBounds = {
  netId: number
  targetPortId: number
  bounds: Float64Array
  cutoff: number
  expandedPortCount: number
  relaxationCount: number
}

export type ParallelGoalBallWorkerJob = {
  kind: "pathingGoalBalls"
  graph: TinyGoalBallGraph
  groups: TinyGoalBallGroup[]
  maximumSettledPorts: number
}

export type ParallelGoalBallWorkerResult = {
  kind: "pathingGoalBalls"
  groups: TinyGoalBallBounds[]
}

export type ParallelGoalBallWorkerPool = {
  run<T>(job: ParallelGoalBallWorkerJob): Promise<T>
}
