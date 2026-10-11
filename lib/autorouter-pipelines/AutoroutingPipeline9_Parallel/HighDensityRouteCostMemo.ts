import { distance } from "@tscircuit/math-utils"
import type { Node } from "../../data-structures/SingleRouteCandidatePriorityQueue"
import { SingleHighDensityRouteSolver } from "../../solvers/HighDensitySolver/SingleHighDensityRouteSolver"
import { SingleHighDensityRouteSolver6_VertHorzLayer_FutureCost } from "../../solvers/HighDensitySolver/SingleHighDensityRouteSolver6_VertHorzLayer_FutureCost"

type GridSolver = SingleHighDensityRouteSolver6_VertHorzLayer_FutureCost
type FuturePoint = GridSolver["futureConnectionPoints"][number]

const ROW_COUNT = 512
const COORDINATE_COLUMNS = 6
const VALUE_COLUMNS = 4
const GOAL_VALID = 1
const PLANAR_PENALTY_VALID = 2
const VIA_PENALTY_VALID = 4
const nativeCosts = SingleHighDensityRouteSolver6_VertHorzLayer_FutureCost.prototype.setNodeCosts
const nativePenalty = SingleHighDensityRouteSolver6_VertHorzLayer_FutureCost.prototype.getFutureConnectionPenalty
const nativeClosest = SingleHighDensityRouteSolver6_VertHorzLayer_FutureCost.prototype.getClosestFutureConnectionPoint
const nativeViaObstacle = SingleHighDensityRouteSolver6_VertHorzLayer_FutureCost.prototype.isNodeTooCloseToObstacle
const nativeFutureTraceObstacle = SingleHighDensityRouteSolver6_VertHorzLayer_FutureCost.prototype.isViaTooCloseToFutureConnectionTrace
const nativeFutureSegments = SingleHighDensityRouteSolver6_VertHorzLayer_FutureCost.prototype.getFutureConnectionSegments
const nativeNodeKey = SingleHighDensityRouteSolver.prototype.getNodeKey
const nativeComputeF = SingleHighDensityRouteSolver.prototype.computeF
const nativeNeighborQuery = SingleHighDensityRouteSolver.prototype.getPlanarNeighborObstacleQuery
const nativePlanarQuery = SingleHighDensityRouteSolver.prototype.getPlanarObstacleQuery
const nativeEdgeObstacle = SingleHighDensityRouteSolver.prototype.isNodeTooCloseToEdge
const nativeParentObstacle = SingleHighDensityRouteSolver.prototype.doesPathToParentIntersectObstacle
const nativeBaseObstacle = SingleHighDensityRouteSolver.prototype.isNodeTooCloseToObstacle
const nativeViasInPath = SingleHighDensityRouteSolver.prototype.getViasInNodePath
const nativeViaDistanceGetter = Object.getOwnPropertyDescriptor(
  SingleHighDensityRouteSolver.prototype, "viaPenaltyDistance",
)!.get

function hasNativeViaDistanceGetter(solver: GridSolver): boolean {
  let object: object | null = solver
  while (object) {
    const descriptor = Object.getOwnPropertyDescriptor(object, "viaPenaltyDistance")
    if (descriptor) return descriptor.get === nativeViaDistanceGetter
    object = Object.getPrototypeOf(object)
  }
  return false
}

function hasNativeCostPolicy(
  solver: GridSolver,
  expectedCosts: GridSolver["setNodeCosts"],
): boolean {
  return solver.setNodeCosts === expectedCosts &&
    solver.getFutureConnectionPenalty === nativePenalty &&
    solver.getClosestFutureConnectionPoint === nativeClosest &&
    solver.getNodeKey === nativeNodeKey &&
    solver.computeF === nativeComputeF &&
    solver.getPlanarNeighborObstacleQuery === nativeNeighborQuery &&
    solver.getPlanarObstacleQuery === nativePlanarQuery &&
    solver.isNodeTooCloseToObstacle === nativeViaObstacle &&
    solver.isViaTooCloseToFutureConnectionTrace === nativeFutureTraceObstacle &&
    solver.getFutureConnectionSegments === nativeFutureSegments &&
    solver.getViasInNodePath === nativeViasInPath &&
    SingleHighDensityRouteSolver.prototype.isNodeTooCloseToObstacle === nativeBaseObstacle &&
    solver.isNodeTooCloseToEdge === nativeEdgeObstacle &&
    solver.doesPathToParentIntersectObstacle === nativeParentObstacle &&
    hasNativeViaDistanceGetter(solver)
}

