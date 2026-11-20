import { expect, test } from "bun:test"
import type { Edge } from "lib/solvers/NetToPointPairsSolver/buildMinimumSpanningTree"
import { getMstEdgeTraceWidths } from "lib/solvers/NetToPointPairsSolver/getMstEdgeTraceWidths"
import type { ConnectionPoint, SimpleRouteConnection } from "lib/types"

test("the shared path gets the widest target while each branch keeps its own", (): void => {
  const supply: ConnectionPoint = {
    x: 0,
    y: 0,
    layer: "top",
    pointId: "supply",
  }
  const split: ConnectionPoint = { x: 1, y: 0, layer: "top", pointId: "split" }
  const driver: ConnectionPoint = {
    x: 2,
    y: 0,
    layer: "top",
    pointId: "driver",
  }
  const monitor: ConnectionPoint = {
    x: 1,
    y: 1,
    layer: "top",
    pointId: "monitor",
  }
  const tap: ConnectionPoint = { x: 1, y: -1, layer: "top", pointId: "tap" }
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
