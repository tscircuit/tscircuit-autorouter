import { expect, test } from "bun:test"
import {
  AutoroutingPipelineSolver,
  AutoroutingPipelineSolver7_MultiGraph,
  AutoroutingPipelineSolver9_PreloadedTraceGraph,
  type SimpleRouteJson,
} from "../lib"

test("the default Pipeline 9 solver routes with and without preloaded traces", () => {
  expect(AutoroutingPipelineSolver).toBe(
    AutoroutingPipelineSolver9_PreloadedTraceGraph,
  )
  expect(AutoroutingPipelineSolver).not.toBe(AutoroutingPipelineSolver7_MultiGraph)

  const input: SimpleRouteJson = {
    layerCount: 2,
    minTraceWidth: 0.15,
    bounds: { minX: 0, minY: 0, maxX: 10, maxY: 10 },
    obstacles: [],
    connections: [
      {
        name: "signal",
        pointsToConnect: [
          { x: 1, y: 2, layer: "top" },
          { x: 9, y: 2, layer: "top" },
        ],
      },
    ],
  }
  const preloadedTrace = {
    type: "pcb_trace" as const,
    pcb_trace_id: "preloaded",
    connection_name: "existing",
    route: [
      { route_type: "wire" as const, x: 1, y: 8, width: 0.15, layer: "top" },
      { route_type: "wire" as const, x: 9, y: 8, width: 0.15, layer: "top" },
    ],
  }

  for (const traces of [[], [preloadedTrace]]) {
    const solver = new AutoroutingPipelineSolver({
      ...structuredClone(input),
      traces: structuredClone(traces),
    })
    solver.solve()

    expect(solver.failed).toBe(false)
    expect(solver.solved).toBe(true)
    const output = solver.getOutputSimpleRouteJson()
    expect(output.traces?.some((trace) => trace.connection_name === "signal")).toBe(true)
    if (traces.length > 0) {
      expect(output.traces).toContainEqual(preloadedTrace)
    }
  }
})
