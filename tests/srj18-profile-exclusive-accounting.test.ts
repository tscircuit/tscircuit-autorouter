import { expect, test } from "bun:test"
import { SolverProfile } from "../scripts/srj18Profile/solverProfile"

test("nested lifecycle timing conserves elapsed work and tracks inherited node IDs", () => {
  const profile = new SolverProfile()
  profile.enabled = true
  profile.stage = "high_density"
  const parent = { nodeWithPortPoints: { capacityMeshNodeId: "cmn_test" } }
  const child = {}
  const outer = profile.enter(parent, { owner: "ParentSolver", method: "step" })
  const inner = profile.enter(child, { owner: "ChildSolver", method: "step" })
  const inherited = profile.enter(child, { owner: "BaseSolver", method: "_step" })
  profile.exit(inherited)
  profile.exit(inner)
  profile.exit(outer)
  const result = profile.export()
  const totalSelfMs = result.methods.reduce((sum, method) => sum + method.selfMs, 0)
  expect(totalSelfMs).toBeCloseTo(result.methods[0]!.inclusiveMs, 6)
  expect(result.solvers[1]!.nodeId).toBe("cmn_test")
  expect(result.solvers[1]!.parentId).toBe(result.solvers[0]!.id)
  expect(result.solvers[1]!.inclusiveMs).toBe(result.methods[1]!.inclusiveMs)
})
