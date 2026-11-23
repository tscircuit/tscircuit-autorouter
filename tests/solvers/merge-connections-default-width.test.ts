import { expect, test } from "bun:test"
import { mergeConnections } from "lib/solvers/NetToPointPairsSolver/mergeConnections"
import type { SimpleRouteConnection } from "lib/types"

test("merging aliases keeps first-width behavior unless maximum is requested", () => {
  const connections: SimpleRouteConnection[] = [
    { name: "unqualified", pointsToConnect: [{ x: 0, y: 0, layer: "top" }] },
    {
      name: "local",
      nominalTraceWidth: 0.1,
      pointsToConnect: [{ x: 0, y: 0, layer: "top" }],
    },
    {
      name: "net",
      nominalTraceWidth: 0.4,
      pointsToConnect: [{ x: 0, y: 0, layer: "top" }],
    },
  ]
  expect(mergeConnections(connections)[0]!.nominalTraceWidth).toBe(0.1)
  expect(
    mergeConnections(connections, { nominalTraceWidth: "first" }),
  ).toEqual(mergeConnections(connections))
  expect(
    mergeConnections(connections, { nominalTraceWidth: "maximum" })[0]!
      .nominalTraceWidth,
  ).toBe(0.4)
})
