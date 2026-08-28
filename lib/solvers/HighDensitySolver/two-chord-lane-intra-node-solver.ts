import {
  findRouteGeometryViolations,
  type HighDensityIntraNodeRoute as B01HighDensityIntraNodeRoute,
} from "@tscircuit/high-density-b01"
import type {
  HighDensityIntraNodeRoute,
  NodeWithPortPoints,
  PortPoint,
} from "lib/types/high-density-types"
import type { Obstacle } from "lib/types/srj-types"
import { BaseSolver } from "../BaseSolver"
import { findIntraNodePhysicalConflicts } from "./find-intra-node-physical-conflicts"

type Side = "left" | "right" | "bottom" | "top"
type Bounds = {
  minX: number
  maxX: number
  minY: number
  maxY: number
}
type PortPair = [PortPoint, PortPoint]
type ChordPairIndices = {
  vertical: number
  lateral: number
}

export type TwoChordLaneSolverStats = {
  applicable: boolean
  candidateLaneCount: number
  candidateValidationCount: number
  selectedLane: "left" | "right" | null
  routeCount: number
  viaCount: number
}

export type TwoChordLaneIntraNodeSolverParams = {
  nodeWithPortPoints: NodeWithPortPoints
  traceWidth?: number
  viaDiameter?: number
  clearance?: number
  obstacles?: Obstacle[]
}

const EPSILON = 1e-8
const BOUNDARY_TOLERANCE = 1e-6
const LANE_INSET_EPSILON = 1e-6

const getBounds = (node: NodeWithPortPoints): Bounds => ({
  minX: node.center.x - node.width / 2,
  maxX: node.center.x + node.width / 2,
  minY: node.center.y - node.height / 2,
  maxY: node.center.y + node.height / 2,
})

const getRootConnectionName = (point: PortPoint): string =>
  point.rootConnectionName ?? point.connectionName

const endpointKey = (point: {
  x: number
  y: number
  z: number
  portPointId?: string
}): string => `${point.portPointId ?? ""}|${point.x},${point.y},${point.z}`

const getBoundarySide = (
  node: NodeWithPortPoints,
  point: PortPoint,
): Side | null => {
  const bounds = getBounds(node)
  if (
    point.x < bounds.minX - BOUNDARY_TOLERANCE ||
    point.x > bounds.maxX + BOUNDARY_TOLERANCE ||
    point.y < bounds.minY - BOUNDARY_TOLERANCE ||
    point.y > bounds.maxY + BOUNDARY_TOLERANCE
  ) {
    return null
  }

  const matchingSides: Side[] = []
  if (Math.abs(point.x - bounds.minX) <= BOUNDARY_TOLERANCE) {
    matchingSides.push("left")
  }
  if (Math.abs(point.x - bounds.maxX) <= BOUNDARY_TOLERANCE) {
    matchingSides.push("right")
  }
  if (Math.abs(point.y - bounds.minY) <= BOUNDARY_TOLERANCE) {
    matchingSides.push("bottom")
  }
  if (Math.abs(point.y - bounds.maxY) <= BOUNDARY_TOLERANCE) {
    matchingSides.push("top")
  }
  return matchingSides.length === 1 ? matchingSides[0]! : null
}

const getChordPairIndices = (
  node: NodeWithPortPoints,
  pairs: PortPair[],
): ChordPairIndices | null => {
  const sides = pairs.map(([start, end]) => [
    getBoundarySide(node, start),
    getBoundarySide(node, end),
  ])
  if (sides.some((pairSides) => pairSides.some((side) => side === null))) {
    return null
  }

  const vertical = sides.findIndex(
    (pairSides) => pairSides.includes("top") && pairSides.includes("bottom"),
  )
  const lateral = sides.findIndex(
    (pairSides) => pairSides.includes("left") && pairSides.includes("right"),
  )
  if (vertical < 0 || lateral < 0 || vertical === lateral) return null
  return { vertical, lateral }
}

