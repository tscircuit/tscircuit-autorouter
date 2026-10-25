import { expect, test } from "bun:test"
import { ReverseCostToGoCache } from "lib/solvers/HighDensitySolver/ReverseCostToGoCache"
import { SingleHighDensityRouteSolver6_VertHorzLayer_FutureCost as Native } from "lib/solvers/HighDensitySolver/SingleHighDensityRouteSolver6_VertHorzLayer_FutureCost"
import { reversePotentialCapturedNode140Options } from "../fixtures/reversePotentialCapturedNode140"

test("a captured production native task uses stronger direction-aware reverse guidance and reuses its exact context before recompiling", () => {
  const diagnostics: Record<string, number> = {}
  const cache = new ReverseCostToGoCache(diagnostics)
  const options = { ...reversePotentialCapturedNode140Options, reversePotentialCache: cache }
  const solver = new Native(options)
  solver.solve()
  expect(solver.solved).toBe(true)
  expect(solver.error).toBeNull()
  expect(solver.solvedPath!.route[0]).toMatchObject(solver.A)
  expect(solver.solvedPath!.route.at(-1)).toMatchObject(solver.B)
  expect(diagnostics.reversePotentialStrengthenedQueries).toBeGreaterThan(0)
  expect(diagnostics.reversePotentialQueries).toBeGreaterThan(0)
  expect(diagnostics.reversePotentialBuilds).toBe(1)
  const compiled = diagnostics.reversePotentialCompiledCells
  const repaired = diagnostics.reversePotentialRepairWork
  const repeated = new Native(options)
  repeated.prepareReversePotential()
  expect(diagnostics.reversePotentialCacheHits).toBe(1)
  expect(diagnostics.reversePotentialCompiledCells).toBe(compiled)
  expect(diagnostics.reversePotentialRepairWork).toBe(repaired)
  expect(diagnostics.reversePotentialCompileWork! + diagnostics.reversePotentialRepairWork!).toBeLessThanOrEqual(200_000)
})
