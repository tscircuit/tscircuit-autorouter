import { expect, test } from "bun:test"
import type { SerializedHyperGraph } from "@tscircuit/hypergraph"
import { FixedCopperClearanceIndex } from "lib/data-structures/FixedCopperClearanceIndex"
import { createTinyGraphFixedCopperClearanceContext } from "lib/solvers/PortPointPathingSolver/tinyhypergraph/createTinyGraphFixedCopperClearanceContext"
import { limitCrampedTinyGraphDuplicatePorts } from "lib/solvers/PortPointPathingSolver/tinyhypergraph/limitCrampedTinyGraphDuplicatePorts"
import { SelectiveReripTinyHyperGraphSolverWithStableInitialAssignments } from "lib/solvers/PortPointPathingSolver/tinyhypergraph/SelectiveReripTinyHyperGraphSolverWithStableInitialAssignments"
import { loadSerializedHyperGraph } from "tiny-hypergraph/lib/compat/loadSerializedHyperGraph"

type SerializedPort = SerializedHyperGraph["ports"][number]
type SerializedRegion = SerializedHyperGraph["regions"][number]

function createSharingGraph(sameNet: boolean): SerializedHyperGraph {
  const ports: SerializedPort[] = [
    {
      portId: "cramped",
      region1Id: "left",
      region2Id: "right",
      d: { x: 0, y: 0, z: 0, cramped: true },
    },
    {
      portId: "alternative",
      region1Id: "left",
      region2Id: "right",
      d: { x: 0, y: 1, z: 0, cramped: false },
    },
  ]
  const regions: SerializedRegion[] = [
    {
      regionId: "left",
      pointIds: ["start-a", "start-b", "cramped", "alternative"],
      d: { center: { x: -1, y: 0 }, width: 2, height: 4, availableZ: [0] },
    },
    {
      regionId: "right",
      pointIds: ["end-a", "end-b", "cramped", "alternative"],
      d: { center: { x: 1, y: 0 }, width: 2, height: 4, availableZ: [0] },
    },
  ]
  for (const [suffix, y] of [
    ["a", -0.25],
    ["b", 0.25],
  ] as const) {
    for (const [endpoint, routingRegion, x] of [
      ["start", "left", -2],
      ["end", "right", 2],
    ] as const) {
      const portId = `${endpoint}-${suffix}`
      const regionId = `${portId}-terminal`
      ports.push({
        portId,
        region1Id: regionId,
        region2Id: routingRegion,
        d: { x, y, z: 0, cramped: false },
      })
      regions.push({
        regionId,
        pointIds: [portId],
        d: {
          center: { x: x < 0 ? -2.5 : 2.5, y },
          width: 1,
          height: 0.5,
          availableZ: [0],
        },
      })
    }
  }
  return {
    regions,
    ports,
    connections: [
      {
        connectionId: "route-a",
        startRegionId: "start-a-terminal",
        endRegionId: "end-a-terminal",
        mutuallyConnectedNetworkId: "net-a",
      },
      {
        connectionId: "route-b",
        startRegionId: "start-b-terminal",
        endRegionId: "end-b-terminal",
        mutuallyConnectedNetworkId: sameNet ? "net-a" : "net-b",
      },
    ],
    solvedRoutes: [],
  }
}

test("limiting cramped duplicates preserves native same-net sharing and routes foreign nets through an original alternative", (): void => {
  for (const sameNet of [true, false]) {
    const originalGraph = createSharingGraph(sameNet)
    const proposedGraph = structuredClone(originalGraph)
    proposedGraph.ports.push({
      portId: "cramped::dup1",
      region1Id: "left",
      region2Id: "right",
      d: {
        x: 0,
        y: 0.025,
        z: 0,
        cramped: true,
        duplicatedFromPortId: "cramped",
      },
    })
    for (const region of proposedGraph.regions) {
      if (region.regionId === "left" || region.regionId === "right") {
        region.pointIds.push("cramped::dup1")
      }
    }
    const originalSnapshot = structuredClone(originalGraph)
    const proposedSnapshot = structuredClone(proposedGraph)
    const { graph, removedPortIds } = limitCrampedTinyGraphDuplicatePorts({
      originalGraph,
      proposedGraph,
    })
    expect(removedPortIds).toEqual(["cramped::dup1"])
    expect(graph).toEqual(originalGraph)
    expect(originalGraph).toEqual(originalSnapshot)
    expect(proposedGraph).toEqual(proposedSnapshot)

    const { topology, problem, solution } = loadSerializedHyperGraph(graph)
    expect(problem.routeCount).toBe(2)
    expect(problem.initialAssignments).toBeUndefined()
    expect(solution.solvedRoutePathSegments).toEqual([[], []])
    expect(problem.routeNet[0] === problem.routeNet[1]).toBe(sameNet)
    const context = createTinyGraphFixedCopperClearanceContext({
      problem,
      clearanceIndex: new FixedCopperClearanceIndex({
        rectangles: [],
        layerCount: 1,
        minClearance: 0.1,
      }),
      traceWidth: 0.15,
    })
    const solver =
      new SelectiveReripTinyHyperGraphSolverWithStableInitialAssignments(
        topology,
        problem,
        undefined,
        context,
      )
    solver.solve()
    expect(solver.failed).toBeFalse()
    expect(solver.solved).toBeTrue()
    expect(solver.state.unroutedRoutes).toEqual([])

    const routePortIds = [new Set<string>(), new Set<string>()]
    for (const segments of solver.state.regionSegments) {
      for (const [routeId, fromPortId, toPortId] of segments) {
        for (const portId of [fromPortId, toPortId]) {
          const serializedPortId: unknown =
            topology.portMetadata?.[portId]?.serializedPortId
          if (typeof serializedPortId !== "string") {
            throw new Error(`Loaded port ${portId} has no serialized identity`)
          }
          routePortIds[routeId]!.add(serializedPortId)
        }
      }
    }
    for (const [routeId, suffix] of [
      [0, "a"],
      [1, "b"],
    ] as const) {
      expect(routePortIds[routeId]!.has(`start-${suffix}`)).toBeTrue()
      expect(routePortIds[routeId]!.has(`end-${suffix}`)).toBeTrue()
      expect(routePortIds[routeId]!.has("cramped::dup1")).toBeFalse()
    }
    if (sameNet) {
      expect(routePortIds[0]!.has("cramped")).toBeTrue()
      expect(routePortIds[1]!.has("cramped")).toBeTrue()
      expect(routePortIds[0]!.has("alternative")).toBeFalse()
      expect(routePortIds[1]!.has("alternative")).toBeFalse()
    } else {
      const usedPortals = routePortIds.map((portIds): string[] =>
        ["cramped", "alternative"].filter((portId): boolean =>
          portIds.has(portId),
        ),
      )
      expect(usedPortals[0]).toHaveLength(1)
      expect(usedPortals[1]).toHaveLength(1)
      expect(new Set(usedPortals.flat())).toEqual(
        new Set(["cramped", "alternative"]),
      )
    }
    expect(originalGraph).toEqual(originalSnapshot)
    expect(proposedGraph).toEqual(proposedSnapshot)
  }
})
