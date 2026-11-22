import {
  distanceBetweenCircleAndCircle,
  distanceBetweenCircleAndPolygon,
} from "@tscircuit/circuit-json-util"
import { segmentToCircleMinDistance } from "@tscircuit/math-utils"
import { createFixedObstacleViolationEvaluator } from "@tscircuit/repair04"
import type { SolverRuntimeExecutor } from "@tscircuit/solver-utils"
import type { AnyCircuitElement } from "circuit-json"
import {
  type ConnectivityMap,
  getFullConnectivityMapFromCircuitJson,
} from "circuit-json-to-connectivity-map"
import { HighDensityForceImproveSolver } from "high-density-repair01/lib/HighDensityForceImproveSolver"
import { isObstacleConnectedToRoute } from "lib/solvers/TraceWidthSolver/isObstacleConnectedToRoute"
import type { Obstacle, SimpleRouteJson } from "lib/types"
import type { HighDensityRoute } from "lib/types/high-density-types"
import {
  compileTraceClearanceObstacle,
  type IndexedObstacle,
} from "lib/utils/autorouting-drc/createTraceObstacleClearanceEvaluator"
import { convertToCircuitJson } from "lib/utils/convertToCircuitJson"
import { RELAXED_DRC_OPTIONS } from "lib/utils/drcPresets"
import { getConnectivityMapFromSimpleRouteJson } from "lib/utils/getConnectivityMapFromSimpleRouteJson"
import { getViaDimensions } from "lib/utils/getViaDimensions"
import { getViaToPadClearance } from "lib/utils/getViaToPadClearance"
import { mapZToLayerName } from "lib/utils/mapZToLayerName"
import RBush from "rbush"
import {
  Pipeline9HighDensityForceImproveSampleSolver,
  type Pipeline9HighDensityForceImproveSampleOutput,
} from "./Pipeline9HighDensityForceImproveSampleSolver"
import { getFixedCopperObstacleIndexes } from "./getFixedCopperObstacleIndexes"

type ForceImproveParams = ConstructorParameters<
  typeof HighDensityForceImproveSolver
>[0] & { inputSrj: SimpleRouteJson }
type ForceImproveConstructorParams = ReturnType<
  HighDensityForceImproveSolver["getConstructorParams"]
>[0] & { inputSrj: SimpleRouteJson }
type ViaClearanceViolationKey = string
type PadElement = Extract<
  AnyCircuitElement,
  { type: "pcb_smtpad" | "pcb_plated_hole" }
>
type IndexedPad = IndexedObstacle & {
  sourceObstacle?: Obstacle
}
type CandidateVia = {
  x: number
  y: number
  radius: number
  layers: string[]
}

const CLEARANCE_SEVERITY_EPSILON = 1e-6

const getViaToIndexedPadGap = (
  via: { x: number; y: number; radius: number },
  pad: IndexedPad,
): number => {
  const circle = {
    kind: "circle" as const,
    x: via.x,
    y: via.y,
    radius: via.radius,
  }
  if (pad.shape.kind === "circle") {
    return distanceBetweenCircleAndCircle(circle, {
      kind: "circle",
      x: (pad.clearanceBounds.minX + pad.clearanceBounds.maxX) / 2,
      y: (pad.clearanceBounds.minY + pad.clearanceBounds.maxY) / 2,
      radius:
        Math.min(
          pad.clearanceBounds.maxX - pad.clearanceBounds.minX,
          pad.clearanceBounds.maxY - pad.clearanceBounds.minY,
        ) / 2,
    })
  }
  if (pad.shape.kind === "capsule") {
    return (
      segmentToCircleMinDistance(pad.shape.start, pad.shape.end, circle) -
      pad.shape.radius
    )
  }
  return (
    distanceBetweenCircleAndPolygon(circle, {
      kind: "polygon",
      points: pad.shape.points,
    }) - (pad.shape.radius ?? 0)
  )
}

