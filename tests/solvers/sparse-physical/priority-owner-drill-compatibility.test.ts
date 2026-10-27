import { expect, test } from "bun:test"
import { createPriorityOwnerFixture } from "./priorityOwnerFixture"

test("same-owner final witnesses retain distinct drill spacing, pad size, and blind-span compatibility", (): void => {
  const near = createPriorityOwnerFixture({ sameOwner: true })
  near.childRoute.vias = [{ x: 5.2, y: 5 }]
  near.childRoute.route = [
    { x: 5.2, y: 5, z: 0 },
    { x: 5.2, y: 5, z: 1 },
    { x: 8, y: 8, z: 1 },
  ]
  expect(
    near.solver["pairConflict"](near.ancestorTask, near.childTask, near.state),
  ).toBe(true)

  const diameter = createPriorityOwnerFixture({ sameOwner: true })
  diameter.ancestorRoute.viaDiameter = 0.5
  expect(
    diameter.solver["pairConflict"](
      diameter.ancestorTask,
      diameter.childTask,
      diameter.state,
    ),
  ).toBe(true)

  const blind = createPriorityOwnerFixture({
    sameOwner: true,
    allowBlindAndBuriedVias: true,
  })
  expect(
    blind.solver["pairConflict"](blind.ancestorTask, blind.childTask, blind.state),
  ).toBe(false)
  blind.ancestorRoute.route = [
    { x: 2, y: 5, z: 0 },
    { x: 5, y: 5, z: 0 },
    { x: 5, y: 5, z: 2 },
    { x: 8, y: 5, z: 2 },
  ]
  // The production copper cache is keyed by immutable route identity. Give the
  // changed physical witness its own identity, as the actual DAG does.
  const changed = blind.state.witnesses[blind.ancestorTask]!
  blind.state.witnesses[blind.ancestorTask] = {
    ...changed,
    route: { ...blind.ancestorRoute },
  }
  expect(
    blind.solver["pairConflict"](blind.ancestorTask, blind.childTask, blind.state),
  ).toBe(true)

  const ownPath = createPriorityOwnerFixture({ sameOwner: true })
  ownPath.childRoute.vias.push({ x: 5.2, y: 5 })
  expect(
    ownPath.solver["validateRoute"](ownPath.childTask, ownPath.state),
  ).toBe(false)
})
