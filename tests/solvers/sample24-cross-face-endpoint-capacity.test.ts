import { expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import type {
  TinyHyperGraphProblem,
  TinyHyperGraphTopology,
} from "tiny-hypergraph/lib/core"
import { createPhysicalViaCapacityEvaluator } from "lib/solvers/PortPointPathingSolver/tinyhypergraph/createPhysicalViaCapacityEvaluator"
import { createPipeline9PhysicalRouteValidator } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/createPipeline9PhysicalRouteValidator"
import { getPipeline9PhysicalGeometryContext } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/getPipeline9PhysicalGeometryContext"
import type { CapacityMeshNode, SimpleRouteJson } from "lib/types"

test("sample24 full shared faces cannot separate corner endpoints", (): void => {
  const fixture = JSON.parse(
    readFileSync(
      new URL(
        "../fixtures/sample24/cross-face-endpoint-capacity.json",
        import.meta.url,
      ),
      "utf8",
    ),
  ) as {
    nodeId: string
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
  const snapshot = structuredClone(fixture)
  const { nodes, ports } = fixture
  const regionById = new Map(
    nodes.map((node, index) => [node.capacityMeshNodeId, index]),
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
    routeNet: new Int32Array([0, 1, 0]),
    routeStartPort: new Int32Array([0, 2, 0]),
    routeEndPort: new Int32Array([1, 3, 1]),
    portSectionMask: new Int8Array(ports.length).fill(1),
    regionNetId: new Int32Array(nodes.length).fill(-1),
    routeMetadata: [136, 106, 136].map((net) => ({
      simpleRouteConnection: {
        __rootConnectionNames: [`source_net_altium_pcb_${net}`],
      },
    })),
  }
  const context = {
    ...fixture,
    planningObstacles: [],
    preserveSolitarySharedEdgePorts: false,
  }
  const evaluate = createPhysicalViaCapacityEvaluator(context)!
  const query = {
    topology,
    problem,
    regionId: regionById.get(fixture.nodeId)!,
    fromPortId: 2,
    toPortId: 3,
    routeId: 1,
    netId: 1,
    regionSegments: [[0, 0, 1]] as [number, number, number][],
  }
  expect(evaluate(query)).toEqual({ feasible: false, blockerRouteIds: [0] })
  expect(evaluate({ ...query, ignoredRouteIds: new Set([0]) })).toEqual({
    feasible: true,
  })
  expect(
    evaluate({
      ...query,
      regionSegments: [
        [0, 0, 1],
        [2, 0, 1],
      ],
    }),
  ).toEqual({ feasible: false, blockerRouteIds: [0, 2] })
  expect(
    evaluate({
      ...query,
      regionSegments: [
        [0, 0, 1],
        [2, 0, 1],
      ],
      ignoredRouteIds: new Set([0]),
    }),
  ).toEqual({ feasible: false, blockerRouteIds: [2] })
  expect(
    evaluate({
      ...query,
      fromPortId: 0,
      toPortId: 1,
      routeId: 0,
      netId: 0,
      regionSegments: [[1, 2, 3]],
    }),
  ).toEqual({ feasible: false, blockerRouteIds: [1] })
  const offFace = { ...topology, portY: topology.portY.slice() }
  offFace.portY[3] -= 0.01
  expect(evaluate({ ...query, topology: offFace })).toEqual({ feasible: true })
  const otherLayer = { ...topology, portZ: topology.portZ.slice() }
  otherLayer.portZ[2] = otherLayer.portZ[3] = 2
  expect(evaluate({ ...query, topology: otherLayer })).toEqual({
    feasible: true,
  })
  const sameOwner = {
    ...problem,
    routeMetadata: [
      problem.routeMetadata![0],
      problem.routeMetadata![0],
      problem.routeMetadata![0],
    ],
  }
  expect(evaluate({ ...query, problem: sameOwner })).toEqual({ feasible: true })
  const unknown = {
    ...problem,
    routeMetadata: [problem.routeMetadata![0], problem.routeMetadata![1], {}],
  }
  expect(
    evaluate({
      ...query,
      problem: unknown,
      regionSegments: [
        [0, 0, 1],
        [2, 0, 1],
      ],
    }),
  ).toEqual({ feasible: true })
  const widened = {
    ...topology,
    regionMetadata: nodes.map((node) =>
      node.capacityMeshNodeId === "topology_merge_61453"
        ? {
            ...node,
            center: { x: node.center.x, y: (68.8134006 + 69.5) / 2 },
            height: 69.5 - 68.8134006,
          }
        : node,
    ),
  }
  expect(evaluate({ ...query, topology: widened })).toEqual({ feasible: true })
  const preserved = createPhysicalViaCapacityEvaluator({
    ...context,
    preserveSolitarySharedEdgePorts: true,
    planningObstacles: [
      {
        type: "rect",
        center: nodes[regionById.get(fixture.nodeId)!]!.center,
        width: 1,
        height: 2,
        layers: ["top"],
        connectedTo: [],
      },
    ],
  })!
  expect(preserved(query)).toEqual({ feasible: false, blockerRouteIds: [0] })
  expect(preserved({ ...query, ignoredRouteIds: new Set([0]) })).toEqual({
    feasible: true,
  })
  const validate = createPipeline9PhysicalRouteValidator({
    physicalSrj: fixture.physicalSrj,
    connMap: getPipeline9PhysicalGeometryContext(fixture.physicalSrj).connMap,
    obstacleMargin: 0.15,
  })
  const stubs = [1, 3].map((index) => ({
    connectionName: `source_net_altium_pcb_${index === 1 ? 136 : 106}`,
    traceThickness: 0.1,
    viaDiameter: 0.3,
    vias: [],
    route: [
      { ...ports[index]!.d },
      {
        ...ports[index]!.d,
        x: ports[index]!.d.x - (index === 1 ? 1e-4 : 0),
        y: ports[index]!.d.y + (index === 3 ? 1e-4 : 0),
      },
    ],
  }))
  expect(validate([stubs[0]!])).toBe(true)
  expect(validate([stubs[1]!])).toBe(true)
  expect(validate(stubs)).toBe(false)
  expect(fixture).toEqual(snapshot)
})
