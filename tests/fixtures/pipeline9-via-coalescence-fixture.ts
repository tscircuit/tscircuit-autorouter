import type { DrcEvaluator } from "high-density-repair03/lib"
import type { Pipeline9FinalViaMergeSolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9FinalViaMergeSolver"
import { addAutoroutingViaTraceIds } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9JointDrcRepairSolver"
import type { Pipeline9DrcError } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/pipeline9JointDrcRepairUtils"
import { evaluateRelaxedDrc } from "lib/testing/evaluate-relaxed-drc"
import type { SimpleRouteJson, SimplifiedPcbTrace } from "lib/types"
import type { HighDensityRoute } from "lib/types/high-density-types"
import { convertHdRouteToSimplifiedRoute } from "lib/utils/convertHdRouteToSimplifiedRoute"
import { getConnectivityMapFromSimpleRouteJson } from "lib/utils/getConnectivityMapFromSimpleRouteJson"

type ViaCoalescenceFixture = {
  routes: HighDensityRoute[]
  srj: SimpleRouteJson
  evaluate: (
    candidate: HighDensityRoute[],
  ) => ReturnType<typeof evaluateRelaxedDrc>
  drcEvaluator: DrcEvaluator
  connMap: ReturnType<typeof getConnectivityMapFromSimpleRouteJson>
}

export const createPipeline9ViaCoalescenceFixture = ({
  distinctNets = false,
  protectedViaEndpoints = false,
  blockingPads = false,
}: {
  distinctNets?: boolean
  protectedViaEndpoints?: boolean
  blockingPads?: boolean
} = {}): ViaCoalescenceFixture => {
  const traceThickness = blockingPads ? 0.02 : 0.1
  const separation = blockingPads ? 0.2 : 0.006
  const routes: HighDensityRoute[] = [0, separation].map((y, index) => ({
    connectionName: `branch_${index}`,
    rootConnectionName: distinctNets ? `net_${index}` : "shared_net",
    traceThickness,
    viaDiameter: 0.3,
    route: [
      { x: protectedViaEndpoints ? 0 : -2, y, z: 0 },
      { x: 0, y, z: 0 },
      { x: 0, y, z: 1 },
      { x: 2, y, z: 1 },
    ],
    vias: [{ x: 0, y }],
  }))
  const srj: SimpleRouteJson = {
    layerCount: 2,
    minTraceWidth: traceThickness,
    minViaDiameter: 0.3,
    minViaHoleEdgeToViaHoleEdgeClearance: 0.1,
    bounds: { minX: -5, maxX: 5, minY: -5, maxY: 5 },
    obstacles: [],
    connections: routes.map((route) => ({
      name: route.connectionName,
      __netConnectionName: route.rootConnectionName,
      pointsToConnect: [route.route[0]!, route.route.at(-1)!].map(
        (point, index) => ({
          x: point.x,
          y: point.y,
          layer: point.z === 0 ? "top" : "bottom",
          pcb_port_id: `${route.connectionName}_port_${index}`,
        }),
      ),
    })),
  }
  srj.obstacles = srj.connections.flatMap((connection) =>
    connection.pointsToConnect.map((point) => ({
      type: "rect" as const,
      center: { x: point.x, y: point.y },
      width: 0.15,
      height: 0.15,
      layers: [point.layer!],
      connectedTo: [connection.name, point.pcb_port_id!],
      circuitJsonMetadata: {
        pcb_smtpad_id: `pad_${point.pcb_port_id}`,
        pcb_port_id: point.pcb_port_id!,
      },
    })),
  )
  if (blockingPads) {
    srj.obstacles.push(
      ...[-1, 1].map((x) => ({
        type: "rect" as const,
        center: { x, y: 0.1 },
        width: 0.05,
        height: 0.14,
        layers: [x < 0 ? "top" : "bottom"],
        connectedTo: [`foreign_pad_${x}`],
        circuitJsonMetadata: {
          pcb_smtpad_id: `foreign_pad_${x}`,
          pcb_port_id: `foreign_port_${x}`,
        },
      })),
    )
  }
  const evaluate = (
    candidate: HighDensityRoute[],
  ): ReturnType<typeof evaluateRelaxedDrc> => {
    const routedTraces: SimplifiedPcbTrace[] = candidate.map((route) => ({
      type: "pcb_trace",
      pcb_trace_id: `${route.connectionName}_0`,
      connection_name: route.connectionName,
      route: convertHdRouteToSimplifiedRoute(route, 2, {
        defaultViaHoleDiameter: 0.2,
      }),
    }))
    return evaluateRelaxedDrc({
      inputSrj: srj,
      srjWithPointPairs: srj,
      routedTraces,
      includeBoardClearance: true,
      drcOptions: { viaClearance: 0.1, traceClearance: 0.01 },
    })
  }
  const drcEvaluator: DrcEvaluator = ({ routes: candidate, hdRoutes }) => {
    const evaluatedRoutes = candidate ?? hdRoutes
    if (!evaluatedRoutes) throw new Error("Missing coalescence candidate")
    const result = evaluate(evaluatedRoutes)
    return {
      errors: result.errors as unknown as Pipeline9DrcError[],
      errorsWithCenters:
        result.errorsWithCenters as unknown as Pipeline9DrcError[],
    }
  }
  return {
    routes,
    srj,
    evaluate,
    drcEvaluator,
    connMap: getConnectivityMapFromSimpleRouteJson(srj),
  }
}

export const getPipeline9ViaCoalescenceInput = (
  fixture: ViaCoalescenceFixture,
  fixedRoutes: readonly HighDensityRoute[] = [],
): ConstructorParameters<typeof Pipeline9FinalViaMergeSolver>[0] => {
  return {
    srj: fixture.srj,
    routes: fixture.routes,
    newConnections: fixture.srj.connections,
    syntheticConnectionNames: new Set<string>(),
    fixedRoutes,
    connMap: fixture.connMap,
    drcEvaluator: fixture.drcEvaluator,
    prepareReference: (routes: HighDensityRoute[]) => {
      const reference = fixture.evaluate(routes)
      return {
        errors: addAutoroutingViaTraceIds({
          errors: reference.errors as unknown as Pipeline9DrcError[],
          circuitJson: reference.circuitJson,
          evaluatedTraceIds: new Set(
            routes.map((route) => `${route.connectionName}_0`),
          ),
        }),
        circuitJson: reference.circuitJson,
      }
    },
  }
}
