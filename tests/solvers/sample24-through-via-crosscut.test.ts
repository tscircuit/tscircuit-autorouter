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
  ports: {
    portId: string
    region1Id: string
    region2Id: string
    d: { x: number; y: number; z: number }
  }[]
  physicalSrj: SimpleRouteJson
  freeRegionIds: string[]
  sharedEdgeRegionIds: string[]
  movableSharedEdgeRegionIds: string[]
}

test("sample24 node61252 attributes an impossible full-stack via barrier to removable demands", (): void => {
  const fixture = JSON.parse(
    readFileSync(
      new URL(
        "../fixtures/sample24/through-via-crosscut.json",
        import.meta.url,
      ),
      "utf8",
    ),
  ) as Fixture
  const snapshot = structuredClone(fixture)
  const { nodes, ports } = fixture
  const regionById = new Map(
    nodes.map((node, index) => [node.capacityMeshNodeId, index]),
  )
  const portById = new Map(ports.map((port, index) => [port.portId, index]))
  const pairs = [
    ["ce240167_pp0_z0::0", "ce240272_pp0_z0::0"],
    ["ce240264_pp0_z0::0", "ce240281_pp0_z1_cramped::1"],
    ["ce240264_pp0_z0::0::dup1", "ce240282_pp0_z2_cramped::2"],
  ].map(
    ([from, to]) =>
      [portById.get(from!)!, portById.get(to!)!] as [number, number],
  )
  const topology: TinyHyperGraphTopology = {
    regionCount: nodes.length,
    portCount: ports.length,
    regionIncidentPorts: nodes.map((node) =>
      ports.flatMap((port, index) =>
        port.region1Id === node.capacityMeshNodeId ||
        port.region2Id === node.capacityMeshNodeId
          ? [index]
          : [],
      ),
    ),
    incidentPortRegion: ports.map((port) => [
      regionById.get(port.region1Id)!,
      regionById.get(port.region2Id)!,
    ]),
    regionWidth: new Float64Array(nodes.map((node) => node.width)),
    regionHeight: new Float64Array(nodes.map((node) => node.height)),
    regionCenterX: new Float64Array(nodes.map((node) => node.center.x)),
    regionCenterY: new Float64Array(nodes.map((node) => node.center.y)),
    regionAvailableZMask: new Int32Array(
      nodes.map((node) =>
        node.availableZ.reduce((mask, z) => mask | (1 << z), 0),
      ),
    ),
    regionMetadata: nodes,
    portMetadata: ports.map((port) => ({ serializedPortId: port.portId })),
    portAngleForRegion1: new Int32Array(ports.length),
    portAngleForRegion2: new Int32Array(ports.length),
    portX: new Float64Array(ports.map((port) => port.d.x)),
    portY: new Float64Array(ports.map((port) => port.d.y)),
    portZ: new Int32Array(ports.map((port) => port.d.z)),
  }
  const problem: TinyHyperGraphProblem = {
    routeCount: 3,
    routeNet: new Int32Array([0, 1, 2]),
    routeStartPort: new Int32Array(pairs.map(([from]) => from)),
    routeEndPort: new Int32Array(pairs.map(([, to]) => to)),
    portSectionMask: new Int8Array(ports.length).fill(1),
    regionNetId: new Int32Array(nodes.length).fill(-1),
    routeMetadata: [378, 136, 106].map((net) => ({
      simpleRouteConnection: {
        __rootConnectionNames: [`source_net_altium_pcb_${net}`],
      },
    })),
  }
  const context = {
    physicalSrj: fixture.physicalSrj,
    freeRegionIds: fixture.freeRegionIds,
    sharedEdgeRegionIds: fixture.sharedEdgeRegionIds,
    movableSharedEdgeRegionIds: fixture.movableSharedEdgeRegionIds,
    planningObstacles: [],
    preserveSolitarySharedEdgePorts: false,
    throughViaCrosscutEnabled: true,
  }
  const evaluate = createPhysicalViaCapacityEvaluator(context)!
  const query = {
    topology,
    problem,
    regionId: regionById.get("topology_merge_61252")!,
    fromPortId: pairs[2]![0],
    toPortId: pairs[2]![1],
    routeId: 2,
    netId: 2,
    regionSegments: [
      [0, ...pairs[0]!],
      [1, ...pairs[1]!],
    ] as [number, number, number][],
  }
  expect(evaluate(query)).toEqual({
    feasible: false,
    alternativeBlockerRouteIdSets: [[1], [0]],
  })
  expect(evaluate({ ...query, ignoredRouteIds: new Set([1]) })).toEqual({
    feasible: true,
  })
  expect(evaluate({ ...query, ignoredRouteIds: new Set([0]) })).toEqual({
    feasible: true,
  })
  expect(evaluate({ ...query, regionSegments: [] })).toEqual({ feasible: true })
  const ground = {
    ...query,
    routeId: 0,
    fromPortId: pairs[0]![0],
    toPortId: pairs[0]![1],
    regionSegments: [
      [1, ...pairs[1]!],
      [2, ...pairs[2]!],
    ] as [number, number, number][],
  }
  expect(evaluate(ground)).toEqual({
    feasible: false,
    alternativeBlockerRouteIdSets: [[1], [2]],
  })
  const changingGround = { ...topology, portZ: topology.portZ.slice() }
  changingGround.portZ[pairs[0]![1]] = 7
  expect(evaluate({ ...ground, topology: changingGround })).toEqual({
    feasible: false,
    alternativeBlockerRouteIdSets: [[1], [2]],
  })
  const aliasedProblem = {
    ...problem,
    routeCount: 4,
    routeMetadata: [...problem.routeMetadata!, problem.routeMetadata![1]],
  }
  const aliased = {
    ...query,
    problem: aliasedProblem,
    regionSegments: [...query.regionSegments, [3, ...pairs[1]!]] as [
      number,
      number,
      number,
    ][],
  }
  expect(evaluate(aliased)).toEqual({
    feasible: false,
    alternativeBlockerRouteIdSets: [[1, 3], [0]],
  })
  expect(evaluate({ ...aliased, ignoredRouteIds: new Set([1]) })).toEqual({
    feasible: false,
    alternativeBlockerRouteIdSets: [[3], [0]],
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
      routeId: 1,
      regionSegments: [
        [2, ...pairs[0]!],
        [0, ...pairs[1]!],
      ],
    }),
  ).toEqual({
    feasible: false,
    alternativeBlockerRouteIdSets: [[0], [2]],
  })
  expect(
    createPhysicalViaCapacityEvaluator({
      ...context,
      throughViaCrosscutEnabled: false,
    })!(query),
  ).toEqual({ feasible: true })
  expect(
    createPhysicalViaCapacityEvaluator({
      ...context,
      throughViaCrosscutEnabled: undefined,
    })!(query),
  ).toEqual({ feasible: true })
  const outside = { ...topology, portX: topology.portX.slice() }
  const currentNode = nodes[query.regionId]!
  outside.portX[pairs[0]![0]] =
    currentNode.center.x - currentNode.width / 2 - 1e-6
  expect(evaluate({ ...query, topology: outside })).toEqual({
    feasible: false,
    alternativeBlockerRouteIdSets: [[1], [0]],
  })
  expect(
    createPhysicalViaCapacityEvaluator({
      ...context,
      movableSharedEdgeRegionIds: [],
    })!({
      ...query,
      topology: outside,
    }),
  ).toEqual({ feasible: true })
  expect(
    createPhysicalViaCapacityEvaluator({
      ...context,
      physicalSrj: { ...fixture.physicalSrj, allowJumpers: true },
    })!(query),
  ).toEqual({ feasible: true })
  const plated = structuredClone(fixture.physicalSrj)
  plated.obstacles.push({
    type: "rect",
    center: { x: 279, y: 68.2 },
    width: 2,
    height: 0.01,
    layers: [
      "top",
      "inner1",
      "inner2",
      "inner3",
      "inner4",
      "inner5",
      "inner6",
      "bottom",
    ],
    connectedTo: ["pcb_plated_hole_existing", "source_net_altium_pcb_136"],
  })
  // Existing owned multilayer copper makes the manufactured-via demand
  // uncertain, so this conservative proof leaves it to detailed routing.
  expect(
    createPhysicalViaCapacityEvaluator({ ...context, physicalSrj: plated })!(
      query,
    ),
  ).toEqual({ feasible: true })
  expect(
    createPhysicalViaCapacityEvaluator({
      ...context,
      physicalSrj: { ...fixture.physicalSrj, allowBlindAndBuriedVias: true },
    })!(query),
  ).toEqual({ feasible: true })
  const preloaded = structuredClone(fixture.physicalSrj)
  preloaded.traces = [
    {
      type: "pcb_trace",
      pcb_trace_id: "fixed",
      connection_name: "source_net_altium_pcb_136",
      route: [{ route_type: "wire", x: 140, y: 50, layer: "top", width: 0.1 }],
    },
  ]
  expect(
    createPhysicalViaCapacityEvaluator({ ...context, physicalSrj: preloaded })!(
      query,
    ),
  ).toEqual({ feasible: true })
  expect(fixture).toEqual(snapshot)
})
