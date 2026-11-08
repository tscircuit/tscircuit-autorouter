import type { ConnectivityMap } from "circuit-json-to-connectivity-map"
import {
  NegotiateTraceClearanceSolver,
  getFixedObstacleViolations,
} from "@tscircuit/repair04"
import type { GraphicsObject } from "graphics-debug"
import { HighDensityForceImproveSolver } from "high-density-repair01/lib/HighDensityForceImproveSolver"
import { BaseSolver } from "lib/solvers/BaseSolver"
import { Pipeline4HighDensityRepairSolver } from "lib/solvers/HighDensityRepairSolver/Pipeline4HighDensityRepairSolver"
import { HighDensitySolver } from "lib/solvers/HighDensitySolver/HighDensitySolver"
import type { CapacityMeshNodeId } from "lib/types/capacity-mesh-types"
import type {
  HighDensityRoute,
  NodeWithPortPoints,
} from "lib/types/high-density-types"
import type { Obstacle, SimpleRouteJson } from "lib/types/srj-types"
import type { HighDensityBoardGeometry } from "lib/types/high-density-board-geometry"
import { mapZToLayerName } from "lib/utils/mapZToLayerName"
import { mapLayerNameToZ } from "lib/utils/mapLayerNameToZ"
import { materializePipeline9HdRouteVias } from "./materializePipeline9HdRouteVias"
import {
  arePipeline9RoutesOnSameNet,
  doPipeline9RoutesHaveCopperConflict,
  getPipeline9RouteCopperGeometry,
} from "./pipeline9FixedRouteCopper"
import { preparePipeline9RepairConnectivity } from "./preparePipeline9RepairConnectivity"
import { getFullyCoveredNodeLayers } from "./getFullyCoveredNodeLayers"

type Pipeline9RegionalFallbackSolverParams = {
  nodeWithPortPoints: NodeWithPortPoints
  colorMap: Record<string, string>
  connMap: ConnectivityMap
  viaDiameter: number
  viaHoleDiameter?: number
  minViaHoleEdgeToViaHoleEdgeClearance?: number
  boardGeometry?: HighDensityBoardGeometry
  traceWidth: number
  obstacleMargin: number
  effort: number
  nodePfById?:
    | Map<CapacityMeshNodeId, number | null>
    | Record<string, number | null>
  obstacles: Obstacle[]
  boardObstacles?: Obstacle[]
  fixedRoutes?: HighDensityRoute[]
  movablePreloadedConnectionNames?: ReadonlySet<string>
  viaToPadClearance?: number
  traceToPadClearance?: number
  layerCount: number
  allowBlindAndBuriedVias?: boolean
  captureSearchDebug?: boolean
  /** Complete topology routes that need physical clearance repair. */
  initialRoutes?: HighDensityRoute[]
}

type RegionalFallbackPhase =
  | "route"
  | "improve"
  | "repair"
  | "via-clearance"
  | "done"

const getPointToObstacleDistance = (
  point: { x: number; y: number },
  obstacle: Obstacle,
): number => {
  if (obstacle.shape === "circle") {
    return Math.max(
      0,
      Math.hypot(point.x - obstacle.center.x, point.y - obstacle.center.y) -
        obstacle.width / 2,
    )
  }
  const rotationRadians =
    (-1 * (obstacle.ccwRotationDegrees ?? 0) * Math.PI) / 180
  const offsetX = point.x - obstacle.center.x
  const offsetY = point.y - obstacle.center.y
  const localX =
    offsetX * Math.cos(rotationRadians) - offsetY * Math.sin(rotationRadians)
  const localY =
    offsetX * Math.sin(rotationRadians) + offsetY * Math.cos(rotationRadians)
  const outsideX = Math.max(Math.abs(localX) - obstacle.width / 2, 0)
  const outsideY = Math.max(Math.abs(localY) - obstacle.height / 2, 0)
  return Math.hypot(outsideX, outsideY)
}