const obstacleIntersectsNodeInterior = (
  node: NodeWithPortPoints,
  obstacle: Obstacle,
): boolean => {
  const bounds = getBounds(node)
  const radians = ((obstacle.ccwRotationDegrees ?? 0) * Math.PI) / 180
  const halfWidth = obstacle.width / 2
  const halfHeight = obstacle.height / 2
  const obstacleHalfX =
    Math.abs(Math.cos(radians)) * halfWidth +
    Math.abs(Math.sin(radians)) * halfHeight
  const obstacleHalfY =
    Math.abs(Math.sin(radians)) * halfWidth +
    Math.abs(Math.cos(radians)) * halfHeight
  const overlapX =
    Math.min(bounds.maxX, obstacle.center.x + obstacleHalfX) -
    Math.max(bounds.minX, obstacle.center.x - obstacleHalfX)
  const overlapY =
    Math.min(bounds.maxY, obstacle.center.y + obstacleHalfY) -
    Math.max(bounds.minY, obstacle.center.y - obstacleHalfY)
  return overlapX > EPSILON && overlapY > EPSILON
}

/**
 * Solves the exact two-chord lane topology found in narrow physical-capacity
 * nodes: one top-to-bottom chord crosses one left-to-right chord. The lateral
 * chord remains direct while the vertical chord changes layer at two legal
 * edge lanes. No grown or approximate geometry is accepted.
 */
export class TwoChordLaneIntraNodeSolver extends BaseSolver {
  override getSolverName(): string {
    return "TwoChordLaneIntraNodeSolver"
  }

  readonly constructorParams: TwoChordLaneIntraNodeSolverParams
  readonly nodeWithPortPoints: NodeWithPortPoints
  readonly traceWidth: number
  readonly viaDiameter: number
  readonly clearance: number
  readonly obstacles: Obstacle[]
  solvedRoutes: HighDensityIntraNodeRoute[] = []

  constructor(params: TwoChordLaneIntraNodeSolverParams) {
    super()
    this.constructorParams = params
    this.nodeWithPortPoints = params.nodeWithPortPoints
    this.traceWidth = params.traceWidth ?? 0.15
    this.viaDiameter = params.viaDiameter ?? 0.3
    this.clearance = params.clearance ?? 0.1
    this.obstacles = params.obstacles ?? []
    this.MAX_ITERATIONS = 1
  }

  static isApplicable(params: TwoChordLaneIntraNodeSolverParams): boolean {
    const node = params.nodeWithPortPoints
    const pairs = node.portPointsInPairs
    const availableZ = [...new Set(node.availableZ ?? [])]
    const traceWidth = params.traceWidth ?? 0.15
    const viaDiameter = params.viaDiameter ?? 0.3
    const clearance = params.clearance ?? 0.1
    if (!pairs || pairs.length !== 2 || node.portPoints.length !== 4) {
      return false
    }
    if (
      availableZ.length < 2 ||
      availableZ.length > 4 ||
      traceWidth <= 0 ||
      viaDiameter <= 0 ||
      clearance < 0 ||
      node.width + EPSILON < viaDiameter + 2 * LANE_INSET_EPSILON ||
      node.height + EPSILON < viaDiameter + 2 * LANE_INSET_EPSILON
    ) {
      return false
    }

    const availableZSet = new Set(availableZ)
    for (const [start, end] of pairs) {
      if (
        start.connectionName !== end.connectionName ||
        getRootConnectionName(start) !== getRootConnectionName(end) ||
        start.z !== end.z ||
        !availableZSet.has(start.z) ||
        start.duplicatedFromPortId ||
        end.duplicatedFromPortId ||
        endpointKey(start) === endpointKey(end)
      ) {
        return false
      }
    }
    if (
      pairs[0]![0].z !== pairs[1]![0].z ||
      getRootConnectionName(pairs[0]![0]) ===
        getRootConnectionName(pairs[1]![0]) ||
      !getChordPairIndices(node, pairs)
    ) {
      return false
    }

    const terminalPoints = pairs.flat()
    for (let indexA = 0; indexA < terminalPoints.length; indexA += 1) {
      const pointA = terminalPoints[indexA]!
      for (
        let indexB = indexA + 1;
        indexB < terminalPoints.length;
        indexB += 1
      ) {
        const pointB = terminalPoints[indexB]!
        if (getRootConnectionName(pointA) === getRootConnectionName(pointB)) {
          continue
        }
        if (
          Math.hypot(pointA.x - pointB.x, pointA.y - pointB.y) + EPSILON <
          traceWidth + clearance
        ) {
          return false
        }
      }
    }

    return !(params.obstacles ?? []).some((obstacle) =>
      obstacleIntersectsNodeInterior(node, obstacle),
    )
  }

