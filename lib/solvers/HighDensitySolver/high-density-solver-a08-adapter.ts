import {
  HighDensitySolverA08,
  type HighDensityIntraNodeRoute as A08Route,
} from "@tscircuit/high-density-a01"
import type { GraphicsObject } from "graphics-debug"
import type {
  HighDensityIntraNodeRoute,
  NodeWithPortPoints,
  PortPoint,
} from "lib/types/high-density-types"
import type { Obstacle } from "lib/types/srj-types"
import { BaseSolver } from "../BaseSolver"

type PortPointWithDuplicateMetadata = PortPoint & {
  duplicatedFromPortId?: string
}

export type HighDensitySolverA08IntraNodeAdapterParams = {
  nodeWithPortPoints: NodeWithPortPoints
  traceWidth?: number
  viaDiameter?: number
  clearance?: number
  obstacles?: Obstacle[]
  effort?: number
  minimumPairCount?: number
}

const EPSILON = 1e-8
const MIN_ITERATION_BUDGET = 150_000
const BASE_ITERATION_BUDGET = 2_000_000
const MAX_ITERATION_BUDGET = 12_000_000

const obstacleIntersectsNodeInterior = (
  node: NodeWithPortPoints,
  obstacle: Obstacle,
): boolean => {
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
    Math.min(
      node.center.x + node.width / 2,
      obstacle.center.x + obstacleHalfX,
    ) -
    Math.max(node.center.x - node.width / 2, obstacle.center.x - obstacleHalfX)
  const overlapY =
    Math.min(
      node.center.y + node.height / 2,
      obstacle.center.y + obstacleHalfY,
    ) -
    Math.max(
      node.center.y - node.height / 2,
      obstacle.center.y - obstacleHalfY,
    )
  return overlapX > EPSILON && overlapY > EPSILON
}

const getRootConnectionName = (portPoint: PortPoint): string =>
  portPoint.rootConnectionName ?? portPoint.connectionName

const haveSameCoordinates = (
  a: { x: number; y: number; z: number },
  b: { x: number; y: number; z: number },
): boolean =>
  Math.abs(a.x - b.x) <= EPSILON &&
  Math.abs(a.y - b.y) <= EPSILON &&
  Math.abs(a.z - b.z) <= EPSILON

const endpointDescription = (portPoint: PortPoint): string =>
  `"${portPoint.portPointId}" (${portPoint.x}, ${portPoint.y}, ${portPoint.z})`

export class HighDensitySolverA08IntraNodeAdapter extends BaseSolver {
  override getSolverName(): string {
    return "HighDensitySolverA08"
  }

  readonly constructorParams: HighDensitySolverA08IntraNodeAdapterParams
  readonly nodeWithPortPoints: NodeWithPortPoints
  readonly upstreamSolver?: HighDensitySolverA08
  solvedRoutes: HighDensityIntraNodeRoute[] = []

  constructor(params: HighDensitySolverA08IntraNodeAdapterParams) {
    super()
    this.constructorParams = params
    this.nodeWithPortPoints = params.nodeWithPortPoints

    if (!HighDensitySolverA08IntraNodeAdapter.isApplicable(params)) {
      this.MAX_ITERATIONS = 1
      return
    }

    const effort = params.effort ?? 1
    this.MAX_ITERATIONS = Math.min(
      MAX_ITERATION_BUDGET,
      Math.max(
        MIN_ITERATION_BUDGET,
        Math.round(BASE_ITERATION_BUDGET * effort),
      ),
    )
    const viaDiameter = params.viaDiameter ?? 0.3
    this.upstreamSolver = new HighDensitySolverA08({
      nodeWithPortPoints: params.nodeWithPortPoints,
      cellSizeMm: 0.1,
      viaDiameter,
      viaMinDistFromBorder: viaDiameter / 2,
      traceMargin: params.clearance ?? 0.1,
      traceThickness: params.traceWidth ?? 0.15,
      effort,
      hyperParameters: { shuffleSeed: 0 },
    })

    // A08 defaults to a 100M iteration ceiling. Keep its entire pipeline,
    // including sub-solvers created later, within the portfolio-sized budget.
    this.upstreamSolver.MAX_ITERATIONS = this.MAX_ITERATIONS
  }