const getObstacleZLayers = (
  obstacle: Obstacle,
  layerCount: number,
): number[] => {
  const existingZLayers = obstacle.__zLayers ?? obstacle.zLayers
  if (existingZLayers) return existingZLayers

  return obstacle.layers.map((layer) => mapLayerNameToZ(layer, layerCount))
}

export const isPipeline9ObstacleConnectedToRoute = ({
  obstacle,
  route,
  connMap,
}: {
  obstacle: Obstacle
  route: Pick<HighDensityRoute, "connectionName" | "rootConnectionName">
  connMap: ConnectivityMap
}): boolean => {
  // A route root names an internal net, while obstacle IDs are aliases.
  // Resolve the route's connection first: internal IDs can collide with aliases.
  const routeNetId =
    connMap.getNetConnectedToId(route.connectionName) ??
    (route.rootConnectionName &&
      (connMap.netMap[route.rootConnectionName]
        ? route.rootConnectionName
        : connMap.getNetConnectedToId(route.rootConnectionName)))
  if (!routeNetId) return false

  return obstacle.connectedTo.some((connectedId) => {
    const connectedNetId =
      connMap.getNetConnectedToId(connectedId) ??
      (connMap.netMap[connectedId] ? connectedId : undefined)
    return connectedNetId === routeNetId
  })
}

export const hasViaToBoardObstacleConflict = ({
  routes,
  boardObstacles,
  connMap,
  layerCount,
  viaToPadClearance,
  allowBlindAndBuriedVias,
}: {
  routes: HighDensityRoute[]
  boardObstacles: Obstacle[]
  connMap: ConnectivityMap
  layerCount: number
  viaToPadClearance: number
  allowBlindAndBuriedVias?: boolean
}): boolean =>
  routes.some((route) => {
    const viaSpans = getPipeline9RouteCopperGeometry(route, {
      layerCount,
      allowBlindAndBuriedVias,
    }).viaSpans
    return viaSpans.some((via) =>
      boardObstacles.some((obstacle) => {
        // Pours are regenerated with antipads around foreign through vias.
        // Keep their wire-layer obstacles, but do not treat them as solid pads.
        if (obstacle.isCopperPour) return false
        if (isPipeline9ObstacleConnectedToRoute({ obstacle, route, connMap }))
          return false
        const obstacleZLayers = getObstacleZLayers(obstacle, layerCount)
        if (!obstacleZLayers.some((z) => z >= via.minZ && z <= via.maxZ)) {
          return false
        }
        return (
          getPointToObstacleDistance(via.center, obstacle) + 1e-9 <
          via.diameter / 2 + viaToPadClearance
        )
      }),
    )
  })

/** Runs the regular high-density cleanup pipeline for a B01 fallback region. */
export class Pipeline9RegionalFallbackSolver extends BaseSolver {
  readonly params: Pipeline9RegionalFallbackSolverParams
  readonly highDensitySolver: HighDensitySolver
  forceImproveSolver?: HighDensityForceImproveSolver
  repairSolver?: Pipeline4HighDensityRepairSolver
  viaClearanceSolver?: NegotiateTraceClearanceSolver
  private validatedRoutes?: HighDensityRoute[]
  private clearanceInputRoutes?: HighDensityRoute[]
  private phase: RegionalFallbackPhase = "route"