  override getConstructorParams(): [TwoChordLaneIntraNodeSolverParams] {
    return [this.constructorParams]
  }

  getOutput(): HighDensityIntraNodeRoute[] {
    return this.solvedRoutes
  }

  computeProgress(): number {
    return this.solved ? 1 : 0
  }

  override _step(): void {
    if (!TwoChordLaneIntraNodeSolver.isApplicable(this.constructorParams)) {
      this.fail(
        "Two-chord lane solver is not structurally applicable",
        false,
        0,
      )
      return
    }

    const pairs = this.nodeWithPortPoints.portPointsInPairs!
    const pairIndices = getChordPairIndices(this.nodeWithPortPoints, pairs)!
    const verticalPair = pairs[pairIndices.vertical]!
    const lateralPair = pairs[pairIndices.lateral]!
    const terminalZ = verticalPair[0].z
    const routingZ = [...new Set(this.nodeWithPortPoints.availableZ!)]
      .sort((a, b) => a - b)
      .find((z) => z !== terminalZ)!
    const bounds = getBounds(this.nodeWithPortPoints)
    const viaInset = this.viaDiameter / 2 + LANE_INSET_EPSILON
    const verticalStartSide = getBoundarySide(
      this.nodeWithPortPoints,
      verticalPair[0],
    )!
    const lateralRoute = this.createDirectRoute(lateralPair)
    const candidateLanes = [
      { name: "right" as const, x: bounds.maxX - viaInset },
      { name: "left" as const, x: bounds.minX + viaInset },
    ]

    let candidateValidationCount = 0
    for (const lane of candidateLanes) {
      candidateValidationCount += 1
      const topVia = { x: lane.x, y: bounds.maxY - viaInset }
      const bottomVia = { x: lane.x, y: bounds.minY + viaInset }
      const startVia = verticalStartSide === "top" ? topVia : bottomVia
      const endVia = verticalStartSide === "top" ? bottomVia : topVia
      const verticalRoute = this.createLayerChangedRoute(
        verticalPair,
        startVia,
        endVia,
        routingZ,
      )
      const candidateRoutes = pairs.map((_, pairIndex) =>
        pairIndex === pairIndices.vertical ? verticalRoute : lateralRoute,
      )
      if (!this.acceptValidatedRoutes(candidateRoutes, pairs)) continue
      this.updateStats(
        true,
        candidateLanes.length,
        candidateValidationCount,
        lane.name,
      )
      return
    }

    this.fail(
      "Two-chord lane solver found no exact conflict-free lane",
      true,
      candidateValidationCount,
    )
  }

  private createDirectRoute(pair: PortPair): HighDensityIntraNodeRoute {
    const [start, end] = pair
    return {
      connectionName: start.connectionName,
      rootConnectionName: getRootConnectionName(start),
      startPcbPortId: start.pcb_port_id,
      endPcbPortId: end.pcb_port_id,
      regionId: this.nodeWithPortPoints.capacityMeshNodeId,
      traceThickness: this.traceWidth,
      viaDiameter: this.viaDiameter,
      route: [start, end],
      vias: [],
    }
  }

  private createLayerChangedRoute(
    pair: PortPair,
    startVia: { x: number; y: number },
    endVia: { x: number; y: number },
    routingZ: number,
  ): HighDensityIntraNodeRoute {
    const [start, end] = pair
    return {
      connectionName: start.connectionName,
      rootConnectionName: getRootConnectionName(start),
      startPcbPortId: start.pcb_port_id,
      endPcbPortId: end.pcb_port_id,
      regionId: this.nodeWithPortPoints.capacityMeshNodeId,
      traceThickness: this.traceWidth,
      viaDiameter: this.viaDiameter,
      route: [
        start,
        { ...startVia, z: start.z },
        { ...startVia, z: routingZ },
        { ...endVia, z: routingZ },
        { ...endVia, z: end.z },
        end,
      ],
      vias: [startVia, endVia],
    }
  }

