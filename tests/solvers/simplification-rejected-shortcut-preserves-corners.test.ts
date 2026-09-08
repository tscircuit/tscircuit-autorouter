import { expect, test } from "bun:test"
import { segmentToBoxMinDistance } from "@tscircuit/math-utils"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { SingleSimplifiedPathSolver5 } from "lib/solvers/SimplifiedPathSolver/SingleSimplifiedPathSolver5_Deg45"
import type { Obstacle } from "lib/types"
import type { HighDensityRoute } from "lib/types/high-density-types"

test("rejected shortcuts preserve original corners beside a pad", () => {
  for (const rotate of [false, true]) {
    const input: HighDensityRoute = {
      connectionName: "wire",
      traceThickness: 0.1,
      viaDiameter: 0.3,
      vias: [],
      route: [
        { x: 0, y: 0.18, z: 0 },
        { x: 0.5, y: 0.18, z: 0 },
        { x: 0.56, y: 0.18, z: 0 },
        { x: 0.56, y: 0, z: 0 },
        { x: 0.56, y: -0.18, z: 0 },
        { x: 0, y: -0.18, z: 0 },
      ].map((point): HighDensityRoute["route"][number] => ({
        x: 3 + (rotate ? -point.y : point.x),
        y: -2 + (rotate ? point.x : point.y),
        z: point.z,
      })),
    }
    const before = structuredClone(input)
    const obstacle: Obstacle = {
      type: "rect",
      center: { x: 3, y: -2 },
      width: rotate ? 0.2 : 1,
      height: rotate ? 1 : 0.2,
      layers: ["top"],
      __zLayers: [0],
      connectedTo: ["pad"],
    }
    const solver = new SingleSimplifiedPathSolver5({
      inputRoute: input,
      otherHdRoutes: [],
      obstacles: [obstacle],
      connMap: new ConnectivityMap({ wire: ["wire"], pad: ["pad"] }),
      colorMap: {},
    })

    solver.solve()

    expect(solver.solved).toBeTrue()
    expect(solver.failed).toBeFalse()
    expect(input).toEqual(before)
    expect(solver.newRoute[0]).toEqual(input.route[0])
    expect(solver.newRoute.at(-1)).toEqual(input.route.at(-1))
    // The incoming 0.01 mm copper gap is below the simplifier's target.
    // A rejected shortcut must retain it instead of cutting across the pad.
    for (let index = 1; index < solver.newRoute.length; index++) {
      const gap =
        segmentToBoxMinDistance(
          solver.newRoute[index - 1]!,
          solver.newRoute[index]!,
          obstacle,
        ) -
        input.traceThickness / 2
      expect(gap).toBeGreaterThanOrEqual(0.01 - 1e-9)
    }
  }
})
