import { expect, test } from "bun:test"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import { evaluateRelaxedDrc } from "lib/testing/evaluate-relaxed-drc"
import type { SimpleRouteJson } from "lib/types"

test("through vias clear inner-layer obstacles on different layer stacks", (): void => {
  for (const layerCount of [4, 6, 8]) {
    const input: SimpleRouteJson = {
      layerCount,
      minTraceWidth: 0.1,
      minViaDiameter: 0.3,
      bounds: { minX: -4, maxX: 4, minY: -3, maxY: 3 },
      obstacles: [
        {
          type: "rect",
          center: { x: -3, y: 0 },
          width: 0.5,
          height: 0.5,
          layers: ["top"],
          connectedTo: ["signal", "start_pad"],
          circuitJsonMetadata: {
            pcb_port_id: "start_port",
            pcb_smtpad_id: "start_pad",
          },
        },
        {
          type: "rect",
          center: { x: 3, y: 0 },
          width: 0.5,
          height: 0.5,
          layers: ["bottom"],
          connectedTo: ["signal", "end_pad"],
          circuitJsonMetadata: {
            pcb_port_id: "end_port",
            pcb_smtpad_id: "end_pad",
          },
        },
        {
          type: "rect",
          center: { x: 0, y: 0 },
          width: 2,
          height: 3,
          layers: ["inner1"],
          connectedTo: [],
        },
      ],
      connections: [
        {
          name: "signal",
          pointsToConnect: [
            { x: -3, y: 0, layer: "top", pcb_port_id: "start_port" },
            { x: 3, y: 0, layer: "bottom", pcb_port_id: "end_port" },
          ],
        },
      ],
    }
    const solver = new AutoroutingPipelineSolver9_PreloadedTraceGraph(input, {
      cacheProvider: null,
    })
    solver.solve()
    expect(solver.solved).toBe(true)
    expect(solver.failed).toBe(false)
    const traces = solver.getOutputSimplifiedPcbTraces()
    expect(
      evaluateRelaxedDrc({
        inputSrj: input,
        srjWithPointPairs: solver.srjWithPointPairs!,
        routedTraces: traces,
      }).errors,
    ).toEqual([])
    const vias = traces.flatMap((trace) =>
      trace.route.filter((point) => point.route_type === "via"),
    )
    expect(vias.length).toBeGreaterThan(0)
    for (const via of vias) {
      expect(
        Math.abs(via.x) >= 1 + solver.viaDiameter / 2 ||
          Math.abs(via.y) >= 1.5 + solver.viaDiameter / 2,
      ).toBe(true)
    }
  }
})
