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

test("an owner with no physical point on a wide shared face is permanently blocked without rejecting own copper or neckdowns", (): void => {
  const fixture = JSON.parse(
    readFileSync(
      new URL("../fixtures/sample24/shared-edge-empty-owner-domain.json", import.meta.url),
      "utf8",
    ),
  ) as Fixture
  const snapshot = structuredClone(fixture)
  const { nodes } = fixture
  const y = nodes[0]!.center.y + nodes[0]!.height / 2
  const topology: TinyHyperGraphTopology = {
    portCount: 2,
    regionCount: 2,
    regionIncidentPorts: [[0, 1], [0, 1]],
    incidentPortRegion: [[0, 1], [0, 1]],
    regionWidth: new Float64Array(nodes.map((node) => node.width)),
    regionHeight: new Float64Array(nodes.map((node) => node.height)),
    regionCenterX: new Float64Array(nodes.map((node) => node.center.x)),
    regionCenterY: new Float64Array(nodes.map((node) => node.center.y)),
    regionAvailableZMask: new Int32Array([255, 255]),
    regionMetadata: nodes,
    portAngleForRegion1: new Int32Array(2),
    portAngleForRegion2: new Int32Array(2),
    portX: new Float64Array(2).fill(nodes[0]!.center.x),
    portY: new Float64Array(2).fill(y),
    portZ: new Int32Array(2),
  }
  const problem: TinyHyperGraphProblem = {
    routeCount: 2,
    portSectionMask: new Int8Array([1, 1]),
    routeStartPort: new Int32Array([0, 0]),
    routeEndPort: new Int32Array([1, 1]),
    routeNet: new Int32Array([0, 1]),
    regionNetId: new Int32Array([-1, -1]),
    routeMetadata: fixture.physicalSrj.connections.map((connection) => ({
      simpleRouteConnection: connection,
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
    fromPortId: 0,
    toPortId: 1,
    routeId: 0,
    netId: 0,
    regionSegments: [] as [number, number, number][],
  }
  // This actual .508 mm face has capacity above one, but R105.2 covers the
  // entire owner-140 landing interval. Removing routes cannot make it legal.
  expect(nodes[0]!.width).toBeGreaterThan(0.5)
  expect(fixture.physicalSrj.connections[0]!.name).toBe("source_net_altium_pcb_140")
  expect(evaluate(query)).toEqual({ feasible: false, blockerRouteIds: [] })
  expect(evaluate({ ...query, ignoredRouteIds: new Set([1]) })).toEqual({
    feasible: false,
    blockerRouteIds: [],
  })
  expect(evaluate({ ...query, routeId: 1 })).toEqual({ feasible: true })
  expect(evaluate({ ...query, routeId: undefined })).toEqual({ feasible: true })
  const anotherLayer = { ...topology, portZ: new Int32Array([1, 1]) }
  expect(evaluate({ ...query, topology: anotherLayer })).toEqual({ feasible: true })
  const unconfirmed = createPhysicalViaCapacityEvaluator({
    ...context,
    freeRegionIds: [fixture.freeRegionIds[0]!],
  })!
  expect(unconfirmed(query)).toEqual({ feasible: true })

  const neckdownSrj = structuredClone(fixture.physicalSrj)
  neckdownSrj.connections[0]!.nominalTraceWidth = 1
  neckdownSrj.obstacles[0]!.center.y += 0.05
  expect(createPhysicalViaCapacityEvaluator({
    ...context,
    physicalSrj: neckdownSrj,
  })!(query)).toEqual({ feasible: true })

  const noPairPitchSrj = structuredClone(fixture.physicalSrj)
  noPairPitchSrj.minTraceWidth = 0.001
  noPairPitchSrj.minTraceToPadEdgeClearance = 0
  noPairPitchSrj.allowBlindAndBuriedVias = true
  noPairPitchSrj.obstacles[0]!.center.y = y
  noPairPitchSrj.obstacles[0]!.connectedTo = ["source_net_altium_pcb_285"]
  expect(createPhysicalViaCapacityEvaluator({
    ...context,
    physicalSrj: noPairPitchSrj,
  })!(query)).toEqual({ feasible: false, blockerRouteIds: [] })

  const tangentSrj = structuredClone(fixture.physicalSrj)
  const pad = tangentSrj.obstacles[0]!
  pad.center.y = y
  pad.center.x = nodes[0]!.center.x + nodes[0]!.width / 2 - 0.15 - pad.width / 2
  expect(createPhysicalViaCapacityEvaluator({
    ...context,
    physicalSrj: tangentSrj,
  })!(query)).toEqual({ feasible: true })
  expect(fixture).toEqual(snapshot)
})
