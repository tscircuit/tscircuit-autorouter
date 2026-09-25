import { expect, test } from "bun:test"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import { evaluateRelaxedDrc } from "lib/testing/evaluate-relaxed-drc"
import type { SimpleRouteJson } from "lib/types"

test("Pipeline9 paths coincident cross-layer terminals before creating a via", (): void => {
  const srj: SimpleRouteJson = {
    layerCount: 2,
    minTraceWidth: 0.1,
    bounds: { minX: -2, maxX: 2, minY: -2, maxY: 2 },
    obstacles: [],
    connections: [
      {
        name: "cross-layer",
        pointsToConnect: [
          { x: 0, y: 0, layer: "top", pointId: "a", pcb_port_id: "pcb_a" },
          { x: 0, y: 0, layer: "bottom", pointId: "b", pcb_port_id: "pcb_b" },
        ],
      },
    ],
  }
  const solver = new AutoroutingPipelineSolver9_PreloadedTraceGraph(srj, {
    cacheProvider: null,
  })
  solver.solve()
  expect(solver.solved).toBe(true)
  expect(solver.failed).toBe(false)
  expect(solver.portPointPathingSolver!.solved).toBe(true)
  const pairs = solver
    .portPointPathingSolver!.getOutput()
    .nodesWithPortPoints.flatMap((node) => node.portPointsInPairs ?? [])
  expect(pairs).toHaveLength(1)
  expect(pairs[0].map((point) => point.pcb_port_id).sort()).toEqual([
    "pcb_a",
    "pcb_b",
  ])
  expect(new Set(pairs[0].map((point) => point.z))).toEqual(new Set([0, 1]))
  const traces = solver.getOutputSimplifiedPcbTraces()
  expect(traces).toHaveLength(1)
  expect(traces[0].connectsTo).toEqual(["a", "b"])
  expect(traces[0].route.some((point) => point.route_type === "via")).toBe(true)
  expect(
    evaluateRelaxedDrc({
      inputSrj: srj,
      srjWithPointPairs: solver.srjWithPointPairs!,
      routedTraces: traces,
    }).errors,
  ).toEqual([])
})