  static isApplicable(
    params: HighDensitySolverA08IntraNodeAdapterParams,
  ): boolean {
    const node = params.nodeWithPortPoints
    const pairs = node.portPointsInPairs
    if (!pairs || pairs.length < (params.minimumPairCount ?? 2)) return false

    if (
      (params.obstacles ?? []).some((obstacle) =>
        obstacleIntersectsNodeInterior(node, obstacle),
      )
    ) {
      return false
    }

    // A08 groups terminals by port identity/root. Shared identities can make
    // it select a representative terminal and silently lose a breakout.
    const portPointsById = new Map<string, PortPoint>()
    const occupiedLocations = new Set<string>()
    const portPointsByConnection = new Map<string, PortPoint[]>()
    for (const portPoint of node.portPoints) {
      const portPointId = portPoint.portPointId
      if (
        !portPointId ||
        portPointsById.has(portPointId) ||
        (portPoint as PortPointWithDuplicateMetadata).duplicatedFromPortId ||
        (!portPoint.rootConnectionName &&
          /_mst\d+$/.test(portPoint.connectionName))
      ) {
        return false
      }
      portPointsById.set(portPointId, portPoint)

      const locationKey = `${portPoint.x}|${portPoint.y}|${portPoint.z}`
      if (occupiedLocations.has(locationKey)) return false
      occupiedLocations.add(locationKey)

      const connectionPortPoints =
        portPointsByConnection.get(portPoint.connectionName) ?? []
      connectionPortPoints.push(portPoint)
      portPointsByConnection.set(
        portPoint.connectionName,
        connectionPortPoints,
      )
    }

    // The adapter can only reconstruct an explicit pair when A08's implicit
    // per-connection pairing is unambiguous.
    if (
      node.portPoints.length !== pairs.length * 2 ||
      portPointsByConnection.size !== pairs.length ||
      [...portPointsByConnection.values()].some(
        (connectionPortPoints) => connectionPortPoints.length !== 2,
      )
    ) {
      return false
    }

    const pairedConnections = new Set<string>()
    for (const [start, end] of pairs) {
      if (
        (start as PortPointWithDuplicateMetadata).duplicatedFromPortId ||
        (end as PortPointWithDuplicateMetadata).duplicatedFromPortId ||
        !start.portPointId ||
        !end.portPointId ||
        (!start.rootConnectionName && /_mst\d+$/.test(start.connectionName)) ||
        (!end.rootConnectionName && /_mst\d+$/.test(end.connectionName)) ||
        start.connectionName !== end.connectionName ||
        getRootConnectionName(start) !== getRootConnectionName(end) ||
        pairedConnections.has(start.connectionName)
      ) {
        return false
      }

      const connectionPortPoints = portPointsByConnection.get(
        start.connectionName,
      )
      const nodeStart = portPointsById.get(start.portPointId)
      const nodeEnd = portPointsById.get(end.portPointId)
      if (!connectionPortPoints || !nodeStart || !nodeEnd) return false

      const connectionPortPointIds = new Set(
        connectionPortPoints.map((portPoint) => portPoint.portPointId),
      )
      if (
        connectionPortPointIds.size !== 2 ||
        !connectionPortPointIds.has(start.portPointId) ||
        !connectionPortPointIds.has(end.portPointId) ||
        nodeStart.connectionName !== start.connectionName ||
        nodeEnd.connectionName !== end.connectionName ||
        getRootConnectionName(nodeStart) !== getRootConnectionName(start) ||
        getRootConnectionName(nodeEnd) !== getRootConnectionName(end) ||
        !haveSameCoordinates(nodeStart, start) ||
        !haveSameCoordinates(nodeEnd, end)
      ) {
        return false
      }

      pairedConnections.add(start.connectionName)
    }

    return pairedConnections.size === portPointsByConnection.size
  }

  override getConstructorParams(): [
    HighDensitySolverA08IntraNodeAdapterParams,
  ] {
    return [this.constructorParams]
  }

  getOutput(): HighDensityIntraNodeRoute[] {
    return this.solvedRoutes
  }

  computeProgress(): number {
    if (this.solved) return 1
    return this.upstreamSolver?.progress ?? 0
  }