  private acceptValidatedRoutes(
    routes: HighDensityIntraNodeRoute[],
    pairs: PortPair[],
  ): boolean {
    if (routes.length !== pairs.length) return false
    for (let pairIndex = 0; pairIndex < pairs.length; pairIndex += 1) {
      const [expectedStart, expectedEnd] = pairs[pairIndex]!
      const route = routes[pairIndex]!
      if (
        route.connectionName !== expectedStart.connectionName ||
        (route.rootConnectionName ?? route.connectionName) !==
          getRootConnectionName(expectedStart) ||
        route.regionId !== this.nodeWithPortPoints.capacityMeshNodeId ||
        route.startPcbPortId !== expectedStart.pcb_port_id ||
        route.endPcbPortId !== expectedEnd.pcb_port_id ||
        endpointKey(route.route[0]!) !== endpointKey(expectedStart) ||
        endpointKey(route.route.at(-1)!) !== endpointKey(expectedEnd) ||
        !this.isRouteStructurallyValid(route)
      ) {
        return false
      }
    }
    if (
      findRouteGeometryViolations(routes as B01HighDensityIntraNodeRoute[])
        .length > 0 ||
      findIntraNodePhysicalConflicts(routes, this.clearance).length > 0
    ) {
      return false
    }
    this.solvedRoutes = routes
    this.solved = true
    this.failed = false
    this.error = null
    return true
  }

  private isRouteStructurallyValid(route: HighDensityIntraNodeRoute): boolean {
    const bounds = getBounds(this.nodeWithPortPoints)
    const availableZ = new Set(this.nodeWithPortPoints.availableZ ?? [])
    if (
      route.route.length < 2 ||
      route.traceThickness !== this.traceWidth ||
      route.viaDiameter !== this.viaDiameter
    ) {
      return false
    }
    for (const point of route.route) {
      if (
        !Number.isFinite(point.x) ||
        !Number.isFinite(point.y) ||
        !Number.isFinite(point.z) ||
        !availableZ.has(point.z) ||
        point.x < bounds.minX - EPSILON ||
        point.x > bounds.maxX + EPSILON ||
        point.y < bounds.minY - EPSILON ||
        point.y > bounds.maxY + EPSILON
      ) {
        return false
      }
    }

    const transitionKeys: string[] = []
    for (let pointIndex = 1; pointIndex < route.route.length; pointIndex += 1) {
      const previous = route.route[pointIndex - 1]!
      const point = route.route[pointIndex]!
      if (previous.z === point.z) continue
      if (
        Math.abs(previous.x - point.x) > EPSILON ||
        Math.abs(previous.y - point.y) > EPSILON
      ) {
        return false
      }
      transitionKeys.push(`${point.x},${point.y}`)
    }
    const viaKeys = route.vias.map((via) => `${via.x},${via.y}`)
    transitionKeys.sort()
    viaKeys.sort()
    if (
      transitionKeys.length !== viaKeys.length ||
      transitionKeys.some((key, index) => key !== viaKeys[index])
    ) {
      return false
    }

    const viaRadius = route.viaDiameter / 2
    return route.vias.every(
      (via) =>
        Number.isFinite(via.x) &&
        Number.isFinite(via.y) &&
        via.x >= bounds.minX + viaRadius - EPSILON &&
        via.x <= bounds.maxX - viaRadius + EPSILON &&
        via.y >= bounds.minY + viaRadius - EPSILON &&
        via.y <= bounds.maxY - viaRadius + EPSILON,
    )
  }

  private fail(
    message: string,
    applicable: boolean,
    candidateValidationCount: number,
  ): void {
    this.solved = false
    this.failed = true
    this.error = message
    this.updateStats(
      applicable,
      applicable ? 2 : 0,
      candidateValidationCount,
      null,
    )
  }

  private updateStats(
    applicable: boolean,
    candidateLaneCount: number,
    candidateValidationCount: number,
    selectedLane: "left" | "right" | null,
  ): void {
    this.stats = {
      applicable,
      candidateLaneCount,
      candidateValidationCount,
      selectedLane,
      routeCount: this.solvedRoutes.length,
      viaCount: this.solvedRoutes.reduce(
        (total, route) => total + route.vias.length,
        0,
      ),
    } satisfies TwoChordLaneSolverStats
  }
}
