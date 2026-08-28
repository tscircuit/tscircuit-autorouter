import {
  defaultB02Params,
  HighDensitySolverB02,
  type HighDensityIntraNodeRoute as B02Route,
  type HighDensitySolverB02Props,
  type NodeWithPortPoints as B02NodeWithPortPoints,
  type PortPoint as B02PortPoint,
} from "@tscircuit/high-density-b01"
import type { GraphicsObject } from "graphics-debug"
import type {
  HighDensityIntraNodeRoute,
  NodeWithPortPoints,
  PortPoint,
} from "lib/types/high-density-types"
import type { Obstacle } from "lib/types/srj-types"
import { BaseSolver } from "../BaseSolver"

type PortPair = [PortPoint, PortPoint]

type PreparedPair = {
  originalPair: PortPair
  startPortPointId: string
  endPortPointId: string
}

type PreparedB02Input = {
  nodeWithPortPoints: B02NodeWithPortPoints
  pairs: PreparedPair[]
}

export type HighDensitySolverB02IntraNodeAdapterParams = {
  nodeWithPortPoints: NodeWithPortPoints
  traceWidth?: number
  viaDiameter?: number
  clearance?: number
  obstacles?: Obstacle[]
  effort?: number
}

const EPSILON = 1e-8

const createPreparedB02Input = (
  node: NodeWithPortPoints,
): PreparedB02Input => {
  const originalPairs = node.portPointsInPairs ?? []
  const preparedPairs: PreparedPair[] = []
  const preparedPortPoints: B02PortPoint[] = []

  for (let pairIndex = 0; pairIndex < originalPairs.length; pairIndex += 1) {
    const originalPair = originalPairs[pairIndex]!
    const [start, end] = originalPair
    const startPortPointId = `${start.portPointId ?? "port"}|b02|${pairIndex}|0`
    const endPortPointId = `${end.portPointId ?? "port"}|b02|${pairIndex}|1`
    preparedPairs.push({
      originalPair,
      startPortPointId,
      endPortPointId,
    })
    preparedPortPoints.push(
      {
        ...start,
        portPointId: startPortPointId,
        prevPortPointId: undefined,
        nextPortPointId: endPortPointId,
      },
      {
        ...end,
        portPointId: endPortPointId,
        prevPortPointId: startPortPointId,
        nextPortPointId: undefined,
      },
    )
  }

  return {
    nodeWithPortPoints: {
      capacityMeshNodeId: node.capacityMeshNodeId,
      center: { ...node.center },
      width: node.width,
      height: node.height,
      availableZ: node.availableZ ? [...node.availableZ] : undefined,
      portPoints: preparedPortPoints,
    },
    pairs: preparedPairs,
  }
}

const getPreparedRouteKey = (
  connectionName: string,
  startPortPointId: string,
  endPortPointId: string,
): string => {
  const endpointIds = [startPortPointId, endPortPointId].sort()
  return `${connectionName}|${endpointIds[0]}|${endpointIds[1]}`
}

const getRouteKey = (route: B02Route): string => {
  const startPortPointId = route.route[0]?.portPointId
  const endPortPointId = route.route.at(-1)?.portPointId
  if (!startPortPointId || !endPortPointId) {
    throw new Error(
      `HighDensitySolverB02 omitted endpoint identity for "${route.connectionName}"`,
    )
  }
  return getPreparedRouteKey(
    route.connectionName,
    startPortPointId,
    endPortPointId,
  )
}

const obstacleIntersectsNodeInterior = (
  node: NodeWithPortPoints,
  obstacle: Obstacle,
): boolean => {
  const nodeMinX = node.center.x - node.width / 2
  const nodeMaxX = node.center.x + node.width / 2
  const nodeMinY = node.center.y - node.height / 2
  const nodeMaxY = node.center.y + node.height / 2
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
    Math.min(nodeMaxX, obstacle.center.x + obstacleHalfX) -
    Math.max(nodeMinX, obstacle.center.x - obstacleHalfX)
  const overlapY =
    Math.min(nodeMaxY, obstacle.center.y + obstacleHalfY) -
    Math.max(nodeMinY, obstacle.center.y - obstacleHalfY)
  return overlapX > EPSILON && overlapY > EPSILON
}

/**
 * Adapts autorouter's explicit pair and terminal metadata to package-native
 * B02 input, then restores that metadata on the validated B02 output.
 */
export class HighDensitySolverB02IntraNodeAdapter extends BaseSolver {
  override getSolverName(): string {
    return "HighDensitySolverB02"
  }

  readonly constructorParams: HighDensitySolverB02IntraNodeAdapterParams
  readonly nodeWithPortPoints: NodeWithPortPoints
  readonly preparedInput: PreparedB02Input
  solvedRoutes: HighDensityIntraNodeRoute[] = []
  upstreamSolver?: HighDensitySolverB02

  constructor(params: HighDensitySolverB02IntraNodeAdapterParams) {
    super()
    this.constructorParams = params
    this.nodeWithPortPoints = params.nodeWithPortPoints
    this.preparedInput = createPreparedB02Input(params.nodeWithPortPoints)
    this.MAX_ITERATIONS = 1
  }