  constructor(params: Pipeline9RegionalFallbackSolverParams) {
    super()
    const node = params.nodeWithPortPoints
    const blockedLayers = getFullyCoveredNodeLayers(
      node,
      params.obstacles.filter(
        (obstacle) =>
          obstacle.isCopperPour &&
          node.portPoints.every(
            (port) =>
              !isPipeline9ObstacleConnectedToRoute({
                obstacle,
                route: port,
                connMap: params.connMap,
              }),
          ),
      ),
      params.layerCount,
    )
    if (node.portPoints.some((port) => blockedLayers.has(port.z))) {
      throw new Error(
        `Regional node "${node.capacityMeshNodeId}" has a terminal inside a foreign copper plane`,
      )
    }
    // These layers cannot contain any legal planar wire for any regional net.
    // Restrict candidate generation before grow/shrink and force-improve; vias
    // may still cross the plane because it is regenerated with antipads.
    params = {
      ...params,
      nodeWithPortPoints: {
        ...node,
        availableZ: (
          node.availableZ ??
          Array.from({ length: params.layerCount }, (_, z) => z)
        ).filter((z) => !blockedLayers.has(z)),
      },
    }
    this.params = params
    this.stats = {
      preloadedViaCandidateRejectionCount: 0,
      forceImproveCandidateRejectionCount: 0,
      repairCandidateRejectionCount: 0,
    }
    this.highDensitySolver = new HighDensitySolver({
      captureSearchDebug: params.captureSearchDebug,
      nodePortPoints: [params.nodeWithPortPoints],
      colorMap: params.colorMap,
      connMap: params.connMap,
      viaDiameter: params.viaDiameter,
      traceWidth: params.traceWidth,
      obstacleMargin: params.obstacleMargin,
      effort: params.effort,
      nodePfById: params.nodePfById,
      obstacles: params.obstacles,
      layerCount: params.layerCount,
      useGrowShrinkHighDensityIntraNodeSolver: true,
      preserveTerminalPcbPortIds: false,
      growShrinkFallbackToInvalidGeometryOnFailure: false,
    })
    this.activeSubSolver = this.highDensitySolver
    this.MAX_ITERATIONS = 100e6 * params.effort
    if (params.initialRoutes) this.startForceImprove(params.initialRoutes)
  }

  override getSolverName(): string {
    return "Pipeline9RegionalFallbackSolver"
  }

  private hasFixedCopperConflict(routes: HighDensityRoute[]): boolean {
    return routes.some((route) =>
      (this.params.fixedRoutes ?? []).some(
        (fixedRoute) =>
          !arePipeline9RoutesOnSameNet(
            route,
            fixedRoute,
            this.params.connMap,
          ) &&
          doPipeline9RoutesHaveCopperConflict({
            left: route,
            right: fixedRoute,
            clearance:
              this.params.traceToPadClearance ?? this.params.obstacleMargin,
            layerCount: this.params.layerCount,
            allowBlindAndBuriedVias: this.params.allowBlindAndBuriedVias,
          }),
      ),
    )
  }

  private validateCandidateRoutes(routes: HighDensityRoute[]): boolean {
    const { boardObstacles, viaToPadClearance } = this.params
    if (this.hasFixedCopperConflict(routes)) {
      this.stats.fixedCopperCandidateRejectionCount =
        Number(this.stats.fixedCopperCandidateRejectionCount ?? 0) + 1
      return false
    }
    const pourObstacles = this.params.obstacles
      .filter((obstacle) => obstacle.isCopperPour)
      .map((obstacle) => ({
        ...obstacle,
        connectedTo: [
          ...obstacle.connectedTo,
          ...routes
            .filter((route) =>
              isPipeline9ObstacleConnectedToRoute({
                obstacle,
                route,
                connMap: this.params.connMap,
              }),
            )
            .map((route) => route.connectionName),
        ],
      }))
    if (pourObstacles.length > 0) {
      const node = this.params.nodeWithPortPoints
      const conflicts = getFixedObstacleViolations({
        srj: {
          bounds: {
            minX: node.center.x - node.width / 2,
            maxX: node.center.x + node.width / 2,
            minY: node.center.y - node.height / 2,
            maxY: node.center.y + node.height / 2,
          },
          layerCount: this.params.layerCount,
          minTraceWidth: this.params.traceWidth,
          obstacles: pourObstacles,
          connections: [],
        },
        routes,
        traceClearance:
          this.params.traceToPadClearance ?? this.params.obstacleMargin,
      })
      if (conflicts.some((conflict) => conflict.kind === "wire")) {
        this.stats.pourWireCandidateRejectionCount =
          Number(this.stats.pourWireCandidateRejectionCount ?? 0) + 1
        return false
      }
    }
    if (!boardObstacles || viaToPadClearance === undefined) {
      return true
    }
    const hasViaConflict = hasViaToBoardObstacleConflict({
      routes,
      boardObstacles,
      connMap: this.params.connMap,
      layerCount: this.params.layerCount,
      allowBlindAndBuriedVias: this.params.allowBlindAndBuriedVias,
      viaToPadClearance,
    })
    if (hasViaConflict) {
      this.stats.preloadedViaCandidateRejectionCount =
        Number(this.stats.preloadedViaCandidateRejectionCount ?? 0) + 1
    }
    return !hasViaConflict
  }

