import { expect, test } from "bun:test"
import {
  GlobalDrcForceImproveSolver,
  type HighDensityRoute,
  type SimpleRouteJson,
} from "high-density-repair03/lib"
import { evaluateRelaxedDrc } from "lib/testing/evaluate-relaxed-drc"
import { convertHdRouteToSimplifiedRoute } from "lib/utils/convertHdRouteToSimplifiedRoute"

test("applied Repair03 clears multiple overlaps under the benchmark DRC checker", (): void => {
  const routes: HighDensityRoute[] = Array.from({ length: 8 }, (_, index) => ({
    connectionName: `net_${index}`,
    traceThickness: 0.2,
    viaDiameter: 0.3,
    vias: [],
    route: [
      { x: -10, y: index * 10, z: 0, pcb_port_id: `pcb_port_start_${index}` },
      { x: 10, y: index * 10, z: 0, pcb_port_id: `pcb_port_end_${index}` },
    ],
  }))
  const srj: SimpleRouteJson = {
    layerCount: 1,
    bounds: { minX: -12, maxX: 12, minY: -5, maxY: 75 },
    minTraceWidth: 0.2,
    minViaDiameter: 0.3,
    minTraceToPadEdgeClearance: 0.1,
    connections: routes.map((route) => ({
      name: route.connectionName,
      pointsToConnect: route.route.map((point) => ({
        x: point.x,
        y: point.y,
        layer: "top",
        pcb_port_id: point.pcb_port_id,
      })),
    })),
    obstacles: [
      ...routes.map((_, index) => ({
        type: "rect" as const,
        layers: ["top"],
        center: { x: 0, y: index * 10 },
        width: 2,
        height: 6,
        connectedTo: [`foreign_${index}`, `pcb_smtpad_foreign_${index}`],
      })),
      ...routes.flatMap((route) =>
        route.route.map((point) => ({
          type: "rect" as const,
          layers: ["top"],
          center: { x: point.x, y: point.y },
          width: 0.5,
          height: 0.5,
          connectedTo: [route.connectionName, point.pcb_port_id!],
        })),
      ),
    ],
  }
  const solver = new GlobalDrcForceImproveSolver({
    srj,
    hdRoutes: routes,
    enableSafeTraceLayerMoves: true,
    enableBroadFallback: false,
    enablePostSolveClearanceRelaxation: false,
    maxIterations: 32,
  })
  solver.solve()
  expect(solver.stats.finalDrcIssueCount).toBe(0)
  expect(solver.getOutput()).toHaveLength(routes.length)
  const input = { ...srj, traces: [] }
  const { errors } = evaluateRelaxedDrc({
    inputSrj: input,
    srjWithPointPairs: input,
    includeBoardClearance: true,
    routedTraces: solver.getOutput().map((route) => ({
      type: "pcb_trace" as const,
      pcb_trace_id: route.connectionName,
      connection_name: route.connectionName,
      route: convertHdRouteToSimplifiedRoute(route, srj.layerCount),
    })),
  })
  expect(errors).toEqual([])
  for (const [index, route] of solver.getOutput().entries()) {
    expect(route.route[0]).toEqual(routes[index]!.route[0])
    expect(route.route.at(-1)).toEqual(routes[index]!.route.at(-1))
    expect(route.vias).toEqual([])
  }
})
