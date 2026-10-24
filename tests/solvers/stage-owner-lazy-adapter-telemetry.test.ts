import { expect, test } from "bun:test"
import input from "../../fixtures/features/portpointpathing/tinyhypergraph-port-bridge-repro-input.json"
import { TinyHypergraphPortPointPathingSolver } from "../../lib/solvers/PortPointPathingSolver/tinyhypergraph/TinyHypergraphPortPointPathingSolver"

test("new option defaults off and enabled adapter exposes collected numeric benchmark activation", (): void => {
  type Params = ConstructorParameters<typeof TinyHypergraphPortPointPathingSolver>[0]
  const ordinary = new TinyHypergraphPortPointPathingSolver(structuredClone(input) as Params)
  ordinary.solve()
  expect(ordinary.solved).toBe(true)
  expect(ordinary.getSolveGraphBenchmarkMetrics()).not.toHaveProperty("lazyOwnerRelease")
  const params = structuredClone(input) as Params
  params.flags.USE_SELECTIVE_RERIP_ROUTING = true
  params.flags.USE_LAZY_MINIMUM_OWNER_RELEASE = true
  const enabled = new TinyHypergraphPortPointPathingSolver(params)
  enabled.solve()
  expect(enabled.solved).toBe(true)
  const metrics = enabled.getSolveGraphBenchmarkMetrics()!
  expect(metrics.lazyOwnerRelease!.lazyOwnerRelease_enabled).toBe(1)
  expect(metrics.lazyOwnerRelease!.lazyOwnerRelease_installedSelectiveSolvers).toBeGreaterThan(0)
  expect(enabled.stats.lazyOwnerRelease_enabled).toBe(1)
  expect(enabled.stats.lazyOwnerRelease_installedSelectiveSolvers).toBe(metrics.lazyOwnerRelease!.lazyOwnerRelease_installedSelectiveSolvers)
  for (const value of Object.values(metrics.lazyOwnerRelease!)) expect(typeof value === "number" && Number.isFinite(value)).toBe(true)
})
