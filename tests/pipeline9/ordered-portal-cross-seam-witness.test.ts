import { expect, test } from "bun:test"
import { Pipeline9StraightCellCertifier } from "../../lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/certifyPipeline9StraightCell"
import type { NodeWithPortPoints, PortPoint } from "../../lib/types/high-density-types"

test("joint witness checks copper on opposite sides of a seam even when each cell alone is feasible", (): void => {
  const pair = (name: string, id: string, start: [number, number], end: [number, number]): [PortPoint, PortPoint] => [
    { connectionName: name, portPointId: `${id}-a`, x: start[0], y: start[1], z: 0 },
    { connectionName: name, portPointId: `${id}-b`, x: end[0], y: end[1], z: 0 },
  ]
  // A rises away from the seam on its left; B descends on its right. The
  // nearest pair of points is across the artificial boundary.
  const leftPairs = [pair("A", "A-left", [0, 0.3], [1, 0]), pair("C", "C-left", [0, 1], [1, 1])]
  const rightPairs = [pair("B", "B-right", [1, 0.3], [2, 0]), pair("D", "D-right", [1, -1], [2, -1])]
  const nodes: NodeWithPortPoints[] = [leftPairs, rightPairs].map((pairs, index) => ({ capacityMeshNodeId: `node-${index}`,
    center: { x: index + 0.5, y: 0 }, width: 1, height: 2, availableZ: [0], portPoints: pairs.flat(), portPointsInPairs: pairs,
  }))
  const certifier = new Pipeline9StraightCellCertifier({ obstacles: [], physicalTerminals: [], layerCount: 2, traceWidth: 0.1, clearance: 0.19 })
  for (const node of nodes) expect(certifier.certify(node, new Map()).certified).toBe(true)
  expect(certifier.certifyJointNodes(nodes, new Map())).toEqual({ certified: false, reason: "copper" })
})
