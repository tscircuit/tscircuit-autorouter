import { expect, test } from "bun:test"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { MultiHeadPolyLineIntraNodeSolver } from "lib/solvers/HighDensitySolver/MultiHeadPolyLineIntraNodeSolver/MultiHeadPolyLineIntraNodeSolver"
import { computeViaCountVariants } from "lib/solvers/HighDensitySolver/MultiHeadPolyLineIntraNodeSolver/computeViaCountVariants"
import type { PolyLine2 } from "lib/solvers/HighDensitySolver/MultiHeadPolyLineIntraNodeSolver/types2"
import type { NodeWithPortPoints } from "lib/types/high-density-types"
import { getIntraNodeCrossings } from "lib/utils/getIntraNodeCrossings"

test("one two-via overpass can separate two distinct same-layer crossings", (): void => {
  const lines: PolyLine2[] = [
    {
      connectionName: "overpass",
      start: { x: -3, y: 0, z1: 0, z2: 0 },
      mPoints: [
        { x: -2, y: 0, z1: 0, z2: 1 },
        { x: 2, y: 0, z1: 1, z2: 0 },
      ],
      end: { x: 3, y: 0, z1: 0, z2: 0 },
    },
    ...[-1, 1].map(
      (x, index): PolyLine2 => ({
        connectionName: `vertical-${index}`,
        start: { x, y: -3, z1: 0, z2: 0 },
        mPoints: [{ x, y: 0, z1: 0, z2: 0 }],
        end: { x, y: 3, z1: 0, z2: 0 },
      }),
    ),
  ]
  const nodeWithPortPoints: NodeWithPortPoints = {
    capacityMeshNodeId: "shared-overpass",
    center: { x: 0, y: 0 },
    width: 6,
    height: 6,
    availableZ: [0, 1],
    portPoints: lines.flatMap((line) => [
      { ...line.start, z: 0, connectionName: line.connectionName },
      { ...line.end, z: 0, connectionName: line.connectionName },
    ]),
  }
  const connMap = new ConnectivityMap({
    overpassNet: ["overpass"],
    verticalNet0: ["vertical-0"],
    verticalNet1: ["vertical-1"],
  })
  const solver = new MultiHeadPolyLineIntraNodeSolver({
    nodeWithPortPoints,
    connMap,
    hyperParameters: { SEGMENTS_PER_POLYLINE: 2 },
  })
  expect(getIntraNodeCrossings(nodeWithPortPoints).numSameLayerCrossings).toBe(
    2,
  )
  expect(solver.failed).toBe(false)
  expect(solver.minViaCount).toBe(0)
  const entries: [
    string,
    { start: PolyLine2["start"]; end: PolyLine2["end"] },
  ][] = lines.map((line) => [line.connectionName, line])
  expect(
    computeViaCountVariants(entries, 2, 2, solver.minViaCount, connMap),
  ).toContainEqual([2, 0, 0])
  expect(
    solver.checkIfSolved({
      polyLines: lines,
      minGaps: solver.computeMinGapBtwPolyLines(lines),
    }),
  ).toBe(true)
  expect(
    lines.flatMap((line) =>
      line.mPoints.filter((point) => point.z1 !== point.z2),
    ),
  ).toHaveLength(2)
})