  static isApplicable(
    params: HighDensitySolverB02IntraNodeAdapterParams,
  ): boolean {
    const pairs = params.nodeWithPortPoints.portPointsInPairs
    if (!pairs || pairs.length === 0) return false
    if (
      pairs.some(([start, end]) =>
        Boolean(start.duplicatedFromPortId || end.duplicatedFromPortId),
      )
    ) {
      return false
    }
    if (
      (params.obstacles ?? []).some((obstacle) =>
        obstacleIntersectsNodeInterior(params.nodeWithPortPoints, obstacle),
      )
    ) {
      return false
    }

    const preparedInput = createPreparedB02Input(params.nodeWithPortPoints)
    return HighDensitySolverB02.isApplicable(
      this.createUpstreamProps(params, preparedInput.nodeWithPortPoints),
    )
  }

  override getConstructorParams(): [
    HighDensitySolverB02IntraNodeAdapterParams,
  ] {
    return [this.constructorParams]
  }

  getOutput(): HighDensityIntraNodeRoute[] {
    return this.solvedRoutes
  }

  computeProgress(): number {
    return this.solved ? 1 : 0
  }

  override _step(): void {
    if (
      !HighDensitySolverB02IntraNodeAdapter.isApplicable(
        this.constructorParams,
      )
    ) {
      this.fail("HighDensitySolverB02 is not structurally applicable")
      return
    }

    this.upstreamSolver = new HighDensitySolverB02(
      HighDensitySolverB02IntraNodeAdapter.createUpstreamProps(
        this.constructorParams,
        this.preparedInput.nodeWithPortPoints,
      ),
    )
    this.upstreamSolver.solve()
    this.stats = this.upstreamSolver.stats
    if (!this.upstreamSolver.solved) {
      this.fail(
        `HighDensitySolverB02 failed: ${this.upstreamSolver.error ?? "unknown error"}`,
      )
      return
    }

    this.solvedRoutes = this.restoreAutorouterRouteMetadata(
      this.upstreamSolver.getOutput(),
    )
    this.solved = true
    this.failed = false
  }

  private static createUpstreamProps(
    params: HighDensitySolverB02IntraNodeAdapterParams,
    nodeWithPortPoints: B02NodeWithPortPoints,
  ): HighDensitySolverB02Props {
    const clearance = params.clearance ?? 0.1
    const viaDiameter = params.viaDiameter ?? 0.3
    return {
      ...defaultB02Params,
      nodeWithPortPoints,
      // The applicability gate rejects every board obstacle that intersects
      // this node. Non-intersecting board-wide obstacles cannot constrain its
      // intra-node geometry, leaving the obstacle-free local problem B02
      // requires.
      obstacles: [],
      traceThickness: params.traceWidth ?? 0.15,
      traceMargin: clearance,
      obstacleClearanceMargin: clearance,
      viaDiameter,
      viaMinDistFromBorder: viaDiameter / 2,
      effort: params.effort ?? 1,
    }
  }

  private restoreAutorouterRouteMetadata(
    upstreamRoutes: B02Route[],
  ): HighDensityIntraNodeRoute[] {
    const routesByKey = new Map<string, B02Route>()
    for (const route of upstreamRoutes) {
      const key = getRouteKey(route)
      if (routesByKey.has(key)) {
        throw new Error(`HighDensitySolverB02 returned duplicate pair "${key}"`)
      }
      routesByKey.set(key, route)
    }
    if (routesByKey.size !== this.preparedInput.pairs.length) {
      throw new Error(
        `HighDensitySolverB02 returned ${routesByKey.size} routes for ${this.preparedInput.pairs.length} explicit pairs`,
      )
    }

    return this.preparedInput.pairs.map((preparedPair) => {
      const [expectedStart, expectedEnd] = preparedPair.originalPair
      const key = getPreparedRouteKey(
        expectedStart.connectionName,
        preparedPair.startPortPointId,
        preparedPair.endPortPointId,
      )
      const route = routesByKey.get(key)
      if (!route) {
        throw new Error(`HighDensitySolverB02 omitted explicit pair "${key}"`)
      }
      const isReversed =
        route.route[0]?.portPointId === preparedPair.endPortPointId
      const routePoints = (isReversed
        ? [...route.route].reverse()
        : [...route.route]
      ).map((point) => ({ ...point }))
      const firstPoint = routePoints[0]
      const lastPoint = routePoints.at(-1)
      if (!firstPoint || !lastPoint) {
        throw new Error(
          `HighDensitySolverB02 returned an empty route for "${key}"`,
        )
      }
      Object.assign(firstPoint, {
        portPointId: expectedStart.portPointId,
        pcb_port_id: expectedStart.pcb_port_id,
      })
      Object.assign(lastPoint, {
        portPointId: expectedEnd.portPointId,
        pcb_port_id: expectedEnd.pcb_port_id,
      })

      return {
        ...route,
        connectionName: expectedStart.connectionName,
        rootConnectionName:
          expectedStart.rootConnectionName ?? expectedStart.connectionName,
        regionId: this.nodeWithPortPoints.capacityMeshNodeId,
        startPcbPortId: expectedStart.pcb_port_id,
        endPcbPortId: expectedEnd.pcb_port_id,
        route: routePoints,
        vias: route.vias.map((via) => ({ ...via })),
      }
    })
  }

  private fail(message: string): void {
    this.solved = false
    this.failed = true
    this.error = message
  }

  override visualize(): GraphicsObject {
    return this.upstreamSolver?.visualize() ?? super.visualize()
  }
}
