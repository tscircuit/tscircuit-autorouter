import { expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import {
  TinyHyperGraphSolver,
  type TinyHyperGraphTopology,
} from "tiny-hypergraph/lib/core"
import { createPhysicalViaCapacityEvaluator } from "lib/solvers/PortPointPathingSolver/tinyhypergraph/createPhysicalViaCapacityEvaluator"
import { isPlainGlobalFreeNode } from "lib/solvers/NodeDimensionSubdivisionSolver/splitThroughOnlyGlobalFreeNodes"
import type { NodeWithPortPoints } from "lib/types/high-density-types"
import type { CapacityMeshNode, SimpleRouteJson } from "lib/types"

type Fixture = {
  capacityNode: NodeWithPortPoints
  detourNode: CapacityMeshNode
  physicalSrj: SimpleRouteJson
}

function createSolver(
  fixture: Fixture,
  enabled: boolean,
): TinyHyperGraphSolver {
  const node = fixture.capacityNode
  const detour = fixture.detourNode
  const y = node.center.y + node.height / 2
  const points = [
    ...node.portPoints,
    { x: node.portPoints[2]!.x, y, z: 2 },
    { x: node.portPoints[2]!.x, y, z: 7 },
  ]
  const incidentPortRegion = [
    [0, 2],
    [0, 3],
    [0, 4],
    [0, 5],
    [0, 1],
    [1, 0],
  ]
  const terminals = points.slice(0, 4).map((point, index) => ({
    capacityMeshNodeId: `terminal-${index}`,
    center: { x: point.x, y: point.y },
    width: 1e-6,
    height: 1e-6,
    availableZ: [point.z],
    _tinyTerminal: true,
  }))
  const regions = [node, detour, ...terminals]
  const angles = points.map((point, index) =>
    incidentPortRegion[index]!.map((id) => {
      const center = regions[id]!.center
      return (
        Math.round(
          (Math.atan2(point.y - center.y, point.x - center.x) * 18000) /
            Math.PI +
            36000,
        ) % 36000
      )
    }),
  )
  const topology: TinyHyperGraphTopology = {
    portCount: points.length,
    regionCount: 6,
    regionIncidentPorts: [[0, 1, 2, 3, 4, 5], [4, 5], [0], [1], [2], [3]],
    incidentPortRegion,
    regionWidth: new Float64Array(regions.map((region) => region.width)),
    regionHeight: new Float64Array(regions.map((region) => region.height)),
    regionCenterX: new Float64Array(regions.map((region) => region.center.x)),
    regionCenterY: new Float64Array(regions.map((region) => region.center.y)),
    regionAvailableZMask: new Int32Array([
      255,
      255,
      ...terminals.map((terminal) => 1 << terminal.availableZ[0]!),
    ]),
    regionMetadata: regions,
    portAngleForRegion1: new Int32Array(angles.map((value) => value[0]!)),
    portAngleForRegion2: new Int32Array(angles.map((value) => value[1] ?? 0)),
    portX: new Float64Array(points.map((point) => point.x)),
    portY: new Float64Array(points.map((point) => point.y)),
    portZ: new Int32Array(points.map((point) => point.z)),
  }
  const problem = {
    routeCount: 2,
    portSectionMask: new Int8Array(points.length).fill(1),
    routeStartPort: new Int32Array([0, 2]),
    routeEndPort: new Int32Array([1, 3]),
    routeNet: new Int32Array([0, 1]),
    regionNetId: new Int32Array([-1, -1, 0, 0, 1, 1]),
    routeMetadata: [136, 106].map((net) => ({
      connectionId: `source_net_altium_pcb_${net}_mst0`,
      simpleRouteConnection: {
        __rootConnectionNames: [`source_net_altium_pcb_${net}`],
      },
    })),
    initialAssignments: [
      { routeId: 0, regionId: 0, fromPortId: 0, toPortId: 1 },
    ],
  }
  if (enabled) {
    topology.regionSegmentFeasibility = createPhysicalViaCapacityEvaluator({
      physicalSrj: fixture.physicalSrj,
      freeRegionIds: [node.capacityMeshNodeId, detour.capacityMeshNodeId],
    })
  }
  return new TinyHyperGraphSolver(topology, problem, {
    ACCEPT_BEST_SOLUTION_ON_TIMEOUT: true,
    GREEDY_FINAL_ROUTE_ITERS: 1,
  })
}

test("actual61633 through-via capacity takes a global detour and preserves electrical exemptions", (): void => {
  const fixture = JSON.parse(
    readFileSync(
      new URL(
        "../fixtures/sample24/two-net-through-via-capacity.json",
        import.meta.url,
      ),
      "utf8",
    ),
  ) as Fixture
  const snapshot = structuredClone(fixture)
  const previous = createSolver(fixture, false)
  previous.tryFinalAcceptance()
  expect(previous.solved).toBe(true)
  expect(previous.state.regionSegments[0]).toContainEqual([1, 2, 3])
  for (const greedy of [false, true]) {
    const solver = createSolver(fixture, true)
    if (greedy) solver.tryFinalAcceptance()
    else solver.solve()
    expect(solver.solved).toBe(true)
    expect(solver.state.regionSegments[0]).not.toContainEqual([1, 2, 3])
    expect(solver.state.regionSegments[1]).toContainEqual([1, 4, 5])
    expect(solver.state.regionSegments[0]).toContainEqual([0, 0, 1])
    const output = solver.getOutput()
    expect(structuredClone(output)).toEqual(output)
  }
  const solver = createSolver(fixture, true)
  const aliasProblem = {
    ...solver.problem,
    routeCount: 3,
    routeNet: new Int32Array([0, 1, 0]),
    routeStartPort: new Int32Array([0, 2, 0]),
    routeEndPort: new Int32Array([1, 3, 1]),
    routeMetadata: [
      ...solver.problem.routeMetadata!,
      {
        connectionId: "same-physical-net-alias",
        simpleRouteConnection: {
          __rootConnectionNames: ["pcb_port_altium_7459"],
        },
      },
    ],
    initialAssignments: [
      { routeId: 0, regionId: 0, fromPortId: 0, toPortId: 1 },
      { routeId: 2, regionId: 0, fromPortId: 0, toPortId: 1 },
    ],
  }
  const query = {
    topology: solver.topology,
    problem: aliasProblem,
    regionId: 0,
    fromPortId: 2,
    toPortId: 3,
    routeId: 1,
    netId: 1,
    regionSegments: [
      [0, 0, 1],
      [2, 0, 1],
    ] as [number, number, number][],
  }
  // Two MST requests on one electrical owner consume one shared-via unit,
  // but every transition request for a conflicting owner must be removed.
  const evaluate = createPhysicalViaCapacityEvaluator({
    physicalSrj: fixture.physicalSrj,
    freeRegionIds: [fixture.capacityNode.capacityMeshNodeId],
  })!
  expect(evaluate(query)).toEqual({ feasible: false, blockerRouteIds: [0, 2] })
  expect(evaluate({ ...query, regionSegments: [] })).toEqual({ feasible: true })
  expect(evaluate({ ...query, routeId: 0, regionSegments: [] })).toEqual({
    feasible: true,
  })
  expect(evaluate({ ...query, ignoredRouteIds: new Set([0]) })).toEqual({
    feasible: false,
    blockerRouteIds: [2],
  })
  expect(evaluate({ ...query, ignoredRouteIds: new Set([0, 2]) })).toEqual({
    feasible: true,
  })
  expect(evaluate({ ...query, routeId: 2 })).toEqual({ feasible: true })
  expect(evaluate({ ...query, routeId: undefined })).toEqual({
    feasible: true,
  })
  expect(evaluate({ ...query, fromPortId: 4, toPortId: 2 })).toEqual({
    feasible: true,
  })

  const own = createSolver(fixture, false)
  own.problem.routeMetadata![0].simpleRouteConnection.__rootConnectionNames = [
    "source_net_altium_pcb_123",
  ]
  const onlyR56 = fixture.physicalSrj.obstacles.filter(
    (obstacle) =>
      obstacle.circuitJsonMetadata?.pcb_smtpad_id === "pcb_smtpad_altium_7100",
  )
  const ownEvaluator = createPhysicalViaCapacityEvaluator({
    physicalSrj: { ...fixture.physicalSrj, obstacles: onlyR56 },
    freeRegionIds: [fixture.capacityNode.capacityMeshNodeId],
  })!
  expect(
    ownEvaluator({
      ...query,
      topology: own.topology,
      problem: own.problem,
      regionSegments: [[0, 0, 1]],
    }),
  ).toEqual({ feasible: true })
  // With both bottom pads present this third owner has no landing at all;
  // removing other routed owners cannot repair that permanent obstruction.
  expect(
    evaluate({
      ...query,
      problem: own.problem,
      routeId: 0,
      fromPortId: 0,
      toPortId: 1,
      regionSegments: [],
    }),
  ).toEqual({ feasible: false, blockerRouteIds: [] })
  const plain: CapacityMeshNode = {
    capacityMeshNodeId: fixture.capacityNode.capacityMeshNodeId,
    layer: "z0",
    center: fixture.capacityNode.center,
    width: fixture.capacityNode.width,
    height: fixture.capacityNode.height,
    availableZ: fixture.capacityNode.availableZ!,
  }
  expect(isPlainGlobalFreeNode(plain)).toBe(true)
  const unknownRole = { ...plain, unknownRole: false } as CapacityMeshNode
  expect(isPlainGlobalFreeNode(unknownRole)).toBe(false)
  expect(
    isPlainGlobalFreeNode({
      ...plain,
      _containsTarget: true,
      _connectedTo: ["owner"],
    }),
  ).toBe(false)
  const protectedEvaluator = createPhysicalViaCapacityEvaluator({
    physicalSrj: fixture.physicalSrj,
    freeRegionIds: [],
  })!
  expect(protectedEvaluator(query)).toEqual({ feasible: true })
  const pth = {
    ...onlyR56[0]!,
    center: {
      x: fixture.capacityNode.center.x + fixture.capacityNode.width / 2,
      y: 69.83,
    },
    width: 0.02,
    height: 0.02,
    layers: ["top", "bottom"],
    connectedTo: ["source_net_altium_pcb_136"],
    circuitJsonMetadata: { pcb_plated_hole_id: "existing-own-pth" },
  }
  const pthEvaluator = createPhysicalViaCapacityEvaluator({
    physicalSrj: {
      ...fixture.physicalSrj,
      obstacles: [...fixture.physicalSrj.obstacles, pth],
    },
    freeRegionIds: [fixture.capacityNode.capacityMeshNodeId],
  })!
  expect(pthEvaluator(query)).toEqual({ feasible: true })
  // Child/section solvers can renumber both routes and regions. The callback
  // must read their live mapping and report blockers in that same namespace.
  const remappedProblem = {
    ...aliasProblem,
    routeCount: 3,
    routeMetadata: [
      aliasProblem.routeMetadata[1],
      aliasProblem.routeMetadata[0],
      aliasProblem.routeMetadata[2],
    ],
    routeNet: new Int32Array([1, 0, 0]),
    routeStartPort: new Int32Array([2, 0, 0]),
    routeEndPort: new Int32Array([3, 1, 1]),
    initialAssignments: [
      { routeId: 1, regionId: 1, fromPortId: 0, toPortId: 1 },
      { routeId: 2, regionId: 1, fromPortId: 0, toPortId: 1 },
    ],
  }
  const remappedTopology = {
    ...solver.topology,
    regionMetadata: [
      solver.topology.regionMetadata![1],
      solver.topology.regionMetadata![0],
      ...solver.topology.regionMetadata!.slice(2),
    ],
    regionWidth: new Float64Array([
      solver.topology.regionWidth[1]!,
      solver.topology.regionWidth[0]!,
      ...solver.topology.regionWidth.slice(2),
    ]),
    regionHeight: new Float64Array([
      solver.topology.regionHeight[1]!,
      solver.topology.regionHeight[0]!,
      ...solver.topology.regionHeight.slice(2),
    ]),
    regionCenterX: new Float64Array([
      solver.topology.regionCenterX[1]!,
      solver.topology.regionCenterX[0]!,
      ...solver.topology.regionCenterX.slice(2),
    ]),
    regionCenterY: new Float64Array([
      solver.topology.regionCenterY[1]!,
      solver.topology.regionCenterY[0]!,
      ...solver.topology.regionCenterY.slice(2),
    ]),
    regionIncidentPorts: [
      solver.topology.regionIncidentPorts[1]!,
      solver.topology.regionIncidentPorts[0]!,
      ...solver.topology.regionIncidentPorts.slice(2),
    ],
    incidentPortRegion: solver.topology.incidentPortRegion.map((ids) =>
      ids.map((id) => (id < 2 ? 1 - id : id)),
    ),
  }
  expect(
    evaluate({
      ...query,
      topology: remappedTopology,
      problem: remappedProblem,
      regionId: 1,
      routeId: 0,
      regionSegments: [
        [1, 0, 1],
        [2, 0, 1],
      ],
    }),
  ).toEqual({ feasible: false, blockerRouteIds: [1, 2] })
  expect(
    structuredClone({
      physicalSrj: fixture.physicalSrj,
      freeRegionIds: [plain.capacityMeshNodeId],
    }),
  ).toEqual({
    physicalSrj: fixture.physicalSrj,
    freeRegionIds: [plain.capacityMeshNodeId],
  })
  const blindEvaluator = createPhysicalViaCapacityEvaluator({
    physicalSrj: { ...fixture.physicalSrj, allowBlindAndBuriedVias: true },
    freeRegionIds: [fixture.capacityNode.capacityMeshNodeId],
  })!
  expect(blindEvaluator(query)).toEqual({ feasible: true })
  expect(fixture).toEqual(snapshot)
})
