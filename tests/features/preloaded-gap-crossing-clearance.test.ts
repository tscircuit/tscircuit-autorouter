import { expect, test } from "bun:test"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import type { ClearanceGap } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/ClearanceGapIndex"
import {
  findConflictingGaps,
  type PortPointId,
} from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/findConflictingGaps"

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
      z,
      start: { x: startX, y: 0 },
      end: { x: endX, y: 0 },
    })
    return { portPointId, connectionName, x: (startX + endX) / 2, y: 0, z }
  })

  const conflictingGaps = findConflictingGaps({
    nodesWithPortPoints: [{ portPoints }, { portPoints }],
    clearanceGapsByPortId,
    connMap: new ConnectivityMap({ DQ0: ["DQ0", "DQ0_branch"] }),
    srj: { minTraceWidth: 0.124, minTraceToPadEdgeClearance: 0.1 },
  })
  expect(conflictingGaps).toEqual([clearanceGapsByPortId.get("DQ1::0")!])
})
