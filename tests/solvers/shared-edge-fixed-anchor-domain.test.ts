import { expect, test } from "bun:test"
import type {
  TinyHyperGraphProblem,
  TinyHyperGraphTopology,
} from "tiny-hypergraph/lib/core"
import type { CapacityMeshNode, SimpleRouteJson } from "lib/types"
import { createPhysicalViaCapacityEvaluator } from "lib/solvers/PortPointPathingSolver/tinyhypergraph/createPhysicalViaCapacityEvaluator"

test("shared-face ordering and fixed plated endpoints preserve exact legal tangencies", (): void => {
  const delta = 1e-10
  const nodes: CapacityMeshNode[] = [
    {
      capacityMeshNodeId: "z-left",
      layer: "top",
      center: { x: (-1 - delta) / 2, y: 0.5 },
      width: 1 - delta,
      height: 1,
      availableZ: [0, 1],
    },
    {
      capacityMeshNodeId: "a-right",
      layer: "top",
      center: { x: 0.5, y: 0.5 },
      width: 1,
      height: 1,
      availableZ: [0, 1],
    },
  ]
  const srj: SimpleRouteJson = {
    layerCount: 2,
    minTraceWidth: 0.1,
    bounds: { minX: -3, maxX: 3, minY: -3, maxY: 3 },
    connections: [
      {
        name: "signal",
        __rootConnectionNames: ["signal-root"],
        pointsToConnect: [],
      },
      {
        name: "foreign",
        __rootConnectionNames: ["foreign-root"],
        pointsToConnect: [],
      },
    ],
    obstacles: [
      {
        type: "rect",
        center: { x: -0.2 - delta / 2, y: 0.5 },
        width: 0.11,
        height: 2,
        layers: ["top"],
        connectedTo: ["pcb_smtpad_foreign", "foreign"],
      },
    ],
  }
  const topology: TinyHyperGraphTopology = {
    regionCount: 2,
    portCount: 2,
    regionIncidentPorts: [
      [0, 1],
      [0, 1],
    ],
    incidentPortRegion: [
      [0, 1],
      [0, 1],
    ],
    regionWidth: new Float64Array(nodes.map((node) => node.width)),
    regionHeight: new Float64Array([1, 1]),
    regionCenterX: new Float64Array(nodes.map((node) => node.center.x)),
    regionCenterY: new Float64Array([0.5, 0.5]),
    regionAvailableZMask: new Int32Array([3, 3]),
    regionMetadata: nodes,
    portAngleForRegion1: new Int32Array(2),
    portAngleForRegion2: new Int32Array(2),
    portX: new Float64Array([0, 0]),
    portY: new Float64Array([0.25, 0.75]),
    portZ: new Int32Array(2),
  }
  const problem: TinyHyperGraphProblem = {
    routeCount: 1,
    portSectionMask: new Int8Array([1, 1]),
    routeStartPort: new Int32Array([0]),
    routeEndPort: new Int32Array([1]),
    routeNet: new Int32Array([0]),
    regionNetId: new Int32Array([-1, -1]),
    routeMetadata: [
      {
        connectionId: "signal",
        simpleRouteConnection: { __rootConnectionNames: ["signal"] },
      },
    ],
  }
  const context = {
    physicalSrj: srj,
    freeRegionIds: nodes.map((node) => node.capacityMeshNodeId),
  }
  const query = {
    topology,
    problem,
    regionId: 0,
    fromPortId: 0,
    toPortId: 1,
    routeId: 0,
    netId: 0,
    regionSegments: [] as [number, number, number][],
  }
  expect(createPhysicalViaCapacityEvaluator(context)!(query)).toEqual({
    feasible: true,
  })
  const reversed = { ...topology, regionMetadata: [...nodes].reverse() }
  expect(
    createPhysicalViaCapacityEvaluator(context)!({
      ...query,
      topology: reversed,
    }),
  ).toEqual({ feasible: true })

  const blockedFaceSrj = structuredClone(srj)
  blockedFaceSrj.obstacles[0]!.center.x += delta
  const special = {
    ...topology,
    regionMetadata: nodes.map((node) => ({ ...node, _containsTarget: true })),
    portX: new Float64Array([delta, delta]),
  }
  const protectedContext = {
    physicalSrj: blockedFaceSrj, freeRegionIds: [], sharedEdgeRegionIds: context.freeRegionIds,
  }
  // The face is blocked, while this fixed point is only 0.1 nm beyond the
  // obstacle's tolerance boundary. Uniform preserves such target endpoints.
  expect(createPhysicalViaCapacityEvaluator(protectedContext)!({ ...query, topology: special }))
    .toEqual({ feasible: true })
  const invalidAnchor = { ...special, portX: new Float64Array([-delta, -delta]) }
  expect(createPhysicalViaCapacityEvaluator(protectedContext)!({ ...query, topology: invalidAnchor }))
    .toEqual({ feasible: false, blockerRouteIds: [] })

  const ownPth = structuredClone(blockedFaceSrj)
  ownPth.obstacles[0]!.layers = ["top", "bottom"]
  ownPth.obstacles[0]!.connectedTo = ["pcb_plated_hole_own", "signal-root"]
  expect(createPhysicalViaCapacityEvaluator({ ...protectedContext, physicalSrj: ownPth })!({
    ...query, topology: invalidAnchor,
  })).toEqual({ feasible: true })
})
