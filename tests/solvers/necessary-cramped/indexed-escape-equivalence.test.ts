import { expect, test } from "bun:test"
import { CapacityNodeTree } from "lib/data-structures/CapacityNodeTree"
import { getConnectionEscapePortPoints } from "lib/solvers/AvailableSegmentPointSolver/getConnectionEscapePortPoints"
import type { SegmentPortPoint } from "lib/solvers/AvailableSegmentPointSolver/AvailableSegmentPointSolver"
import type { ConnectionEscapeIndex } from "lib/solvers/AvailableSegmentPointSolver/getConnectionEscapeIndex"
import type { CapacityMeshNode, SimpleRouteJson } from "lib/types"

const summarize = (ports: Set<SegmentPortPoint> | undefined) =>
  ports === undefined
    ? null
    : [...ports].map((p) => p.segmentPortPointId).sort()

for (const layerCount of [2, 6]) {
  for (const blockedAt of [-1, 1, 2, 3, 4]) {
    for (const crampedAt of [-1, 0, 2]) {
      test(`spatial endpoint index preserves original escape results: layers=${layerCount}, blocked=${blockedAt}, cramped=${crampedAt}`, () => {
        const nodes: CapacityMeshNode[] = Array.from({ length: 6 }, (_, i) => ({
          capacityMeshNodeId: `n${i}`,
          center: { x: i, y: 0 },
          width: 1,
          height: 1,
          layer: "z0",
          availableZ: layerCount === 6 ? [0, 1, 2] : [0],
          _containsTarget: i === 0 || i === 5,
          _containsObstacle: i === 0 || i === 5 || i === blockedAt,
          _connectedTo:
            i === 0 || i === 5
              ? ["GND"]
              : i === blockedAt
                ? ["foreign"]
                : undefined,
        }))
        const map = new Map(nodes.map((n) => [n.capacityMeshNodeId, n]))
        const ports = new Map<string, SegmentPortPoint[]>()
        for (let i = 0; i < nodes.length - 1; i++) {
          const port = {
            segmentPortPointId: `p${i}`,
            x: i + 0.5,
            y: 0,
            availableZ: [0],
            nodeIds: [`n${i}`, `n${i + 1}`],
            edgeId: `e${i}`,
            connectionName: null,
            distToCentermostPortOnZ: 0,
            cramped: crampedAt === i,
          } as SegmentPortPoint
          for (const id of port.nodeIds) {
            if (!ports.has(id)) ports.set(id, [])
            ports.get(id)!.push(port)
          }
        }
        const connections: SimpleRouteJson["connections"] = [
          {
            name: "GND",
            pointsToConnect: [
              { x: 0, y: 0, layer: "top" },
              { x: 5, y: 0, layer: "top" },
            ],
          },
        ]
        // No free-space fast shortcut: only the endpoint spatial query changes.
        const escapeIndex: ConnectionEscapeIndex = {
          layerCount,
          nodeTree: new CapacityNodeTree(nodes),
          freeSpaceComponentIds: new Map(),
        }
        for (const allowCrampedPortPoints of [false, true]) {
          const input = {
            target: nodes[0]!,
            nodes,
            nodeMap: map,
            portsByNodeId: ports,
            connections,
            allowCrampedPortPoints,
          }
          const baseline = summarize(getConnectionEscapePortPoints(input))
          const indexed = summarize(
            getConnectionEscapePortPoints({ ...input, escapeIndex }),
          )
          expect(indexed).toEqual(baseline)
        }
      })
    }
  }
}
