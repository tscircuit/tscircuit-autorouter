import { expect, test } from "bun:test"
import { compareOwnerCutResults, ownerCutValueHash, runColdOwnerCutOperator, type OwnerCutBenchmarkHost } from "../scripts/benchmark/ownerCutBenchmarkModel"

test("isolated owner operators receive fresh identical native hop metadata and retain cap unknowns", (): void => {
  let ownerScans = 0, factories = 0
  const cacheGenerations = new Set<object>()
  const host: OwnerCutBenchmarkHost = {
    topology: {}, problem: {}, problemSetup: {}, candidateHopSlotStride: 1,
    candidateFirstRegionByPortId: new Int32Array(), candidateSecondRegionByPortId: new Int32Array(),
    state: { currentRouteId: 0, currentRouteNetId: 0, portAssignment: new Int32Array(), regionSegments: [] },
    getRouteStartPortId: (): number => 0, getRouteEndPortId: (): number => 3,
    getStartingNextRegionId: (): number => 0, getHopId: (port): number => port,
    getPortOwners: (): Map<number, Set<number>> => { ownerScans++; return new Map() },
    getRelaxedSearchExpansionLimit: (): number => 1000,
    getRelaxedSearchHops: (params) => {
      cacheGenerations.add(params.portResources); factories++
      const graph = [
        [{ state: { portId: 1, nextRegionId: 0 }, distance: 1, owners: [7, 9], data: { resources: [7, 9] } },
         { state: { portId: 2, nextRegionId: 0 }, distance: 4, owners: [7], data: { resources: [7] } }],
        [{ state: { portId: 3, nextRegionId: 0 }, distance: 1, owners: [7], data: { resources: [7] } }],
        [{ state: { portId: 3, nextRegionId: 0 }, distance: 1, owners: [7], data: { resources: [7] } }],
        [],
      ]
      return graph[params.state.portId]!.filter((hop) => !hop.owners.some((owner) => params.forbiddenOwnerRouteIds.has(owner)))
    },
  }
  const before = ownerCutValueHash(host.state)
  const native = runColdOwnerCutOperator("native", host, new Set(), 100000)
  const candidate = runColdOwnerCutOperator("candidate", host, new Set(), 100000)
  expect(compareOwnerCutResults(native.result, candidate.result).classification).toBe("exact")
  expect(candidate.result.found && candidate.result.distance).toBe(5)
  expect(candidate.result.found && [...candidate.result.owners]).toEqual([7])
  expect(candidate.candidate?.ownerMinimumProven).toBe(true)
  expect(candidate.candidate?.distanceMinimumProven).toBe(true)
  const capped = runColdOwnerCutOperator("candidate", host, new Set(), 0)
  expect(compareOwnerCutResults(native.result, capped.result).classification).toBe("unknown")
  expect(capped.result.found).toBe(false)
  const forbidden = runColdOwnerCutOperator("native", host, new Set([7]), 100000)
  expect(forbidden.result.found).toBe(false)
  expect(ownerScans).toBe(4)
  expect(cacheGenerations.size).toBe(3)
  expect(factories).toBeGreaterThan(0)
  expect(ownerCutValueHash(host.state)).toBe(before)
})
