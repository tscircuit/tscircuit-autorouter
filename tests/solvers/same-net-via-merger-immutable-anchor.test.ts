import { expect, test } from "bun:test"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { SameNetViaMergerSolver } from "lib/solvers/SameNetViaMergerSolver/SameNetViaMergerSolver"
import type { HighDensityRoute } from "lib/types/high-density-types"

const makeViaRoute = ({
  connectionName,
  rootConnectionName,
  x,
}: {
  connectionName: string
  rootConnectionName: string
  x: number
}): HighDensityRoute => ({
  connectionName,
  rootConnectionName,
  traceThickness: 0.1,
  viaDiameter: 0.3,
  route: [
    { x: x - 0.5, y: 0, z: 0 },
    { x, y: 0, z: 0 },
    { x, y: 0, z: 1 },
    { x: x + 0.5, y: 0, z: 1 },
  ],
  vias: [{ x, y: 0 }],
})

test("same-net via merging reuses an immutable via without mutating it", () => {
  const editableRoute = makeViaRoute({
    connectionName: "editable",
    rootConnectionName: "net0",
    x: 0.02,
  })
  const immutableRoute = makeViaRoute({
    connectionName: "preloaded_fixed_0",
    rootConnectionName: "net0",
    x: 0,
  })
  const immutableSnapshot = structuredClone(immutableRoute)
  const solver = new SameNetViaMergerSolver({
    inputHdRoutes: [editableRoute],
    otherHdRoutes: [immutableRoute],
    obstacles: [],
    colorMap: {},
    layerCount: 2,
    connMap: new ConnectivityMap({
      net0: ["editable"],
    }),
  })

  solver.solve()

  expect(solver.failed).toBeFalse()
  const [mergedRoute] = solver.getMergedViaHdRoutes()!
  expect(mergedRoute!.vias).toHaveLength(0)
  expect(
    mergedRoute!.route.filter(
      (point, pointIndex) =>
        pointIndex > 0 && point.z !== mergedRoute!.route[pointIndex - 1]!.z,
    ),
  ).toEqual([{ x: 0, y: 0, z: 1 }])
  expect(immutableRoute).toEqual(immutableSnapshot)
})
