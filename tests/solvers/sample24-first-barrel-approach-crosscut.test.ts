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

test("sample24 node61154 preserves a first-barrel crosscut for the exact movable face order", (): void => {
  const fixture = JSON.parse(
    readFileSync(
      new URL(
        "../fixtures/sample24/first-barrel-approach-crosscut.json",
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
    portById.get("ce239184_pp1_z0::0")!,
    portById.get("ce239339_pp1_z0::0")!,
  ] as [number, number]
  const approach = [
    portById.get("ce239184_pp0_z0::0")!,
    portById.get("ce239340_pp1_z1::1")!,
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
    routeMetadata: [142, 112].map((net) => ({
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
    regionId: regionById.get("topology_merge_61154__sub_0_0")!,
    fromPortId: approach[0],
    toPortId: approach[1],
    routeId: 1,
    netId: 1,
    regionSegments: [[0, ...wire]] as [number, number, number][],
  }
  expect(evaluate(query)).toEqual({
    feasible: false,
    alternativeBlockerRouteIdSets: [[0]],
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
    alternativeBlockerRouteIdSets: [[1]],
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
  ).toEqual({ feasible: false, alternativeBlockerRouteIdSets: [[0, 2]] })
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
  ).toEqual({ feasible: false, alternativeBlockerRouteIdSets: [[2]] })
  const sameOwner = {
    ...problem,
    routeMetadata: [problem.routeMetadata![0], problem.routeMetadata![0]],
  }
  expect(evaluate({ ...query, problem: sameOwner })).toEqual({ feasible: true })
  const escape = structuredClone(fixture.physicalSrj)
  escape.obstacles[0]!.connectedTo = [
    "pcb_smtpad_owned",
    "source_net_altium_pcb_142",
  ]
  expect(
    createPhysicalViaCapacityEvaluator({ ...context, physicalSrj: escape })!(
      query,
    ),
  ).toEqual({ feasible: true })
  expect(
    createPhysicalViaCapacityEvaluator({
      ...context,
      throughViaCrosscutEnabled: false,
    })!(query),
  ).toEqual({ feasible: true })
  expect(createPhysicalViaCapacityEvaluator({ ...context, movableSharedEdgeRegionIds: [] })!(query)).toEqual({ feasible: true })
  const reversed = { ...topology, portY: topology.portY.slice() }
  reversed.portY[approach[0]] = 122.5
  expect(evaluate({ ...query, topology: reversed })).toEqual({ feasible: true })
  const plated = structuredClone(fixture.physicalSrj)
  plated.obstacles.push({ type: "rect", center: { ...nodes[query.regionId]!.center }, width: .01, height: .01,
    layers: ["top", "inner1", "inner2", "inner3", "inner4", "inner5", "inner6", "bottom"],
    connectedTo: ["pcb_plated_hole_existing", "source_net_altium_pcb_112"] })
  expect(createPhysicalViaCapacityEvaluator({ ...context, physicalSrj: plated })!(query)).toEqual({ feasible: true })
  expect(fixture).toEqual(snapshot)
})
