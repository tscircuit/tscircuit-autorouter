import {
  HighDensitySolverA08,
  type HighDensityIntraNodeRoute as A08Route,
} from "@tscircuit/high-density-a01-next"
import type { GraphicsObject } from "graphics-debug"
import type {
  HighDensityIntraNodeRoute,
  NodeWithPortPoints,
  PortPoint,
} from "lib/types/high-density-types"
import type { Obstacle } from "lib/types/srj-types"
import { BaseSolver } from "../BaseSolver"
import {
  getHighDensityIntraNodeRouteValidationError,
  materializeHighDensityIntraNodeRouteVias,
} from "./validate-high-density-intra-node-routes"

type PortPair = [PortPoint, PortPoint]

export type HighDensityA08InputStrategy =
  | "explicit-pairs"
  | "shared-anchors"

export type HighDensitySolverA08IntraNodeAdapterParams = {
  nodeWithPortPoints: NodeWithPortPoints
  traceWidth?: number
  viaDiameter?: number
  traceMargin?: number
  obstacles?: Obstacle[]
  effort?: number
  minimumPairCount?: number
  inputStrategy?: HighDensityA08InputStrategy
  shuffleSeed?: number
}

type PreparedPair = {
  originalPair: PortPair
  inputConnectionName: string
  inputStartPortPointId: string
  inputEndPortPointId: string
}

type PreparedA08Input = {
  nodeWithPortPoints: NodeWithPortPoints
  pairs: PreparedPair[]
}

const EPSILON = 1e-8
const MIN_ITERATION_BUDGET = 150_000
const BASE_ITERATION_BUDGET = 2_000_000
const MAX_ITERATION_BUDGET = 12_000_000
const UPSTREAM_STEPS_PER_ADAPTER_STEP = 5

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
  portPoint.rootConnectionName ??
  portPoint.connectionName.replace(/_mst\d+$/, "")

const haveSameCoordinates = (
  a: { x: number; y: number; z: number },
  b: { x: number; y: number; z: number },
): boolean =>
  Math.abs(a.x - b.x) <= EPSILON &&
  Math.abs(a.y - b.y) <= EPSILON &&
  Math.abs(a.z - b.z) <= EPSILON

const getAnchorKey = (portPoint: PortPoint): string => {
  const baseKey =
    portPoint.portPointId ??
    `${portPoint.z}:${portPoint.x.toFixed(6)}:${portPoint.y.toFixed(6)}`
  return `${baseKey}|${getRootConnectionName(portPoint)}`
}

const compactRoutePoints = <T extends { x: number; y: number; z: number }>(
  points: T[],
): T[] =>
  points.filter(
    (point, index) =>
      index === 0 || !haveSameCoordinates(point, points[index - 1]!),
  )

const restoreEndpointMetadata = (
  generatedPoint: A08Route["route"][number],
  originalPortPoint: PortPoint,
): A08Route["route"][number] => {
  const restoredPoint = {
    ...generatedPoint,
    ...originalPortPoint,
  } as A08Route["route"][number] &
    Partial<
      Pick<PortPoint, "portPointId" | "prevPortPointId" | "nextPortPointId">
    >

  for (const field of [
    "portPointId",
    "prevPortPointId",
    "nextPortPointId",
  ] as const) {
    if (originalPortPoint[field] === undefined) delete restoredPoint[field]
  }
  return restoredPoint
}

