import { expect, test } from "bun:test"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { SameNetViaMergerSolver } from "lib/solvers/SameNetViaMergerSolver/SameNetViaMergerSolver"
import type { HighDensityRoute } from "lib/types/high-density-types"

const makeViaRoute = ({
  connectionName,
  x,
  endpointVia,
}: {
  connectionName: string
  x: number
  endpointVia: boolean
}): HighDensityRoute => ({
  connectionName,
  rootConnectionName: "net0",
  traceThickness: 0.1,
  viaDiameter: 0.3,
  route: endpointVia
    ? [
        { x, y: 0, z: 0 },
        { x, y: 0, z: 1 },
        { x: x + 0.5, y: 0, z: 1 },
      ]
    : [
        { x: x - 0.5, y: 0, z: 0 },
        { x, y: 0, z: 0 },
        { x, y: 0, z: 1 },
        { x: x - 0.5, y: 0, z: 1 },
      ],
  vias: [{ x, y: 0 }],
})

test("same-net via merging preserves a route endpoint via", () => {
  const editableRoute = makeViaRoute({
    connectionName: "editable",
    x: 0.02,
    endpointVia: true,
  })
  const immutableRoute = makeViaRoute({
    connectionName: "fixed",
    x: 0,
    endpointVia: false,
  })
  const solver = new SameNetViaMergerSolver({
    inputHdRoutes: [editableRoute],
    otherHdRoutes: [immutableRoute],
    netByConnectionName: new Map([
      [editableRoute.connectionName, "net0"],
      [immutableRoute.connectionName, "net0"],
    ]),
    obstacles: [],
    colorMap: {},
    layerCount: 2,
    connMap: new ConnectivityMap({ net0: [editableRoute.connectionName] }),
    preserveRouteEndpoints: true,
  })

  solver.solve()

  expect(solver.failed).toBeFalse()
  expect(solver.getMergedViaHdRoutes()).toEqual([editableRoute])
})
