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
  ports: Array<{ id: string; d: { x: number; y: number; z: number } }>
  physicalSrj: SimpleRouteJson
}

function createTopology(
  fixture: Fixture,
  width?: number,
): TinyHyperGraphTopology {
  const nodes = fixture.nodes.map((node) => ({
    ...node,
    ...(width === undefined
      ? {}
      : {
          width,
          center: { ...node.center, x: fixture.nodes[1]!.center.x },
        }),
  }))
  const ports = Array.from({ length: 8 }, (_, index) => ({
    ...fixture.ports[Math.min(index, fixture.ports.length - 1)]!.d,
    serializedPortId: `opaque-port-${index}`,
  }))
  return {
    portCount: 8,
    regionCount: 2,
    regionIncidentPorts: [
      ports.map((_, index) => index),
      ports.map((_, index) => index),
    ],
    incidentPortRegion: ports.map(() => [0, 1]),
    regionWidth: new Float64Array(nodes.map((node) => node.width)),
    regionHeight: new Float64Array(nodes.map((node) => node.height)),
    regionCenterX: new Float64Array(nodes.map((node) => node.center.x)),
    regionCenterY: new Float64Array(nodes.map((node) => node.center.y)),
    regionAvailableZMask: new Int32Array([255, 255]),
    regionMetadata: nodes,
    portMetadata: ports,
    portAngleForRegion1: new Int32Array(8),
    portAngleForRegion2: new Int32Array(8),
    portX: new Float64Array(ports.map((port) => port.x)),
    portY: new Float64Array(ports.map((port) => port.y)),
    portZ: new Int32Array(8),
  }
}

test("real shared-face capacity groups all aliases without restricting wide redistribution or other layers", (): void => {
  const fixture = JSON.parse(
    readFileSync(
      new URL(
        "../fixtures/sample24/shared-edge-sliver-capacity.json",
        import.meta.url,
      ),
      "utf8",
    ),
  ) as Fixture
  const snapshot = structuredClone(fixture)
  const topology = createTopology(fixture)
  const alias = fixture.physicalSrj.connections.find(
    (connection) => connection.name === "source_net_altium_pcb_178",
  )!.pointsToConnect[0]!.pcb_port_id!
  const problem: TinyHyperGraphProblem = {
    routeCount: 3,
    portSectionMask: new Int8Array(8).fill(1),
    routeStartPort: new Int32Array([0, 2, 4]),
    routeEndPort: new Int32Array([1, 3, 5]),
    routeNet: new Int32Array([0, 1, 0]),
    regionNetId: new Int32Array([-1, -1]),
    routeMetadata: [178, 142, alias].map((owner) => ({
      connectionId: `logical-${owner}`,
      simpleRouteConnection: {
        __rootConnectionNames: [
          typeof owner === "number" ? `source_net_altium_pcb_${owner}` : owner,
        ],
      },
    })),
  }
  const context = {
    physicalSrj: fixture.physicalSrj,
    freeRegionIds: fixture.freeRegionIds,
  }
  const evaluate = createPhysicalViaCapacityEvaluator(context)!
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
  // The source face is 6.8 um wide. Duplicate coordinates drift diagonally
  // outside it; neither their spread nor their textual ids define capacity.
  expect(fixture.nodes[1]!.width).toBeCloseTo(0.00679997, 9)
  expect(evaluate(query)).toEqual({ feasible: false, blockerRouteIds: [0, 2] })
  expect(evaluate({ ...query, ignoredRouteIds: new Set([0]) })).toEqual({
    feasible: false,
    blockerRouteIds: [2],
  })
  expect(evaluate({ ...query, ignoredRouteIds: new Set([0, 2]) })).toEqual({
    feasible: true,
  })
  expect(evaluate({ ...query, routeId: 2 })).toEqual({ feasible: true })
  expect(evaluate({ ...query, routeId: undefined })).toEqual({ feasible: true })
  const otherLayer = { ...topology, portZ: topology.portZ.slice() }
  otherLayer.portZ[2] = otherLayer.portZ[3] = 1
  expect(evaluate({ ...query, topology: otherLayer })).toEqual({
    feasible: true,
  })

  const wide = createTopology(fixture, 1)
  wide.portX.fill(fixture.nodes[1]!.center.x)
  wide.portY.fill(fixture.ports[0]!.d.y)
  expect(evaluate({ ...query, topology: wide })).toEqual({ feasible: true })
  // The same 5 um tolerance as forward trace checks is permissive. Equality
  // remains legal, while a strictly shorter full face certifies capacity one.
  expect(
    evaluate({ ...query, topology: createTopology(fixture, 0.195) }),
  ).toEqual({ feasible: true })
  expect(
    evaluate({ ...query, topology: createTopology(fixture, 0.194999) }),
  ).toEqual({ feasible: false, blockerRouteIds: [0, 2] })
  for (const policy of [{ allowBlindAndBuriedVias: true }, { layerCount: 1 }]) {
    const singleOrBlind = createPhysicalViaCapacityEvaluator({
      ...context,
      physicalSrj: { ...fixture.physicalSrj, ...policy },
    })!
    expect(singleOrBlind(query)).toEqual({
      feasible: false,
      blockerRouteIds: [0, 2],
    })
  }
  const unconfirmed = createPhysicalViaCapacityEvaluator({
    ...context,
    freeRegionIds: [fixture.freeRegionIds[0]!],
  })!
  expect(unconfirmed(query)).toEqual({ feasible: true })
  const overlapping = createTopology(fixture)
  overlapping.regionMetadata![1] = {
    ...overlapping.regionMetadata![1],
    center: {
      ...overlapping.regionMetadata![1].center,
      y: fixture.nodes[0]!.center.y,
    },
  }
  expect(evaluate({ ...query, topology: overlapping })).toEqual({
    feasible: true,
  })
  const remappedTopology = {
    ...topology,
    regionMetadata: [...topology.regionMetadata!].reverse(),
    incidentPortRegion: topology.incidentPortRegion.map((ids) =>
      ids.map((id) => 1 - id),
    ),
  }
  const remappedProblem = {
    ...problem,
    routeMetadata: [
      problem.routeMetadata![1],
      problem.routeMetadata![2],
      problem.routeMetadata![0],
    ],
    routeNet: new Int32Array([1, 0, 0]),
  }
  expect(evaluate({
    ...query,
    topology: remappedTopology,
    problem: remappedProblem,
    regionId: 1,
    routeId: 0,
    regionSegments: [[1, 4, 5], [2, 0, 1]],
  })).toEqual({ feasible: false, blockerRouteIds: [1, 2] })
  expect(fixture).toEqual(snapshot)
})
