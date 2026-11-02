import { expect, spyOn, test } from "bun:test"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import type { SimpleRouteJson } from "lib/types"

test("Pipeline9 refuses to publish via-in-pad left after repair and cleanup", (): void => {
  const source: SimpleRouteJson = {
    layerCount: 2,
    minTraceWidth: 0.1,
    minViaDiameter: 0.3,
    minViaHoleDiameter: 0.15,
    bounds: { minX: -3, maxX: 3, minY: -3, maxY: 3 },
    obstacles: [
      {
        type: "rect",
        center: { x: -2, y: 0 },
        width: 0.6,
        height: 0.6,
        layers: ["top"],
        connectedTo: ["signal", "start"],
        circuitJsonMetadata: {
          pcb_smtpad_id: "start_pad",
          pcb_port_id: "start",
        },
      },
    ],
    connections: [
      {
        name: "signal",
        pointsToConnect: [
          { x: -2, y: 0, layer: "top", pcb_port_id: "start" },
          { x: 2, y: 0, layer: "top", pcb_port_id: "end" },
        ],
      },
    ],
  }
  for (const allowViaInPad of [false, undefined, true] as const) {
    const pipeline = new AutoroutingPipelineSolver9_PreloadedTraceGraph(
      {
        ...structuredClone(source),
        allowViaInPad,
      },
      { cacheProvider: null },
    )
    pipeline.solveUntilPhase("powerTraceExpansionSolver")
    pipeline.step()
    const expansion = pipeline.powerTraceExpansionSolver!
    expansion.solve()
    const routes = structuredClone(expansion.getOutput())
    const trace = routes[0]!
    const start = trace.route[0]!
    if (start.route_type !== "wire") throw new Error("Expected a wire start")
    // Model an unresolved intermediate repair at a same-net terminal pad.
    trace.route.splice(
      1,
      0,
      {
        route_type: "via",
        x: start.x,
        y: start.y,
        from_layer: "top",
        to_layer: "bottom",
      },
      {
        route_type: "via",
        x: start.x,
        y: start.y,
        from_layer: "bottom",
        to_layer: "top",
      },
    )
    const output = spyOn(expansion, "getOutput").mockReturnValue(routes)
    try {
      pipeline.solve()
      if (allowViaInPad === true) {
        expect(pipeline.solved).toBe(true)
        expect(pipeline.failed).toBe(false)
      } else {
        expect(pipeline.solved).toBe(false)
        expect(pipeline.failed).toBe(true)
        expect(pipeline.error).toContain("forbidden via-in-pad")
        expect(() => pipeline.getOutputSimpleRouteJson()).toThrow()
        expect(() => pipeline.getOutputSimplifiedPcbTraces()).toThrow()
      }
    } finally {
      output.mockRestore()
    }
  }
})
