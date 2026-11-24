import { expect, test } from "bun:test"
import type { Edge } from "lib/solvers/NetToPointPairsSolver/buildMinimumSpanningTree"
import { getMstEdgeTraceWidths } from "lib/solvers/NetToPointPairsSolver/getMstEdgeTraceWidths"
import type { ConnectionPoint, SimpleRouteConnection } from "lib/types"

test("the shared path gets the widest target while each branch keeps its own", (): void => {
  const pad = (pointId: string, x: number, y: number): ConnectionPoint => ({
    pointId, x, y, layer: "top",
  })
  const supply = pad("supply", 0, 0)
  const split = pad("split", 1, 0)
  const driver = pad("driver", 2, 0)
  const monitor = pad("monitor", 1, 1)
  const tap = pad("tap", 1, -1)
  const shared: Edge<ConnectionPoint> = { from: supply, to: split, weight: 0 }
  const power: Edge<ConnectionPoint> = { from: driver, to: split, weight: 1 }
  const sense: Edge<ConnectionPoint> = { from: split, to: monitor, weight: 1 }
  const unspecified: Edge<ConnectionPoint> = { from: split, to: tap, weight: 1 }
  const edges = [power, shared, sense, unspecified]
  const sources: SimpleRouteConnection[] = [
    {
      name: "sense",
      nominalTraceWidth: 0.15,
      pointsToConnect: [supply, monitor],
    },
    {
      name: "power",
      width: 0.8,
      pointsToConnect: [{ ...supply, x: -0.1 }, driver],
    },
    { name: "tap", pointsToConnect: [supply, tap] },
  ]

  const expected = new Map([
    [shared, 0.8],
    [power, 0.8],
    [sense, 0.15],
  ])
  const mergedPoints = [supply, split, driver, monitor, tap]
  expect(getMstEdgeTraceWidths(mergedPoints, edges, sources)).toEqual(expected)
  expect(
    getMstEdgeTraceWidths(mergedPoints, edges, [...sources].reverse()),
  ).toEqual(expected)
})
