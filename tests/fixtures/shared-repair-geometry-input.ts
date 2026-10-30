import type { DrcEvaluator } from "high-density-repair03/lib"
import { Pipeline9JointDrcRepairSolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9JointDrcRepairSolver"
import type { ClearanceMarginDrcEvaluator } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/applyPipeline9ClearancePrecisionRepairs"
import type { SimpleRouteJson } from "lib/types"
import type { HighDensityRoute } from "lib/types/high-density-types"
import { getConnectivityMapFromSimpleRouteJson } from "lib/utils/getConnectivityMapFromSimpleRouteJson"

export type SharedRepairEvaluatorAccess = {
  drcEvaluator: DrcEvaluator
  cachedReferenceDrcEvaluator: DrcEvaluator
  clearancePrecisionDrcEvaluator: DrcEvaluator
  clearancePrecisionIndexedDrcEvaluator: DrcEvaluator
  clearanceMarginDrcEvaluator: ClearanceMarginDrcEvaluator
  indexedDrcEvaluationCount: number
  referenceDrcValidationCount: number
  referenceDrcFalseNegativeCount: number
}

export const createSharedRepairGeometryInput = (
  experimentSharedRepairGeometry?: boolean,
  includePreloadedCopper = false,
): ConstructorParameters<typeof Pipeline9JointDrcRepairSolver>[0] => {
  const routes: HighDensityRoute[] = [
    {
      connectionName: "horizontal",
      rootConnectionName: "horizontal",
      traceThickness: 0.1,
      viaDiameter: 0.4,
      route: [{ x: -2, y: 0, z: 0 }, { x: 2, y: 0, z: 0 }],
      vias: [],
    },
    {
      connectionName: "vertical",
      rootConnectionName: "vertical",
      traceThickness: 0.1,
      viaDiameter: 0.4,
      route: [{ x: 0, y: -2, z: 0 }, { x: 0, y: 2, z: 0 }],
      vias: [],
    },
  ]
  const srj: SimpleRouteJson = {
    layerCount: 2,
    minTraceWidth: 0.1,
    minViaDiameter: 0.4,
    bounds: { minX: -10, minY: -10, maxX: 10, maxY: 10 },
    connections: routes.map((route) => ({
      name: route.connectionName,
      pointsToConnect: route.route.map((point, index) => ({
        x: point.x,
        y: point.y,
        layer: "top",
        pointId: `${route.connectionName}_${index}`,
        pcb_port_id: `${route.connectionName}_port_${index}`,
      })),
    })),
    obstacles: [{
      type: "rect",
      center: { x: 8, y: 8 },
      width: 0.6,
      height: 0.6,
      layers: ["top"],
      connectedTo: ["fixed_net"],
      circuitJsonMetadata: { pcb_smtpad_id: "fixed_pad" },
    }],
    ...(includePreloadedCopper ? { traces: [{
      type: "pcb_trace" as const,
      pcb_trace_id: "horizontal_0",
      connection_name: "fixed_net",
      connectsTo: ["fixed_net"],
      route: [
        { route_type: "wire" as const, x: 7, y: 8, width: 0.1, layer: "top" },
        { route_type: "wire" as const, x: 9, y: 8, width: 0.1, layer: "top" },
      ],
    }] } : {}),
  }
  return {
    ...(experimentSharedRepairGeometry === undefined
      ? {}
      : { experimentSharedRepairGeometry }),
    srj,
    srjWithPointPairs: srj,
    originalSrj: srj,
    newConnections: srj.connections,
    newHdRoutes: routes,
    updatedPreloadedTraces: srj.traces ?? [],
    mutatedPreloadedTraceIds: new Set(),
    connMap: getConnectivityMapFromSimpleRouteJson(srj),
    obstacles: srj.obstacles,
    layerCount: 2,
    defaultViaDiameter: 0.4,
    defaultViaHoleDiameter: 0.2,
    effort: 1,
    colorMap: {},
  }
}

export const createCleanSharedRepairCandidate = (
  routes: HighDensityRoute[],
): HighDensityRoute[] => {
  const candidate = structuredClone(routes)
  candidate[1]!.route = [
    { x: 0, y: -2, z: 0 },
    { x: 0, y: -0.6, z: 0 },
    { x: 0, y: -0.6, z: 1 },
    { x: 0, y: 0.6, z: 1 },
    { x: 0, y: 0.6, z: 0 },
    { x: 0, y: 2, z: 0 },
  ]
  candidate[1]!.vias = [{ x: 0, y: -0.6 }, { x: 0, y: 0.6 }]
  return candidate
}
