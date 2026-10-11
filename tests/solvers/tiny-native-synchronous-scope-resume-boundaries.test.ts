import { expect, test } from "bun:test"
import input from "../../fixtures/features/portpointpathing/tinyhypergraph-port-bridge-repro-input.json"
import { TinyHyperGraphSectionSolver } from "tiny-hypergraph/lib/index"
import { ParallelPortPointPathingSolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/ParallelPortPointPathingSolver"
import { TinyHypergraphPortPointPathingSolver } from "lib/solvers/PortPointPathingSolver/tinyhypergraph/TinyHypergraphPortPointPathingSolver"
import { initializeReferenceDrcRuntime } from "lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/authoritative-drc-fork/initializeReferenceDrcRuntime"
import { attachOwnedTinyKernelScope } from "lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/pathingWasm/createTinyOrderedNeighborKernel"
import { beginTinyNativeSynchronousScope, endTinyNativeSynchronousScope, getTinyNativeSynchronousScope,
  isTinyNativeFallbackRun } from "lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/pathingWasm/TinyNativeSynchronousScope"

type Host = any
function params(): Host {
  const result: Host = structuredClone(input)
  result.flags.USE_SELECTIVE_RERIP_ROUTING = true
  result.graph.ports[0].d.tinyHypergraphPortPenalty = 0.1
  return result
}
function core(solver: Host): Host { return solver.tinyPipelineSolver.getSolver("solveGraph") }
function observe(solver: Host): unknown {
  const child = core(solver), { candidateQueue, ...state } = child.state
  return { output: solver.getOutput(), iterations: solver.iterations, solved: solver.solved,
    failed: solver.failed, error: solver.error, state, childStats: child.stats,
    childIterations: child.iterations, childCap: child.MAX_ITERATIONS, queue: candidateQueue.length }
}

test("resumed searches scope only verified children and pause before future stages or greedy factories", async (): Promise<void> => {
  await initializeReferenceDrcRuntime()
  for (const mode of ["setup", "search", "finishedGraph"] as const) {
    const native: Host = new TinyHypergraphPortPointPathingSolver(params())
    const packed: Host = new ParallelPortPointPathingSolver(params())
    while (!core(native)) { native.step(); packed.step() }
    if (mode === "setup") { core(native)._setup(); core(packed)._setup() }
    if (mode === "search") { native.step(); packed.step() }
    if (mode === "finishedGraph") while (!core(native).solved) { native.step(); packed.step() }
    native.solve(); packed.solve()
    expect(observe(packed)).toEqual(observe(native))
    const scope = core(packed).wasmNeighborKernel?.validatedScope
    if (mode !== "finishedGraph") {
      expect(scope?.diagnostics.trustedBatches).toBeGreaterThan(0)
      expect(scope?.finished).toBe(true)
      expect(scope?.active).toBe(false)
    }
    expect(getTinyNativeSynchronousScope(packed)).toBeUndefined()
    expect(isTinyNativeFallbackRun()).toBe(false)
  }

  const packed: Host = new ParallelPortPointPathingSolver(params())
  const native: Host = new TinyHypergraphPortPointPathingSolver(params())
  const original = TinyHyperGraphSectionSolver.prototype.getOutput
  const seen: Array<{ open: boolean; active: boolean; paused: boolean }> = []
  TinyHyperGraphSectionSolver.prototype.getOutput = function (...args): any {
    const scope = getTinyNativeSynchronousScope(packed)
    if (scope) seen.push({ open: scope.open, active: scope.active, paused: scope.paused })
    return Reflect.apply(original, this, args)
  }
  try {
    native.solve(); packed.solve()
    expect(observe(packed)).toEqual(observe(native))
    expect(core(packed).wasmNeighborKernel.validatedScope.diagnostics.trustedBatches).toBeGreaterThan(0)
    expect(seen.length).toBeGreaterThan(0)
    for (const phase of seen) expect(phase).toEqual({ open: false, active: false, paused: true })
  } finally { TinyHyperGraphSectionSolver.prototype.getOutput = original }

  // Factory attempt >=0 selects the unchanged native greedy class and caps,
  // but ends the trusted interval before the unverified constructor executes.
  const root: Host = new ParallelPortPointPathingSolver(params())
  while (!core(root)) root.step()
  const child: Host = core(root)
  child._setup()
  const scope = beginTinyNativeSynchronousScope(root)!
  expect(scope).toBeDefined()
  attachOwnedTinyKernelScope(child.topology, child.problem, scope)
  child.step()
  expect(scope.active).toBe(true)
  const bestAlias = child.state.candidateBestCostByHopId
  const greedy = child.createGreedyFinalRouteSolver({ MAX_ITERATIONS: 73 }, 0)
  expect(greedy.MAX_ITERATIONS).toBe(73)
  expect(scope.open).toBe(false)
  expect(scope.paused).toBe(true)
  expect(scope.active).toBe(false)
  endTinyNativeSynchronousScope(root, scope)
  expect(getTinyNativeSynchronousScope(root)).toBeUndefined()
  expect(scope.finished).toBe(true)
  const batches = child.wasmNeighborKernel.diagnostics.batches
  // Direct, externally driven steps after finally return to strict per-batch
  // checks. The ended token does not leave the child permanently trusted.
  while (!child.solved && !child.failed) child.step()
  expect(child.wasmNeighborKernel.diagnostics.batches).toBeGreaterThan(batches)
  expect(child.state.candidateBestCostByHopId).toBe(bestAlias)
  expect(child.wasmNeighborKernel.diagnostics.disabledReason).toBe("")
})