export class Pipeline9HighDensityForceImproveSolver extends HighDensityForceImproveSolver {
  private asyncRunning = false
  private completedSample?: Pipeline9HighDensityForceImproveSampleOutput
  private readonly inputSrj: SimpleRouteJson
  private readonly fixedViaObstacleIndexes: ReadonlySet<number>
  private readonly padIndex: RBush<IndexedPad>
  private readonly hasIndexedPads: boolean
  private readonly staticConnectivityMap: ConnectivityMap
  private readonly srjConnectivityMap: ConnectivityMap
  private readonly viaClearance: number
  private readonly defaultViaDiameter: number
  private readonly allBoardLayers: string[]
  private readonly evaluateFixedObstacles: ReturnType<
    typeof createFixedObstacleViolationEvaluator
  >

  constructor(params: ForceImproveParams) {
    super(params)
    this.inputSrj = params.inputSrj
    this.viaClearance =
      getViaToPadClearance(params.inputSrj) ??
      RELAXED_DRC_OPTIONS.traceClearance
    this.defaultViaDiameter = getViaDimensions(params.inputSrj).padDiameter
    this.allBoardLayers = Array.from(
      { length: params.inputSrj.layerCount },
      (_, z) => mapZToLayerName(z, params.inputSrj.layerCount),
    )
    const representedPadObstacleIndexes = new Set<number>()
    const staticCircuitJson = convertToCircuitJson(params.inputSrj, [], {
      originalSrj: params.inputSrj,
      representedPadObstacleIndexes,
    })
    this.staticConnectivityMap =
      getFullConnectivityMapFromCircuitJson(staticCircuitJson)
    this.srjConnectivityMap = getConnectivityMapFromSimpleRouteJson(
      params.inputSrj,
    )
    const routeAliasPairs = params.hdRoutes
      .filter(
        (route): route is HighDensityRoute & { rootConnectionName: string } =>
          typeof route.rootConnectionName === "string" &&
          route.rootConnectionName.length > 0 &&
          route.rootConnectionName !== route.connectionName,
      )
      .map((route): [string, string] => [
        route.connectionName,
        route.rootConnectionName,
      ])
    if (routeAliasPairs.length > 0) {
      this.staticConnectivityMap.addConnections(routeAliasPairs)
      this.srjConnectivityMap.addConnections(routeAliasPairs)
    }
    const fixedCopperObstacleIndexes = getFixedCopperObstacleIndexes({
      inputSrj: params.inputSrj,
      representedPadObstacleIndexes,
    })
    this.fixedViaObstacleIndexes = new Set(
      [...fixedCopperObstacleIndexes].filter((obstacleIndex) => {
        const obstacle = params.inputSrj.obstacles[obstacleIndex]!
        return obstacle.shape === "circle" && obstacle.layers.length > 1
      }),
    )
    const pads: IndexedPad[] = staticCircuitJson
      .filter(
        (element): element is PadElement =>
          element.type === "pcb_smtpad" || element.type === "pcb_plated_hole",
      )
      .map((pad, order) => {
        const compiled = compileTraceClearanceObstacle(pad, order)
        return { ...compiled, ...compiled.clearanceBounds }
      })
    for (const obstacleIndex of fixedCopperObstacleIndexes) {
      if (this.fixedViaObstacleIndexes.has(obstacleIndex)) continue
      const obstacle = params.inputSrj.obstacles[obstacleIndex]!
      const layers = obstacle.layers.filter((layer) =>
        this.allBoardLayers.includes(layer),
      )
      if (layers.length === 0) continue
      const padId = obstacle.obstacleId ?? `fixed_pad_${obstacleIndex}`
      const syntheticElement: PadElement =
        obstacle.shape === "circle"
          ? {
              type: "pcb_smtpad",
              pcb_smtpad_id: padId,
              shape: "circle",
              x: obstacle.center.x,
              y: obstacle.center.y,
              radius: Math.min(obstacle.width, obstacle.height) / 2,
              layer: layers[0]! as "top",
            }
          : typeof obstacle.ccwRotationDegrees === "number" &&
              Math.abs(obstacle.ccwRotationDegrees % 180) > 1e-8
            ? {
                type: "pcb_smtpad",
                pcb_smtpad_id: padId,
                shape: "rotated_rect",
                x: obstacle.center.x,
                y: obstacle.center.y,
                width: obstacle.width,
                height: obstacle.height,
                ccw_rotation: obstacle.ccwRotationDegrees,
                layer: layers[0]! as "top",
              }
            : {
                type: "pcb_smtpad",
                pcb_smtpad_id: padId,
                shape: "rect",
                x: obstacle.center.x,
                y: obstacle.center.y,
                width: obstacle.width,
                height: obstacle.height,
                layer: layers[0]! as "top",
              }
      const compiled = compileTraceClearanceObstacle(
        syntheticElement,
        pads.length,
      )
      pads.push({
        ...compiled,
        ...compiled.clearanceBounds,
        layers,
        sourceObstacle: obstacle,
      })
    }
    this.padIndex = new RBush<IndexedPad>()
    this.padIndex.load(pads)
    this.hasIndexedPads = pads.length > 0
    this.evaluateFixedObstacles = createFixedObstacleViolationEvaluator({
      srj: {
        ...params.inputSrj,
        traces: undefined,
        // The checker represents circular copper as an equal-width oval.
        obstacles: params.inputSrj.obstacles.map((obstacle) =>
          obstacle.shape === "circle"
            ? { ...obstacle, type: "oval" as const, height: obstacle.width }
            : obstacle,
        ),
      },
      routes: params.hdRoutes,
      traceClearance:
        params.inputSrj.minTraceToPadEdgeClearance ??
        params.inputSrj.defaultObstacleMargin ??
        RELAXED_DRC_OPTIONS.traceClearance,
      viaClearance: this.viaClearance,
    })
  }

