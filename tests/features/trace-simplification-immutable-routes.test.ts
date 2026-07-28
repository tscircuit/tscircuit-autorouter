import { expect, test } from "bun:test"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { SameNetViaMergerSolver } from "lib/solvers/SameNetViaMergerSolver/SameNetViaMergerSolver"
import { TraceSimplificationSolver } from "lib/solvers/TraceSimplificationSolver/TraceSimplificationSolver"
import { UselessViaRemovalSolver } from "lib/solvers/UselessViaRemovalSolver/UselessViaRemovalSolver"
import type { HighDensityRoute } from "lib/types/high-density-types"
import { minimumDistanceBetweenSegments } from "lib/utils/minimumDistanceBetweenSegments"

const editableRoute: HighDensityRoute = {
  connectionName: "editable",
  traceThickness: 0.15,
  viaDiameter: 0.3,
  route: [
    { x: -2, y: 0, z: 0 },
    { x: -1, y: 1.5, z: 0 },
    { x: 1, y: 1.5, z: 0 },
    { x: 2, y: 0, z: 0 },
  ],
  vias: [],
}

const immutableRoute: HighDensityRoute = {
  connectionName: "fixed_piece",
  rootConnectionName: "fixed",
  traceThickness: 0.15,
  viaDiameter: 0.3,
  route: [
    { x: 0, y: -0.5, z: 0 },
    { x: 0, y: 0.5, z: 0 },
  ],
  vias: [],
}

const solve = (otherHdRoutes: HighDensityRoute[] = []) => {
  const connMap = new ConnectivityMap({})
  connMap.addConnections([["fixed", "fixed_piece"]])
  const solver = new TraceSimplificationSolver({
    hdRoutes: [structuredClone(editableRoute)],
    otherHdRoutes,
    obstacles: [],
    connMap,
    colorMap: {},
    defaultViaDiameter: 0.3,
    layerCount: 2,
  })
  solver.solve()
  expect(solver.failed).toBe(false)
  return solver.simplifiedHdRoutes
}

const getMinimumRouteDistance = (
  first: HighDensityRoute,
  second: HighDensityRoute,
) => {
  let minimumDistance = Number.POSITIVE_INFINITY
  for (let firstIndex = 1; firstIndex < first.route.length; firstIndex++) {
    const firstStart = first.route[firstIndex - 1]!
    const firstEnd = first.route[firstIndex]!
    if (firstStart.z !== firstEnd.z) continue

    for (
      let secondIndex = 1;
      secondIndex < second.route.length;
      secondIndex++
    ) {
      const secondStart = second.route[secondIndex - 1]!
      const secondEnd = second.route[secondIndex]!
      if (secondStart.z !== secondEnd.z || firstStart.z !== secondStart.z) {
        continue
      }
      minimumDistance = Math.min(
        minimumDistance,
        minimumDistanceBetweenSegments(
          firstStart,
          firstEnd,
          secondStart,
          secondEnd,
        ),
      )
    }
  }
  return minimumDistance
}

test("trace simplification avoids immutable routed traces without emitting or mutating them", () => {
  const immutableSnapshot = structuredClone(immutableRoute)

  const routesWithoutFixedCopper = solve()
  expect(routesWithoutFixedCopper).toHaveLength(1)
  expect(
    getMinimumRouteDistance(routesWithoutFixedCopper[0]!, immutableRoute),
  ).toBe(0)

  const routesWithFixedCopper = solve([immutableRoute])
  expect(routesWithFixedCopper).toHaveLength(1)
  expect(routesWithFixedCopper[0]!.connectionName).toBe("editable")
  expect(
    getMinimumRouteDistance(routesWithFixedCopper[0]!, immutableRoute),
  ).toBeGreaterThanOrEqual(0.25)
  expect(immutableRoute).toEqual(immutableSnapshot)
})

test("via removal keeps a layer detour that crosses an immutable route", () => {
  const routeWithLayerDetour: HighDensityRoute = {
    connectionName: "editable",
    traceThickness: 0.15,
    viaDiameter: 0.3,
    route: [
      { x: -1, y: 0, z: 0 },
      { x: -0.5, y: 0, z: 0 },
      { x: -0.5, y: 0, z: 1 },
      { x: 0.5, y: 0, z: 1 },
      { x: 0.5, y: 0, z: 0 },
      { x: 1, y: 0, z: 0 },
    ],
    vias: [
      { x: -0.5, y: 0 },
      { x: 0.5, y: 0 },
    ],
  }
  const connMap = new ConnectivityMap({})
  connMap.addConnections([["fixed", "fixed_piece"]])
  const runViaRemoval = (otherHdRoutes: HighDensityRoute[] = []) => {
    const solver = new UselessViaRemovalSolver({
      unsimplifiedHdRoutes: [structuredClone(routeWithLayerDetour)],
      otherHdRoutes,
      obstacles: [],
      colorMap: {},
      layerCount: 2,
      connMap,
    })
    solver.solve()
    expect(solver.failed).toBe(false)
    return solver.getOptimizedHdRoutes()!
  }

  expect(runViaRemoval()[0]!.vias).toHaveLength(0)
  const immutableSnapshot = structuredClone(immutableRoute)
  const guardedRoutes = runViaRemoval([immutableRoute])
  expect(guardedRoutes).toHaveLength(1)
  expect(guardedRoutes[0]!.vias).toHaveLength(2)
  expect(immutableRoute).toEqual(immutableSnapshot)
})

test("same-net via merging collision-checks immutable routes without emitting them", () => {
  const makeViaRoute = (
    connectionName: string,
    viaX: number,
  ): HighDensityRoute => ({
    connectionName,
    traceThickness: 0.15,
    viaDiameter: 0.3,
    route: [
      { x: viaX - 0.25, y: 0, z: 0 },
      { x: viaX, y: 0, z: 0 },
      { x: viaX, y: 0, z: 1 },
      { x: viaX - 0.25, y: 0, z: 1 },
    ],
    vias: [{ x: viaX, y: 0 }],
  })
  const inputRoutes = [
    makeViaRoute("editable_a", -0.25),
    makeViaRoute("editable_b", 0.25),
  ]
  const connMap = new ConnectivityMap({})
  connMap.addConnections([
    ["editable_a", "editable_b"],
    ["fixed", "fixed_piece"],
  ])
  const runViaMerge = (otherHdRoutes: HighDensityRoute[] = []) => {
    const solver = new SameNetViaMergerSolver({
      inputHdRoutes: structuredClone(inputRoutes),
      otherHdRoutes,
      obstacles: [],
      colorMap: {},
      layerCount: 2,
      connMap,
    })
    solver.solve()
    expect(solver.failed).toBe(false)
    return solver.getMergedViaHdRoutes()!
  }
  const countViaLocations = (routes: HighDensityRoute[]) =>
    new Set(
      routes.flatMap((route) => route.vias.map((via) => `${via.x}:${via.y}`)),
    ).size

  expect(countViaLocations(runViaMerge())).toBe(1)
  const immutableSnapshot = structuredClone(immutableRoute)
  const guardedRoutes = runViaMerge([immutableRoute])
  expect(guardedRoutes).toHaveLength(2)
  expect(countViaLocations(guardedRoutes)).toBe(2)
  expect(immutableRoute).toEqual(immutableSnapshot)
})