/** Bounded scalar math storage; native closest-point cache effects remain live. */
export class HighDensityRouteCostMemo {
  private readonly coordinates = new Float64Array(ROW_COUNT * COORDINATE_COLUMNS)
  private readonly values = new Float64Array(ROW_COUNT * VALUE_COLUMNS)
  private readonly validity = new Uint8Array(ROW_COUNT)
  private readonly closestPoints: (FuturePoint | null | undefined)[] = new Array(ROW_COUNT)
  private readonly configuration = new Float64Array(9)
  private hasConfiguration = false
  private inNeighborBatch = false
  private memoEnabled = false
  private readonly wrappedCosts: GridSolver["setNodeCosts"]

  constructor(private readonly solver: GridSolver) {
    if (!hasNativeCostPolicy(solver, nativeCosts)) {
      throw new Error("High-density cost memo requires the native cost policy")
    }
    this.wrappedCosts = this.calculateCosts.bind(this)
    solver.setNodeCosts = this.wrappedCosts
  }

  beginNeighborBatch(): void {
    // Native neighbor predicates do not mutate the numeric cost policy.
    // Recheck public callbacks before sharing one configuration for the batch.
    this.inNeighborBatch = true
    this.memoEnabled = hasNativeCostPolicy(this.solver, this.wrappedCosts)
    if (this.memoEnabled) this.validateConfiguration()
  }

  endNeighborBatch(): void {
    this.inNeighborBatch = false
    // Direct public cost calls perform their own policy and geometry check.
    // A throwing neighbor callback must not leave that check disabled.
    this.memoEnabled = false
  }

  setNodeCosts(node: Node, pointKey: number): void {
    if (this.solver.setNodeCosts !== this.wrappedCosts) {
      this.solver.setNodeCosts(node)
      return
    }
    this.calculateCosts(node, pointKey)
  }

  private validateConfiguration(): void {
    const solver = this.solver
    const config = this.configuration
    const goalX = solver.B.x, goalY = solver.B.y, goalZ = solver.B.z
    const viaDistance = solver.viaPenaltyDistance
    const straightDistance = solver.straightLineDistance
    const diameter = solver.viaDiameter
    const proximity = solver.FUTURE_CONNECTION_PROXIMITY_VD
    const traceFactor = solver.FUTURE_CONNECTION_PROX_TRACE_PENALTY_FACTOR
    const viaFactor = solver.FUTURE_CONNECTION_PROX_VIA_PENALTY_FACTOR
    if (
      this.hasConfiguration &&
      Object.is(config[0], goalX) && Object.is(config[1], goalY) &&
      Object.is(config[2], goalZ) && Object.is(config[3], viaDistance) &&
      Object.is(config[4], straightDistance) && Object.is(config[5], diameter) &&
      Object.is(config[6], proximity) && Object.is(config[7], traceFactor) &&
      Object.is(config[8], viaFactor)
    ) return
    this.validity.fill(0)
    config[0] = goalX
    config[1] = goalY
    config[2] = goalZ
    config[3] = viaDistance
    config[4] = straightDistance
    config[5] = diameter
    config[6] = proximity
    config[7] = traceFactor
    config[8] = viaFactor
    this.hasConfiguration = true
  }

