import { expect, test } from "bun:test"
import { SingleHighDensityRouteStitchSolver3 } from "lib/solvers/RouteStitchingSolver/SingleHighDensityRouteStitchSolver3"
import type { HighDensityIntraNodeRoute } from "lib/types/high-density-types"

test("stitching materializes nearby layer changes at explicit via anchors", (): void => {
  const firstFragment: HighDensityIntraNodeRoute = {
    connectionName: "signal",
    traceThickness: 0.15,
    viaDiameter: 0.3,
    route: [
      { x: -1, y: 0, z: 1 },
      { x: 0.25, y: 0, z: 1 },
    ],
    vias: [{ x: 0.25, y: 0 }],
    jumpers: [],
  }
  const secondFragment: HighDensityIntraNodeRoute = {
    connectionName: "signal",
    traceThickness: 0.15,
    viaDiameter: 0.3,
    route: [
      { x: 0.2500002, y: 0, z: 0 },
      { x: 1, y: 0, z: 0 },
    ],
    vias: [],
    jumpers: [],
  }
  const inputBefore: string = JSON.stringify([firstFragment, secondFragment])
  const solver: SingleHighDensityRouteStitchSolver3 =
    new SingleHighDensityRouteStitchSolver3({
      connectionName: "signal",
      start: { x: -1, y: 0, z: 1 },
      end: { x: 1, y: 0, z: 0 },
      hdRoutes: [firstFragment, secondFragment],
      isStitchSegmentClear: (): boolean => true,
      stitchClearanceMode: "require_clear",
    })

  solver.solve()

  expect(solver.solved).toBeTrue()
  expect(solver.failed).toBeFalse()
  expect(solver.mergedHdRoute.route).toEqual([
    { x: 1, y: 0, z: 0 },
    { x: 0.2500002, y: 0, z: 0 },
    { x: 0.25, y: 0, z: 0 },
    { x: 0.25, y: 0, z: 1 },
    { x: -1, y: 0, z: 1 },
  ])
  expect(solver.mergedHdRoute.vias).toEqual([{ x: 0.25, y: 0 }])
  for (
    let pointIndex: number = 1;
    pointIndex < solver.mergedHdRoute.route.length;
    pointIndex++
  ) {
    const previous = solver.mergedHdRoute.route[pointIndex - 1]!
    const point = solver.mergedHdRoute.route[pointIndex]!
    if (previous.z === point.z) continue
    expect(point.x).toBe(previous.x)
    expect(point.y).toBe(previous.y)
    expect(solver.mergedHdRoute.vias).toContainEqual({
      x: point.x,
      y: point.y,
    })
  }
  expect(JSON.stringify([firstFragment, secondFragment])).toBe(inputBefore)

  const exactTransitionSolver: SingleHighDensityRouteStitchSolver3 =
    new SingleHighDensityRouteStitchSolver3({
      connectionName: "exact-signal",
      start: { x: -1, y: 0, z: 1 },
      end: { x: 1, y: 0, z: 0 },
      hdRoutes: [
        {
          ...firstFragment,
          connectionName: "exact-signal",
          route: [
            { x: -1, y: 0, z: 1 },
            { x: 0.25, y: 0, z: 1 },
          ],
          vias: [{ x: 0.2505, y: 0 }],
        },
        {
          ...secondFragment,
          connectionName: "exact-signal",
          route: [
            { x: 0.25, y: 0, z: 0 },
            { x: 1, y: 0, z: 0 },
          ],
        },
      ],
      isStitchSegmentClear: (): boolean => true,
      stitchClearanceMode: "require_clear",
    })

  exactTransitionSolver.solve()

  expect(exactTransitionSolver.solved).toBeTrue()
  expect(exactTransitionSolver.failed).toBeFalse()
  expect(exactTransitionSolver.mergedHdRoute.route).toEqual([
    { x: 1, y: 0, z: 0 },
    { x: 0.25, y: 0, z: 0 },
    { x: 0.25, y: 0, z: 1 },
    { x: -1, y: 0, z: 1 },
  ])
})
