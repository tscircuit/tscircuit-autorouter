import { expect, test } from "bun:test"
import input from "../../fixtures/features/portpointpathing/tinyhypergraph-port-bridge-repro-input.json"
import { TinyHypergraphPortPointPathingSolver } from "../../lib/solvers/PortPointPathingSolver/tinyhypergraph/TinyHypergraphPortPointPathingSolver"

test("generic routing stays native by default and enabled feasible policy exposes finite benchmark activation and native continuation work", (): void => {
  type Params = ConstructorParameters<typeof TinyHypergraphPortPointPathingSolver>[0]
  const ordinary = new TinyHypergraphPortPointPathingSolver(structuredClone(input) as Params)
  ordinary.solve()
  expect(ordinary.solved).toBe(true)
  expect(ordinary.getSolveGraphBenchmarkMetrics()).not.toHaveProperty("feasibleOwnerCorridor")
  const params = structuredClone(input) as Params
  params.flags.USE_SELECTIVE_RERIP_ROUTING = true
  params.flags.USE_FEASIBLE_OWNER_CORRIDORS = true
  const enabled = new TinyHypergraphPortPointPathingSolver(params)
  enabled.solve()
  expect(enabled.solved).toBe(true)
  const metrics = enabled.getSolveGraphBenchmarkMetrics()!, counters = metrics.feasibleOwnerCorridor!
  expect(counters.feasibleOwner_enabled).toBe(1)
  expect(counters.feasibleOwner_installedSelectiveSolvers).toBeGreaterThan(0)
  expect(counters.feasibleOwner_nativeObservedSolverIterations).toBeGreaterThan(0)
  expect(counters.feasibleOwner_nativeObservedRouteAttempts).toBeGreaterThan(0)
  expect(enabled.stats.feasibleOwner_enabled).toBe(1)
  expect(enabled.stats.feasibleOwner_installedSelectiveSolvers).toBe(counters.feasibleOwner_installedSelectiveSolvers)
  for (const value of Object.values(counters)) expect(typeof value === "number" && Number.isFinite(value)).toBe(true)
  expect(enabled.getSolveGraphBenchmarkMetrics()!.feasibleOwnerCorridor).toEqual(counters)
  expect(counters.feasibleOwner_oldSearchCalls).toBe(0)
})
