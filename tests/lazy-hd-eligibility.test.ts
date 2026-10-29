import { expect, test } from "bun:test"
import { getLazyHdGridPlan } from "lib/solvers/HyperHighDensitySolver/lazyHdGridCandidates"
import { makeLazyHdPortfolio, makeLazyHdSyntheticNode } from "./fixtures/lazyHdSynthetic"

test("rich and invalid geometry and caps above the proof remain on native eager admission", () => {
  const node = makeLazyHdSyntheticNode(1)
  for (const kind of ["A01", "A03"] as const) {
    for (const cap of [0, NaN, Infinity, -1, 2_000_001]) expect(getLazyHdGridPlan(node, kind, () => cap)).toBeNull()
    for (const dimension of [0, -1, NaN, Infinity]) expect(getLazyHdGridPlan({ ...node, width: dimension }, kind, () => 150_000)).toBeNull()
    expect(getLazyHdGridPlan({ ...node, portPoints: [{ ...node.portPoints[0]!, x: NaN }] }, kind, () => 150_000)).toBeNull()
    expect(getLazyHdGridPlan({ ...node, availableZ: [] }, kind, () => 150_000)).toBeNull()
    let reads = 0
    const rich = { ...node }
    Object.defineProperty(rich, "width", { get: () => { reads++; return 2 } })
    expect(getLazyHdGridPlan(rich, kind, () => { throw new Error("must not compute a rich object's budget") })).toBeNull()
    expect(reads).toBe(0)
    expect(getLazyHdGridPlan({ ...node, portPointsInPairs: { get length() { throw new Error("must not read rich pair counts") } } as any }, kind, () => { throw new Error("must not compute rich pair-count budget") })).toBeNull()
    const richPoint = { ...node.portPoints[0]!, portPointId: { toString: () => { throw new Error("metadata must stay on eager path") } } }
    expect(getLazyHdGridPlan({ ...node, portPoints: [richPoint as any] }, kind, () => 150_000)).toBeNull()
    const richArray = [...node.portPoints]
    Object.defineProperty(richArray, "0", { get: () => { throw new Error("array accessors must stay on eager path") } })
    expect(getLazyHdGridPlan({ ...node, portPoints: richArray }, kind, () => 150_000)).toBeNull()
  }
  const crowded = makeLazyHdSyntheticNode(1)
  crowded.width = 60
  crowded.height = 60
  const portfolio = makeLazyHdPortfolio(crowded, true)
  portfolio.initializeSolvers()
  const grids = portfolio.supervisedSolvers!.filter(({ hyperParameters }) => hyperParameters.HIGH_DENSITY_A01 || hyperParameters.HIGH_DENSITY_A03)
  expect(grids).toHaveLength(2)
  for (const { solver } of grids) {
    expect(Object.hasOwn(solver, "gridMaterialized")).toBeFalse()
    expect((solver as any)._setupDone).toBeTrue()
  }
})
