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

const prepareInput = (node: NodeWithPortPoints): PreparedB02Input => {
  const pairs: PreparedPair[] = []
  const portPoints: B02PortPoint[] = []
  for (const [pairIndex, originalPair] of (
    node.portPointsInPairs ?? []
  ).entries()) {
    const [start, end] = originalPair
    const startPortPointId = `${start.portPointId ?? "port"}|b02|${pairIndex}|0`
    const endPortPointId = `${end.portPointId ?? "port"}|b02|${pairIndex}|1`
    pairs.push({ originalPair, startPortPointId, endPortPointId })
    portPoints.push(
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
      portPoints,
    },
    pairs,
  }
}

const pairKey = (
  connectionName: string,
  startPortPointId: string,
  endPortPointId: string,
): string => {
  const endpointIds = [startPortPointId, endPortPointId].sort()
  return `${connectionName}|${endpointIds[0]}|${endpointIds[1]}`
}

const routeKey = (route: B02Route): string => {
  const startPortPointId = route.route[0]?.portPointId
  const endPortPointId = route.route.at(-1)?.portPointId
  if (!startPortPointId || !endPortPointId) {
    throw new Error(
      `HighDensitySolverB02 omitted endpoint identity for "${route.connectionName}"`,
    )
  }
  return pairKey(route.connectionName, startPortPointId, endPortPointId)
}

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
    Math.max(node.center.y - node.height / 2, obstacle.center.y - obstacleHalfY)
  return overlapX > EPSILON && overlapY > EPSILON
}

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
    this.preparedInput = prepareInput(params.nodeWithPortPoints)
    this.MAX_ITERATIONS = 1
  }

  static isApplicable(
    params: HighDensitySolverB02IntraNodeAdapterParams,
  ): boolean {
    const pairs = params.nodeWithPortPoints.portPointsInPairs
    if (!pairs || pairs.length === 0) return false
    if (
      (params.obstacles ?? []).some((obstacle) =>
        obstacleIntersectsNodeInterior(params.nodeWithPortPoints, obstacle),
      )
    ) {
      return false
    }
    const preparedInput = prepareInput(params.nodeWithPortPoints)
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
      !HighDensitySolverB02IntraNodeAdapter.isApplicable(this.constructorParams)
    ) {
      this.solved = false
      this.failed = true
      this.error = "HighDensitySolverB02 is not structurally applicable"
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
      this.solved = false
      this.failed = true
      this.error = `HighDensitySolverB02 failed: ${this.upstreamSolver.error ?? "unknown error"}`
      return
    }
    this.solvedRoutes = this.restoreMetadata(this.upstreamSolver.getOutput())
    this.solved = true
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
      obstacles: [],
      traceThickness: params.traceWidth ?? 0.15,
      traceMargin: clearance,
      obstacleClearanceMargin: clearance,
      viaDiameter,
      viaMinDistFromBorder: viaDiameter / 2,
      effort: params.effort ?? 1,
    }
  }

  private restoreMetadata(routes: B02Route[]): HighDensityIntraNodeRoute[] {
    const routesByKey = new Map(routes.map((route) => [routeKey(route), route]))
    if (routesByKey.size !== this.preparedInput.pairs.length) {
      throw new Error(
        `HighDensitySolverB02 returned ${routesByKey.size} routes for ${this.preparedInput.pairs.length} explicit pairs`,
      )
    }
    return this.preparedInput.pairs.map((pair) => {
      const [expectedStart, expectedEnd] = pair.originalPair
      const key = pairKey(
        expectedStart.connectionName,
        pair.startPortPointId,
        pair.endPortPointId,
      )
      const route = routesByKey.get(key)
      if (!route) {
        throw new Error(`HighDensitySolverB02 omitted explicit pair "${key}"`)
      }
      const routePoints = (
        route.route[0]?.portPointId === pair.endPortPointId
          ? [...route.route].reverse()
          : [...route.route]
      ).map((point) => ({ ...point }))
      const firstPoint = routePoints[0]!
      const lastPoint = routePoints.at(-1)!
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

  override visualize(): GraphicsObject {
    return this.upstreamSolver?.visualize() ?? super.visualize()
  }
}