const createPreparedInput = (
  params: HighDensitySolverA08IntraNodeAdapterParams,
): PreparedA08Input => {
  const strategy = params.inputStrategy ?? "explicit-pairs"
  const originalPairs = params.nodeWithPortPoints.portPointsInPairs ?? []
  const inputPairs: PortPair[] = []
  const pairs: PreparedPair[] = []

  for (const [pairIndex, originalPair] of originalPairs.entries()) {
    const [originalStart, originalEnd] = originalPair
    const inputConnectionName =
      strategy === "explicit-pairs"
        ? `a08_explicit_pair_${pairIndex}`
        : originalStart.connectionName
    const inputStartPortPointId =
      strategy === "explicit-pairs"
        ? `a08_pair_${pairIndex}_0_${originalStart.portPointId ?? "missing"}`
        : originalStart.portPointId!
    const inputEndPortPointId =
      strategy === "explicit-pairs"
        ? `a08_pair_${pairIndex}_1_${originalEnd.portPointId ?? "missing"}`
        : originalEnd.portPointId!
    const inputStart: PortPoint = {
      ...originalStart,
      connectionName: inputConnectionName,
      portPointId: inputStartPortPointId,
      prevPortPointId: undefined,
      nextPortPointId: inputEndPortPointId,
    }
    const inputEnd: PortPoint = {
      ...originalEnd,
      connectionName: inputConnectionName,
      portPointId: inputEndPortPointId,
      prevPortPointId: inputStartPortPointId,
      nextPortPointId: undefined,
    }
    delete (inputStart as PortPoint & { duplicatedFromPortId?: string })
      .duplicatedFromPortId
    delete (inputEnd as PortPoint & { duplicatedFromPortId?: string })
      .duplicatedFromPortId
    inputPairs.push([inputStart, inputEnd])
    pairs.push({
      originalPair,
      inputConnectionName,
      inputStartPortPointId,
      inputEndPortPointId,
    })
  }

  return {
    nodeWithPortPoints: {
      ...params.nodeWithPortPoints,
      portPoints: inputPairs.flat(),
      portPointsInPairs: inputPairs,
    },
    pairs,
  }
}

const hasValidCommonStructure = (
  params: HighDensitySolverA08IntraNodeAdapterParams,
): boolean => {
  const node = params.nodeWithPortPoints
  const pairs = node.portPointsInPairs
  if (!pairs || pairs.length < (params.minimumPairCount ?? 2)) return false
  if (
    !Number.isFinite(node.width) ||
    !Number.isFinite(node.height) ||
    node.width <= 0 ||
    node.height <= 0
  ) {
    return false
  }
  if (
    (params.obstacles ?? []).some((obstacle) =>
      obstacleIntersectsNodeInterior(node, obstacle),
    )
  ) {
    return false
  }

  const availableZ = new Set(
    node.availableZ ?? node.portPoints.map((portPoint) => portPoint.z),
  )
  if (availableZ.size < 2) return false

  return pairs.every(([start, end]) => {
    const coordinates = [start.x, start.y, start.z, end.x, end.y, end.z]
    return (
      coordinates.every(Number.isFinite) &&
      start.connectionName === end.connectionName &&
      getRootConnectionName(start) === getRootConnectionName(end) &&
      availableZ.has(start.z) &&
      availableZ.has(end.z)
    )
  })
}

const hasValidSharedAnchorStructure = (
  params: HighDensitySolverA08IntraNodeAdapterParams,
): boolean => {
  const pairs = params.nodeWithPortPoints.portPointsInPairs!
  const seenConnections = new Set<string>()
  const anchorCoordinates = new Map<
    string,
    { x: number; y: number; z: number }
  >()
  let hasSharedAnchor = false

  for (const [start, end] of pairs) {
    if (
      !start.portPointId ||
      !end.portPointId ||
      seenConnections.has(start.connectionName)
    ) {
      return false
    }
    seenConnections.add(start.connectionName)

    for (const portPoint of [start, end]) {
      const anchorKey = getAnchorKey(portPoint)
      const previousCoordinates = anchorCoordinates.get(anchorKey)
      if (previousCoordinates) {
        if (!haveSameCoordinates(previousCoordinates, portPoint)) return false
        hasSharedAnchor = true
      } else {
        anchorCoordinates.set(anchorKey, portPoint)
      }
    }
  }

  return hasSharedAnchor
}

export class HighDensitySolverA08IntraNodeAdapter extends BaseSolver {
  override getSolverName(): string {
    return "HighDensitySolverA08"
  }

  readonly constructorParams: HighDensitySolverA08IntraNodeAdapterParams
  readonly nodeWithPortPoints: NodeWithPortPoints
  readonly preparedInput: PreparedA08Input
  private readonly upstreamSolver?: HighDensitySolverA08
  solvedRoutes: HighDensityIntraNodeRoute[] = []

