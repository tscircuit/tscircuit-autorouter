import { expect, test } from "bun:test"
import { findGlobalOwnerBoundedDistance, GLOBAL_OWNER_DISTANCE_LABEL_LIMIT, type GlobalOwnerDistanceWork } from "../../lib/solvers/PortPointPathingSolver/tinyhypergraph/findGlobalOwnerBoundedDistance"

test("global label storage cap is explicit unknown and cannot be raised above fixed policy", (): void => {
  const work = (): GlobalOwnerDistanceWork => ({ globalExpandedLabels: 0, globalHopVisits: 0, globalOwnerUnionVisits: 0,
    globalDominanceTests: 0, globalSubsetOwnerChecks: 0, globalAllocatedLabels: 0, globalQueuePushes: 0,
    globalQueuePops: 0, globalQueueComparisons: 0, globalLabelLimitHits: 0, globalPeakQueueSize: 0, globalPeakStateLabels: 0 })
  const state = work()
  const options = { start: 0, minimumOwners: 0, getStateKey: (value: number): number => value,
    isGoal: (value: number): boolean => value === 2,
    getHops: (value: number) => value < 2 ? [{ state: value + 1, distance: 1, owners: [] }] : [],
    getOwnerIds: (): number[] => [], work: state,
    charge: (field: keyof GlobalOwnerDistanceWork, units = 1): boolean => { state[field] += units; return true } }
  const limited = findGlobalOwnerBoundedDistance({ ...options, maximumAllocatedLabels: 2 })
  expect(limited).toEqual({ found: false, reason: "expansion_limit" })
  expect(state.globalAllocatedLabels).toBe(2)
  expect(state.globalLabelLimitHits).toBe(1)
  const fresh = work()
  const found = findGlobalOwnerBoundedDistance({ ...options, work: fresh, maximumAllocatedLabels: 3,
    charge: (field, units = 1): boolean => { fresh[field] += units; return true } })
  expect(found.found).toBe(true)
  if (!found.found) throw new Error("Three labels suffice for controlled chain")
  expect(found.distance).toBe(2)
  expect(fresh.globalAllocatedLabels).toBe(3)
  expect(() => findGlobalOwnerBoundedDistance({ ...options, maximumAllocatedLabels: GLOBAL_OWNER_DISTANCE_LABEL_LIMIT + 1 })).toThrow()
})
