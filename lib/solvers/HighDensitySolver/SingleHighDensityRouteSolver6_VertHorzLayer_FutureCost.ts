import * as bindings from "../../../rust/capacity-autorouter-bindings/pkg/capacity_autorouter_bindings.js"
import type { Node } from "lib/data-structures/SingleRouteCandidatePriorityQueue"
import { SingleHighDensityRouteSolver, type SingleRouteOptions } from "./SingleHighDensityRouteSolver"

type Point = { x: number; y: number; z: number }
export type FutureConnectionSegment = { connectionName: string; start: Point; end: Point }

export class SingleHighDensityRouteSolver6_VertHorzLayer_FutureCost extends SingleHighDensityRouteSolver {
  declare FUTURE_CONNECTION_PROX_TRACE_PENALTY_FACTOR: number
  declare FUTURE_CONNECTION_PROX_VIA_PENALTY_FACTOR: number
  declare FUTURE_CONNECTION_PROXIMITY_VD: number
  declare MISALIGNED_DIST_PENALTY_FACTOR: number
  declare VIA_PENALTY_FACTOR_2: number
  declare FLIP_TRACE_ALIGNMENT_DIRECTION: boolean
  declare FUTURE_CONNECTION_VIA_TRACE_CLEARANCE: number
  declare futureConnectionPoints: Point[]
  futureConnectionSegmentsCache: FutureConnectionSegment[] | null = null

  constructor(opts: SingleRouteOptions, existingBinding?: bindings.SingleHighDensityRouteSolver) {
    super(opts, true, existingBinding)
    this.futureConnectionPoints = this.futureConnections.flatMap((connection) => connection.points)
  }

  getClosestFutureConnectionPoint(node: Node): Point | null {
    this.configure()
    const index = this.binding.closestFuturePointIndex(node)
    return index === undefined ? null : this.futureConnectionPoints[index]!
  }

  getFutureConnectionSegments(): FutureConnectionSegment[] {
    if (!this.futureConnectionSegmentsCache) {
      this.configure()
      this.futureConnectionSegmentsCache = this.binding.getFutureConnectionSegments()
    }
    return this.futureConnectionSegmentsCache
  }

  isViaTooCloseToFutureConnectionTrace(node: Node): boolean {
    this.configure()
    return this.binding.isViaTooCloseToFutureConnectionTrace(node)
  }
  diminishCloseToGoal(node: Node): number {
    this.configure()
    return this.binding.diminishCloseToGoal(node)
  }
  getFutureConnectionPenalty(node: Node, isVia: boolean): number {
    this.configure()
    return this.binding.getFutureConnectionPenalty(node, isVia)
  }
}
