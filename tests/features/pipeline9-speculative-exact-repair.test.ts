import { expect, spyOn, test } from "bun:test"
import { SolverRuntime } from "@tscircuit/solver-utils/runtime/bun"
import type { SolverRuntimeExecutor } from "@tscircuit/solver-utils"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { restoreSpeculativeConnectivityMap } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9SpeculativeExactRepairSolver"
import { Pipeline9JointDrcRepairSolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9JointDrcRepairSolver"
import { getConnectivityMapFromSimpleRouteJson } from "lib/utils/getConnectivityMapFromSimpleRouteJson"
import { createBoundedRegionalRepairFixture } from "../fixtures/pipeline9-bounded-regional-repair-fixture"

test("speculative exact repair preserves serial output and iteration budgets", async (): Promise<void> => {
  const merged = new ConnectivityMap({})
  merged.addConnections([["a"], ["b"], ["c"], ["b", "c"], ["a", "b"]])
  const restored = restoreSpeculativeConnectivityMap(
    structuredClone(merged.netMap),
    structuredClone(merged.idToNetMap),
  )
  expect(merged.areIdsConnected("a", "b")).toBe(true)
  expect(restored.areIdsConnected("a", "b")).toBe(true)
  expect(restored.getNetConnectedToId("c")).toBe(merged.getNetConnectedToId("c"))
  const fixture = createBoundedRegionalRepairFixture()
  const srj = fixture.originalSrj
  const params = {
    srj,
    srjWithPointPairs: srj,
    originalSrj: srj,
    newConnections: srj.connections,
    newHdRoutes: fixture.routes,
    updatedPreloadedTraces: [],
    mutatedPreloadedTraceIds: new Set<string>(),
    connMap: getConnectivityMapFromSimpleRouteJson(srj),
    obstacles: srj.obstacles,
    layerCount: srj.layerCount,
    defaultViaDiameter: 0.3,
    defaultViaHoleDiameter: 0.15,
    effort: 1,
    colorMap: {},
  }
  params.connMap.addConnections([["a"], ["b"], ["c"], ["b", "c"], ["a", "b"]])
  const makeSolver = (): Pipeline9JointDrcRepairSolver => {
    const solver = new Pipeline9JointDrcRepairSolver(params)
    const initial = solver.initialBoundedRegionalRepairSolver!
    const getResult = initial.getResult.bind(initial)
    spyOn(initial, "getResult").mockImplementation(() => ({
      ...getResult(),
      publishedDrcIssueCount: 1,
      repaired: false,
    }))
    return solver
  }
  const serial = makeSolver()
  serial.solve()
  expect(serial.solved).toBe(true)
  const runtime = new SolverRuntime({
    workerCount: 2,
    workerUrl: new URL("../../lib/runtime/bun.worker.ts", import.meta.url),
    requireWorker: true,
  })
  try {
    const parallel = makeSolver()
    await parallel.solveAsync(runtime)
    expect(parallel.solved).toBe(true)
    expect(parallel.stats.speculativeExactRepairDispatched).toBe(1)
    expect(parallel.stats.speculativeExactRepairAccepted).toBe(true)
    expect(parallel.getOutput()).toEqual(serial.getOutput())
    expect(parallel.iterations).toBe(serial.iterations)
    expect(parallel.exactRepairSolver!.visualize()).toEqual(serial.exactRepairSolver!.visualize())

    const probe = makeSolver()
    while (!probe.exactRepairSolver && !probe.failed) probe.step()
    const paused = makeSolver()
    const limit = probe.iterations + 1
    await paused.solveAsync(runtime, limit)
    expect(paused.iterations).toBe(limit)
    await paused.solveAsync(runtime)
    expect(paused.solved).toBe(true)
    expect(paused.getOutput()).toEqual(serial.getOutput())
    expect(paused.iterations).toBe(serial.iterations)

    const resumed = makeSolver()
    await resumed.solveAsync(runtime, 1)
    expect(resumed.stats.speculativeExactRepairDispatched).toBe(1)
    await resumed.solveAsync(runtime)
    expect(resumed.solved).toBe(true)
    expect(resumed.stats.speculativeExactRepairDispatched).toBe(1)
    expect(resumed.getOutput()).toEqual(serial.getOutput())

    const staged = makeSolver()
    await staged.solveAsync(runtime, probe.iterations)
    expect(staged.exactRepairSolver).toBeDefined()
    expect(staged.exactRepairSolver!.iterations).toBe(0)
    await staged.solveAsync(runtime)
    expect(staged.stats.speculativeExactRepairAccepted).toBe(true)
    expect(staged.stats.speculativeExactRepairDispatched).toBe(1)
    expect(staged.getOutput()).toEqual(serial.getOutput())

    const early = new Pipeline9JointDrcRepairSolver(params)
    await early.solveAsync(runtime)
    expect(early.solved).toBe(true)
    expect(early.stats.initialBoundedRegionalRepairAccepted).toBe(true)
    expect(early.stats.speculativeExactRepairAccepted).toBeUndefined()

    const failing = makeSolver()
    const failedRuntime = {
      executeAsync: () => Promise.reject(new Error("worker failed")),
    } as unknown as SolverRuntimeExecutor
    await expect(failing.solveAsync(failedRuntime)).rejects.toThrow("worker failed")
    expect(failing.failed).toBe(true)
  } finally {
    await runtime.dispose()
  }
})
