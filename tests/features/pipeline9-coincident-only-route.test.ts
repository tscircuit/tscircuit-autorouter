import { expect, test } from "bun:test"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import type { SimpleRouteJson } from "lib/types"

test("Pipeline9 emits a direct-only net once with length matching enabled", (): void => {
  const srj: SimpleRouteJson = {
    layerCount: 2,
    minTraceWidth: 0.1,
    bounds: { minX: -2, maxX: 2, minY: -2, maxY: 2 },
    obstacles: [],
    connections: [
      {
        name: "direct",
        nominalTraceWidth: 0.3,
        pointsToConnect: [
          {
            x: 0,
            y: 0,
            layer: "top",
            pointId: "logical_a",
            pcb_port_id: "pcb_a",
          },
          {
            x: 0,
            y: 0,
            layer: "top",
            pointId: "logical_b",
            pcb_port_id: "pcb_b",
          },
        ],
      },
    ],
    buses: [{ busId: "bus", connectionNames: ["direct"], maxLengthSkew: 0 }],
  }
  const solver = new AutoroutingPipelineSolver9_PreloadedTraceGraph(srj, {
    cacheProvider: null,
  })
  solver.solve()
  expect(solver.solved).toBe(true)
  expect(solver.failed).toBe(false)
  expect(solver.routingSrjWithPointPairs!.connections).toHaveLength(0)
  expect(solver._getOutputHdRoutes()).toHaveLength(1)
  const traces = solver.getOutputSimplifiedPcbTraces()
  expect(traces).toHaveLength(1)
  expect(traces[0].connectsTo).toEqual(["logical_a", "logical_b"])
  expect(traces[0].route).toEqual([
    {
      route_type: "wire",
      x: 0,
      y: 0,
      layer: "top",
      width: 0.3,
      start_pcb_port_id: "pcb_a",
    },
    {
      route_type: "wire",
      x: 0,
      y: 0,
      layer: "top",
      width: 0.3,
      end_pcb_port_id: "pcb_b",
    },
  ])
})
