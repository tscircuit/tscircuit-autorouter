import { expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import type {
  TinyHyperGraphProblem,
  TinyHyperGraphTopology,
} from "tiny-hypergraph/lib/core"
import type { CapacityMeshNode, SimpleRouteJson } from "lib/types"
import { createPhysicalViaCapacityEvaluator } from "lib/solvers/PortPointPathingSolver/tinyhypergraph/createPhysicalViaCapacityEvaluator"

type Fixture = {
  nodes: CapacityMeshNode[]
  freeRegionIds: string[]
  physicalSrj: SimpleRouteJson
}

function createTopology(nodes: CapacityMeshNode[]): TinyHyperGraphTopology {
  const x = nodes[0]!.center.x + nodes[0]!.width / 2
  const low = Math.max(...nodes.map((node) => node.center.y - node.height / 2))
  const high = Math.min(...nodes.map((node) => node.center.y + node.height / 2))
  return {
    portCount: 6,
    regionCount: 2,
    regionIncidentPorts: [
      [0, 1, 2, 3, 4, 5],
      [0, 1, 2, 3, 4, 5],
    ],
    incidentPortRegion: Array.from({ length: 6 }, () => [0, 1]),
    regionWidth: new Float64Array(nodes.map((node) => node.width)),
    regionHeight: new Float64Array(nodes.map((node) => node.height)),
    regionCenterX: new Float64Array(nodes.map((node) => node.center.x)),
    regionCenterY: new Float64Array(nodes.map((node) => node.center.y)),
    regionAvailableZMask: new Int32Array([255, 255]),
    regionMetadata: nodes,
    portAngleForRegion1: new Int32Array(6),
    portAngleForRegion2: new Int32Array(6),
    portX: new Float64Array(6).fill(x),
    portY: new Float64Array(6).fill((low + high) / 2),
    portZ: new Int32Array(6),
  }
}

test("actual wide faces cannot carry two foreign owners confined to the same narrow physical domain", (): void => {
  const fixture = JSON.parse(
    readFileSync(
      new URL(
        "../fixtures/sample24/shared-edge-pair-domain.json",
        import.meta.url,
      ),
      "utf8",
    ),
  ) as Fixture
  const snapshot = structuredClone(fixture)
  const connection = fixture.physicalSrj.connections.find(
    (entry) => entry.name === "source_net_altium_pcb_48",
  )!
  const problem: TinyHyperGraphProblem = {
    routeCount: 3,
    portSectionMask: new Int8Array(6).fill(1),
    routeStartPort: new Int32Array([0, 2, 4]),
    routeEndPort: new Int32Array([1, 3, 5]),
    routeNet: new Int32Array([0, 1, 0]),
    regionNetId: new Int32Array([-1, -1]),
    routeMetadata: [
      "source_net_altium_pcb_48",
      "source_net_altium_pcb_49",
      connection.pointsToConnect[0]!.pcb_port_id!,
    ].map((name) => ({
      simpleRouteConnection: { __rootConnectionNames: [name] },
    })),
  }
  const context = {
    physicalSrj: fixture.physicalSrj,
    freeRegionIds: fixture.freeRegionIds,
    sharedEdgeRegionIds: fixture.freeRegionIds,
  }
  const evaluate = createPhysicalViaCapacityEvaluator(context)!
  for (const nodes of [fixture.nodes.slice(0, 2), fixture.nodes.slice(1)]) {
    const topology = createTopology(nodes)
    const query = {
      topology,
      problem,
      regionId: 0,
      fromPortId: 2,
      toPortId: 3,
      routeId: 1,
      netId: 1,
      regionSegments: [
        [0, 0, 1],
        [2, 4, 5],
      ] as [number, number, number][],
    }
    expect(nodes[0]!.height).toBeGreaterThan(0.24)
    expect(evaluate({ ...query, regionSegments: [] })).toEqual({
      feasible: true,
    })
    expect(evaluate(query)).toEqual({
      feasible: false,
      blockerRouteIds: [0, 2],
    })
    expect(evaluate({ ...query, ignoredRouteIds: new Set([0]) })).toEqual({
      feasible: false,
      blockerRouteIds: [2],
    })
    expect(evaluate({ ...query, ignoredRouteIds: new Set([0, 2]) })).toEqual({
      feasible: true,
    })
    expect(evaluate({ ...query, routeId: 2 })).toEqual({ feasible: true })
    const otherLayer = { ...topology, portZ: topology.portZ.slice() }
    otherLayer.portZ[2] = otherLayer.portZ[3] = 1
    expect(evaluate({ ...query, topology: otherLayer })).toEqual({
      feasible: true,
    })
    const remapped = {
      ...problem,
      routeMetadata: [
        problem.routeMetadata![1],
        problem.routeMetadata![2],
        problem.routeMetadata![0],
      ],
    }
    expect(
      evaluate({
        ...query,
        problem: remapped,
        routeId: 0,
        regionSegments: [
          [1, 4, 5],
          [2, 0, 1],
        ],
      }),
    ).toEqual({ feasible: false, blockerRouteIds: [1, 2] })
    // Component/target roles do not authorize foreign copper to overlap.
    // Their explicit producer identity is separate from the via-free scope.
    const marked = {
      ...topology,
      regionMetadata: nodes.map((node) => ({ ...node, _containsTarget: true })),
    }
    const sharedOnly = createPhysicalViaCapacityEvaluator({
      ...context,
      freeRegionIds: [],
    })!
    expect(sharedOnly({ ...query, topology: marked })).toEqual({
      feasible: false,
      blockerRouteIds: [0, 2],
    })
    const anchored = {
      ...marked,
      portX: marked.portX.slice(),
      portY: new Float64Array(6).fill(121.786),
    }
    anchored.portX.fill(topology.portX[0]! + 0.01)
    expect(sharedOnly({ ...query, topology: anchored })).toEqual({
      feasible: true,
    })
  }
  const preloaded = structuredClone(fixture.physicalSrj)
  preloaded.traces = [
    {
      type: "pcb_trace",
      pcb_trace_id: "fixed-thin",
      connection_name: "source_net_altium_pcb_48",
      route: [
        { route_type: "wire", x: 160, y: 120, width: 0.001, layer: "top" },
      ],
    },
  ]
  preloaded.minTraceToPadEdgeClearance = 0
  const topology = createTopology(fixture.nodes.slice(0, 2))
  expect(
    createPhysicalViaCapacityEvaluator({ ...context, physicalSrj: preloaded })!(
      {
        topology,
        problem,
        regionId: 0,
        fromPortId: 2,
        toPortId: 3,
        routeId: 1,
        netId: 1,
        regionSegments: [[0, 0, 1]],
      },
    ),
  ).toEqual({ feasible: true })
  expect(fixture).toEqual(snapshot)
})
