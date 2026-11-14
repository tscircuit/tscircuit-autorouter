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

// Dense overlapping nodes mimic refined capacity meshes, where a single
// electrical endpoint may land inside more than one graph node. The indexed
// lookup must still produce exactly the same accepted crossing set.
for (const layerCount of [2, 6]) {
  for (const seed of [1, 5, 11, 19, 29, 43, 67, 101, 149, 211, 307, 401]) {
    test(`overlapping destination nodes retain baseline reachability: layerCount=${layerCount}, seed=${seed}`, () => {
      const nodes: CapacityMeshNode[] = Array.from({ length: 9 }, (_, i) => ({
        capacityMeshNodeId: `dense-n${i}`,
        center: { x: i * 0.73 - 2.5, y: ((i * seed) % 3) * 0.13 },
        width: 1.6,
        height: 1.4,
        layer: "z0",
        availableZ: layerCount === 6 ? [0, 1, 2, 3, 4, 5] : [0],
        _containsTarget: i === 0 || i === 8,
        _containsObstacle:
          i === 0 || i === 8 || (i > 1 && i < 8 && (i + seed) % 7 === 0),
        _connectedTo: i === 0 || i === 8 ? ["GND"] : ["OTHER"],
      }))
      const nodeMap = new Map(nodes.map((n) => [n.capacityMeshNodeId, n]))
      const portsByNodeId = new Map<string, SegmentPortPoint[]>()
      for (let i = 0; i < nodes.length - 1; i++) {
        const ids = [`dense-n${i}`, `dense-n${i + 1}`] as [string, string]
        const port: SegmentPortPoint = {
          segmentPortPointId: `dense-port${i}`,
          x: (nodes[i]!.center.x + nodes[i + 1]!.center.x) / 2,
          y: 0,
          nodeIds: ids,
          edgeId: `dense-e${i}`,
          availableZ: [0],
          connectionName: null,
          distToCentermostPortOnZ: 0,
          cramped: (i + seed) % 3 === 0,
        }
        for (const id of ids) {
          if (!portsByNodeId.has(id)) portsByNodeId.set(id, [])
          portsByNodeId.get(id)!.push(port)
        }
      }
      const connections: SimpleRouteJson["connections"] = [
        {
          name: "GND",
          pointsToConnect: [
            { x: nodes[0]!.center.x, y: nodes[0]!.center.y, layer: "top" },
            { x: nodes[8]!.center.x, y: nodes[8]!.center.y, layer: "top" },
          ],
        },
      ]
      const escapeIndex: ConnectionEscapeIndex = {
        layerCount,
        nodeTree: new CapacityNodeTree(nodes),
        freeSpaceComponentIds: new Map(),
      }
      for (const allowCrampedPortPoints of [true, false]) {
        const args = {
          target: nodes[0]!,
          nodes,
          nodeMap,
          portsByNodeId,
          connections,
          allowCrampedPortPoints,
        }
        expect(
          summarize(getConnectionEscapePortPoints({ ...args, escapeIndex })),
        ).toEqual(summarize(getConnectionEscapePortPoints(args)))
      }
    })
  }
}
