import type { SerializedHyperGraph } from "@tscircuit/hypergraph"
import { expect, test } from "bun:test"
import { CrampedPortAwareGreedyFinalRouteSolver } from "lib/solvers/PortPointPathingSolver/tinyhypergraph/CrampedPortAwareGreedyFinalRouteSolver"
import { loadSerializedHyperGraph } from "tiny-hypergraph/lib/compat/loadSerializedHyperGraph"

test("final greedy routing prefers free capacity but can use overflow when necessary", () => {
  for (const withAlternative of [true, false]) {
    const ports: SerializedHyperGraph["ports"] = [
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
        d: {
          x: 0,
          y: 0,
          z: 0,
          crampedBoundaryKey: "busy",
          crampedBoundaryCapacity: 1,
          crampedBoundaryPitch: 3,
        },
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
    ports.push({
      portId: "occupied-sibling",
      region1Id: "occupied-a",
      region2Id: "occupied-b",
      d: {
        x: 0,
        y: 0,
        z: 0,
        crampedBoundaryKey: "busy",
        crampedBoundaryCapacity: 1,
        crampedBoundaryPitch: 3,
      },
    })
    const graph: SerializedHyperGraph = {
      ports,
      regions: [
        "start",
        "left",
        "right",
        "end",
        "occupied-a",
        "occupied-b",
      ].map((regionId, index) => ({
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
    const sibling = topology.portMetadata!.findIndex(
      (port) => port.serializedPortId === "occupied-sibling",
    )
    solver.state.portAssignment[sibling] = 42
    solver.solve()
    expect(solver.solved).toBe(true)
    expect(solver.failed).toBe(false)
    const overflowIndex = topology.portMetadata!.findIndex(
      (port) => port.serializedPortId === "overflow",
    )
    expect(overflowIndex).toBeGreaterThanOrEqual(0)
    expect(solver.state.portAssignment[overflowIndex] >= 0).toBe(
      !withAlternative,
    )
    // Unused duplicates do not consume capacity, and branches of the same net
    // can share a boundary without being charged as different signals.
    solver.state.currentRouteId = 0
    solver.state.currentRouteNetId = 0
    solver.state.portAssignment[overflowIndex] = -1
    solver.state.ripCount++
    const usedCost = solver.computeH(overflowIndex)
    solver.state.portAssignment[sibling] = -1
    solver.state.ripCount++
    const unusedCost = solver.computeH(overflowIndex)
    expect(usedCost).toBeGreaterThan(unusedCost)
    solver.state.currentRouteNetId = 42
    solver.state.portAssignment[sibling] = 42
    solver.state.ripCount++
    expect(solver.computeH(overflowIndex)).toBe(unusedCost)
  }
})
