import { test, expect } from "bun:test"
import { TraceWidthSolver } from "lib/solvers/TraceWidthSolver/TraceWidthSolver"
import type { HighDensityRoute } from "lib/types/high-density-types"
import type { SimpleRouteConnection } from "lib/types"

function makeRoute(name: string, thickness = 0.15): HighDensityRoute {
  return {
    connectionName: name,
    traceThickness: thickness,
    viaDiameter: 0.6,
    route: [
      { x: 0, y: 0, z: 0 },
      { x: 5, y: 0, z: 0 },
    ],
    vias: [],
  }
}

test("traceWidthMultiplier 2x sets nominalTraceWidth to 2 * minTraceWidth", () => {
  const minTraceWidth = 0.15
  const connection: SimpleRouteConnection = {
    name: "A",
    traceWidthMultiplier: 2,
    pointsToConnect: [
      { x: 0, y: 0, layer: "top" },
      { x: 5, y: 0, layer: "top" },
    ],
  }

  const solver = new TraceWidthSolver({
    hdRoutes: [makeRoute("A")],
    minTraceWidth,
    connection: [connection],
    layerCount: 2,
  })
  solver.solve()

  expect(solver.solved).toBe(true)
  const routes = solver.getHdRoutesWithWidths()
  expect(routes.length).toBe(1)
  // Wide-open board — nominal 0.30mm should fit
  expect(routes[0]!.traceThickness).toBeCloseTo(0.3)
})

test("traceWidthMultiplier 4x sets nominalTraceWidth to 4 * minTraceWidth", () => {
  const minTraceWidth = 0.15
  const connection: SimpleRouteConnection = {
    name: "B",
    traceWidthMultiplier: 4,
    pointsToConnect: [
      { x: 0, y: 0, layer: "top" },
      { x: 5, y: 0, layer: "top" },
    ],
  }

  const solver = new TraceWidthSolver({
    hdRoutes: [makeRoute("B")],
    minTraceWidth,
    connection: [connection],
    layerCount: 2,
  })
  solver.solve()

  expect(solver.solved).toBe(true)
  const routes = solver.getHdRoutesWithWidths()
  expect(routes[0]!.traceThickness).toBeCloseTo(0.6)
})

test("traceWidthMultiplier 8x sets nominalTraceWidth to 8 * minTraceWidth", () => {
  const minTraceWidth = 0.15
  const connection: SimpleRouteConnection = {
    name: "C",
    traceWidthMultiplier: 8,
    pointsToConnect: [
      { x: 0, y: 0, layer: "top" },
      { x: 5, y: 0, layer: "top" },
    ],
  }

  const solver = new TraceWidthSolver({
    hdRoutes: [makeRoute("C")],
    minTraceWidth,
    connection: [connection],
    layerCount: 2,
  })
  solver.solve()

  expect(solver.solved).toBe(true)
  const routes = solver.getHdRoutesWithWidths()
  expect(routes[0]!.traceThickness).toBeCloseTo(1.2)
})

test("nominalTraceWidth takes priority over traceWidthMultiplier", () => {
  const minTraceWidth = 0.15
  const connection: SimpleRouteConnection = {
    name: "D",
    nominalTraceWidth: 0.5,
    traceWidthMultiplier: 2,
    pointsToConnect: [
      { x: 0, y: 0, layer: "top" },
      { x: 5, y: 0, layer: "top" },
    ],
  }

  const solver = new TraceWidthSolver({
    hdRoutes: [makeRoute("D")],
    minTraceWidth,
    connection: [connection],
    layerCount: 2,
  })
  solver.solve()

  expect(solver.solved).toBe(true)
  const routes = solver.getHdRoutesWithWidths()
  // explicit nominalTraceWidth (0.5) wins over multiplier (2x = 0.3)
  expect(routes[0]!.traceThickness).toBeCloseTo(0.5)
})

test("boardNominalTraceWidth applies when connection has no width spec", () => {
  const minTraceWidth = 0.15
  const connection: SimpleRouteConnection = {
    name: "E",
    pointsToConnect: [
      { x: 0, y: 0, layer: "top" },
      { x: 5, y: 0, layer: "top" },
    ],
  }

  const solver = new TraceWidthSolver({
    hdRoutes: [makeRoute("E")],
    minTraceWidth,
    boardNominalTraceWidth: 0.3,
    connection: [connection],
    layerCount: 2,
  })
  solver.solve()

  expect(solver.solved).toBe(true)
  const routes = solver.getHdRoutesWithWidths()
  // board-level nominal 0.3mm applies
  expect(routes[0]!.traceThickness).toBeCloseTo(0.3)
})

test("per-connection traceWidthMultiplier overrides boardNominalTraceWidth", () => {
  const minTraceWidth = 0.15
  const connection: SimpleRouteConnection = {
    name: "F",
    traceWidthMultiplier: 4,
    pointsToConnect: [
      { x: 0, y: 0, layer: "top" },
      { x: 5, y: 0, layer: "top" },
    ],
  }

  const solver = new TraceWidthSolver({
    hdRoutes: [makeRoute("F")],
    minTraceWidth,
    boardNominalTraceWidth: 0.3,
    connection: [connection],
    layerCount: 2,
  })
  solver.solve()

  expect(solver.solved).toBe(true)
  const routes = solver.getHdRoutesWithWidths()
  // per-connection 4x (0.6) overrides board-level 0.3
  expect(routes[0]!.traceThickness).toBeCloseTo(0.6)
})
