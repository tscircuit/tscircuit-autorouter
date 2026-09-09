import { expect, test } from "bun:test"
import { minimumDistanceBetweenSegments } from "lib/utils/minimumDistanceBetweenSegments"
import {
  createPadJunctionFixture,
  solvePadJunction,
} from "../fixtures/pad-junction"

test("local V replacement keeps an existing same-net branch tap connected", () => {
  const input = createPadJunctionFixture()
  const tap = { x: -1, y: 2, z: 0 }
  input.otherHdRoutes = [
    {
      connectionName: "tap",
      rootConnectionName: "signal",
      traceThickness: 0.2,
      viaDiameter: 0.3,
      vias: [],
      route: [{ x: -4, y: 2, z: 0 }, tap],
    },
  ]
  const solver = solvePadJunction(input)
  const route = solver.getOutput()[0]!.route
  const distance = Math.min(
    ...route
      .slice(1)
      .map((point, index) =>
        minimumDistanceBetweenSegments(route[index]!, point, tap, tap),
      ),
  )
  expect(distance).toBeLessThan(1e-8)
  expect(input.otherHdRoutes[0]!.route.at(-1)).toEqual(tap)
})