  override getConstructorParams(): readonly [ForceImproveConstructorParams] {
    return [
      {
        ...super.getConstructorParams()[0],
        inputSrj: this.inputSrj,
      },
    ]
  }

  private isRouteConnectedToPad(
    route: HighDensityRoute,
    pad: IndexedPad,
  ): boolean {
    if (
      pad.sourceObstacle &&
      isObstacleConnectedToRoute(
        pad.sourceObstacle,
        route,
        this.srjConnectivityMap,
      )
    ) {
      return true
    }
    const padId = pad.id
    const names = [route.connectionName, route.rootConnectionName].filter(
      (name): name is string => typeof name === "string" && name.length > 0,
    )
    return names.some(
      (name) =>
        name === padId ||
        this.staticConnectivityMap.areIdsConnected(name, padId) ||
        this.srjConnectivityMap.areIdsConnected(name, padId),
    )
  }

  private getRouteCandidateVias(route: HighDensityRoute): CandidateVia[] {
    const radius = (route.viaDiameter ?? this.defaultViaDiameter) / 2
    const vias: CandidateVia[] = []
    const coveredLocations = new Set<string>()
    for (let index = 1; index < route.route.length; index++) {
      const prevPoint = route.route[index - 1]!
      const currPoint = route.route[index]!
      if (
        prevPoint.z === currPoint.z ||
        (prevPoint as { toNextSegmentType?: string }).toNextSegmentType ===
          "through_obstacle"
      ) {
        continue
      }
      const minZ = Math.min(prevPoint.z, currPoint.z)
      const maxZ = Math.max(prevPoint.z, currPoint.z)
      const layers =
        this.inputSrj.allowBlindAndBuriedVias === true
          ? Array.from({ length: maxZ - minZ + 1 }, (_, offset) =>
              mapZToLayerName(minZ + offset, this.inputSrj.layerCount),
            )
          : this.allBoardLayers
      const key = `${currPoint.x.toFixed(6)},${currPoint.y.toFixed(6)},${layers.join(",")}`
      if (coveredLocations.has(key)) continue
      coveredLocations.add(key)
      vias.push({ x: currPoint.x, y: currPoint.y, radius, layers })
    }
    for (const via of route.vias) {
      const key = `${via.x.toFixed(6)},${via.y.toFixed(6)},${this.allBoardLayers.join(",")}`
      if (
        coveredLocations.has(key) ||
        vias.some(
          (existing) =>
            Math.abs(existing.x - via.x) <= CLEARANCE_SEVERITY_EPSILON &&
            Math.abs(existing.y - via.y) <= CLEARANCE_SEVERITY_EPSILON,
        )
      ) {
        continue
      }
      coveredLocations.add(key)
      vias.push({
        x: via.x,
        y: via.y,
        radius,
        layers: this.allBoardLayers,
      })
    }
    return vias
  }

