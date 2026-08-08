import { expect, test } from "bun:test"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { buildHyperGraph } from "lib/solvers/PortPointPathingSolver/hgportpointpathingsolver"
import type { CapacityMeshNode, SimpleRouteConnection } from "lib/types"
import { getGraphicsSvgFrames } from "tests/fixtures/solver-svg-frames"

const capacityMeshNodes: CapacityMeshNode[] = [
  { capacityMeshNodeId: "start", x: -2, y: 0 },
  { capacityMeshNodeId: "shortcut", x: 0, y: 0 },
  { capacityMeshNodeId: "detour", x: 0, y: 2 },
  { capacityMeshNodeId: "end", x: 2, y: 0 },
].map(({ capacityMeshNodeId, x, y }) => ({
  capacityMeshNodeId,
  center: { x, y },
  width: 1.5,
  height: 1.5,
  layer: "top",
  availableZ: [0],
}))

const connections: SimpleRouteConnection[] = [-0.2, 0.2].map((y, index) => ({
  name: `route-${index}`,
  pointsToConnect: [
    { x: -2, y, layer: "top" },
    { x: 2, y, layer: "top" },
  ],
}))

test("reproduces two nets competing for one physical shortcut lane", async () => {
  const connectivityMap = new ConnectivityMap({})
  for (const connection of connections) {
    connectivityMap.addConnections([[connection.name]])
  }
  const portalDefinitions = [
    { nodeIds: ["start", "shortcut"], x: -1, y: 0 },
    { nodeIds: ["shortcut", "end"], x: 1, y: 0 },
    { nodeIds: ["start", "detour"], x: -1, y: 1 },
    { nodeIds: ["detour", "end"], x: 1, y: 1 },
  ] as const
  const segmentPortPoints = portalDefinitions.map(
    ({ nodeIds, x, y }, index) => ({
      segmentPortPointId: `portal-${index}`,
      x,
      y,
      availableZ: [0],
      nodeIds: [...nodeIds] as [string, string],
      edgeId: `edge-${index}`,
      connectionName: null,
      distToCentermostPortOnZ: 0,
      cramped: false,
    }),
  )
  const { graph } = buildHyperGraph({
    capacityMeshNodes,
    segmentPortPoints,
    layerCount: 1,
    connectivityMap,
    simpleRouteJsonConnections: connections,
  })

  expect(connections).toHaveLength(2)
  expect(graph.ports).toHaveLength(4)
  expect(graph.ports.every((port) => port.d.z === 0)).toBe(true)

  const svg = getGraphicsSvgFrames({
    frames: [
      {
        name: "Input: 2 nets compete for a 1-lane shortcut",
        step: 0,
        graphics: {
          rects: graph.regions.map((region) => ({
            center: region.d.center,
            width: region.d.width,
            height: region.d.height,
            fill: "rgba(226, 232, 240, 0.25)",
            stroke: "#94a3b8",
            label: region.regionId,
          })),
          circles: graph.ports.map((port) => ({
            center: port.d,
            radius: 0.09,
            fill: "#cbd5e1",
            stroke: "#334155",
            label: "1 physical lane",
          })),
          lines: connections.map((connection, index) => ({
            points: connection.pointsToConnect,
            strokeColor: index === 0 ? "#ef4444" : "#2563eb",
            strokeWidth: 0.05,
            label: connection.name,
          })),
          texts: graph.regions.map((region) => ({
            x: region.d.center.x,
            y: region.d.center.y + 0.5,
            text:
              region.regionId === "shortcut" || region.regionId === "detour"
                ? `${region.regionId}: 1 lane`
                : region.regionId,
            fontSize: 0.14,
            anchorSide: "center" as const,
          })),
        },
      },
    ],
    columns: 1,
    cellWidth: 5.5,
    cellHeight: 4.5,
  })
  await expect(svg).toMatchSvgSnapshot(import.meta.path)
})
