import { expect, test } from "bun:test"
import type { SerializedHyperGraph } from "@tscircuit/hypergraph"
import { loadSerializedHyperGraph } from "tiny-hypergraph/lib/compat/loadSerializedHyperGraph"
import { CrampedPortAwareGreedyFinalRouteSolver } from "lib/solvers/PortPointPathingSolver/tinyhypergraph/CrampedPortAwareGreedyFinalRouteSolver"

test("final greedy routing prefers free capacity but can use overflow when necessary", () => {
  for (const withAlternative of [true, false]) {
    const ports = [
      {
        portId: "start",
        region1Id: "start",
        region2Id: "left",
        d: { x: -3, y: 0, z: 0 },
      },
      {
        portId: "overflow",
        region1Id: "left",
        region2Id: "right",
        d: { x: 0, y: 0, z: 0, crampedPortOverflowPenalty: 150 },
      },
      ...(withAlternative
        ? [
            {
              portId: "free",
              region1Id: "left",
              region2Id: "right",
              d: { x: 0, y: 2, z: 0 },
            },
          ]
        : []),
      {
        portId: "end",
        region1Id: "right",
        region2Id: "end",
        d: { x: 3, y: 0, z: 0 },
      },
    ]
    const graph: SerializedHyperGraph = {
      ports,
      regions: ["start", "left", "right", "end"].map((regionId, index) => ({
        regionId,
        pointIds: ports
          .filter(
            (port) =>
              port.region1Id === regionId || port.region2Id === regionId,
          )
          .map((port) => port.portId),
        d: { center: { x: index * 2 - 3, y: 0 }, width: 2, height: 6 },
      })),
      connections: [
        {
          connectionId: "route",
          startRegionId: "start",
          endRegionId: "end",
          mutuallyConnectedNetworkId: "net",
        },
      ],
    }
    const { topology, problem } = loadSerializedHyperGraph(graph)
    const solver = new CrampedPortAwareGreedyFinalRouteSolver(topology, problem)
    solver.solve()
    expect(solver.solved).toBe(true)
    expect(solver.failed).toBe(false)
    const overflowIndex = topology.portMetadata!.findIndex(
      (port) => port.serializedPortId === "overflow",
    )
    expect(overflowIndex).toBeGreaterThanOrEqual(0)
    expect(solver.state.portAssignment[overflowIndex] >= 0).toBe(!withAlternative)
  }
})