  private evaluatePadViaViolations(
    routes: HighDensityRoute[],
  ): Map<ViaClearanceViolationKey, number> {
    const severityByKey = new Map<ViaClearanceViolationKey, number>()
    for (const [routeIndex, route] of routes.entries()) {
      for (const via of this.getRouteCandidateVias(route)) {
        const searchReach =
          via.radius + this.viaClearance + CLEARANCE_SEVERITY_EPSILON
        const nearbyPads = this.padIndex.search({
          minX: via.x - searchReach,
          minY: via.y - searchReach,
          maxX: via.x + searchReach,
          maxY: via.y + searchReach,
        })
        for (const pad of nearbyPads) {
          if (!via.layers.some((layer) => pad.layers.includes(layer))) continue
          const sameNet = this.isRouteConnectedToPad(route, pad)
          if (sameNet && this.inputSrj.allowViaInPad !== false) continue
          const requiredClearance = sameNet ? 0 : this.viaClearance
          const gap = getViaToIndexedPadGap(via, pad)
          const severity = requiredClearance - gap
          if (severity <= CLEARANCE_SEVERITY_EPSILON) continue
          const key = `pad-via:${routeIndex}:${pad.id}`
          if ((severityByKey.get(key) ?? -Infinity) < severity) {
            severityByKey.set(key, severity)
          }
        }
      }
    }
    return severityByKey
  }

  private validateImprovedSample(routeIndexes: number[]): void {
    if (this.fixedViaObstacleIndexes.size === 0 && !this.hasIndexedPads) return
    const originalRoutes = routeIndexes.map(
      (routeIndex) => this.originalHdRoutes[routeIndex],
    )
    const candidateRoutes = routeIndexes.map((routeIndex) => {
      const route = this.improvedRoutesByIndex.get(routeIndex)
      if (!route) throw new Error("Force improvement lost a node's candidate")
      return route
    })
    let worsensViaClearance = false
    if (this.fixedViaObstacleIndexes.size > 0) {
      // Leave existing via conflicts to repair without worsening their clearance.
      const originalSeverityByKey = new Map<ViaClearanceViolationKey, number>(
        this.evaluateFixedObstacles(originalRoutes)
          .filter(
            (violation) =>
              violation.kind === "via" &&
              this.fixedViaObstacleIndexes.has(violation.obstacleIndex),
          )
          .map((violation) => [violation.key, violation.severity]),
      )
      worsensViaClearance = this.evaluateFixedObstacles(candidateRoutes).some(
        (violation) =>
          violation.kind === "via" &&
          this.fixedViaObstacleIndexes.has(violation.obstacleIndex) &&
          violation.severity >
            (originalSeverityByKey.get(violation.key) ?? 0) +
              CLEARANCE_SEVERITY_EPSILON,
      )
    }
    if (!worsensViaClearance && this.hasIndexedPads) {
      const originalPadSeverityByKey =
        this.evaluatePadViaViolations(originalRoutes)
      for (const [key, severity] of this.evaluatePadViaViolations(
        candidateRoutes,
      )) {
        if (
          severity >
          (originalPadSeverityByKey.get(key) ?? 0) + CLEARANCE_SEVERITY_EPSILON
        ) {
          worsensViaClearance = true
          break
        }
      }
    }
    if (!worsensViaClearance) return
    // A node's routes move together; accepting only some can introduce peer shorts.
    for (const routeIndex of routeIndexes) {
      this.improvedRoutesByIndex.delete(routeIndex)
    }
    this.stats.improvedRouteCount = this.improvedRoutesByIndex.size
  }

