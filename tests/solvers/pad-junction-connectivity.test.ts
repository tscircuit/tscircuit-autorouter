import { expect, test } from "bun:test"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import {
  createPadJunctionFixture,
  solvePadJunction,
} from "../fixtures/pad-junction"

test("V detection resolves member aliases and merged net keys without confusing foreign nets", () => {
  for (const root of ["branch-alias", "signal", "old-net", "foreign"]) {
    const input = createPadJunctionFixture()
    input.connMap = new ConnectivityMap({
      signal: ["pad-port", "branch-alias"],
      "old-net": ["old-member"],
      foreign: ["foreign-member"],
    })
    input.connMap.addConnections([["pad-port", "old-member"]])
    for (const [index, route] of input.hdRoutes.entries()) {
      route.connectionName = `generated-${index}`
      route.rootConnectionName = root
    }
    const solver = solvePadJunction(input)
    expect(
      solver.outcomes.some((outcome) => outcome.outcome === "accepted"),
    ).toBe(root !== "foreign")
    if (root === "foreign") expect(solver.getOutput()).toEqual(input.hdRoutes)
  }
})
