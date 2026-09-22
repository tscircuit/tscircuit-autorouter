import { expect, test } from "bun:test"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { SameNetViaMergerSolver } from "@tscircuit/trace-simplification-solver"
import type { HighDensityRoute } from "lib/types/high-density-types"

test("a shared via stays put when one attached route cannot follow a merge", (): void => {
  const routes: HighDensityRoute[] = [
    {
      connectionName: "anchored", traceThickness: 0.1, viaDiameter: 0.3,
      vias: [{ x: 0, y: 0 }, { x: 0.6, y: 0 }],
      route: [
        { x: -0.4, y: 0, z: 0 }, { x: 0, y: 0, z: 0 },
        { x: 0, y: 0, z: 1 }, { x: 0.6, y: 0, z: 1 },
        { x: 0.6, y: 0, z: 0 }, { x: 1, y: 0, z: 0 },
      ],
    },
    {
      connectionName: "movable", traceThickness: 0.1, viaDiameter: 0.3,
      vias: [{ x: 0.6, y: 0 }],
      route: [
        { x: 0.6, y: -1, z: 1 }, { x: 0.6, y: 0, z: 1 },
        { x: 0.6, y: 0, z: 2 }, { x: 0.6, y: 1, z: 2 },
      ],
    },
  ]
  const solver = new SameNetViaMergerSolver({
    inputHdRoutes: routes, colorMap: {}, layerCount: 4,
    connMap: new ConnectivityMap({ signal: ["anchored", "movable"] }),
    obstacles: [{
      type: "rect", center: { x: 0.3, y: 0 }, width: 0.1, height: 0.2,
      layers: ["top"], connectedTo: ["other"],
    }],
  })
  // The old implementation moves the movable branch back and forth forever.
  for (let i = 0; i < 4 && !solver.solved && !solver.failed; i++) solver.step()
  expect(solver.failed).toBe(false)
  expect(solver.solved).toBe(true)
  expect(solver.getMergedViaHdRoutes()).toEqual(routes)
})
