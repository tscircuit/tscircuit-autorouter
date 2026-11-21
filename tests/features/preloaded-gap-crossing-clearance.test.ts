import { expect, test } from "bun:test"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import {
  findConflictingGapKeys,
  type ClearanceGap,
  type PortPointId,
} from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/findConflictingGapKeys"

test("a rejected crossing leaves room for a later net at the clearance limit", () => {
  const west = { startX: -0.1, endX: 0, z: 0 }
  const east = { startX: 0, endX: 0.06, z: 0 }
  const crossings = [
    { ...west, connectionName: "DQ0" },
    { ...west, connectionName: "DQ0_branch" },
    { ...east, connectionName: "DQS", z: 1 },
    { ...east, connectionName: "DQ1" },
    { ...east, connectionName: "DQ2", endX: 0.124 },
  ]
  const clearanceGapsByPortId = new Map<PortPointId, ClearanceGap>()
  const portPoints = crossings.map(({ connectionName, startX, endX, z }) => {
    const portPointId = `${connectionName}::${z}`
    clearanceGapsByPortId.set(portPointId, {
      key: portPointId,
      start: { x: startX, y: 0 },
      end: { x: endX, y: 0 },
    })
    return { portPointId, connectionName, x: (startX + endX) / 2, y: 0, z }
  })

  const conflictingGapKeys = findConflictingGapKeys({
    nodesWithPortPoints: [{ portPoints }, { portPoints }],
    clearanceGapsByPortId,
    connMap: new ConnectivityMap({ DQ0: ["DQ0", "DQ0_branch"] }),
    srj: { minTraceWidth: 0.124, minTraceToPadEdgeClearance: 0.1 },
  })
  expect(conflictingGapKeys).toEqual(new Set(["DQ1::0"]))
})
