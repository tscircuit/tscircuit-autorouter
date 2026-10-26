import {expect,test} from "bun:test"
import {MultiTargetNecessaryCrampedPortPointSolver} from "lib/solvers/NecessaryCrampedPortPointSolver/MultiTargetNecessaryCrampedPortPointSolver"
import {createCrampedPortSetupInput} from "../fixtures/createCrampedPortSetupInput"

test("cramped-port graph setup initializes adjacency only once before native stepping", (): void => {
  const fixture=createCrampedPortSetupInput(128)
  const before=JSON.stringify(fixture.input.sharedEdgeSegments),initialReads=fixture.nodeIdReads
  const solver=new MultiTargetNecessaryCrampedPortPointSolver(fixture.input)
  expect(fixture.nodeIdReads-initialReads).toBe(fixture.portCount)
  solver.step()
  expect(fixture.nodeIdReads-initialReads).toBe(fixture.portCount)
  solver.solve()
  expect(solver.solved).toBe(true)
  expect(solver.failed).toBe(false)
  expect(solver.getOutput()).toEqual(fixture.input.sharedEdgeSegments)
  expect(JSON.stringify(fixture.input.sharedEdgeSegments)).toBe(before)
})