  override _step(): void {
    if (!this.upstreamSolver) {
      this.failed = true
      this.error = "HighDensitySolverA08 is not structurally applicable"
      return
    }

    this.upstreamSolver.step()
    this.activeSubSolver = this.upstreamSolver.activeSubSolver as any
    this.stats = this.upstreamSolver.stats

    if (this.upstreamSolver.failed) {
      this.failed = true
      this.error = `HighDensitySolverA08 failed: ${this.upstreamSolver.error ?? "unknown error"}`
      return
    }

    if (this.upstreamSolver.solved) {
      this.solvedRoutes = this.restoreAndValidateMetadata(
        this.upstreamSolver.getOutput(),
      )
      this.solved = true
    }
  }

  private restoreAndValidateMetadata(
    routes: A08Route[],
  ): HighDensityIntraNodeRoute[] {
    const pairs = this.nodeWithPortPoints.portPointsInPairs!
    if (routes.length !== pairs.length) {
      throw new Error(
        `HighDensitySolverA08 returned ${routes.length} routes for ${pairs.length} explicit pairs`,
      )
    }

    const routesByConnection = new Map<string, A08Route>()
    for (const route of routes) {
      if (routesByConnection.has(route.connectionName)) {
        throw new Error(
          `HighDensitySolverA08 returned multiple routes for "${route.connectionName}"`,
        )
      }
      routesByConnection.set(route.connectionName, route)
    }

    return pairs.map(([expectedStart, expectedEnd]) => {
      const connectionName = expectedStart.connectionName
      const rootConnectionName = getRootConnectionName(expectedStart)
      const route = routesByConnection.get(connectionName)
      if (!route) {
        throw new Error(
          `HighDensitySolverA08 omitted connection "${connectionName}"`,
        )
      }
      if (
        route.rootConnectionName !== rootConnectionName ||
        route.regionId !== this.nodeWithPortPoints.capacityMeshNodeId
      ) {
        throw new Error(
          `HighDensitySolverA08 returned unexpected route metadata for "${connectionName}"`,
        )
      }

      const firstPoint = route.route[0]
      const lastPoint = route.route.at(-1)
      if (!firstPoint || !lastPoint) {
        throw new Error(
          `HighDensitySolverA08 returned an empty route for "${connectionName}"`,
        )
      }

      const isForward =
        firstPoint.portPointId === expectedStart.portPointId &&
        lastPoint.portPointId === expectedEnd.portPointId
      const isReverse =
        firstPoint.portPointId === expectedEnd.portPointId &&
        lastPoint.portPointId === expectedStart.portPointId
      if (!isForward && !isReverse) {
        throw new Error(
          `HighDensitySolverA08 returned unexpected endpoint identities for "${connectionName}": "${firstPoint.portPointId}" -> "${lastPoint.portPointId}"`,
        )
      }

      const routePoints = (isReverse
        ? [...route.route].reverse()
        : [...route.route]
      ).map((point) => ({ ...point }))
      const restoredFirstPoint = routePoints[0]!
      const restoredLastPoint = routePoints.at(-1)!
      if (!haveSameCoordinates(restoredFirstPoint, expectedStart)) {
        throw new Error(
          `HighDensitySolverA08 moved start endpoint ${endpointDescription(expectedStart)} for "${connectionName}"`,
        )
      }
      if (!haveSameCoordinates(restoredLastPoint, expectedEnd)) {
        throw new Error(
          `HighDensitySolverA08 moved end endpoint ${endpointDescription(expectedEnd)} for "${connectionName}"`,
        )
      }

      Object.assign(restoredFirstPoint, {
        portPointId: expectedStart.portPointId,
        pcb_port_id: expectedStart.pcb_port_id,
      })
      Object.assign(restoredLastPoint, {
        portPointId: expectedEnd.portPointId,
        pcb_port_id: expectedEnd.pcb_port_id,
      })

      return {
        ...route,
        connectionName,
        rootConnectionName,
        regionId: this.nodeWithPortPoints.capacityMeshNodeId,
        startPcbPortId: expectedStart.pcb_port_id,
        endPcbPortId: expectedEnd.pcb_port_id,
        route: routePoints,
        vias: route.vias.map((via) => ({ ...via })),
      }
    })
  }

  override visualize(): GraphicsObject {
    return this.upstreamSolver?.visualize() ?? super.visualize()
  }
}
