import { test, expect } from "bun:test"
import { TraceWidthSolver } from "lib/solvers/TraceWidthSolver/TraceWidthSolver"
import type { SimpleRouteConnection } from "lib/types"
import type { HighDensityRoute } from "lib/types/high-density-types"

test("TraceWidthSolver respects nominalTraceWidth from connections", () => {
  const minTraceWidth = 0.15

  // Create simple HD routes (already routed, just need width assignment)
  const hdRoutes: HighDensityRoute[] = [
    {
      connectionName: "power_2x",
      traceThickness: minTraceWidth, // Initial thickness
      viaDiameter: 0.6,
      route: [
        { x: -5, y: 0, z: 0 },
        { x: 5, y: 0, z: 0 },
      ],
      vias: [],
    },
    {
      connectionName: "power_4x",
      traceThickness: minTraceWidth,
      viaDiameter: 0.6,
      route: [
        { x: -5, y: 2, z: 0 },
        { x: 5, y: 2, z: 0 },
      ],
      vias: [],
    },
    {
      connectionName: "power_8x",
      traceThickness: minTraceWidth,
      viaDiameter: 0.6,
      route: [
        { x: -5, y: 4, z: 0 },
        { x: 5, y: 4, z: 0 },
      ],
      vias: [],
    },
    {
      connectionName: "signal_default",
      traceThickness: minTraceWidth,
      viaDiameter: 0.6,
      route: [
        { x: -5, y: -2, z: 0 },
        { x: 5, y: -2, z: 0 },
      ],
      vias: [],
    },
  ]

  const connections: SimpleRouteConnection[] = [
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
      // No nominalTraceWidth - should remain at minTraceWidth
      pointsToConnect: [
        { x: -5, y: -2, layer: "top" },
        { x: 5, y: -2, layer: "top" },
      ],
    },
  ]

  const solver = new TraceWidthSolver({
    hdRoutes,
    connection: connections,
    minTraceWidth,
    obstacles: [], // No obstacles, so routes should get their full nominal width
  })

  solver.solve()

  expect(solver.solved).toBe(true)

  const routesWithWidths = solver.getHdRoutesWithWidths()
  expect(routesWithWidths.length).toBe(4)

  const power2x = routesWithWidths.find((r) => r.connectionName === "power_2x")
  const power4x = routesWithWidths.find((r) => r.connectionName === "power_4x")
  const power8x = routesWithWidths.find((r) => r.connectionName === "power_8x")
  const signal = routesWithWidths.find(
    (r) => r.connectionName === "signal_default",
  )

  expect(power2x).toBeDefined()
  expect(power4x).toBeDefined()
  expect(power8x).toBeDefined()
  expect(signal).toBeDefined()

  // With no obstacles, traces should use their nominal widths
  expect(power2x!.traceThickness).toBe(minTraceWidth * 2) // 0.3mm
  expect(power4x!.traceThickness).toBe(minTraceWidth * 4) // 0.6mm
  expect(power8x!.traceThickness).toBe(minTraceWidth * 8) // 1.2mm
  expect(signal!.traceThickness).toBe(minTraceWidth) // 0.15mm (unchanged, no nominal specified)
})
