import { expect, test } from "bun:test"
import type { RegionHg } from "lib/solvers/PortPointPathingSolver/hgportpointpathingsolver/types"
import { TinyHypergraphPortPointPathingSolver } from "lib/solvers/PortPointPathingSolver/tinyhypergraph/TinyHypergraphPortPointPathingSolver"
import input from "../fixtures/features/portpointpathing/tinyhypergraph-port-bridge-repro-input.json"

test("TinyHypergraph finds a real port-point path between distinct coincident terminals", () => {
  const region: RegionHg = {
    regionId: "terminal-region",
    d: {
      capacityMeshNodeId: "terminal-region",
      center: { x: 0, y: 0 },
      width: 2,
      height: 2,
      layer: "top",
      availableZ: [0],
    },
    ports: [],
  }
  const solver = new TinyHypergraphPortPointPathingSolver({
    graph: { regions: [region], ports: [] },
    connections: [
      {
        connectionId: "coincident-pair",
        mutuallyConnectedNetworkId: "net",
        startRegion: region,
        endRegion: region,
        simpleRouteConnection: {
          name: "coincident-pair",
          pointsToConnect: [
            {
              x: 0,
              y: 0,
              layer: "top",
              pointId: "logical-a",
              pcb_port_id: "pcb-a",
            },
            {
              x: 0,
              y: 0,
              layer: "top",
              pointId: "logical-b",
              pcb_port_id: "pcb-b",
            },
          ],
        },
      },
    ],
    layerCount: 2,
    effort: 1,
    preserveTerminalPcbPortIds: true,
    flags: {
      FORCE_CENTER_FIRST: true,
      RIPPING_ENABLED: true,
      USE_SELECTIVE_RERIP_ROUTING: true,
    },
    weights: input.weights,
  })
  solver.solve()

  expect(solver.solved).toBe(true)
  expect(solver.failed).toBe(false)
  const { nodesWithPortPoints } = solver.getOutput()
  expect(nodesWithPortPoints).toHaveLength(1)
  const [node] = nodesWithPortPoints
  expect(node.capacityMeshNodeId).toBe(region.regionId)
  expect(node.portPoints).toHaveLength(2)
  expect(node.portPointsInPairs).toHaveLength(1)
  const [start, end] = node.portPointsInPairs![0]
  expect(
    [start, end].map(({ x, y, z, pcb_port_id, connectionName }) => ({
      x,
      y,
      z,
      pcb_port_id,
      connectionName,
    })),
  ).toEqual([
    {
      x: 0,
      y: 0,
      z: 0,
      pcb_port_id: "pcb-a",
      connectionName: "coincident-pair",
    },
    {
      x: 0,
      y: 0,
      z: 0,
      pcb_port_id: "pcb-b",
      connectionName: "coincident-pair",
    },
  ])
  expect(start.portPointId).toBeDefined()
  expect(end.portPointId).toBeDefined()
  expect(start.portPointId).not.toBe(end.portPointId)
  expect(start.nextPortPointId).toBe(end.portPointId)
  expect(end.prevPortPointId).toBe(start.portPointId)
})
