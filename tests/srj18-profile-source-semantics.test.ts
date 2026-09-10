import { expect, test } from "bun:test"
import { instrumentSolverSource } from "../scripts/srj18Profile/instrumentSolverSource"
import { SolverProfile } from "../scripts/srj18Profile/solverProfile"

test("profiling preserves inherited steps, empty methods, constructors and thrown errors", () => {
  const source = `
    class BaseSolver {
      iterations = 0;
      step() { this.iterations++; return this._step(); }
      _step() {}
    }
    class ChildSolver extends BaseSolver {
      constructor() { super(); this.nodeWithPortPoints = {capacityMeshNodeId: "node-a"}; }
      _step() { if (this.iterations === 2) throw new Error("original failure"); return 42; }
    }
    class ParentSolver extends BaseSolver {
      constructor() { super(); this.child = new ChildSolver(); }
      _step() { return this.child.step(); }
    }
    const parent = new ParentSolver();
    const first = parent.step();
    let error;
    try { parent.step(); } catch (caught) { error = caught.message; }
    new BaseSolver().step();
    return { first, error, iterations: parent.child.iterations };
  `
  const transformed = instrumentSolverSource({
    source,
    path: "example.js",
    runtimePath: "profile",
  })
  const profile = new SolverProfile()
  profile.enabled = true
  const actual = new Function(
    "__srj18Profile",
    transformed.contents.replace(/^import[^\n]+\n/, ""),
  )(profile)
  const expected = new Function(source)()
  expect(actual).toEqual(expected)
  expect(actual).toEqual({
    first: 42,
    error: "original failure",
    iterations: 2,
  })
  const records = profile.export()
  expect(records.solvers.some((solver) => solver.nodeId === "node-a")).toBe(
    true,
  )
  expect(
    records.methods
      .filter((method) => method.method === "step")
      .reduce((sum, method) => sum + method.calls, 0),
  ).toBe(5)
  expect(
    records.methods.every(
      (method) => method.selfMs >= 0 && method.inclusiveMs >= method.selfMs,
    ),
  ).toBe(true)
})
