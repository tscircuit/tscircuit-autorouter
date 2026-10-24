import { expect, test } from "bun:test"
import { SelectiveReripTinyHyperGraphSolver, type TinyHyperGraphTopology, type TinyHyperGraphProblem } from "tiny-hypergraph/lib/index"
import { createFeasibleOwnerCorridorController } from "../../lib/solvers/PortPointPathingSolver/tinyhypergraph/createFeasibleOwnerCorridorController"

test("fresh native resources preserve crossings, forbidden owners, terminal reservations, layers and changed current copper", (): void => {
  const topology: TinyHyperGraphTopology = {
    portCount: 4, regionCount: 5, regionIncidentPorts: [[0, 1, 2, 3], [0], [1], [2], [3]],
    incidentPortRegion: [[0, 1], [0, 2], [0, 3], [0, 4]],
    regionWidth: new Float64Array([4, 1, 1, 1, 1]), regionHeight: new Float64Array([4, 1, 1, 1, 1]),
    regionCenterX: new Float64Array(5), regionCenterY: new Float64Array(5), regionAvailableZMask: new Int32Array([1, 1, 1, 1, 1]),
    portAngleForRegion1: new Int32Array([0, 9000, 18000, 27000]), portAngleForRegion2: new Int32Array(4),
    portX: new Float64Array([2, 0, -2, 0]), portY: new Float64Array([0, 2, 0, -2]), portZ: new Int32Array(4),
  }
  const problem: TinyHyperGraphProblem = { routeCount: 2, portSectionMask: new Int8Array([1, 1, 0, 1]),
    routeStartPort: new Int32Array([0, 1]), routeEndPort: new Int32Array([2, 3]),
    routeNet: new Int32Array([0, 1]), regionNetId: new Int32Array([-1, 0, 1, 0, 1]),
    initialAssignments: [{ routeId: 1, regionId: 0, fromPortId: 1, toPortId: 3 }] }
  const native = new SelectiveReripTinyHyperGraphSolver(topology, problem)
  native.state.currentRouteId = 0; native.state.currentRouteNetId = 0
  const access = native as unknown as { findRelaxedBlockerPath(forbidden?: ReadonlySet<number>): {
    found: boolean; reason?: string; states?: Array<{ portId: number; nextRegionId: number }>;
    owners?: Set<number>; distance?: number; hops?: Array<{ data: { resources: Array<{ kind: string; owners: number[]; regionId?: number; fromPortId?: number; toPortId?: number }> } }> } }
  const original = access.findRelaxedBlockerPath()
  expect(original.found).toBe(true)
  expect([...original.owners!]).toEqual([1])
  const controller = createFeasibleOwnerCorridorController()
  controller.install(native)
  const corridor = access.findRelaxedBlockerPath()
  expect(corridor.found).toBe(true)
  expect(corridor.states).toEqual([{ portId: 0, nextRegionId: 0 }, { portId: 2, nextRegionId: 0 }])
  expect([...corridor.owners!]).toEqual([1])
  expect(corridor.distance).toBe(4)
  expect(corridor.hops![0]!.data.resources).toEqual([{ kind: "same_layer_intersection", regionId: 0, fromPortId: 0, toPortId: 2, owners: [1] }])
  expect(access.findRelaxedBlockerPath(new Set([1])).reason).toBe("no_path")
  // The goal is valid despite its section mask0, exactly as in native search.
  // Foreign terminal ports1/3 must not become a detour after releasing their owner.
  native.state.regionSegments[0] = []
  native.state.portAssignment.fill(-1)
  const cleared = access.findRelaxedBlockerPath()
  expect(cleared.found).toBe(true)
  expect([...cleared.owners!]).toEqual([])
  expect(cleared.states).toEqual(corridor.states)
  native.state.regionSegments[0] = [[1, 1, 3]]
  topology.regionAvailableZMask![0] = 3
  const multilayer = access.findRelaxedBlockerPath(new Set([1]))
  expect(multilayer.found).toBe(true)
  expect([...multilayer.owners!]).toEqual([])
  // An unavailable current region is a genuine native graph no-path, including
  // the early return before native multilayer template construction.
  problem.regionNetId[0] = 99
  problem.regionNetId[1] = 99
  expect(native.getStartingNextRegionId(0, 0)).toBe(0)
  expect(access.findRelaxedBlockerPath().reason).toBe("no_path")
  expect(controller.stats.feasibleOwner_found).toBe(3)
  expect(controller.stats.feasibleOwner_noPath).toBe(2)
  expect(controller.stats.feasibleOwner_oldSearchCalls).toBe(0)
})
