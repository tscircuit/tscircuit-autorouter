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

test("sample24 displaced movable endpoints retain their complete physical face domains", (): void => {
  const fixture = JSON.parse(
    readFileSync(
      new URL(
        "../fixtures/sample24/movable-off-face-endpoints.json",
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
  const wire = [
    portById.get("ce137154_pp0_z0_cramped::0")!,
    portById.get("ce137157_pp0_z0_cramped::0")!,
  ] as [number, number]
  const approach = [
    portById.get("ce137156_pp0_z0_cramped::0")!,
    portById.get("ce137155_pp0_z0_cramped::0::dup1")!,
  ] as [number, number]
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
    routeCount: 2,
    routeNet: new Int32Array([0, 1]),
    routeStartPort: new Int32Array([wire[0], approach[0]]),
    routeEndPort: new Int32Array([wire[1], approach[1]]),
    portSectionMask: new Int8Array(ports.length).fill(1),
    regionNetId: new Int32Array(nodes.length).fill(-1),
    routeMetadata: [98, 93].map((net) => ({
      simpleRouteConnection: {
        __rootConnectionNames: [`source_net_altium_pcb_${net}`],
      },
    })),
  }
  const context = {
    ...fixture,
    planningObstacles: [],
    preserveSolitarySharedEdgePorts: false,
    throughViaCrosscutEnabled: true,
  }
  const evaluate = createPhysicalViaCapacityEvaluator(context)!
  const query = {
    topology,
    problem,
    regionId: regionById.get("topology_merge_43619__sub_2_0")!,
    fromPortId: approach[0],
    toPortId: approach[1],
    routeId: 1,
    netId: 1,
    regionSegments: [[0, ...wire]] as [number, number, number][],
  }
  expect(evaluate(query)).toEqual({
    feasible: false,
    blockerRouteIds: [0],
  })
  expect(evaluate({ ...query, ignoredRouteIds: new Set([0]) })).toEqual({
    feasible: true,
  })
  const candidateWire = {
    ...query,
    routeId: 0,
    fromPortId: wire[0],
    toPortId: wire[1],
    regionSegments: [[1, ...approach]] as [number, number, number][],
  }
  expect(evaluate(candidateWire)).toEqual({
    feasible: false,
    blockerRouteIds: [1],
  })
  const aliased = {
    ...problem,
    routeCount: 3,
    routeMetadata: [...problem.routeMetadata!, problem.routeMetadata![0]],
  }
  expect(
    evaluate({
      ...query,
      problem: aliased,
      regionSegments: [
        [0, ...wire],
        [2, ...wire],
      ],
    }),
  ).toEqual({ feasible: false, blockerRouteIds: [0, 2] })
  expect(
    evaluate({
      ...query,
      problem: aliased,
      regionSegments: [
        [0, ...wire],
        [2, ...wire],
      ],
      ignoredRouteIds: new Set([0]),
    }),
  ).toEqual({ feasible: false, blockerRouteIds: [2] })
  const sameOwner = {
    ...problem,
    routeMetadata: [problem.routeMetadata![0], problem.routeMetadata![0]],
  }
  expect(evaluate({ ...query, problem: sameOwner })).toEqual({ feasible: true })
  // Exclude the separate three-endpoint corridor conflict so these controls
  // isolate abstention for the unknown/anchored displaced endpoint itself.
  expect(createPhysicalViaCapacityEvaluator({ ...context, movableSharedEdgeRegionIds: [] })!(query)).toEqual({ feasible: false, alternativeBlockerRouteIdSets: [[0]] })
  const abstention = { ...query, regionSegments: [[0, wire[0], wire[0]]] as [number, number, number][] }
  expect(createPhysicalViaCapacityEvaluator({ ...context, movableSharedEdgeRegionIds: [] })!(abstention)).toEqual({ feasible: true })
  expect(createPhysicalViaCapacityEvaluator({ ...context, planningObstacles: undefined })!(abstention)).toEqual({ feasible: true })
  expect(createPhysicalViaCapacityEvaluator({ ...context, preserveSolitarySharedEdgePorts: true })!(query)).toEqual({ feasible: false, blockerRouteIds: [0] })
  const aliasFaceX = 157.86689280000002
  const preserved = createPhysicalViaCapacityEvaluator({
    ...context,
    preserveSolitarySharedEdgePorts: true,
    planningObstacles: [{ type: "rect", layers: ["bottom"], connectedTo: [],
      center: { x: aliasFaceX + .5, y: 96.58592020871794 }, width: 1, height: .019332915897436465 }],
  })!
  expect(preserved(abstention)).toEqual({ feasible: true })
  const remapped = { ...problem, routeMetadata: [problem.routeMetadata![1], problem.routeMetadata![0]] }
  expect(evaluate({ ...query, problem: remapped, routeId: 0, regionSegments: [[1, ...wire]] })).toEqual({ feasible: false, blockerRouteIds: [1] })
  expect(fixture).toEqual(snapshot)
})