  async solveAsync(
    runtime?: SolverRuntimeExecutor,
    stopAtIteration = Infinity,
  ): Promise<void> {
    if (this.asyncRunning)
      throw new Error(
        "High-density force improvement solveAsync is already running",
      )
    if (this.solved || this.failed || this.iterations >= stopAtIteration) return
    const startTime = performance.now()
    this.asyncRunning = true
    try {
      if (runtime === undefined) {
        this.solveUntilIteration(stopAtIteration)
        return
      }
      // A node consumes one native step; leave the exhaustion step to the host.
      const parallelSampleCount = Math.max(
        0,
        Math.floor(
          Math.min(this.MAX_ITERATIONS, stopAtIteration) - this.iterations,
        ),
      )
      const pending = this.sampleEntries
        .slice(
          this.activeSampleIndex,
          this.activeSampleIndex + parallelSampleCount,
        )
        .map((entry) =>
          runtime
            .executeAsync(Pipeline9HighDensityForceImproveSampleSolver, {
              nodeWithPortPoints: [entry.node],
              fixedHdRoutes: this.getFixedRoutesForNode(entry.node),
              hdRoutes: entry.routeIndexes.map(
                (routeIndex) => this.originalHdRoutes[routeIndex],
              ),
              totalStepsPerNode: this.totalStepsPerNode,
              nodeAssignmentMargin: this.nodeAssignmentMargin,
              preserveTopologyPortAnchors: this.preserveTopologyPortAnchors,
              colorMap: Object.fromEntries(
                entry.routeIndexes.map((routeIndex) => {
                  const name = this.originalHdRoutes[routeIndex].connectionName
                  return [name, this.colorMap[name]]
                }),
              ),
            })
            .then(
              (result) => ({ type: "result" as const, result }),
              (error: unknown) => ({ type: "error" as const, error }),
            ),
        )
      for (const promise of pending) {
        if (
          this.solved ||
          this.failed ||
          this.iterations >= Math.min(this.MAX_ITERATIONS, stopAtIteration)
        ) {
          break
        }
        const outcome = await promise
        if (outcome.type === "error") throw outcome.error
        this.completedSample = outcome.result
        this.step()
      }
      this.solveUntilIteration(stopAtIteration)
    } catch (error) {
      this.failed = true
      this.error = `High-density force improvement runtime error: ${error}`
      throw error
    } finally {
      this.completedSample = undefined
      this.asyncRunning = false
      this.timeToSolve = performance.now() - startTime
    }
  }

  private solveUntilIteration(stopAtIteration: number): void {
    while (!this.solved && !this.failed && this.iterations < stopAtIteration) {
      this.step()
    }
  }

  override _step(): void {
    const result = this.completedSample
    if (!result) {
      const entry = this.sampleEntries[this.activeSampleIndex]
      super._step()
      if (entry) this.validateImprovedSample(entry.routeIndexes)
      return
    }
    this.completedSample = undefined
    const entry = this.sampleEntries[this.activeSampleIndex]
    if (!entry || result.routes.length !== entry.routeIndexes.length) {
      throw new Error("Force-improve result does not match the current node")
    }
    for (const [index, routeIndex] of entry.routeIndexes.entries()) {
      this.improvedRoutesByIndex.set(routeIndex, result.routes[index])
    }
    this.validateImprovedSample(entry.routeIndexes)
    this.latestVisualization = result.latestVisualization
    this.activeSampleIndex += 1
    this.stats = {
      nodeAssignmentMargin: this.nodeAssignmentMargin,
      sampleCount: this.sampleEntries.length,
      improvedNodeCount: this.activeSampleIndex,
      improvedRouteCount: this.improvedRoutesByIndex.size,
      totalStepsPerNode: this.totalStepsPerNode,
    }
    if (this.activeSampleIndex >= this.sampleEntries.length) this.solved = true
  }
}
