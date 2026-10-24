import { expect, test } from "bun:test"
import { withDetailedWork, options, resetGrid, UniformLazy } from "./lazyPhysicalTestUtils"

test("lazy siblings share one native query, mutation is loud, and work includes deferred and final validation", () => withDetailedWork(() => {
  const solver = new UniformLazy(options())
  resetGrid(solver)
  solver.step()
  expect(solver.lazyPhysicalDiagnostics.lazySharedQueryBuilds).toBe(0)
  solver.step()
  solver.step()
  expect(solver.lazyPhysicalDiagnostics.lazyValidatedPlanar).toBe(2)
  expect(solver.lazyPhysicalDiagnostics.lazySharedQueryBuilds).toBe(1)
  expect(solver.lazyPhysicalDiagnostics.lazyPointQueryAdapters).toBe(2)
  expect(solver.MAX_ITERATIONS).toBe(10000)
  const d = solver.lazyPhysicalDiagnostics
  expect(d.lazyWorkUnits).toBe(Object.entries(d).reduce((s, [k, v]) => s + (k === "lazyInstances" || k === "lazyWorkUnits" ? 0 : v), 0))
  solver.obstacleMargin *= 2
  expect(() => solver.step()).toThrow("Lazy physical context changed")
  const rebuilt = new UniformLazy(options())
  expect(Reflect.get(rebuilt, "sceneRevision")).toBe(1)
  resetGrid(rebuilt)
  rebuilt.step()
  rebuilt.buildObstacleIndexes()
  expect(Reflect.get(rebuilt, "sceneRevision")).toBe(2)
  expect(() => rebuilt.step()).toThrow("Lazy physical context changed")
}))