  private startViaClearanceRepair(routes: HighDensityRoute[]): void {
    const { params } = this
    const node = params.nodeWithPortPoints
    const clearance = params.viaToPadClearance ?? params.obstacleMargin
    // Negotiation keeps mutable copper strictly inside the window. Include a
    // search-grid step beyond the first legal via center beside terminal pads;
    // otherwise that center lies on the excluded boundary and no via can fit.
    const repairGridSize = Math.min(0.1, params.traceWidth / 2)
    const collar = params.viaDiameter / 2 + clearance + repairGridSize
    const board = params.boardGeometry?.bounds
    const bounds = {
      minX: Math.max(
        node.center.x - node.width / 2 - collar,
        board?.minX ?? -Infinity,
      ),
      maxX: Math.min(
        node.center.x + node.width / 2 + collar,
        board?.maxX ?? Infinity,
      ),
      minY: Math.max(
        node.center.y - node.height / 2 - collar,
        board?.minY ?? -Infinity,
      ),
      maxY: Math.min(
        node.center.y + node.height / 2 + collar,
        board?.maxY ?? Infinity,
      ),
    }
    // A node on inner layers can lie beneath a solid surface pad. A through-via
    // cannot escape that pad inside a node-sized window, so include its edge
    // and a legal via-center collar in the physical repair search.
    for (const route of routes) {
      const vias = getPipeline9RouteCopperGeometry(route, params).viaSpans
      for (const obstacle of params.boardObstacles ?? []) {
        const connected = isPipeline9ObstacleConnectedToRoute({
          obstacle,
          route,
          connMap: params.connMap,
        })
        // A topology anchor can lie on the far edge of its terminal pad.
        // Retained copper may block that side, so include the entire pad and
        // its via collar to let repair escape through the opposite side.
        const touchesTerminal =
          connected &&
          [route.route[0]!, route.route.at(-1)!].some(
            (point) =>
              getPointToObstacleDistance(point, obstacle) <=
              route.traceThickness / 2 + 1e-6,
          )
        if (
          obstacle.isCopperPour ||
          (!touchesTerminal &&
            (connected ||
              !vias.some(
                (via) =>
                  getObstacleZLayers(obstacle, params.layerCount).some(
                    (z) => z >= via.minZ && z <= via.maxZ,
                  ) &&
                  getPointToObstacleDistance(via.center, obstacle) + 1e-9 <
                    via.diameter / 2 + clearance,
              )))
        )
          continue
        const angle = ((obstacle.ccwRotationDegrees ?? 0) * Math.PI) / 180
        const halfWidth =
          (Math.abs(Math.cos(angle)) * obstacle.width +
            Math.abs(Math.sin(angle)) * obstacle.height) /
          2
        const halfHeight =
          (Math.abs(Math.sin(angle)) * obstacle.width +
            Math.abs(Math.cos(angle)) * obstacle.height) /
          2
        bounds.minX = Math.max(
          board?.minX ?? -Infinity,
          Math.min(bounds.minX, obstacle.center.x - halfWidth - collar),
        )
        bounds.maxX = Math.min(
          board?.maxX ?? Infinity,
          Math.max(bounds.maxX, obstacle.center.x + halfWidth + collar),
        )
        bounds.minY = Math.max(
          board?.minY ?? -Infinity,
          Math.min(bounds.minY, obstacle.center.y - halfHeight - collar),
        )
        bounds.maxY = Math.min(
          board?.maxY ?? Infinity,
          Math.max(bounds.maxY, obstacle.center.y + halfHeight + collar),
        )
      }
    }
    // A retained wire may span this entire region and end inside a pad beyond
    // its boundary. A via-sized collar alone cannot reach around that pad.
    // Include each intersecting fixed wire and its terminal pads before adding
    // the via collar, while retaining all board obstacles in the repair SRJ.
    const nodeBounds = {
      minX: node.center.x - node.width / 2,
      maxX: node.center.x + node.width / 2,
      minY: node.center.y - node.height / 2,
      maxY: node.center.y + node.height / 2,
    }
    for (const fixed of params.fixedRoutes ?? []) {
      const geometry = getPipeline9RouteCopperGeometry(fixed, params)
      if (
        !geometry.wireSegments.some(
          ({ start, end, width }) =>
            Math.min(start.x, end.x) - width / 2 <= nodeBounds.maxX &&
            Math.max(start.x, end.x) + width / 2 >= nodeBounds.minX &&
            Math.min(start.y, end.y) - width / 2 <= nodeBounds.maxY &&
            Math.max(start.y, end.y) + width / 2 >= nodeBounds.minY,
        )
      )
        continue
      const copperBounds = {
        minX: Math.min(...fixed.route.map((point) => point.x)),
        maxX: Math.max(...fixed.route.map((point) => point.x)),
        minY: Math.min(...fixed.route.map((point) => point.y)),
        maxY: Math.max(...fixed.route.map((point) => point.y)),
      }
      for (const obstacle of params.boardObstacles ?? []) {
        if (
          obstacle.isCopperPour ||
          !isPipeline9ObstacleConnectedToRoute({
            obstacle,
            route: fixed,
            connMap: params.connMap,
          })
        )
          continue
        if (
          ![fixed.route[0]!, fixed.route.at(-1)!].some(
            (point) =>
              getPointToObstacleDistance(point, obstacle) <=
              fixed.traceThickness / 2 + 1e-6,
          )
        )
          continue
        const angle = ((obstacle.ccwRotationDegrees ?? 0) * Math.PI) / 180
        const halfWidth =
          (Math.abs(Math.cos(angle)) * obstacle.width +
            Math.abs(Math.sin(angle)) * obstacle.height) /
          2
        const halfHeight =
          (Math.abs(Math.sin(angle)) * obstacle.width +
            Math.abs(Math.cos(angle)) * obstacle.height) /
          2
        copperBounds.minX = Math.min(
          copperBounds.minX,
          obstacle.center.x - halfWidth,
        )
        copperBounds.maxX = Math.max(
          copperBounds.maxX,
          obstacle.center.x + halfWidth,
        )
        copperBounds.minY = Math.min(
          copperBounds.minY,
          obstacle.center.y - halfHeight,
        )
        copperBounds.maxY = Math.max(
          copperBounds.maxY,
          obstacle.center.y + halfHeight,
        )
      }
      bounds.minX = Math.max(
        board?.minX ?? -Infinity,
        Math.min(bounds.minX, copperBounds.minX - collar),
      )
      bounds.maxX = Math.min(
        board?.maxX ?? Infinity,
        Math.max(bounds.maxX, copperBounds.maxX + collar),
      )
      bounds.minY = Math.max(
        board?.minY ?? -Infinity,
        Math.min(bounds.minY, copperBounds.minY - collar),
      )
      bounds.maxY = Math.min(
        board?.maxY ?? Infinity,
        Math.max(bounds.maxY, copperBounds.maxY + collar),
      )
    }
    const dirtyRouteIndices = routes.flatMap((route, index) =>
      this.validateCandidateRoutes([route]) ? [] : [index],
    )
    const srj: SimpleRouteJson = {
      ...params.boardGeometry,
      bounds,
      layerCount: params.layerCount,
      minTraceWidth: params.traceWidth,
      minViaDiameter: params.viaDiameter,
      minViaHoleDiameter: params.viaHoleDiameter,
      minViaHoleEdgeToViaHoleEdgeClearance:
        params.minViaHoleEdgeToViaHoleEdgeClearance,
      allowBlindAndBuriedVias: params.allowBlindAndBuriedVias,
      obstacles: params.obstacles.map((obstacle) => ({
        ...obstacle,
        connectedTo: [
          ...obstacle.connectedTo,
          ...routes
            .filter((route) =>
              isPipeline9ObstacleConnectedToRoute({
                obstacle,
                route,
                connMap: params.connMap,
              }),
            )
            .map((route) => route.connectionName),
        ],
      })),
      connections: routes.map((route) => ({
        name: route.connectionName,
        rootConnectionName: route.rootConnectionName,
        pointsToConnect: [route.route[0]!, route.route.at(-1)!].map(
          (point) => ({
            x: point.x,
            y: point.y,
            layer: mapZToLayerName(point.z, params.layerCount),
          }),
        ),
      })),
    }
    this.clearanceInputRoutes = routes
    const fixedRoutes = params.fixedRoutes ?? []
    const prepared =
      fixedRoutes.length > 0
        ? preparePipeline9RepairConnectivity({
            // Regional roots are internal net IDs, which may also be aliases
            // of a different net. Supply the true aliases from connMap instead.
            srj: {
              ...srj,
              connections: srj.connections.map(
                ({ rootConnectionName, ...connection }) => connection,
              ),
            },
            routes: [...routes, ...fixedRoutes],
            connMap: params.connMap,
          })
        : { srj, routes }
    this.viaClearanceSolver = new NegotiateTraceClearanceSolver({
      srj: { ...prepared.srj, traces: undefined },
      routes: prepared.routes,
      fixedRouteIndices: fixedRoutes.map((_, index) => routes.length + index),
      bounds,
      dirtyRouteIndices,
      isLocked: (routeIndex, pointIndex): boolean =>
        routeIndex >= routes.length ||
        pointIndex === 0 ||
        pointIndex === routes[routeIndex]!.route.length - 1,
      allowLayerChanges: true,
      // The topology's planning margin can exceed the board's clearance rule.
      // Keep already legal regional endpoints available to clearance repair.
      traceClearance: params.traceToPadClearance ?? params.obstacleMargin,
      viaClearance: clearance,
      viaHoleDiameter: params.viaHoleDiameter,
      maxPathSearchNodes: Math.ceil(1_000_000 * params.effort),
      maxPathSearchNodesPerCall: 100_000,
      maxPathSearchCalls: Math.ceil(100 * params.effort),
      // Retained fanout tracks can leave via passages narrower than the usual
      // half-trace-width grid. Resolve these fixed-copper corridors directly;
      // pad-only repairs keep their coarser grid and existing search budget.
      pathGridSizeScale: this.hasFixedCopperConflict(routes) ? 0.25 : 1,
      pathHeuristicWeight: 3,
      searchDirectionCount: 2,
    })
    this.activeSubSolver = this.viaClearanceSolver
    this.phase = "via-clearance"
    this.MAX_ITERATIONS += this.viaClearanceSolver.MAX_ITERATIONS + 2
  }

