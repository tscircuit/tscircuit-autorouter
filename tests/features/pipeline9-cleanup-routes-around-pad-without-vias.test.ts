import { expect, test } from "bun:test"
import { convertRepairRoutesToTraces } from "@tscircuit/repair04"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { Pipeline9EffortCleanupSolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9EffortCleanupSolver"
import { evaluateRelaxedDrc } from "lib/testing/evaluate-relaxed-drc"
import type { SimpleRouteJson } from "lib/types"
import type { HighDensityRoute } from "lib/types/high-density-types"

test("cleanup searches a planar path when a via-pair corridor detour is too long", (): void => {
  const srj: SimpleRouteJson = {
    layerCount: 2,
    minTraceWidth: 0.15,
    minTraceToPadEdgeClearance: 0.2,
    minBoardEdgeClearance: 0.5,
    bounds: { minX: -10, maxX: 10, minY: -10, maxY: 10 },
    connections: [{
      name: "signal",
      pointsToConnect: [
        { x: 0, y: 0, layer: "top", pcb_port_id: "start" },
        { x: 6, y: 0, layer: "top", pcb_port_id: "end" },
      ],
    }],
    obstacles: [{
      type: "rect",
      center: { x: 3, y: 0 },
      width: 1,
      height: 4,
      layers: ["top"],
      connectedTo: ["other-net"],
    }],
  }
  const route: HighDensityRoute = {
    connectionName: "signal",
    traceThickness: 0.15,
    viaDiameter: 0.5,
    route: [
      { x: 0, y: 0, z: 0, pcb_port_id: "start" },
      { x: 1, y: 0, z: 0 },
      { x: 1, y: 0, z: 1 },
      { x: 5, y: 0, z: 1 },
      { x: 5, y: 0, z: 0 },
      { x: 6, y: 0, z: 0, pcb_port_id: "end" },
    ],
    vias: [{ x: 1, y: 0 }, { x: 5, y: 0 }],
  }
  const original = structuredClone(route)
  const solver = new Pipeline9EffortCleanupSolver({
    effort: 1,
    srj,
    config: {
      hdRoutes: [route],
      obstacles: srj.obstacles,
      minTraceToPadEdgeClearance: srj.minTraceToPadEdgeClearance,
      connMap: new ConnectivityMap({ signal: ["signal"] }),
      colorMap: {},
      defaultViaDiameter: 0.5,
      layerCount: 2,
      preserveRouteEndpoints: true,
      enableCrossingViaReduction: true,
    },
    getCost: (candidate) => ({
      vias: candidate.reduce((sum, branch) => sum + branch.vias.length, 0),
      points: candidate.reduce((sum, branch) => sum + branch.route.length, 0),
    }),
    isValid: (candidate) => evaluateRelaxedDrc({
      inputSrj: srj,
      srjWithPointPairs: srj,
      routedTraces: convertRepairRoutesToTraces(candidate, 2),
      includeBoardClearance: true,
      drcOptions: { traceClearance: srj.minTraceToPadEdgeClearance },
    }).errors.length === 0,
  })

  solver.solve()

  expect(solver.bestCost.vias).toBe(0)
  expect(solver.getOutput()[0]!.route.every((point) => point.z === 0)).toBe(true)
  expect(solver.getOutput()[0]!.route[0]).toEqual(original.route[0])
  expect(solver.getOutput()[0]!.route.at(-1)).toEqual(original.route.at(-1))
  expect(route).toEqual(original)
})
