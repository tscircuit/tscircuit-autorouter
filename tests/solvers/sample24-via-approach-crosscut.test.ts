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

test("sample24 node61487 cannot put its required via approach across a trapped same-layer wire", (): void => {
  const fixture = JSON.parse(
    readFileSync(
      new URL(
        "../fixtures/sample24/via-approach-crosscut.json",
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
    portById.get("ce241991_pp0_z1::1")!,
    portById.get("ce242230_pp0_z1_cramped::1")!,
  ] as [number, number]
  const approach = [
    portById.get("ce242003_pp0_z1::1")!,
    portById.get("ce242231_pp0_z2_cramped::2")!,
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
    routeMetadata: [136, 106].map((net) => ({
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
    regionId: regionById.get("topology_merge_61487")!,
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
  expect(evaluate({ ...candidateWire, ignoredRouteIds: new Set([1]) })).toEqual(
    { feasible: true },
  )
  const aliased = {
    ...problem,
    routeCount: 3,
    routeMetadata: [...problem.routeMetadata!, problem.routeMetadata![1]],
  }
  expect(
    evaluate({
      ...candidateWire,
      problem: aliased,
      regionSegments: [
        [1, ...approach],
        [2, ...approach],
      ],
    }),
  ).toEqual({ feasible: false, alternativeBlockerRouteIdSets: [[1, 2]] })
  expect(
    evaluate({
      ...candidateWire,
      problem: aliased,
      regionSegments: [
        [1, ...approach],
        [2, ...approach],
      ],
      ignoredRouteIds: new Set([1]),
    }),
  ).toEqual({ feasible: false, alternativeBlockerRouteIdSets: [[2]] })
  const lowerTopology = {
    ...topology,
    portCount: ports.length + 1,
    incidentPortRegion: [
      ...topology.incidentPortRegion,
      topology.incidentPortRegion[wire[0]]!,
    ],
    portMetadata: [
      ...topology.portMetadata!,
      { serializedPortId: "other-lower-entry" },
    ],
    portX: new Float64Array([...topology.portX, topology.portX[wire[0]]!]),
    portY: new Float64Array([...topology.portY, 68.95]),
    portZ: new Int32Array([...topology.portZ, 1]),
  }
  const extraEntry = [2, ports.length, approach[1]] as [number, number, number]
  expect(
    evaluate({
      ...candidateWire,
      topology: lowerTopology,
      problem: aliased,
      regionSegments: [[1, ...approach], extraEntry],
    }),
  ).toEqual({ feasible: false, alternativeBlockerRouteIdSets: [[1]] })
  expect(
    evaluate({
      ...candidateWire,
      topology: lowerTopology,
      problem: aliased,
      regionSegments: [[1, ...approach], extraEntry],
      ignoredRouteIds: new Set([1]),
    }),
  ).toEqual({ feasible: true })
  const outside = { ...topology, portX: topology.portX.slice() }
  outside.portX[approach[0]] -= 0.01
  expect(evaluate({ ...query, topology: outside })).toEqual({
    feasible: false,
    alternativeBlockerRouteIdSets: [[0]],
  })
  expect(
    createPhysicalViaCapacityEvaluator({
      ...context,
      movableSharedEdgeRegionIds: [],
    })!({ ...query, topology: outside }),
  ).toEqual({ feasible: true })
  const plated = structuredClone(fixture.physicalSrj)
  plated.obstacles.push({ type: "rect", center: { x: 281.3, y: 68.2 }, width: 2, height: 0.01,
    layers: ["top", "inner1", "inner2", "inner3", "inner4", "inner5", "inner6", "bottom"],
    connectedTo: ["pcb_plated_hole_existing", "source_net_altium_pcb_136"] })
  expect(createPhysicalViaCapacityEvaluator({ ...context, physicalSrj: plated })!(query)).toEqual({ feasible: true })
  const remapped = { ...problem, routeMetadata: [...problem.routeMetadata!].reverse() }
  expect(evaluate({ ...query, problem: remapped, routeId: 0, regionSegments: [[1, ...wire]] })).toEqual({ feasible: false, alternativeBlockerRouteIdSets: [[1]] })
  expect(createPhysicalViaCapacityEvaluator({ ...context, throughViaCrosscutEnabled: false })!(query)).toEqual({ feasible: true })
  expect(createPhysicalViaCapacityEvaluator({ ...context, physicalSrj: { ...fixture.physicalSrj, allowBlindAndBuriedVias: true } })!(query)).toEqual({ feasible: true })
  expect(fixture).toEqual(snapshot)
})
