import { test, expect } from "bun:test"
import { getEffectiveNominalTraceWidth } from "lib/utils/getEffectiveNominalTraceWidth"
import { TraceWidthSolver } from "lib/solvers/TraceWidthSolver/TraceWidthSolver"
import { SimpleRouteConnection } from "lib/types"
import { HighDensityRoute } from "lib/types/high-density-types"

test("getEffectiveNominalTraceWidth - returns nominalTraceWidth when set", () => {
  const connection: SimpleRouteConnection = {
    name: "VCC",
    nominalTraceWidth: 0.6,
    traceWidthMultiplier: 2,
    pointsToConnect: [],
  }
  expect(getEffectiveNominalTraceWidth(connection, 0.15)).toBe(0.6)
})

test("getEffectiveNominalTraceWidth - computes from multiplier when nominalTraceWidth is not set", () => {
  const minTraceWidth = 0.15
  const testCases = [
    { multiplier: 2, expected: 0.3 },
    { multiplier: 4, expected: 0.6 },
    { multiplier: 8, expected: 1.2 },
  ]
  for (const { multiplier, expected } of testCases) {
    const connection: SimpleRouteConnection = {
      name: `power_${multiplier}x`,
      traceWidthMultiplier: multiplier,
      pointsToConnect: [],
    }
    expect(
      getEffectiveNominalTraceWidth(connection, minTraceWidth),
    ).toBeCloseTo(expected)
  }
})

test("getEffectiveNominalTraceWidth - returns undefined when neither is set", () => {
  const connection: SimpleRouteConnection = {
    name: "data",
    pointsToConnect: [],
  }
  expect(getEffectiveNominalTraceWidth(connection, 0.15)).toBeUndefined()
})

test("getEffectiveNominalTraceWidth - returns undefined for multiplier of 1", () => {
  const connection: SimpleRouteConnection = {
    name: "data",
    traceWidthMultiplier: 1,
    pointsToConnect: [],
  }
  expect(getEffectiveNominalTraceWidth(connection, 0.15)).toBeUndefined()
})

test("TraceWidthSolver - uses traceWidthMultiplier for connections without explicit nominalTraceWidth", () => {
  const minTraceWidth = 0.15

  // Create a simple straight route
  const hdRoute: HighDensityRoute = {
    connectionName: "VCC",
    traceThickness: minTraceWidth,
    viaDiameter: 0.3,
    route: [
      { x: 0, y: 0, z: 0 },
      { x: 1, y: 0, z: 0 },
      { x: 2, y: 0, z: 0 },
    ],
    vias: [],
  }

  // Connection with traceWidthMultiplier=4 -> effective nominal width = 0.6mm
  const connection: SimpleRouteConnection = {
    name: "VCC",
    traceWidthMultiplier: 4,
    pointsToConnect: [
      { x: 0, y: 0, layer: "top" },
      { x: 2, y: 0, layer: "top" },
    ],
  }

  const solver = new TraceWidthSolver({
    hdRoutes: [hdRoute],
    connection: [connection],
    minTraceWidth,
    layerCount: 2,
  })

  solver.solve()

  expect(solver.solved).toBe(true)
  const routes = solver.getHdRoutesWithWidths()
  expect(routes.length).toBe(1)
  // With no obstacles nearby, the solver should use the full nominal width (0.6mm)
  expect(routes[0].traceThickness).toBeCloseTo(0.6)
})

test("TraceWidthSolver - passes through routes without multiplier or nominalTraceWidth unchanged", () => {
  const minTraceWidth = 0.15

  const hdRoute: HighDensityRoute = {
    connectionName: "DATA",
    traceThickness: minTraceWidth,
    viaDiameter: 0.3,
    route: [
      { x: 0, y: 0, z: 0 },
      { x: 1, y: 0, z: 0 },
    ],
    vias: [],
  }

  const connection: SimpleRouteConnection = {
    name: "DATA",
    pointsToConnect: [
      { x: 0, y: 0, layer: "top" },
      { x: 1, y: 0, layer: "top" },
    ],
  }

  const solver = new TraceWidthSolver({
    hdRoutes: [hdRoute],
    connection: [connection],
    minTraceWidth,
    layerCount: 2,
  })

  solver.solve()

  expect(solver.solved).toBe(true)
  const routes = solver.getHdRoutesWithWidths()
  expect(routes.length).toBe(1)
  // Route without any width override should be passed through unchanged
  expect(routes[0].traceThickness).toBe(minTraceWidth)
})
