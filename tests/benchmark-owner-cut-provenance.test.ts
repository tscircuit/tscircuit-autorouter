import { expect, test } from "bun:test"
import { ownerCutQueryFingerprint, ownerCutValueHash, type OwnerCutBenchmarkHost } from "../scripts/benchmark/ownerCutBenchmarkModel"

test("query fingerprints retain directed ownership, geometry bits, masks, reservations and forbidden identity", (): void => {
  const state = { currentRouteId: 1, currentRouteNetId: 2,
    portAssignment: new Int32Array([-1, 8]), regionSegments: [[[9, 0, 1]]] }
  const host = { topology: { coordinates: new Float64Array([0, -0, 2]), incident: [[0, 1]] },
    problem: { portSectionMask: new Int32Array([1, 2]) },
    problemSetup: { portEndpointReservationNetId: new Int32Array([-1, 8]) },
    candidateHopSlotStride: 2, candidateFirstRegionByPortId: new Int32Array([0]),
    candidateSecondRegionByPortId: new Int32Array([1]), state } as unknown as OwnerCutBenchmarkHost
  const original = ownerCutQueryFingerprint(host, new Set([7]))
  expect(original).toBe(ownerCutQueryFingerprint(host, new Set([7])))
  expect(original).not.toBe(ownerCutQueryFingerprint(host, new Set([8])))
  state.portAssignment[0] = 7
  expect(original).not.toBe(ownerCutQueryFingerprint(host, new Set([7])))
  state.portAssignment[0] = -1
  state.regionSegments[0]![0]![0] = 10
  expect(original).not.toBe(ownerCutQueryFingerprint(host, new Set([7])))
  state.regionSegments[0]![0]![0] = 9
  expect(ownerCutQueryFingerprint(host, new Set([7]))).toBe(original)
  expect(ownerCutValueHash(new Float64Array([0]))).not.toBe(ownerCutValueHash(new Float64Array([-0])))
  expect(ownerCutValueHash({ b: 1, a: 2 })).toBe(ownerCutValueHash({ a: 2, b: 1 }))
  expect(ownerCutValueHash([Number.NaN])).not.toBe(ownerCutValueHash([null]))
})
