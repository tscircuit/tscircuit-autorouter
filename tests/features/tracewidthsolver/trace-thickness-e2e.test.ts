import { test, expect } from "bun:test"
import { AssignableAutoroutingPipeline3 } from "lib/autorouter-pipelines/AssignableAutoroutingPipeline3/AssignableAutoroutingPipeline3"
import type { SimpleRouteJson } from "lib/types"

/**
 * End-to-end test: routes a board with mixed trace thickness multipliers
 * through AssignableAutoroutingPipeline3, verifying the output traces
 * carry per-connection widths.
 *
 * This is the primary integration test for issue #66.
 */
test("AssignableAutoroutingPipeline3 - routes with per-connection trace thickness", () => {
  const srj: SimpleRouteJson = {
    layerCount: 2,
    minTraceWidth: 0.15,
    obstacles: [
      {
        type: "rect",
        layers: ["top"],
        center: { x: -2, y: 0 },
        width: 1,
        height: 1,
        connectedTo: ["VCC"],
      },
      {
        type: "rect",
        layers: ["top"],
        center: { x: 12, y: 0 },
        width: 1,
        height: 1,
        connectedTo: ["VCC"],
      },
      {
        type: "rect",
        layers: ["top"],
        center: { x: -2, y: 5 },
        width: 1,
        height: 1,
        connectedTo: ["DATA"],
      },
      {
        type: "rect",
        layers: ["top"],
        center: { x: 12, y: 5 },
        width: 1,
        height: 1,
        connectedTo: ["DATA"],
      },
    ],
    connections: [
      {
        name: "VCC",
        traceWidthMultiplier: 4, // 0.6mm trace for power
        pointsToConnect: [
          { x: -2, y: 0, layer: "top" },
          { x: 12, y: 0, layer: "top" },
        ],
      },
      {
        name: "DATA",
        // No multiplier -- uses minTraceWidth (0.15mm)
        pointsToConnect: [
          { x: -2, y: 5, layer: "top" },
          { x: 12, y: 5, layer: "top" },
        ],
      },
    ],
    bounds: { minX: -5, maxX: 15, minY: -5, maxY: 10 },
  }

  const solver = new AssignableAutoroutingPipeline3(srj)
  solver.solve()

  expect(solver.solved).toBe(true)
  expect(solver.failed).toBe(false)

  const output = solver.getOutputSimpleRouteJson()
  expect(output.traces).toBeDefined()
  expect(output.traces!.length).toBeGreaterThan(0)

  // Find traces for each connection
  const vccTraces = output.traces!.filter((t) => t.connection_name === "VCC")
  const dataTraces = output.traces!.filter((t) => t.connection_name === "DATA")

  expect(vccTraces.length).toBeGreaterThan(0)
  expect(dataTraces.length).toBeGreaterThan(0)

  // Check that VCC trace wires have width > minTraceWidth (due to 4x multiplier)
  const vccWires = vccTraces.flatMap((t) =>
    t.route.filter((r) => r.route_type === "wire"),
  )
  expect(vccWires.length).toBeGreaterThan(0)

  // At least some VCC wires should have width > minTraceWidth
  const hasThickerVcc = vccWires.some(
    (w) => w.route_type === "wire" && w.width > 0.15,
  )
  expect(hasThickerVcc).toBe(true)

  // DATA traces should use minTraceWidth (unchanged)
  const dataWires = dataTraces.flatMap((t) =>
    t.route.filter((r) => r.route_type === "wire"),
  )
  expect(dataWires.length).toBeGreaterThan(0)

  // DATA wires should be at minTraceWidth
  for (const wire of dataWires) {
    if (wire.route_type === "wire") {
      expect(wire.width).toBe(0.15)
    }
  }
}, 30_000)

/**
 * Tests that explicit nominalTraceWidth on a connection is carried
 * through the full pipeline.
 */
test("AssignableAutoroutingPipeline3 - routes with explicit nominalTraceWidth", () => {
  const srj: SimpleRouteJson = {
    layerCount: 2,
    minTraceWidth: 0.15,
    obstacles: [
      {
        type: "rect",
        layers: ["top"],
        center: { x: 0, y: 0 },
        width: 1,
        height: 1,
        connectedTo: ["GND"],
      },
      {
        type: "rect",
        layers: ["top"],
        center: { x: 10, y: 0 },
        width: 1,
        height: 1,
        connectedTo: ["GND"],
      },
    ],
    connections: [
      {
        name: "GND",
        nominalTraceWidth: 0.6, // Explicit 0.6mm
        pointsToConnect: [
          { x: 0, y: 0, layer: "top" },
          { x: 10, y: 0, layer: "top" },
        ],
      },
    ],
    bounds: { minX: -3, maxX: 13, minY: -5, maxY: 5 },
  }

  const solver = new AssignableAutoroutingPipeline3(srj)
  solver.solve()

  expect(solver.solved).toBe(true)
  expect(solver.failed).toBe(false)

  const output = solver.getOutputSimpleRouteJson()
  expect(output.traces).toBeDefined()
  expect(output.traces!.length).toBeGreaterThan(0)

  const gndTraces = output.traces!.filter((t) => t.connection_name === "GND")
  expect(gndTraces.length).toBeGreaterThan(0)

  const gndWires = gndTraces.flatMap((t) =>
    t.route.filter((r) => r.route_type === "wire"),
  )
  expect(gndWires.length).toBeGreaterThan(0)

  // GND wires should have width > minTraceWidth due to nominalTraceWidth=0.6
  const hasThickerGnd = gndWires.some(
    (w) => w.route_type === "wire" && w.width > 0.15,
  )
  expect(hasThickerGnd).toBe(true)
}, 30_000)
