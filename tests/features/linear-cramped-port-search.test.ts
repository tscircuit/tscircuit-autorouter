import {expect,test} from "bun:test"
import {SingleTargetNecessaryCrampedPortPointSolver} from "lib/solvers/NecessaryCrampedPortPointSolver/SingleTargetNecessaryCrampedPortPointSolver"
import {createWideCrampedPortGraph} from "../fixtures/createWideCrampedPortGraph"

test("cramped-port search expands shared adjacency once per best node-depth state", (): void => {
  const fixture=createWideCrampedPortGraph(128)
  const before=JSON.stringify([...fixture.ports])
  const solver=new SingleTargetNecessaryCrampedPortPointSolver(fixture.input)
  solver.solve()
  expect(solver.solved).toBe(true)
  const candidates=solver.getOutput()
  expect(candidates).toHaveLength(1)
  expect(candidates[0]!.port).toBe(fixture.exit)
  expect(candidates[0]!.parent!.port).toBe(fixture.links[0]!)
  expect(candidates[0]!.parent!.parent!.port).toBe(fixture.seed)
  expect(JSON.stringify([...fixture.ports])).toBe(before)
  expect(fixture.ports.getCalls).toBeLessThanOrEqual(13)
})
