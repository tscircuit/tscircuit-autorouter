import { expect, test } from "bun:test"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { TraceSimplificationSolver } from "lib/solvers/TraceSimplificationSolver/TraceSimplificationSolver"
import type { HighDensityRoute } from "lib/types/high-density-types"
import { minimumDistanceBetweenSegments } from "lib/utils/minimumDistanceBetweenSegments"

test("path simplification recognizes preloaded net roots without joining unrelated copper", () => {
  const connMap = new ConnectivityMap({
    ground: ["new_ground", "existing_ground"],
    signal: ["existing_signal"],
  })
  for (const rootConnectionName of [
    "ground",
    "existing_ground",
    "signal",
    "unknown_net",
  ]) {
    const inputRoute: HighDensityRoute = {
      connectionName:
        rootConnectionName === "unknown_net" ? "unknown_route" : "new_ground",
      traceThickness: 0.15,
      viaDiameter: 0.3,
      route: [
        { x: -2, y: 0, z: 0 },
        { x: -1, y: 1, z: 0 },
        { x: 0, y: 1, z: 0 },
        { x: 1, y: 1, z: 0 },
        { x: 2, y: 0, z: 0 },
      ],
      vias: [],
    }
    const fixedRoute: HighDensityRoute = {
      connectionName: "synthetic_fixed_section",
      rootConnectionName,
      traceThickness: 0.15,
      viaDiameter: 0.3,
      route: [
        { x: 0, y: -0.5, z: 0 },
        { x: 0, y: 0.5, z: 0 },
      ],
      vias: [{ x: 0, y: 0 }],
    }
    const originalFixedRoute = structuredClone(fixedRoute)
    const solver = new TraceSimplificationSolver({
      hdRoutes: [inputRoute],
      defaultViaDiameter: 0.3,
      layerCount: 2,
      otherHdRoutes: [fixedRoute],
      obstacles: [],
      connMap,
      colorMap: {},
    })
    solver.solve()
    expect(solver.failed).toBe(false)
    const output = solver.simplifiedHdRoutes[0]!
    expect(output.route[0]).toEqual(inputRoute.route[0])
    expect(output.route.at(-1)).toEqual(inputRoute.route.at(-1))
    expect(fixedRoute).toEqual(originalFixedRoute)
    expect(connMap.getNetConnectedToId("ground")).toBeUndefined()
    expect(
      connMap.getNetConnectedToId("synthetic_fixed_section"),
    ).toBeUndefined()
    if (
      rootConnectionName === "ground" ||
      rootConnectionName === "existing_ground"
    ) {
      expect(output.route.every((point) => Math.abs(point.y) < 1e-9)).toBe(true)
    } else {
      for (let index = 1; index < output.route.length; index++) {
        expect(
          minimumDistanceBetweenSegments(
            output.route[index - 1]!,
            output.route[index]!,
            fixedRoute.route[0]!,
            fixedRoute.route[1]!,
          ),
        ).toBeGreaterThanOrEqual(0.25)
      }
    }
  }
})