  constructor(params: HighDensitySolverA08IntraNodeAdapterParams) {
    super()
    this.constructorParams = params
    this.nodeWithPortPoints = params.nodeWithPortPoints
    this.preparedInput = createPreparedInput(params)

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
      nodeWithPortPoints: this.preparedInput.nodeWithPortPoints,
      cellSizeMm: 0.1,
      viaDiameter,
      viaMinDistFromBorder: viaDiameter / 2,
      traceMargin: params.traceMargin ?? 0.1,
      traceThickness: params.traceWidth ?? 0.15,
      effort,
      stepMultiplier: 4,
      hyperParameters: { shuffleSeed: params.shuffleSeed ?? 0 },
    })
    // A08 divides its outer budget between breakout routing and A01. Give the
    // upstream pipeline enough headroom for A01's natural effort=1 budget
    // while keeping this adapter's supervisor-visible work budget bounded.
    this.upstreamSolver.MAX_ITERATIONS = Math.min(
      MAX_ITERATION_BUDGET,
      this.MAX_ITERATIONS * 5,
    )
  }

  static isApplicable(
    params: HighDensitySolverA08IntraNodeAdapterParams,
  ): boolean {
    if (!hasValidCommonStructure(params)) return false
    if ((params.inputStrategy ?? "explicit-pairs") === "shared-anchors") {
      return hasValidSharedAnchorStructure(params)
    }
    return true
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

    for (
      let substep = 0;
      substep < UPSTREAM_STEPS_PER_ADAPTER_STEP;
      substep++
    ) {
      this.upstreamSolver.step()
      if (this.upstreamSolver.solved || this.upstreamSolver.failed) break
    }
    this.activeSubSolver = this.upstreamSolver.activeSubSolver as any
    this.stats = {
      ...this.upstreamSolver.stats,
      inputStrategy: this.constructorParams.inputStrategy ?? "explicit-pairs",
      shuffleSeed: this.constructorParams.shuffleSeed ?? 0,
    }

    if (this.upstreamSolver.failed) {
      this.failed = true
      this.error = `HighDensitySolverA08 failed: ${this.upstreamSolver.error ?? "unknown error"}`
      return
    }

    if (!this.upstreamSolver.solved) return

    try {
      const restoredRoutes =
        (this.constructorParams.inputStrategy ?? "explicit-pairs") ===
        "shared-anchors"
          ? this.restoreSharedAnchorRoutes()
          : this.restoreExplicitPairRoutes(this.upstreamSolver.getOutput())
      const solvedRoutes = restoredRoutes.map(
        materializeHighDensityIntraNodeRouteVias,
      )
      const validationError = getHighDensityIntraNodeRouteValidationError({
        routes: solvedRoutes,
        nodeWithPortPoints: this.nodeWithPortPoints,
        requirePairConnectivity: true,
        expectedTraceThickness:
          this.constructorParams.traceWidth ?? 0.15,
        expectedViaDiameter:
          this.constructorParams.viaDiameter ?? 0.3,
      })
      if (validationError) {
        this.failed = true
        this.error = `HighDensitySolverA08 output rejected: ${validationError}`
        return
      }
      this.solvedRoutes = solvedRoutes
      this.solved = true
    } catch (error) {
      this.failed = true
      this.error =
        error instanceof Error
          ? `HighDensitySolverA08 output rejected: ${error.message}`
          : "HighDensitySolverA08 output rejected"
    }
  }

  private restoreExplicitPairRoutes(
    routes: A08Route[],
  ): HighDensityIntraNodeRoute[] {
    if (routes.length !== this.preparedInput.pairs.length) {
      throw new Error(
        `returned ${routes.length} routes for ${this.preparedInput.pairs.length} explicit pairs`,
      )
    }
    const routesByConnection = new Map<string, A08Route>()
    for (const route of routes) {
      if (routesByConnection.has(route.connectionName)) {
        throw new Error(
          `returned multiple routes for "${route.connectionName}"`,
        )
      }
      routesByConnection.set(route.connectionName, route)
    }

    return this.preparedInput.pairs.map((preparedPair) => {
      const route = routesByConnection.get(preparedPair.inputConnectionName)
      if (!route) {
        throw new Error(
          `omitted explicit pair "${preparedPair.inputConnectionName}"`,
        )
      }
      return this.restorePairRoute(route, preparedPair)
    })
  }

  private restoreSharedAnchorRoutes(): HighDensityIntraNodeRoute[] {
    const innerRoutes = this.upstreamSolver?.innerSolver?.getOutput() ?? []
    if (innerRoutes.length !== this.preparedInput.pairs.length) {
      throw new Error(
        `returned ${innerRoutes.length} inner routes for ${this.preparedInput.pairs.length} shared-anchor pairs`,
      )
    }
    const innerRoutesByConnection = new Map<string, A08Route>()
    for (const route of innerRoutes) {
      if (innerRoutesByConnection.has(route.connectionName)) {
        throw new Error(
          `returned multiple inner routes for "${route.connectionName}"`,
        )
      }
      innerRoutesByConnection.set(route.connectionName, route)
    }
    const breakoutRoutesByAnchorKey = new Map(
      (this.upstreamSolver?.breakoutRoutes ?? []).map((route) => [
        route.anchorKey,
        route.route,
      ]),
    )

    return this.preparedInput.pairs.map((preparedPair) => {
      const innerRoute = innerRoutesByConnection.get(
        preparedPair.inputConnectionName,
      )
      if (!innerRoute) {
        throw new Error(
          `omitted shared-anchor pair "${preparedPair.inputConnectionName}"`,
        )
      }
      const [originalStart, originalEnd] = preparedPair.originalPair
      let routePoints = this.orientRoutePoints(innerRoute, preparedPair)
      const startBreakout = breakoutRoutesByAnchorKey.get(
        getAnchorKey(originalStart),
      )
      const endBreakout = breakoutRoutesByAnchorKey.get(
        getAnchorKey(originalEnd),
      )

      if (!haveSameCoordinates(routePoints[0]!, originalStart)) {
        if (!startBreakout) {
          throw new Error(
            `missing breakout for start anchor "${getAnchorKey(originalStart)}"`,
          )
        }
        routePoints = compactRoutePoints([
          ...startBreakout.map((point) => ({ ...point })),
          ...routePoints,
        ])
      }
      if (!haveSameCoordinates(routePoints.at(-1)!, originalEnd)) {
        if (!endBreakout) {
          throw new Error(
            `missing breakout for end anchor "${getAnchorKey(originalEnd)}"`,
          )
        }
        routePoints = compactRoutePoints([
          ...routePoints,
          ...[...endBreakout].reverse().map((point) => ({ ...point })),
        ])
      }

      return this.restorePairRoute(
        { ...innerRoute, route: routePoints },
        preparedPair,
      )
    })
  }

  private orientRoutePoints(
    route: A08Route,
    preparedPair: PreparedPair,
  ): A08Route["route"] {
    const firstPoint = route.route[0]
    const lastPoint = route.route.at(-1)
    if (!firstPoint || !lastPoint) {
      throw new Error(
        `returned an empty route for "${preparedPair.inputConnectionName}"`,
      )
    }
    const isForward =
      firstPoint.portPointId === preparedPair.inputStartPortPointId &&
      lastPoint.portPointId === preparedPair.inputEndPortPointId
    const isReverse =
      firstPoint.portPointId === preparedPair.inputEndPortPointId &&
      lastPoint.portPointId === preparedPair.inputStartPortPointId
    if (!isForward && !isReverse) {
      throw new Error(
        `returned unexpected endpoint identities for "${preparedPair.inputConnectionName}"`,
      )
    }
    return (isReverse ? [...route.route].reverse() : route.route).map(
      (point) => ({ ...point }),
    )
  }

  private restorePairRoute(
    route: A08Route,
    preparedPair: PreparedPair,
  ): HighDensityIntraNodeRoute {
    const [originalStart, originalEnd] = preparedPair.originalPair
    const routePoints = this.orientRoutePoints(route, preparedPair)
    if (!haveSameCoordinates(routePoints[0]!, originalStart)) {
      throw new Error(
        `moved the start endpoint for "${originalStart.connectionName}"`,
      )
    }
    if (!haveSameCoordinates(routePoints.at(-1)!, originalEnd)) {
      throw new Error(
        `moved the end endpoint for "${originalStart.connectionName}"`,
      )
    }
    routePoints[0] = restoreEndpointMetadata(routePoints[0]!, originalStart)
    routePoints[routePoints.length - 1] = restoreEndpointMetadata(
      routePoints.at(-1)!,
      originalEnd,
    )

    return {
      ...route,
      connectionName: originalStart.connectionName,
      rootConnectionName: getRootConnectionName(originalStart),
      regionId: this.nodeWithPortPoints.capacityMeshNodeId,
      startPcbPortId: originalStart.pcb_port_id,
      endPcbPortId: originalEnd.pcb_port_id,
      route: routePoints,
      vias: route.vias.map((via) => ({ ...via })),
    }
  }

  override visualize(): GraphicsObject {
    return this.upstreamSolver?.visualize() ?? super.visualize()
  }
}