  private startForceImprove(routes: HighDensityRoute[]): void {
    const routedCandidate = materializePipeline9HdRouteVias(routes)
    // Both initial native routes and grow/shrink candidates still pass through
    // the same force-improve, obstacle repair, and physical copper validation.
    this.forceImproveSolver = new HighDensityForceImproveSolver({
      nodeWithPortPoints: [this.params.nodeWithPortPoints],
      hdRoutes: routedCandidate,
      preserveTopologyPortAnchors: true,
      colorMap: this.params.colorMap,
      totalStepsPerNode: Math.max(12, Math.round(20 * this.params.effort)),
      nodeAssignmentMargin: this.params.obstacleMargin,
    })
    this.activeSubSolver = this.forceImproveSolver
    this.phase = "improve"
  }

  override _step(): void {
    if (this.phase === "route") {
      this.highDensitySolver.step()
      if (this.highDensitySolver.failed) {
        this.error = this.highDensitySolver.error
        this.failed = true
        return
      }
      if (!this.highDensitySolver.solved) return
      // Grow/shrink produces provisional geometry. Keep it private until the
      // existing force-improve and obstacle-repair stages have placed its vias.
      this.startForceImprove(this.highDensitySolver.routes)
      return
    }

    if (this.phase === "improve") {
      this.forceImproveSolver!.step()
      if (this.forceImproveSolver!.failed) {
        this.error = this.forceImproveSolver!.error
        this.failed = true
        return
      }
      if (!this.forceImproveSolver!.solved) return
      const forceImprovedRoutes = this.forceImproveSolver!.getOutput()
      this.repairSolver = new Pipeline4HighDensityRepairSolver({
        nodeWithPortPoints: [this.params.nodeWithPortPoints],
        hdRoutes: forceImprovedRoutes,
        obstacles: this.params.obstacles,
        colorMap: this.params.colorMap,
        repairMargin: this.params.obstacleMargin,
        minimumTraceWidth: this.params.traceWidth,
        connMap: this.params.connMap,
      })
      this.activeSubSolver = this.repairSolver
      this.phase = "repair"
      return
    }

    if (this.phase === "repair") {
      this.repairSolver!.step()
      if (this.repairSolver!.failed) {
        this.error = this.repairSolver!.error
        this.failed = true
        return
      }
      if (!this.repairSolver!.solved) return
      const repairedRoutes = this.repairSolver!.getOutput()
      if (!this.validateCandidateRoutes(repairedRoutes)) {
        this.startViaClearanceRepair(repairedRoutes)
        return
      }
      this.validatedRoutes = repairedRoutes
      this.activeSubSolver = null
      this.phase = "done"
      this.solved = true
      return
    }

    if (this.phase === "via-clearance") {
      const solver = this.viaClearanceSolver!
      solver.step()
      this.stats.viaClearanceRepair = solver.stats
      if (solver.failed) {
        this.failed = true
        this.error = solver.error
        return
      }
      if (!solver.solved) return
      const routes = solver
        .getOutput()
        .routes.slice(0, this.clearanceInputRoutes!.length)
        .map(
          (route, index): HighDensityRoute => ({
            ...route,
            rootConnectionName:
              this.clearanceInputRoutes![index]!.rootConnectionName,
          }),
        )
      if (!this.validateCandidateRoutes(routes)) {
        this.stats.repairCandidateRejectionCount =
          Number(this.stats.repairCandidateRejectionCount ?? 0) + 1
        this.error =
          "Pipeline9 regional repair output failed its candidate validator"
        this.failed = true
        return
      }
      this.validatedRoutes = routes
      this.activeSubSolver = null
      this.phase = "done"
      this.solved = true
      return
    }
  }

  getOutput(): HighDensityRoute[] {
    if (!this.solved || !this.validatedRoutes) {
      throw new Error("Cannot publish regional routes before final validation")
    }
    return this.validatedRoutes
  }

  override visualize(): GraphicsObject {
    return (
      this.repairSolver?.visualize() ??
      this.forceImproveSolver?.visualize() ??
      this.highDensitySolver.visualize()
    )
  }
}
