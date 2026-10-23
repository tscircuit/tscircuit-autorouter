import { expect, test } from "bun:test"
import { SharedElectricalTreeClearanceSolver, type SharedElectricalTreeClearanceInput } from "lib/solvers/SharedElectricalTreeClearanceSolver/SharedElectricalTreeClearanceSolver"
import { sharedElectricalTreeClearanceFixture } from "../fixtures/sharedElectricalTreeClearanceFixture"

test("the trusted graph boundary rejects malformed geometry, rules and source sidecars before constraint interning", (): void => {
  const { adapter, srj } = sharedElectricalTreeClearanceFixture()
  const input: SharedElectricalTreeClearanceInput = { srj: { ...srj, traces: undefined }, routes: adapter.routes, bounds: srj.bounds, boundaryMargin: 0,
    lockedPointIndices: adapter.lockedPointIndices, segmentIdentityByRoute: adapter.segmentIdentityByRoute }
  for (const invalid of [Number.NaN, Infinity, -1]) {
    expect(() => new SharedElectricalTreeClearanceSolver({ ...input, traceClearance: invalid })).toThrow("nonnegative clearances")
    expect(() => new SharedElectricalTreeClearanceSolver({ ...input, srj: { ...input.srj, minTraceToPadEdgeClearance: invalid } })).toThrow("nonnegative clearances")
    expect(() => new SharedElectricalTreeClearanceSolver({ ...input, srj: { ...input.srj, minTraceToHoleEdgeClearance: invalid } })).toThrow("nonnegative clearances")
  }
  for (const invalid of [Number.NaN, Infinity, 0, 1.5]) {
    expect(() => new SharedElectricalTreeClearanceSolver({ ...input, srj: { ...input.srj, layerCount: invalid } })).toThrow("layer count")
  }
  expect(() => new SharedElectricalTreeClearanceSolver({ ...input, bounds: { ...input.bounds, minX: Infinity } })).toThrow("finite ordered bounds")
  expect(() => new SharedElectricalTreeClearanceSolver({ ...input, segmentIdentityByRoute: [] })).toThrow("lost a route")
  expect(() => new SharedElectricalTreeClearanceSolver({ ...input, lockedPointIndices: [] })).toThrow("lost a route")
  expect(() => new SharedElectricalTreeClearanceSolver({ ...input, segmentIdentityByRoute: [[]] })).toThrow("lost an adjacency")
  const invalid = structuredClone(input)
  invalid.routes[0]!.route[0]!.x = Number.NaN
  expect(() => new SharedElectricalTreeClearanceSolver(invalid)).toThrow("physical point geometry")
  const malformed = structuredClone(input)
  malformed.segmentIdentityByRoute = malformed.routes.map((route) => route.route.slice(1).map(() => ({ kind: "adapter-seam" })))
  expect(() => new SharedElectricalTreeClearanceSolver(malformed)).toThrow("seam changed physical position")
})
