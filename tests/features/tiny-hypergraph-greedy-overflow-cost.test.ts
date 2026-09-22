import type { SerializedHyperGraph } from "@tscircuit/hypergraph"
import { expect, test } from "bun:test"
import { CrampedPortAwareGreedyFinalRouteSolver } from "lib/solvers/PortPointPathingSolver/tinyhypergraph/CrampedPortAwareGreedyFinalRouteSolver"
import { loadSerializedHyperGraph } from "tiny-hypergraph/lib/compat/loadSerializedHyperGraph"

test("greedy routing avoids severe crowding without penalizing small groups or same-net reuse", () => {
  for (const occupiedCount of [0, 1, 3, 4]) {
    for (const withAlternative of [true, false]) {
      const boundary = {
        x: 0,
        y: 0,
        z: 0,
        crampedBoundaryKey: "busy",
        crampedBoundaryCapacity: 1,
        crampedBoundaryPitch: 3,
      }
      const ports: SerializedHyperGraph["ports"] = [
        {
          portId: "start",
          region1Id: "start",
          region2Id: "left",
          d: { x: -3, y: 0, z: 0 },
        },
        {
          portId: "crowded",
          region1Id: "left",
          region2Id: "right",
          d: boundary,
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
        ...Array.from({ length: 4 }, (_, index) => ({
          portId: `occupied-${index}`,
          region1Id: "left",
          region2Id: "right",
          d: boundary,
        })),
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
      const solver = new CrampedPortAwareGreedyFinalRouteSolver(
        topology,
        problem,
      )
      const siblings = topology.portMetadata!.flatMap((port, index) =>
        String(port.serializedPortId).startsWith("occupied-") ? [index] : [],
      )
      for (const [index, portId] of siblings.entries()) {
        if (index < occupiedCount) {
          solver.state.portAssignment[portId] = 42 + index
        }
      }
      solver.solve()
      expect(solver.solved).toBe(true)
      expect(solver.failed).toBe(false)
      const freeIndex = topology.portMetadata!.findIndex(
        (port) => port.serializedPortId === "free",
      )
      if (withAlternative) {
        expect(solver.state.portAssignment[freeIndex] >= 0).toBe(
          occupiedCount === 4,
        )
      }
      const crowdedIndex = topology.portMetadata!.findIndex(
        (port) => port.serializedPortId === "crowded",
      )
      solver.state.currentRouteId = 0
      solver.state.currentRouteNetId = 0
      solver.state.portAssignment.fill(-1)
      solver.state.ripCount++
      const unusedCost = solver.computeH(crowdedIndex)
      // Four copies owned by one foreign net consume one slot, not four.
      for (const id of siblings) solver.state.portAssignment[id] = 42
      solver.state.ripCount++
      expect(solver.computeH(crowdedIndex)).toBe(unusedCost)
      // Same-net branches do not compete for capacity at all.
      solver.state.currentRouteNetId = 42
      solver.state.ripCount++
      expect(solver.computeH(crowdedIndex)).toBe(unusedCost)
    }
  }
})
