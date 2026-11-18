import { expect, test } from "bun:test"
import { ViaPossibilitiesSolver2 } from "lib/solvers/ViaPossibilitiesSolver/ViaPossibilitiesSolver2"
import { loadH616PowerRoutingFixture } from "tests/fixtures/loadH616PowerRoutingFixture"

test("captures H616 ground branches blocking their own via paths", (): void => {
  const fixture = loadH616PowerRoutingFixture()
  const originalNode = structuredClone(fixture.sameNetBranchNode)
  const solver = new ViaPossibilitiesSolver2({
    nodeWithPortPoints: fixture.sameNetBranchNode,
    viaDiameter: fixture.inputSrj.minViaDiameter!,
  })
  solver.solve()
  expect(solver.solved).toBeFalse()
  expect(solver.failed).toBeTrue()
  expect(solver.completedPaths.size).toBe(0)
  expect(fixture.sameNetBranchNode).toEqual(originalNode)
})
