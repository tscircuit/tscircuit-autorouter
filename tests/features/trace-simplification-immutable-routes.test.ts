import { expect, test } from "bun:test"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { TraceSimplificationSolver } from "lib/solvers/TraceSimplificationSolver/TraceSimplificationSolver"
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
