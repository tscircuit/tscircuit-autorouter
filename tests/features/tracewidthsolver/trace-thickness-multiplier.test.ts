import { test, expect } from "bun:test"
import { TraceWidthSolver } from "lib/solvers/TraceWidthSolver/TraceWidthSolver"
import { SimpleRouteConnection } from "lib/types"

/**
 * Tests that traceWidthMultiplier on a SimpleRouteConnection is correctly
 * resolved into an effective nominalTraceWidth by the TraceWidthSolver.
 *
 * This covers the core requirement of issue #66: supporting 2x, 4x, and 8x
 * trace thickness multiples (0.3mm, 0.6mm, 1.2mm) on the standard 0.15mm base.
 */
test("TraceWidthSolver - resolves traceWidthMultiplier to effective nominalTraceWidth", () => {
  const minTraceWidth = 0.15

  // Create a simple HD route for testing
  const hdRoutes = [
    {
      connectionName: "power_2x",
      traceThickness: minTraceWidth,
      viaDiameter: 0.3,
      route: [
        { x: 0, y: 0, z: 0 },
        { x: 5, y: 0, z: 0 },
      ],
      vias: [],
    },
    {
      connectionName: "power_4x",
      traceThickness: minTraceWidth,
      viaDiameter: 0.3,
      route: [
        { x: 0, y: 2, z: 0 },
        { x: 5, y: 2, z: 0 },
      ],
      vias: [],
    },
    {
      connectionName: "power_8x",
      traceThickness: minTraceWidth,
      viaDiameter: 0.3,
      route: [
        { x: 0, y: 4, z: 0 },
        { x: 5, y: 4, z: 0 },
      ],
      vias: [],
    },
    {
      connectionName: "data_signal",
      traceThickness: minTraceWidth,
      viaDiameter: 0.3,
      route: [
        { x: 0, y: 6, z: 0 },
        { x: 5, y: 6, z: 0 },
      ],
      vias: [],
    },
  ]

  // Connections with various multipliers and one without
  const connections: SimpleRouteConnection[] = [
    {
      name: "power_2x",
      traceWidthMultiplier: 2,
      pointsToConnect: [
        { x: 0, y: 0, layer: "top" },
        { x: 5, y: 0, layer: "top" },
      ],
    },
    {
      name: "power_4x",
      traceWidthMultiplier: 4,
      pointsToConnect: [
        { x: 0, y: 2, layer: "top" },
        { x: 5, y: 2, layer: "top" },
      ],
    },
    {
      name: "power_8x",
      traceWidthMultiplier: 8,
      pointsToConnect: [
        { x: 0, y: 4, layer: "top" },
        { x: 5, y: 4, layer: "top" },
      ],
    },
    {
      name: "data_signal",
      // No multiplier or nominalTraceWidth -- should stay unchanged
      pointsToConnect: [
        { x: 0, y: 6, layer: "top" },
        { x: 5, y: 6, layer: "top" },
      ],
    },
  ]

  const solver = new TraceWidthSolver({
    hdRoutes,
    connection: connections,
    minTraceWidth,
    layerCount: 2,
  })

  solver.solve()

  expect(solver.solved).toBe(true)
  const results = solver.getHdRoutesWithWidths()
  expect(results.length).toBe(4)

  const resultMap = new Map(results.map((r) => [r.connectionName, r]))

  // 2x multiplier: should try 0.3mm first, may fall back if clearance is tight
  const power2x = resultMap.get("power_2x")!
  expect(power2x.traceThickness).toBeGreaterThan(minTraceWidth)
  expect(power2x.traceThickness).toBeLessThanOrEqual(0.3)

  // 4x multiplier: should try 0.6mm first
  const power4x = resultMap.get("power_4x")!
  expect(power4x.traceThickness).toBeGreaterThan(minTraceWidth)
  expect(power4x.traceThickness).toBeLessThanOrEqual(0.6)

  // 8x multiplier: should try 1.2mm first
  const power8x = resultMap.get("power_8x")!
  expect(power8x.traceThickness).toBeGreaterThan(minTraceWidth)
  expect(power8x.traceThickness).toBeLessThanOrEqual(1.2)

  // data_signal: no multiplier, should be passed through unchanged
  const data = resultMap.get("data_signal")!
  expect(data.traceThickness).toBe(minTraceWidth)
})

/**
 * Tests that nominalTraceWidth takes precedence over traceWidthMultiplier
 * when both are specified.
 */
test("TraceWidthSolver - nominalTraceWidth takes precedence over traceWidthMultiplier", () => {
  const minTraceWidth = 0.15

  const hdRoutes = [
    {
      connectionName: "mixed",
      traceThickness: minTraceWidth,
      viaDiameter: 0.3,
      route: [
        { x: 0, y: 0, z: 0 },
        { x: 5, y: 0, z: 0 },
      ],
      vias: [],
    },
  ]

  // nominalTraceWidth is 0.6, multiplier would give 0.3 -- nominalTraceWidth should win
  const connections: SimpleRouteConnection[] = [
    {
      name: "mixed",
      nominalTraceWidth: 0.6,
      traceWidthMultiplier: 2,
      pointsToConnect: [
        { x: 0, y: 0, layer: "top" },
        { x: 5, y: 0, layer: "top" },
      ],
    },
  ]

  const solver = new TraceWidthSolver({
    hdRoutes,
    connection: connections,
    minTraceWidth,
    layerCount: 2,
  })

  solver.solve()

  expect(solver.solved).toBe(true)
  const results = solver.getHdRoutesWithWidths()
  expect(results.length).toBe(1)

  // Should use nominalTraceWidth (0.6), not multiplier (0.3)
  const route = results[0]
  expect(route.traceThickness).toBe(0.6)
})
