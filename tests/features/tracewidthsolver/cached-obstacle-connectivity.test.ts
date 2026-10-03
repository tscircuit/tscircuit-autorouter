import { expect, test } from "bun:test"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { TraceWidthSolver } from "lib/solvers/TraceWidthSolver/TraceWidthSolver"
import { isObstacleConnectedToRoute } from "lib/solvers/TraceWidthSolver/isObstacleConnectedToRoute"
import type { Obstacle } from "lib/types"
import type { HighDensityRoute } from "lib/types/high-density-types"

class CountingConnectivityMap extends ConnectivityMap {
  connectivityChecks = 0
  connectivityChecksByPair = new Map<string, number>()

  override areIdsConnected(first: string, second: string): boolean {
    this.connectivityChecks++
    const pair = `${first}:${second}`
    this.connectivityChecksByPair.set(
      pair,
      (this.connectivityChecksByPair.get(pair) ?? 0) + 1,
    )
    return super.areIdsConnected(first, second)
  }
}

test("trace widths reuse true and false obstacle connectivity within a step while preserving route changes", (): void => {
  const routes: HighDensityRoute[] = [
    {
      connectionName: "first-section",
      rootConnectionName: "first",
      traceThickness: 0.1,
      viaDiameter: 0.3,
      route: [
        { x: -5, y: 0, z: 0 },
        { x: 5, y: 0, z: 0 },
      ],
      vias: [],
    },
    {
      connectionName: "second-section",
      rootConnectionName: "second",
      traceThickness: 0.1,
      viaDiameter: 0.3,
      route: [
        { x: -5, y: 0.55, z: 0 },
        { x: 5, y: 0.55, z: 0 },
      ],
      vias: [],
    },
  ]
  const obstacles: Obstacle[] = [
    {
      type: "rect",
      center: { x: 0, y: 0 },
      width: 12,
      height: 0.6,
      layers: ["top"],
      connectedTo: ["first-pad"],
    },
  ]
  const nets = {
    first: ["first", "first-pad"],
    second: ["second", "second-pad"],
  }
  const cachedMap = new CountingConnectivityMap(structuredClone(nets))
  const referenceMap = new CountingConnectivityMap(structuredClone(nets))
  const input = {
    hdRoutes: routes,
    connection: routes.map((route) => ({
      name: route.connectionName,
      nominalTraceWidth: 0.4,
      pointsToConnect: [],
    })),
    obstacles,
    minTraceWidth: 0.1,
    layerCount: 1,
  }
  const cached = new TraceWidthSolver({ ...input, connMap: cachedMap })
  const reference = new TraceWidthSolver({ ...input, connMap: referenceMap })
  // Restore the direct predicate call to compare against the original solver.
  Object.defineProperty(reference, "isObstacleConnectedToRouteCached", {
    value: (obstacle: Obstacle, route: HighDensityRoute): boolean =>
      isObstacleConnectedToRoute(obstacle, route, referenceMap),
  })
  cached.solve()
  reference.solve()
  expect(cached.solved).toBe(true)
  expect(cached.failed).toBe(false)
  expect(cached.hdRoutesWithWidths).toEqual(reference.hdRoutesWithWidths)
  expect(cached.iterations).toBe(reference.iterations)
  expect(cached.hdRoutesWithWidths[0]!.traceThickness).toBe(0.4)
  expect(cached.hdRoutesWithWidths[1]!.traceThickness).toBe(0.1)
  expect(referenceMap.connectivityChecks).toBeGreaterThan(200)
  expect(cachedMap.connectivityChecks).toBeLessThan(
    referenceMap.connectivityChecks,
  )
  expect(
    cachedMap.connectivityChecksByPair.get("second:first-pad"),
  ).toBeLessThan(
    referenceMap.connectivityChecksByPair.get("second:first-pad")!,
  )
})
