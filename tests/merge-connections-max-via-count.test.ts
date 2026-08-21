import { expect, test } from "bun:test"
import { mergeConnections } from "lib/solvers/NetToPointPairsSolver/mergeConnections"
import { getConnectionPointPairKey } from "lib/utils/getConnectionPointPairKey"

test("merged connections retain each original via limit", () => {
  const [mergedConnection] = mergeConnections([
    {
      name: "XTAL_OUT",
      maxViaCount: 2,
      pointsToConnect: [
        { x: 0, y: 0, layer: "top" },
        { x: 1, y: 0, layer: "top" },
      ],
    },
    {
      name: "XTAL_LOAD_OUT",
      maxViaCount: 0,
      pointsToConnect: [
        { x: 1, y: 0, layer: "top" },
        { x: 2, y: 0, layer: "top" },
      ],
    },
  ])

  expect(mergedConnection?.maxViaCount).toBeUndefined()
  expect(mergedConnection?.maxViaCountByRootConnectionName).toEqual({
    XTAL_OUT: 2,
    XTAL_LOAD_OUT: 0,
  })
  expect(mergedConnection?.maxViaCountByPointPair).toEqual({
    [getConnectionPointPairKey(
      { x: 0, y: 0, layer: "top" },
      { x: 1, y: 0, layer: "top" },
    )]: 2,
    [getConnectionPointPairKey(
      { x: 1, y: 0, layer: "top" },
      { x: 2, y: 0, layer: "top" },
    )]: 0,
  })
})
