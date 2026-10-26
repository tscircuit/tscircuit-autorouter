import { expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import type { TinyHyperGraphProblem, TinyHyperGraphTopology } from "tiny-hypergraph/lib/core"
import { createPhysicalViaCapacityEvaluator } from "lib/solvers/PortPointPathingSolver/tinyhypergraph/createPhysicalViaCapacityEvaluator"
import type { NodeWithPortPoints } from "lib/types/high-density-types"
import type { SimpleRouteJson } from "lib/types"

type Fixture = { capacityNode: NodeWithPortPoints; physicalSrj: SimpleRouteJson }

test("sample24 node60069 applies existing via-pair capacity after combining foreign pad exclusions", (): void => {
  const fixture = JSON.parse(readFileSync(new URL("../fixtures/sample24/convex-via-domain-pair.json", import.meta.url), "utf8")) as Fixture
  const snapshot = structuredClone(fixture)
  const node = fixture.capacityNode, ports = node.portPoints
  const topology: TinyHyperGraphTopology = {
    regionCount: 1, portCount: ports.length,
    regionMetadata: [node], regionIncidentPorts: [ports.map((_, index) => index)],
    incidentPortRegion: ports.map(() => [0]), regionAvailableZMask: new Int32Array([255]),
    regionWidth: new Float64Array([node.width]), regionHeight: new Float64Array([node.height]),
    regionCenterX: new Float64Array([node.center.x]), regionCenterY: new Float64Array([node.center.y]),
    portMetadata: ports.map((port) => ({ serializedPortId: port.portPointId })),
    portX: new Float64Array(ports.map((port) => port.x)), portY: new Float64Array(ports.map((port) => port.y)),
    portZ: new Int32Array(ports.map((port) => port.z)),
    portAngleForRegion1: new Int32Array(ports.length), portAngleForRegion2: new Int32Array(ports.length),
  }
  const problem: TinyHyperGraphProblem = {
    routeCount: 2, routeNet: new Int32Array([0, 1]),
    routeStartPort: new Int32Array([0, 2]), routeEndPort: new Int32Array([1, 3]),
    regionNetId: new Int32Array([-1]), portSectionMask: new Int8Array(ports.length).fill(1),
    routeMetadata: [142, 112].map((net) => ({ simpleRouteConnection: { __rootConnectionNames: [`source_net_altium_pcb_${net}`] } })),
  }
  const context = { physicalSrj: fixture.physicalSrj, freeRegionIds: [node.capacityMeshNodeId], throughViaCrosscutEnabled: true }
  const query = { topology, problem, regionId: 0, fromPortId: 2, toPortId: 3, routeId: 1, netId: 1, regionSegments: [[0, 0, 1]] as [number, number, number][] }
  const previous = createPhysicalViaCapacityEvaluator({ ...context, throughViaCrosscutEnabled: false })!
  expect(previous(query)).toEqual({ feasible: true })
  const evaluate = createPhysicalViaCapacityEvaluator(context)!
  expect(evaluate(query)).toEqual({ feasible: false, blockerRouteIds: [0] })
  expect(evaluate({ ...query, regionSegments: [] })).toEqual({ feasible: true })
  expect(evaluate({ ...query, ignoredRouteIds: new Set([0]) })).toEqual({ feasible: true })
  const alias = { ...problem, routeCount: 3, routeMetadata: [...problem.routeMetadata!, problem.routeMetadata![0]] }
  const repeated = { ...query, problem: alias, regionSegments: [[0, 0, 1], [2, 0, 1]] as [number, number, number][] }
  expect(evaluate(repeated)).toEqual({ feasible: false, blockerRouteIds: [0, 2] })
  expect(evaluate({ ...repeated, ignoredRouteIds: new Set([0]) })).toEqual({ feasible: false, blockerRouteIds: [2] })
  const sameOwner = { ...problem, routeMetadata: [problem.routeMetadata![0], problem.routeMetadata![0]] }
  expect(evaluate({ ...query, problem: sameOwner })).toEqual({ feasible: true })
  const ownFlank = { ...problem, routeMetadata: [{ simpleRouteConnection: { __rootConnectionNames: ["source_net_altium_pcb_364"] } }, problem.routeMetadata![1]] }
  expect(evaluate({ ...query, problem: ownFlank })).toEqual({ feasible: true })
  expect(createPhysicalViaCapacityEvaluator({ ...context, physicalSrj: { ...fixture.physicalSrj, allowBlindAndBuriedVias: true } })!(query)).toEqual({ feasible: true })
  expect(fixture).toEqual(snapshot)
})
