import { expect, test } from "bun:test"
import { TinyHyperGraphSolver, loadSerializedHyperGraph } from "tiny-hypergraph/lib/index"
import { TopologyMergingSolver } from "lib/solvers/TopologyMergingSolver/TopologyMergingSolver"
import type { CapacityMeshNode } from "../../lib/types"

type SerializedGraph = Parameters<typeof loadSerializedHyperGraph>[0]

function getFreeLayerNodes(joinLayers: boolean): CapacityMeshNode[] {
  const nodes: CapacityMeshNode[] = [0, 1].map((z) => ({
    capacityMeshNodeId: `free-${z}`,
    center: { x: z + 1, y: 1 },
    width: 2, height: 2, availableZ: [z], layer: `z${z}`,
  }))
  const solver = new TopologyMergingSolver({
    layerCount: 2,
    minViaPadDiameter: joinLayers ? 0.3 : undefined,
    nodeGroups: nodes.map((node, index) => ({
      groupId: `group-${index}`, nodes: [node], isComponent: false,
    })),
  })
  solver.solve()
  return [
    { capacityMeshNodeId: "start", center: { x: -0.05, y: 1 },
      width: 0.1, height: 2, availableZ: [0], layer: "z0" },
    ...solver.getOutput(),
    { capacityMeshNodeId: "goal", center: { x: 3.05, y: 1 },
      width: 0.1, height: 2, availableZ: [1], layer: "z1" },
  ]
}

function routeFreeLayerNodes(nodes: CapacityMeshNode[]): TinyHyperGraphSolver {
  const ports: SerializedGraph["ports"] = []
  for (const a of nodes) {
    for (const b of nodes) {
      const x = a.center.x + a.width / 2
      if (Math.abs(x - (b.center.x - b.width / 2)) > 1e-8) continue
      for (const z of a.availableZ.filter((value) => b.availableZ.includes(value))) {
        ports.push({ portId: `p-${ports.length}`,
          region1Id: a.capacityMeshNodeId, region2Id: b.capacityMeshNodeId,
          d: { x, y: 1, z } })
      }
    }
  }
  const graph: SerializedGraph = {
    regions: nodes.map((node) => ({
      regionId: node.capacityMeshNodeId, d: node,
      pointIds: ports.filter((port) => port.region1Id === node.capacityMeshNodeId ||
        port.region2Id === node.capacityMeshNodeId).map((port) => port.portId),
    })),
    ports,
    connections: [{ connectionId: "transition", mutuallyConnectedNetworkId: "signal",
      startRegionId: "start", endRegionId: "goal" }],
  }
  const loaded = loadSerializedHyperGraph(graph)
  const solver = new TinyHyperGraphSolver(loaded.topology, loaded.problem, {
    MAX_ITERATIONS: 1000, ACCEPT_BEST_SOLUTION_ON_TIMEOUT: false, GREEDY_FINAL_ROUTE_ITERS: 0,
    minViaPadDiameter: 0.3,
  })
  solver.solve()
  return solver
}

test("a native route can change layers only after overlapping free domains are joined", (): void => {
  const original = routeFreeLayerNodes(getFreeLayerNodes(false))
  expect(original.solved).toBe(false)
  const corrected = routeFreeLayerNodes(getFreeLayerNodes(true))
  expect(corrected.solved).toBe(true)
  expect(corrected.failed).toBe(false)
  expect(corrected.state.unroutedRoutes).toHaveLength(0)
  const transitions = corrected.state.regionSegments.flatMap((segments, regionId) =>
    segments.filter(([, a, b]) => corrected.topology.portZ[a] !== corrected.topology.portZ[b])
      .map(() => corrected.topology.regionAvailableZMask![regionId]))
  expect(transitions).toEqual([3])
})
