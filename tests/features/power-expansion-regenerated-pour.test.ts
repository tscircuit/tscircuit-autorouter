import { expect, test } from "bun:test"
import { PowerTraceExpansionSolver } from "lib/autorouter-pipelines/AutoroutingPipeline7_MultiGraph/PowerTraceExpansionSolver"
import type { SimpleRouteJson } from "lib/types"

test("power expansion uses declared pad clearance and regeneratable pour outlines", (): void => {
  for (const isCopperPour of [false, true]) {
    const input: SimpleRouteJson = {
      layerCount: 4,
      minTraceWidth: 0.1,
      minTraceToPadEdgeClearance: 0.1,
      bounds: { minX: -6, maxX: 6, minY: -3, maxY: 3 },
      connections: [
        {
          name: "power",
          nominalTraceWidth: 0.8,
          pointsToConnect: [
            { x: -5, y: 0, layer: "inner1" },
            { x: 5, y: 0, layer: "inner1" },
          ],
        },
      ],
      obstacles: [
        {
          type: "rect",
          isCopperPour,
          center: { x: 0, y: 0 },
          width: 12,
          height: 6,
          layers: ["inner1"],
          connectedTo: ["GND"],
        },
      ],
      traces: [
        {
          type: "pcb_trace",
          pcb_trace_id: "power_0",
          connection_name: "power",
          route: [
            { route_type: "wire", x: -5, y: 0, layer: "inner1", width: 0.1 },
            { route_type: "wire", x: 5, y: 0, layer: "inner1", width: 0.1 },
          ],
        },
      ],
    }
    const solver = new PowerTraceExpansionSolver(input, { allowNewVias: false })
    solver.solve()
    expect(solver.solved).toBe(true)
    const widths = solver
      .getOutput()
      .flatMap((trace) =>
        trace.route.flatMap((point) =>
          point.route_type === "wire" ? [point.width] : [],
        ),
      )
    if (isCopperPour) expect(Math.min(...widths)).toBeCloseTo(0.8)
    else expect(Math.max(...widths)).toBeCloseTo(0.1)
    expect(input.obstacles).toHaveLength(1)
  }
})
