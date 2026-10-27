import { expect, test } from "bun:test"
import { Pipeline9StraightCellCertifier } from "../../lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/certifyPipeline9StraightCell"
import type { NodeWithPortPoints, PortPoint } from "../../lib/types/high-density-types"

test("a later two-cell allocation must retain nearby earlier witness copper in its transaction", (): void => {
  const specifications = [
    { name: "A", id: "A", x: 0, y1: 0.3, y2: 0 },
    { name: "B", id: "B", x: 1, y1: 0.3, y2: 0.6 },
    { name: "B", id: "C", x: 2, y1: 0.6, y2: -0.3 },
  ]
  const nodes: NodeWithPortPoints[] = specifications.map((specification) => {
    const start: PortPoint = { connectionName: specification.name, portPointId: `${specification.id}-start`, x: specification.x, y: specification.y1, z: 0 }
    const end: PortPoint = { connectionName: specification.name, portPointId: `${specification.id}-end`, x: specification.x + 1, y: specification.y2, z: 0 }
    return { capacityMeshNodeId: specification.id, center: { x: specification.x + 0.5, y: 0 }, width: 1, height: 2, availableZ: [0],
      portPoints: [start, end], portPointsInPairs: [[start, end]],
    }
  })
  const certifier = new Pipeline9StraightCellCertifier({ obstacles: [], physicalTerminals: [], layerCount: 2, traceWidth: 0.1, clearance: 0.17 })
  expect(certifier.certifyJointNodes(nodes.slice(0, 2), new Map()).certified).toBe(true)
  const proposed = new Map([["B-end", { x: 2, y: -0.3 }], ["C-start", { x: 2, y: -0.3 }]])
  expect(certifier.certifyJointNodes(nodes.slice(1), proposed).certified).toBe(true)
  expect(certifier.certifyJointNodes(nodes, proposed)).toEqual({ certified: false, reason: "copper" })
})