  private calculateCosts(node: Node, knownPointKey?: number): void {
    const solver = this.solver
    if (!this.inNeighborBatch) {
      this.memoEnabled = hasNativeCostPolicy(solver, this.wrappedCosts)
      if (this.memoEnabled) this.validateConfiguration()
    }
    if (!this.memoEnabled) {
      nativeCosts.call(solver, node)
      return
    }
    const dx = Math.abs(node.x - node.parent!.x)
    const dy = Math.abs(node.y - node.parent!.y)
    const dist = Math.sqrt(dx ** 2 + dy ** 2)
    const isEvenLayer = node.z % 2 === 0
    const misalignedDist = !solver.FLIP_TRACE_ALIGNMENT_DIRECTION
      ? isEvenLayer ? dy : dx
      : isEvenLayer ? dx : dy
    const baseG =
      (node.parent?.g ?? 0) +
      (node.z === node.parent?.z ? 0 : solver.viaPenaltyDistance) +
      dist + misalignedDist * solver.MISALIGNED_DIST_PENALTY_FACTOR
    const isVia = node.z !== node.parent?.z
    const pointKey = knownPointKey === undefined ? solver.getNodeKey(node) : knownPointKey
    const slot = Number.isSafeInteger(pointKey) ? Math.abs(pointKey % ROW_COUNT) : -1
    const coordinateIndex = slot * COORDINATE_COLUMNS
    const valueIndex = slot * VALUE_COLUMNS
    const coordinates = this.coordinates
    const values = this.values
    let valid = slot >= 0 ? this.validity[slot]! : 0
    // A selector or point read may throw after some numeric columns are written.
    // Publish validity only after the entire row calculation succeeds.
    if (slot >= 0) this.validity[slot] = 0
    if (valid && (
      !Object.is(coordinates[coordinateIndex], node.x) ||
      !Object.is(coordinates[coordinateIndex + 1], node.y) ||
      !Object.is(coordinates[coordinateIndex + 2], node.z)
    )) valid = 0
    let goalDistance: number
    let baseH: number
    if (valid & GOAL_VALID) {
      goalDistance = values[valueIndex]!
      baseH = values[valueIndex + 1]!
    } else {
      goalDistance = distance(node, solver.B)
      const goalDist = goalDistance ** 1.6
      baseH = goalDist + (node.z !== solver.B.z ? solver.viaPenaltyDistance : 0)
      if (slot >= 0) {
        coordinates[coordinateIndex] = node.x
        coordinates[coordinateIndex + 1] = node.y
        coordinates[coordinateIndex + 2] = node.z
        values[valueIndex] = goalDistance
        values[valueIndex + 1] = baseH
        valid = GOAL_VALID
      }
    }
    // Preserve every native selector call, including its bounded cache writes
    // and evictions. In-place point edits can leave that selection sticky.
    const closest = solver.getClosestFutureConnectionPoint(node)
    if (slot >= 0 && (
      this.closestPoints[slot] !== closest ||
      (closest && (
        !Object.is(coordinates[coordinateIndex + 3], closest.x) ||
        !Object.is(coordinates[coordinateIndex + 4], closest.y) ||
        !Object.is(coordinates[coordinateIndex + 5], closest.z)
      ))
    )) {
      valid &= GOAL_VALID
      this.closestPoints[slot] = closest
      if (closest) {
        coordinates[coordinateIndex + 3] = closest.x
        coordinates[coordinateIndex + 4] = closest.y
        coordinates[coordinateIndex + 5] = closest.z
      }
    }
    const penaltyValidity = isVia ? VIA_PENALTY_VALID : PLANAR_PENALTY_VALID
    const penaltyIndex = valueIndex + (isVia ? 3 : 2)
    let penalty: number
    if (valid & penaltyValidity) {
      penalty = values[penaltyIndex]!
    } else {
      penalty = 0
      if (closest) {
        const distanceToFuturePoint = distance(node, closest)
        if (!(goalDistance <= distanceToFuturePoint)) {
          const maxDistance = solver.viaDiameter * solver.FUTURE_CONNECTION_PROXIMITY_VD
          const distanceRatio = distanceToFuturePoint / maxDistance
          const maxPenalty = isVia
            ? solver.straightLineDistance * solver.FUTURE_CONNECTION_PROX_VIA_PENALTY_FACTOR
            : solver.straightLineDistance * solver.FUTURE_CONNECTION_PROX_TRACE_PENALTY_FACTOR
          penalty = maxPenalty * Math.exp(-distanceRatio * 5)
        }
      }
      if (slot >= 0) {
        values[penaltyIndex] = penalty
        valid |= penaltyValidity
      }
    }
    if (slot >= 0) this.validity[slot] = valid
    node.g = baseG + penalty
    node.h = baseH + penalty
    node.f = solver.computeF(node.g, node.h)
  }
}

/** Custom cost or neighbor callbacks retain the original public method path. */
export function createHighDensityRouteCostMemo(solver: GridSolver): HighDensityRouteCostMemo | null {
  if (!hasNativeCostPolicy(solver, nativeCosts)) return null
  const memo = new HighDensityRouteCostMemo(solver)
  // Storage is owned by one route child and never retains scratch candidates.
  // Exact coordinate checks distinguish aliases of rounded numeric grid keys.
  return memo
}
