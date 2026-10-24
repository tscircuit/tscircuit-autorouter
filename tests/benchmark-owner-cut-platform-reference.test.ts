import { expect, test } from "bun:test"
import {
  assertOwnerCutFrozenReference, assertOwnerCutHistoricalIdentity, assertOwnerCutReference,
  ownerCutQueryFingerprint, ownerCutReferenceDifferences, storeOwnerCutResult,
  type OwnerCutBenchmarkHost, type OwnerCutBenchmarkResult, type OwnerCutFrozenQuery,
  type OwnerCutReferenceQuery,
} from "../scripts/benchmark/ownerCutBenchmarkModel"

test("historical label drift cannot weaken frozen platform context, witness or query identity", (): void => {
  const host = {
    topology: { x: new Float64Array([0, 1]) }, problem: {}, problemSetup: {},
    candidateHopSlotStride: 2, candidateFirstRegionByPortId: new Int32Array([2, 2]),
    candidateSecondRegionByPortId: new Int32Array([-1, -1]),
    state: { currentRouteId: 0, currentRouteNetId: 3, portAssignment: new Int32Array([-1, 7]), regionSegments: [] },
    getRouteStartPortId: (): number => 0, getRouteEndPortId: (): number => 1,
    getStartingNextRegionId: (): number => 2,
  } as unknown as OwnerCutBenchmarkHost
  const native: OwnerCutBenchmarkResult = {
    found: true, owners: new Set([7]), distance: 1, expandedLabelCount: 2,
    states: [{ portId: 0, nextRegionId: 2 }, { portId: 1, nextRegionId: 2 }],
    hops: [{ state: { portId: 1, nextRegionId: 2 }, distance: 1, owners: [7], data: { resources: ["port7"] } }],
  }
  const historical: OwnerCutReferenceQuery = {
    index: 1, routeId: 0, forbiddenOwnerCount: 0,
    start: { portId: 0, nextRegionId: 2 }, goalPortId: 1,
    native: { found: true, owners: [7], distance: 1, expandedLabelCount: 4, states: native.states },
  }
  const forbidden = new Set<number>()
  const differences = ownerCutReferenceDifferences(historical, host, forbidden, native)
  expect(differences.expandedLabelCount).toEqual({ expected: 4, actual: 2, equal: false })
  expect(differences.states!.equal).toBe(true)
  expect(() => assertOwnerCutHistoricalIdentity(historical, host, forbidden)).not.toThrow()
  // The old strict helper is retained; the preflight deliberately freezes a
  // NEW exact witness, rather than globally disabling the label-work check.
  expect(() => assertOwnerCutReference(historical, host, forbidden, native)).toThrow()
  const stored = storeOwnerCutResult(native)
  if (!stored.found) throw new Error("Controlled native witness must be feasible")
  const frozen = JSON.parse(JSON.stringify({ ...historical, fingerprint: ownerCutQueryFingerprint(host, forbidden), native: stored })) as OwnerCutFrozenQuery
  expect(stored.hops).toEqual(native.hops)
  expect(() => assertOwnerCutFrozenReference(frozen, host, forbidden, native)).not.toThrow()
  for (const mutation of ["labels", "states", "hops", "distance", "owners"] as const) {
    const changed = structuredClone(native)
    if (mutation === "labels") changed.expandedLabelCount++
    if (mutation === "states") changed.states[1]!.portId = 8
    if (mutation === "hops") changed.hops[0]!.data = { resources: ["foreign"] }
    if (mutation === "distance") changed.distance += Number.EPSILON
    if (mutation === "owners") changed.owners = new Set([8])
    expect(() => assertOwnerCutFrozenReference(frozen, host, forbidden, changed)).toThrow()
  }
  host.state.portAssignment[0] = 9
  expect(() => assertOwnerCutFrozenReference(frozen, host, forbidden, native)).toThrow()
  host.state.portAssignment[0] = -1
  expect(() => assertOwnerCutHistoricalIdentity({ ...historical, routeId: 9 }, host, forbidden)).toThrow()
  expect(() => assertOwnerCutHistoricalIdentity({ ...historical, goalPortId: 9 }, host, forbidden)).toThrow()
  expect(() => assertOwnerCutHistoricalIdentity({ ...historical, start: { portId: 0, nextRegionId: 9 } }, host, forbidden)).toThrow()
})
