import { expect, test } from "bun:test"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { GlobalDrcForceImproveSolver } from "high-density-repair03/lib"
import { AutoroutingPipelineSolver7_MultiGraph } from "lib/autorouter-pipelines/AutoroutingPipeline7_MultiGraph/AutoroutingPipelineSolver7_MultiGraph"
import type { SimpleRouteJson } from "lib/types"
import type { HighDensityRoute } from "lib/types/high-density-types"

test("pipeline 7 GlobalDrc inputs keep same-net via on connMap pad", () => {
  const srj: SimpleRouteJson = {
    bounds: { minX: -1, minY: -1, maxX: 11, maxY: 7 },
    connections: [
      { name: "route-a", pointsToConnect: [] },
      { name: "route-b", pointsToConnect: [] },
    ],
    obstacles: [
      {
        type: "rect",
        center: { x: 2, y: 5 },
        width: 1,
        height: 1,
        layers: ["top", "bottom"],
        connectedTo: ["route-b"],
      },
    ],
    layerCount: 2,
    minTraceWidth: 0.1,
    minViaDiameter: 0.3,
  }
  const hdRoutes: HighDensityRoute[] = [
    {
      connectionName: "route-a",
      route: [
        { x: 0, y: 5, z: 0 },
        { x: 2, y: 5, z: 0 },
        { x: 2, y: 5, z: 1 },
        { x: 5, y: 5, z: 1 },
      ],
      vias: [{ x: 2, y: 5 }],
      traceThickness: 0.1,
      viaDiameter: 0.3,
    },
  ]

  const pipeline = new AutoroutingPipelineSolver7_MultiGraph(srj)
  pipeline.connMap = new ConnectivityMap({
    net0: ["route-a", "route-b"],
  })
  pipeline.srjWithPointPairs = srj

  const solver = new GlobalDrcForceImproveSolver({
    srj: (pipeline as any).getConnMapAwareGlobalDrcSrj(),
    hdRoutes: (pipeline as any).getConnMapAwareGlobalDrcHdRoutes(hdRoutes),
    maxIterations: 1,
    enableLargeBoardBroadFallback: false,
    drcEvaluator: () => [
      {
        message: "pcb_via overlaps pcb_smtpad",
        center: { x: 2, y: 5 },
        pcb_trace_id: "route-a_0",
      },
    ],
  })

  solver.solve()

  const output = solver.getOutput()[0]
  expect(output?.route).toEqual(hdRoutes[0]!.route)
  expect(output?.vias).toEqual(hdRoutes[0]!.vias)
})
