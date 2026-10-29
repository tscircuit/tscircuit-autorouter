import { defaultB01Params } from "@tscircuit/high-density-b01"
import { pointToSegmentDistance } from "@tscircuit/math-utils"
import type { HighDensityRoute } from "lib/types/high-density-types"
import {
  asRegionalRoutes,
  type Pipeline9RegionalB01RepairParams,
} from "./applyPipeline9RegionalB01Repairs"
import { arePipeline9RoutesOnSameNet } from "./pipeline9FixedRouteCopper"
import { Pipeline9HighDensitySolver } from "./Pipeline9HighDensitySolver"
import {
  createRegionalFallbackProblem,
  spliceFixedRouteSection,
  type FixedRouteSection,
} from "./pipeline9RegionalFallback"

export type Pipeline9TracePairRepair = {
  solver: Pipeline9HighDensitySolver
  routes: HighDensityRoute[]
  sections: Map<number, FixedRouteSection>
}

/** Coupled crossings need both routes movable and their real terminal anchors. */
export const preparePipeline9TracePairRepair = ({
  routeIndexes,
  ...params
}: Pipeline9RegionalB01RepairParams & {
  routeIndexes: [number, number]
}): Pipeline9TracePairRepair | undefined => {
  const { routes, connMap, srj, fixedObstacleRoutes } = params
  const selectedRoutes = routeIndexes.map((index) => routes[index]!)
  // Whole-route candidates cannot relocate internal anchors or reproduce
  // jumper, through-obstacle, or variable-width copper contracts.
  if (
    selectedRoutes.some(
      (route) =>
        params.syntheticConnectionNames.has(route.connectionName) ||
        (route.jumpers?.length ?? 0) > 0 ||
        route.route.some(
          (point, index) =>
            point.insideJumperPad ||
            point.toNextSegmentType !== undefined ||
            point.toNextSegmentCircuitJsonMetadata !== undefined ||
            (point.traceThickness !== undefined &&
              point.traceThickness !== route.traceThickness) ||
            (point.pcb_port_id !== undefined &&
              index > 0 &&
              index < route.route.length - 1),
        ),
    )
  ) {
    return undefined
  }
  const points = selectedRoutes.flatMap((route) => route.route)
  if (
    points.some(
      (point) =>
        point.x < srj.bounds.minX ||
        point.x > srj.bounds.maxX ||
        point.y < srj.bounds.minY ||
        point.y > srj.bounds.maxY,
    )
  ) {
    return undefined
  }
  for (const route of selectedRoutes) {
    const routeStart = route.route[0]!
    const routeEnd = route.route.at(-1)!
    const adjacentRoutes = [...routes, ...fixedObstacleRoutes].filter(
      (other) =>
        other !== route && arePipeline9RoutesOnSameNet(route, other, connMap),
    )
    for (const other of adjacentRoutes) {
      for (const anchor of [other.route[0]!, other.route.at(-1)!]) {
        if (
          (anchor.z === routeStart.z &&
            Math.hypot(anchor.x - routeStart.x, anchor.y - routeStart.y) < 1e-9) ||
          (anchor.z === routeEnd.z &&
            Math.hypot(anchor.x - routeEnd.x, anchor.y - routeEnd.y) < 1e-9)
        ) {
          continue
        }
        for (let index = 1; index < route.route.length; index++) {
          const start = route.route[index - 1]!
          const end = route.route[index]!
          if (
            anchor.z >= Math.min(start.z, end.z) &&
            anchor.z <= Math.max(start.z, end.z) &&
            pointToSegmentDistance(anchor, start, end) < 1e-9
          ) {
            return undefined
          }
        }
      }
    }
  }
  const traceWidth = Math.max(
    params.traceWidth,
    ...selectedRoutes.map((route) => route.traceThickness),
    ...points.map((point) => point.traceThickness ?? params.traceWidth),
  )
  const viaDiameter = Math.max(
    params.viaDiameter,
    ...selectedRoutes.map((route) => route.viaDiameter),
  )
  const obstacleClearance = Math.max(
    params.obstacleMargin,
    srj.minViaEdgeToPadEdgeClearance ?? params.obstacleMargin,
    srj.minTraceToHoleEdgeClearance ?? params.obstacleMargin,
  )
  const padding = viaDiameter + obstacleClearance
  const minX = Math.max(srj.bounds.minX, Math.min(...points.map((p) => p.x)) - padding)
  const maxX = Math.min(srj.bounds.maxX, Math.max(...points.map((p) => p.x)) + padding)
  const minY = Math.max(srj.bounds.minY, Math.min(...points.map((p) => p.y)) - padding)
  const maxY = Math.min(srj.bounds.maxY, Math.max(...points.map((p) => p.y)) + padding)
  // B01's existing routing-window limit bounds the fine-grid pair search.
  if (maxX - minX > 15 || maxY - minY > 15) return undefined
  const regionalRoutes = asRegionalRoutes(routes, connMap)
  const node = {
    capacityMeshNodeId: "pipeline9_trace_pair_repair",
    center: { x: (minX + maxX) / 2, y: (minY + maxY) / 2 },
    width: maxX - minX,
    height: maxY - minY,
    availableZ: Array.from({ length: srj.layerCount }, (_, z) => z),
    portPoints: [],
    portPointsInPairs: [],
  }
  const problem = createRegionalFallbackProblem(
    node,
    routeIndexes.map((index) => regionalRoutes[index]!),
  )
  if (problem.fixedRouteSectionsByConnectionName.size !== 2) return undefined
  const sections = new Map<number, FixedRouteSection>()
  for (const index of routeIndexes) {
    sections.set(
      index,
      problem.fixedRouteSectionsByConnectionName.get(
        regionalRoutes[index]!.connectionName,
      )!,
    )
  }
  const fixedRoutes = regionalRoutes.filter((_, index) => !sections.has(index))
  const solver = new Pipeline9HighDensitySolver({
    nodePortPoints: [problem.nodeWithPortPoints],
    fixedHdRoutes: [...fixedRoutes, ...fixedObstacleRoutes].map((route) => ({
      ...route,
      rootConnectionName:
        connMap.getNetConnectedToId(
          route.rootConnectionName ?? route.connectionName,
        ) ??
        route.rootConnectionName ??
        route.connectionName,
    })),
    connMap,
    colorMap: params.colorMap,
    obstacles: srj.obstacles,
    layerCount: srj.layerCount,
    allowBlindAndBuriedVias: srj.allowBlindAndBuriedVias,
    viaDiameter,
    traceWidth,
    obstacleMargin: params.obstacleMargin,
    effort: params.effort,
    preserveTerminalPcbPortIds: true,
    includeBoardObstacles: true,
    enableRegionalFallback: false,
    maxB01Rips: 120,
    b01RepairOptions: {
      // Interior terminals can need narrow channels throughout this window,
      // beyond the fine perimeter band used for ordinary B01 nodes.
      lowResolutionCellSize: defaultB01Params.highResolutionCellSize,
      obstacleClearanceMargin: obstacleClearance,
    },
  })
  return { solver, routes, sections }
}

export const getPipeline9TracePairRepairOutput = ({
  solver,
  routes,
  sections,
}: Pipeline9TracePairRepair): HighDensityRoute[] | undefined => {
  if (!solver.solved || solver.failed) return undefined
  return routes.map((route, index) => {
    const section = sections.get(index)
    if (!section) return route
    const replacement = solver.routes.find(
      (candidate) =>
        candidate.connectionName === section.sourceRoutes[0]!.connectionName,
    )
    if (!replacement) throw new Error("Completed pair repair is missing a route")
    return {
      ...spliceFixedRouteSection(section, replacement),
      connectionName: route.connectionName,
    }
  })
}
