import { expect, test } from "bun:test"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { segmentToBoxMinDistance } from "@tscircuit/math-utils"
import { TraceSimplificationSolver } from "lib/solvers/TraceSimplificationSolver/TraceSimplificationSolver"
import type { Obstacle } from "lib/types"
import type { HighDensityRoute } from "lib/types/high-density-types"

test("synthetic simplification sections recognize their pads and preserve foreign clearance", (): void => {
  for (const connected of [true, false]) {
    const connMap: ConnectivityMap = new ConnectivityMap({
      net_a: ["route_a", "pad_a"],
      net_b: ["route_b", "pad_b"],
    })
    const route: HighDensityRoute = {
      connectionName: "pipeline9_mutated_preload_0_0",
      rootConnectionName: "net_a",
      traceThickness: 0.15,
      viaDiameter: 0.3,
      vias: [],
      route: [
        { x: -2, y: 0, z: 0 },
        { x: -1, y: 1, z: 0 },
        { x: -1, y: 2, z: 0 },
        { x: 1, y: 2, z: 0 },
        { x: 1, y: 1, z: 0 },
        { x: 2, y: 0, z: 0 },
      ],
    }
    const obstacle: Obstacle = {
      type: "rect",
      center: { x: 0, y: 0 },
      width: 0.5,
      height: 2,
      layers: ["top"],
      connectedTo: [connected ? "pad_a" : "pad_b"],
    }
    const inputSnapshot: { route: HighDensityRoute; obstacle: Obstacle } =
      structuredClone({ route, obstacle })
    const connectivitySnapshot: Record<string, string[]> = structuredClone(
      connMap.netMap,
    )
    const solver: TraceSimplificationSolver = new TraceSimplificationSolver({
      hdRoutes: [route],
      obstacles: [obstacle],
      connMap,
      colorMap: {},
      defaultViaDiameter: 0.3,
      layerCount: 2,
      preserveRouteEndpoints: true,
      netByConnectionName: new Map([[route.connectionName, "net_a"]]),
    })
    solver.solve()

    expect(solver.failed).toBeFalse()
    expect(solver.simplifiedHdRoutes).toHaveLength(1)
    const output: HighDensityRoute = solver.simplifiedHdRoutes[0]!
    expect(output.route[0]).toEqual(route.route[0])
    expect(output.route.at(-1)).toEqual(route.route.at(-1))
    expect(output.vias).toEqual([])
    if (connected) {
      expect(output.route.every((point) => point.y === 0)).toBeTrue()
    } else {
      expect(output.route.some((point) => point.y !== 0)).toBeTrue()
      for (let index = 1; index < output.route.length; index++) {
        expect(
          segmentToBoxMinDistance(
            output.route[index - 1]!,
            output.route[index]!,
            obstacle,
          ),
        ).toBeGreaterThanOrEqual(0.175 - 1e-6)
      }
    }
    expect({ route, obstacle }).toEqual(inputSnapshot)
    expect(connMap.netMap).toEqual(connectivitySnapshot)
    expect(connMap.getNetConnectedToId(route.connectionName)).toBeUndefined()
  }
})
