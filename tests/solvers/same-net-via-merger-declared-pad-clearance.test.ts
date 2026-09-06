import { expect, test } from "bun:test"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { SameNetViaMergerSolver } from "lib/solvers/SameNetViaMergerSolver/SameNetViaMergerSolver"
import type { HighDensityRoute } from "lib/types/high-density-types"
import type { Obstacle } from "lib/types"

test("same-net via merging honors the board's declared pad clearance", (): void => {
  for (const clearance of [0.1, 0.25]) {
    const editable: HighDensityRoute = {
      connectionName: "editable", traceThickness: 0.15, viaDiameter: 0.3,
      route: [
        { x: -1, y: -1, z: 0 },
        { x: 0.6, y: 0, z: 0 },
        { x: 0.6, y: 0, z: 1 },
        { x: 0.6, y: 1, z: 1 },
      ],
      vias: [{ x: 0.6, y: 0 }],
    }
    const anchor: HighDensityRoute = {
      connectionName: "anchor", traceThickness: 0.15, viaDiameter: 0.3,
      route: [{ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 1 }],
      vias: [{ x: 0, y: 0 }],
    }
    const obstacle: Obstacle = {
      type: "rect", layers: ["top"], center: { x: -0.55, y: -0.07 },
      width: 0.1, height: 0.1, connectedTo: ["foreign_pad"],
    }
    const input: { routes: HighDensityRoute[]; obstacle: Obstacle } =
      structuredClone({ routes: [editable, anchor], obstacle })
    const solver: SameNetViaMergerSolver = new SameNetViaMergerSolver({
      inputHdRoutes: [editable], otherHdRoutes: [anchor],
      obstacles: [obstacle], colorMap: {}, layerCount: 2,
      minTraceToPadEdgeClearance: clearance,
      connMap: new ConnectivityMap({ signal: ["editable", "anchor"], other: ["foreign_pad"] }),
    })
    solver.solve()
    expect(solver.failed).toBeFalse()
    expect(solver.getMergedViaHdRoutes()?.[0]?.route[1]?.x).toBe(
      clearance === 0.1 ? 0 : 0.6,
    )
    expect({ routes: [editable, anchor], obstacle }).toEqual(input)
  }
})
