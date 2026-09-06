import { expect, test } from "bun:test"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { SameNetViaMergerSolver } from "lib/solvers/SameNetViaMergerSolver/SameNetViaMergerSolver"
import type { HighDensityRoute } from "lib/types/high-density-types"
import { minimumDistanceBetweenSegments } from "lib/utils/minimumDistanceBetweenSegments"

test("same-net via merging validates relocated adjacent copper at both merge distances", (): void => {
  for (const viaX of [0.28, 0.6]) {
    const editable: HighDensityRoute = {
      connectionName: "editable",
      traceThickness: 0.15,
      viaDiameter: 0.3,
      route: [
        { x: -1, y: -1, z: 0, pcb_port_id: "start" },
        { x: viaX, y: 0, z: 0 },
        { x: viaX, y: 0, z: 1 },
        { x: viaX, y: 1, z: 1, pcb_port_id: "end" },
      ],
      vias: [{ x: viaX, y: 0 }],
    }
    const anchor: HighDensityRoute = {
      connectionName: "anchor",
      traceThickness: 0.15,
      viaDiameter: 0.3,
      route: [
        { x: 0, y: 0, z: 0 },
        { x: 0, y: 0, z: 1 },
      ],
      vias: [{ x: 0, y: 0 }],
    }
    const foreign: HighDensityRoute = {
      connectionName: "foreign",
      traceThickness: 0.15,
      viaDiameter: 0.3,
      route: [
        { x: -0.6, y: -0.32, z: 0 },
        { x: -0.55, y: -0.32, z: 0 },
      ],
      vias: [],
    }
    const snapshot: HighDensityRoute[] = structuredClone([
      editable,
      anchor,
      foreign,
    ])
    expect(
      minimumDistanceBetweenSegments(
        editable.route[0]!,
        editable.route[1]!,
        foreign.route[0]!,
        foreign.route[1]!,
      ),
    ).toBeGreaterThan(0.15 + 0.1)
    const solver: SameNetViaMergerSolver = new SameNetViaMergerSolver({
      inputHdRoutes: [editable],
      otherHdRoutes: [anchor, foreign],
      obstacles: [],
      colorMap: {},
      layerCount: 2,
      preserveRouteEndpoints: true,
      connMap: new ConnectivityMap({
        signal: ["editable", "anchor"],
        other: ["foreign"],
      }),
    })
    solver.solve()
    expect(solver.failed).toBeFalse()
    expect(solver.getMergedViaHdRoutes()).toEqual([editable])
    expect([editable, anchor, foreign]).toEqual(snapshot)
  }
})
