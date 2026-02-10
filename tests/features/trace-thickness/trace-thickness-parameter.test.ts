import { test, expect } from "bun:test"
import { AutoroutingPipelineSolver2_PortPointPathing } from "lib/autorouter-pipelines/AutoroutingPipeline2_PortPointPathing/AutoroutingPipelineSolver2_PortPointPathing"
import type { SimpleRouteJson } from "lib/types"

test("trace thickness parameter - supports 2x, 4x, 8x multiples", () => {
  const minTraceWidth = 0.15

  const input: SimpleRouteJson = {
    layerCount: 2,
    minTraceWidth,
    nominalTraceWidth: minTraceWidth * 2, // 0.3mm (2x)
    bounds: { minX: -10, maxX: 10, minY: -10, maxY: 10 },
    connections: [
      {
        name: "power_2x",
        nominalTraceWidth: minTraceWidth * 2, // 0.3mm
        pointsToConnect: [
          { x: -5, y: 0, layer: "top" },
          { x: 5, y: 0, layer: "top" },
        ],
      },
      {
        name: "power_4x",
        nominalTraceWidth: minTraceWidth * 4, // 0.6mm
        pointsToConnect: [
          { x: -5, y: 2, layer: "top" },
          { x: 5, y: 2, layer: "top" },
        ],
      },
      {
        name: "power_8x",
        nominalTraceWidth: minTraceWidth * 8, // 1.2mm
        pointsToConnect: [
          { x: -5, y: 4, layer: "top" },
          { x: 5, y: 4, layer: "top" },
        ],
      },
      {
        name: "signal_default",
        // No nominalTraceWidth specified, should use minTraceWidth
        pointsToConnect: [
          { x: -5, y: -2, layer: "top" },
          { x: 5, y: -2, layer: "top" },
        ],
      },
    ],
    obstacles: [],
  }

  const solver = new AutoroutingPipelineSolver2_PortPointPathing(input)
  solver.solve()

  expect(solver.solved).toBe(true)

  const output = solver.getOutputSimpleRouteJson()
  expect(output.traces).toBeDefined()
  expect(output.traces!.length).toBe(4)

  // Find each trace and verify its width
  const traces = output.traces!

  const power2xTrace = traces.find((t) => t.connection_name === "power_2x")
  const power4xTrace = traces.find((t) => t.connection_name === "power_4x")
  const power8xTrace = traces.find((t) => t.connection_name === "power_8x")
  const signalTrace = traces.find((t) => t.connection_name === "signal_default")

  expect(power2xTrace).toBeDefined()
  expect(power4xTrace).toBeDefined()
  expect(power8xTrace).toBeDefined()
  expect(signalTrace).toBeDefined()

  // Check that wire segments have the correct widths
  const power2xWires = power2xTrace!.route.filter(
    (r) => r.route_type === "wire",
  ) as Array<{ width: number }>
  const power4xWires = power4xTrace!.route.filter(
    (r) => r.route_type === "wire",
  ) as Array<{ width: number }>
  const power8xWires = power8xTrace!.route.filter(
    (r) => r.route_type === "wire",
  ) as Array<{ width: number }>
  const signalWires = signalTrace!.route.filter(
    (r) => r.route_type === "wire",
  ) as Array<{ width: number }>

  // Power traces should have their specified nominal widths (or close to them)
  // The solver may adjust based on clearance, but should attempt to use the nominal width
  expect(power2xWires.length).toBeGreaterThan(0)
  expect(power4xWires.length).toBeGreaterThan(0)
  expect(power8xWires.length).toBeGreaterThan(0)
  expect(signalWires.length).toBeGreaterThan(0)

  // Check that power traces are wider than signal traces
  const power2xWidth = power2xWires[0]?.width ?? 0
  const power4xWidth = power4xWires[0]?.width ?? 0
  const power8xWidth = power8xWires[0]?.width ?? 0
  const signalWidth = signalWires[0]?.width ?? 0

  expect(power2xWidth).toBeGreaterThanOrEqual(minTraceWidth * 1.5)
  expect(power4xWidth).toBeGreaterThanOrEqual(minTraceWidth * 2.5)
  expect(power8xWidth).toBeGreaterThanOrEqual(minTraceWidth * 4)
  expect(power4xWidth).toBeGreaterThan(power2xWidth)
  expect(power8xWidth).toBeGreaterThan(power4xWidth)
  expect(signalWidth).toBeLessThanOrEqual(minTraceWidth * 1.1)
})
