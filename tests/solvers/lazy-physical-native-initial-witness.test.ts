import { expect, test } from "bun:test"
import { Native, options } from "./lazyPhysicalTestUtils"
import { LazyPhysicalSingleHighDensityRouteSolver as Lazy } from "lib/solvers/HighDensitySolver/LazyPhysicalSingleHighDensityRouteSolver"

test("native rounded/exact starts and terminal boundary markers are retained and the final chain is checked", () => {
  for (const A of [{ x: 0, y: 1, z: 0 }, { x: 0.003, y: 1.007, z: 0 }, { x: 1.013, y: 1.019, z: 0 }]) {
    const opts = options({ A })
    const solver = new Lazy(opts), checker = new Native(opts)
    expect(solver.candidates.peek()).toEqual(checker.candidates.peek())
    solver.solve()
    expect(solver.solved).toBe(true)
    expect(solver.solvedPath!.route[0]).toEqual(A)
    expect(solver.solvedPath!.route.at(-1)).toEqual(opts.B)
    expect(solver.lazyPhysicalDiagnostics.lazyGoalChecks).toBeGreaterThan(0)
    for (let i = 1; i < solver.solvedPath!.route.length; i++) {
      const parent = { ...solver.solvedPath!.route[i - 1], parent: null, g: 0, h: 0, f: 0 }
      const child = { ...solver.solvedPath!.route[i], parent, g: 0, h: 0, f: 0 }
      expect(checker.doesPathToParentIntersectObstacle(child)).toBe(false)
    }
  }
})
