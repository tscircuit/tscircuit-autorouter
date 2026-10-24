import { expect, test } from "bun:test"
import { withDetailedWork, Native, options, resetGrid, UniformLazy, explicitGraphOracle } from "./lazyPhysicalTestUtils"

test("depth-one lazy search agrees with independently enumerated static graphs and checks every emitted edge", () => withDetailedWork(() => {
  for (let mask = 0; mask < 32; mask++) {
    const obstacleRoutes = Array.from({ length: 5 }, (_, i) => i).filter((i) => mask & (1 << i)).map((i) => ({
      connectionName: `wall${i}`, traceThickness: 0.08, viaDiameter: 0.3, vias: [],
      route: [{ x: 1.5 + (i % 3), y: 1.3 + Math.floor(i / 3) * 2, z: 0 },
        { x: 1.5 + (i % 3), y: 2.3 + Math.floor(i / 3) * 2, z: 0 }],
    }))
    const opts = options({ obstacleRoutes })
    const solver = new UniformLazy(opts), checker = new Native(opts)
    resetGrid(solver)
    resetGrid(checker)
    const expected = explicitGraphOracle(checker)
    solver.solve()
    expect(solver.solved).toBe(expected !== undefined)
    if (expected === undefined) continue
    expect(solver.acceptedG).toBeCloseTo(expected, 10)
    expect(solver.solvedPath!.rootConnectionName).toBe("root")
    expect(solver.solvedPath!.regionId).toBe("region")
    const path = solver.solvedPath!.route
    expect(path[0]).toEqual(opts.A)
    expect(path.at(-1)).toEqual(opts.B)
    for (let i = 1; i < path.length; i++) {
      const parent = { ...path[i - 1], parent: null, g: 0, h: 0, f: 0 }
      const node = { ...path[i], parent, g: 0, h: 0, f: 0 }
      expect(checker.doesPathToParentIntersectObstacle(node)).toBe(false)
      if (i < path.length - 1) expect(checker.isNodeTooCloseToObstacle(node)).toBe(false)
    }
    expect(solver.lazyPhysicalDiagnostics.lazyWitnessEdges).toBeGreaterThan(0)
  }
}))
