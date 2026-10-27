import { expect, test } from "bun:test"
import { SingleHighDensityRouteSolver6_VertHorzLayer_FutureCost as Native } from "lib/solvers/HighDensitySolver/SingleHighDensityRouteSolver6_VertHorzLayer_FutureCost"
import { createPriorityOwnerFixture } from "./priorityOwnerFixture"

test("final validation reuses same-net via copper while preserving foreign copper and board bounds", (): void => {
  const own = createPriorityOwnerFixture({ sameOwner: true })
  const options = own.solver["getOptions"](own.childTask, own.state)
  const native = new Native(options)
  expect(
    native.isNodeTooCloseToObstacle(
      { x: 5, y: 5, z: 1, g: 0, h: 0, f: 0, parent: null },
      0.2,
      true,
    ),
  ).toBe(true)
  expect(
    own.solver["pairConflict"](own.ancestorTask, own.childTask, own.state),
  ).toBe(false)
  expect(own.solver["validateRoute"](own.childTask, own.state)).toBe(true)

  const foreign = createPriorityOwnerFixture({ sameOwner: false })
  expect(
    foreign.solver["pairConflict"](
      foreign.ancestorTask,
      foreign.childTask,
      foreign.state,
    ),
  ).toBe(true)
  expect(
    foreign.solver["validateRoute"](foreign.childTask, foreign.state),
  ).toBe(false)
  foreign.ancestorRoute.vias = []
  foreign.ancestorRoute.route = [
    { x: 2, y: 6.5, z: 1 },
    { x: 8, y: 6.5, z: 1 },
  ]
  expect(
    foreign.solver["validateRoute"](foreign.childTask, foreign.state),
  ).toBe(false)

  const outside = createPriorityOwnerFixture({ sameOwner: true })
  outside.childRoute.route = [
    { x: 0.01, y: 5, z: 0 },
    { x: 0.01, y: 5, z: 1 },
    { x: 8, y: 8, z: 1 },
  ]
  outside.childRoute.vias = [{ x: 0.01, y: 5 }]
  expect(
    outside.solver["validateRoute"](outside.childTask, outside.state),
  ).toBe(false)
})
