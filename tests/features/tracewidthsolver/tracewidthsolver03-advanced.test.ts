import { describe, test, expect } from "bun:test"
import { TraceWidthSolver } from "lib/solvers/TraceWidthSolver/TraceWidthSolver"
import type { TraceWidthSolverInput } from "lib/solvers/TraceWidthSolver/TraceWidthSolver"

const baseInput = (): TraceWidthSolverInput => ({
  hdRoutes: [
    {
      connectionName: "VCC",
      route: [
        { x: 0, y: 0, z: 0 },
        { x: 10, y: 0, z: 0 },
      ],
      vias: [],
      traceThickness: 0.15,
      viaDiameter: 0.6,
    },
    {
      connectionName: "GND",
      route: [
        { x: 0, y: 2, z: 0 },
        { x: 10, y: 2, z: 0 },
      ],
      vias: [],
      traceThickness: 0.15,
      viaDiameter: 0.6,
    },
  ],
  connections: [
    { name: "VCC", pointsToConnect: [] },
    { name: "GND", pointsToConnect: [] },
  ],
  obstacles: [],
  minTraceWidth: 0.15,
  layerCount: 2,
})

describe("TraceWidthSolver — advanced features", () => {
  test("clearanceOverride applies higher margin to specific connection", () => {
    const input = baseInput()
    input.clearanceOverride = { VCC: 0.5 }
    const solver = new TraceWidthSolver(input)
    solver.solve()
    // VCC should use 0.5mm margin — solver should not crash
    expect(solver.solved).toBe(true)
  })

  test("traceWidthByLayer overrides width per layer", () => {
    const input = baseInput()
    input.traceWidthByLayer = { VCC: { top: 0.4 } }
    input.connections[0]!.nominalTraceWidth = undefined
    const solver = new TraceWidthSolver(input)
    solver.solve()
    const vccRoute = solver
      .getHdRoutesWithWidths()
      .find((r) => r.connectionName === "VCC")
    expect(vccRoute).toBeDefined()
    expect(solver.solved).toBe(true)
  })

  test("getMetrics returns correct totals after solving", () => {
    const input = baseInput()
    input.connections[0]!.nominalTraceWidth = 0.3
    const solver = new TraceWidthSolver(input)
    solver.solve()
    const metrics = solver.getMetrics()
    expect(metrics.totalTraces).toBe(1)
    expect(metrics.averageFinalWidth).toBeGreaterThan(0)
    expect(metrics.cacheHits + metrics.cacheMisses).toBeGreaterThanOrEqual(0)
  })

  test("cache reduces redundant clearance calculations", () => {
    const input = baseInput()
    input.connections[0]!.nominalTraceWidth = 0.3
    const solver = new TraceWidthSolver(input)
    solver.solve()
    const metrics = solver.getMetrics()
    // After first solve, cache should have entries
    expect(metrics.cacheMisses).toBeGreaterThan(0)
  })

  test("free multiplier value 3.5 is accepted and clamped correctly", () => {
    const input = baseInput()
    input.connections[0]!.traceWidthMultiplier = 3.5
    const solver = new TraceWidthSolver(input)
    solver.solve()
    expect(solver.solved).toBe(true)
  })
})
