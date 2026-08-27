import { expect, test } from "bun:test"
import { MultipleHighDensityRouteStitchSolver3 } from "lib/solvers/RouteStitchingSolver/MultipleHighDensityRouteStitchSolver3"
import type { HighDensityIntraNodeRoute } from "lib/types/high-density-types"

const makeRoute = (
  connectionName: string,
  rootConnectionName: string,
  route: HighDensityIntraNodeRoute["route"],
): HighDensityIntraNodeRoute => ({
  connectionName,
  rootConnectionName,
  traceThickness: 0.15,
  viaDiameter: 0.3,
  route,
  vias: [],
  jumpers: [],
})

test("orphan pruning preserves a bridge needed by another shared-root connection", () => {
  const solver = new MultipleHighDensityRouteStitchSolver3({
    connections: [
      {
        name: "a",
        __rootConnectionNames: ["shared_root"],
        pointsToConnect: [
          { x: 0, y: 10, layer: "top" },
          { x: 10, y: 10, layer: "top" },
        ],
      },
      {
        name: "b",
        __rootConnectionNames: ["shared_root"],
        pointsToConnect: [
          { x: 5, y: -1, layer: "top" },
          { x: 5, y: 1, layer: "top" },
        ],
      },
      {
        name: "c",
        __rootConnectionNames: ["c_root"],
        pointsToConnect: [
          { x: 0, y: 20, layer: "top" },
          { x: 10, y: 20, layer: "top" },
        ],
      },
    ],
    hdRoutes: [
      makeRoute("a", "shared_root", [
        { x: 0, y: 10, z: 0 },
        { x: 10, y: 10, z: 0 },
      ]),
      makeRoute("a", "shared_root", [
        { x: 5, y: -0.4, z: 0 },
        { x: 5, y: 0.4, z: 0 },
      ]),
      makeRoute("b", "shared_root", [
        { x: 5, y: -1, z: 0 },
        { x: 5, y: -0.8, z: 0 },
      ]),
      makeRoute("b", "shared_root", [
        { x: 5, y: 0.8, z: 0 },
        { x: 5, y: 1, z: 0 },
      ]),
      makeRoute("c", "c_root", [
        { x: 0, y: 20, z: 0 },
        { x: 10, y: 20, z: 0 },
      ]),
      makeRoute("c", "c_root", [
        { x: 4.5, y: -0.6, z: 0 },
        { x: 5.5, y: -0.6, z: 0 },
      ]),
    ],
    layerCount: 2,
  })

  solver.solve()

  expect(solver.failed).toBe(false)
  expect(solver.solved).toBe(true)
  expect(solver.mergedHdRoutes).toHaveLength(3)
  const stitchedB = solver.mergedHdRoutes.find(
    (route) => route.connectionName === "b",
  )!
  expect(stitchedB).toBeDefined()
  expect([stitchedB.route[0], stitchedB.route.at(-1)]).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ x: 5, y: -1, z: 0 }),
      expect.objectContaining({ x: 5, y: 1, z: 0 }),
    ]),
  )
  expect(stitchedB.route).toContainEqual({ x: 5, y: -0.4, z: 0 })
  expect(stitchedB.route).toContainEqual({ x: 5, y: 0.4, z: 0 })
})
