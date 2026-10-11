import { expect, test } from "bun:test"
import input from "../../fixtures/features/portpointpathing/tinyhypergraph-port-bridge-repro-input.json"
import { ParallelPortPointPathingSolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/ParallelPortPointPathingSolver"
import { TinyHypergraphPortPointPathingSolver, TinyHyperGraphSectionPipelineWithTerminalNetIds } from "lib/solvers/PortPointPathingSolver/tinyhypergraph/TinyHypergraphPortPointPathingSolver"
import { initializeReferenceDrcRuntime } from "lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/authoritative-drc-fork/initializeReferenceDrcRuntime"
import { getTinyNativeSynchronousScope } from "lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/pathingWasm/TinyNativeSynchronousScope"
import { TinyRegionCostMemo } from "lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/TinyRegionCostMemo"
import { TinyIndexedSelectiveReripHyperGraphSolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/TinyIndexedSelectiveReripHyperGraphSolver"

type Host = any
function params(): Host {
  const result: Host = structuredClone(input)
  result.flags.USE_SELECTIVE_RERIP_ROUTING = true
  result.graph.ports[0].d.tinyHypergraphPortPenalty = 0.1
  return result
}
function core(solver: Host): Host { return solver.tinyPipelineSolver.getSolver("solveGraph") }
function snapshot(solver: Host): unknown {
  const child = core(solver), { candidateQueue, ...state } = child.state
  return { iterations: solver.iterations, solved: solver.solved, failed: solver.failed, error: solver.error,
    output: solver.getOutput(), state, stats: child.stats, queueLength: candidateQueue.length,
    childIterations: child.iterations, childCap: child.MAX_ITERATIONS, childSolved: child.solved }
}

test("synchronous native scope retains observer calls, exceptions, cleanup and positive admission", async (): Promise<void> => {
  await initializeReferenceDrcRuntime()
  const serial = new TinyHypergraphPortPointPathingSolver(params())
  const pristine = new ParallelPortPointPathingSolver(params())
  serial.solve(); pristine.solve()
  expect(snapshot(pristine)).toEqual(snapshot(serial))
  const kernel = core(pristine).wasmNeighborKernel
  expect(kernel.diagnostics.batches).toBeGreaterThan(0)
  expect(kernel.diagnostics.scoringBatches).toBe(kernel.diagnostics.batches)
  expect(kernel.diagnostics.scoredCandidates).toBeGreaterThan(0)
  expect(kernel.validatedScope.diagnostics.trustedBatches).toBe(kernel.diagnostics.batches)
  expect(kernel.validatedScope.diagnostics.childChecks).toBe(1)
  expect(kernel.validatedScope.open).toBe(false)
  expect(kernel.validatedScope.active).toBe(false)
  expect(kernel.validatedScope.finished).toBe(true)
  expect(getTinyNativeSynchronousScope(pristine)).toBeUndefined()

  const variants = ["progress", "progressGetter", "policyGetter", "factory", "pipelinePrototype", "Date.now",
    "regionProxy", "pipelineProxy", "rootProxy", "typedBufferGetter", "typedLengthGetter", "costMemo", "childPrototype", "strategyGetter", "statsGetter", "kernelGetter", "kernelCallback"] as const
  for (const variant of variants) {
    const native: Host = new TinyHypergraphPortPointPathingSolver(params())
    const packed: Host = new ParallelPortPointPathingSolver(params())
    const hosts = [native, packed], events: string[][] = [[], []]
    let active = -1, restore: (() => void) | undefined
    const add = (index: number, message: string): void => { events[index]!.push(message) }
    if (variant === "progress" || variant === "progressGetter" || variant === "strategyGetter") for (let index = 0; index < hosts.length; index++) {
      const solver = hosts[index]!, callback = (): number => {
        add(index, "progress")
        const child = core(solver)
        if (child) { for (let port = 0; port < child.topology.portX.length; port++) child.topology.portX[port] += 0.03 }
        return 0.5
      }
      if (variant !== "progressGetter") solver.computeProgress = callback
      else Object.defineProperty(solver, "computeProgress", { configurable: true, get(): unknown {
        add(index, "getProgress"); return callback
      } })
    }
    if (variant === "strategyGetter") Object.defineProperty(packed, "pathingStrategy", { configurable: true, get(): string { add(1, "strategy"); return "indexed" } })
    if (variant === "statsGetter") for (let index = 0; index < hosts.length; index++) Object.defineProperty(hosts[index]!, "stats", { configurable: true, get(): unknown { add(index, "stats"); return {} } })
    if (variant === "factory") for (let index = 0; index < hosts.length; index++) {
      const stage = hosts[index]!.tinyPipelineSolver.pipelineDef.find((step: Host) => step.solverName === "solveGraph")
      const original = stage.getConstructorParams
      stage.getConstructorParams = function (...args: Host[]): Host {
        add(index, "factory"); return original.apply(this, args)
      }
    }
    if (variant === "pipelinePrototype") {
      const host: Host = TinyHyperGraphSectionPipelineWithTerminalNetIds.prototype, original = host._step
      host._step = function (...args: Host[]): Host { add(active, "pipelineStep"); return original.apply(this, args) }
      restore = (): void => { host._step = original }
    }
    if (variant === "Date.now") {
      const original = Date.now
      Date.now = (): number => { add(active, "now"); return 123 }
      restore = (): void => { Date.now = original }
    }
    if (["policyGetter", "typedBufferGetter", "typedLengthGetter", "costMemo", "childPrototype", "strategyGetter", "statsGetter", "kernelGetter", "kernelCallback"].includes(variant)) {
      for (const solver of hosts) while (!core(solver)) solver.step()
      if (variant === "policyGetter") for (let index = 0; index < hosts.length; index++) {
        const child = core(hosts[index]!), value = child.DISTANCE_TO_COST
        Object.defineProperty(child, "DISTANCE_TO_COST", { configurable: true, get(): number {
          add(index, "scale"); return value
        } })
      }
      if (variant === "typedBufferGetter" || variant === "typedLengthGetter") for (let index = 0; index < hosts.length; index++) {
        const vector = core(hosts[index]!).topology.portX, name = variant === "typedBufferGetter" ? "buffer" : "length"
        const value = vector[name]
        Object.defineProperty(vector, name, { configurable: true, get(): unknown { add(index, name); return value } })
      }
      if (variant === "kernelGetter" || variant === "kernelCallback") {
        for (const solver of hosts) core(solver).setup()
        const child = core(packed), kernel = child.wasmNeighborKernel
        if (variant === "kernelGetter") Object.defineProperty(child, "wasmNeighborKernel", { configurable: true, get(): unknown { add(1, "kernel"); return kernel } })
        else { const original = kernel.updateBest; kernel.updateBest = function (...args: Host[]): unknown { add(1, "kernelUpdate"); return original.apply(this, args) } }
      }
      if (variant === "costMemo") {
        const child = core(packed), memo = child.regionCostMemo as TinyRegionCostMemo, original = memo.get
        // The memo is prototype-owned in the packed implementation. The public
        // callback is declined, then the original callback is still visited.
        memo.get = function (...args): number { add(1, "memo"); return original.apply(this, args) }
      }
      if (variant === "childPrototype") {
        const host: Host = TinyIndexedSelectiveReripHyperGraphSolver.prototype, original = host.computeH, originalDescriptor = Object.getOwnPropertyDescriptor(host, "computeH")
        host.computeH = function (...args: Host[]): Host { add(1, "h"); return original.apply(this, args) }
        restore = (): void => { if (originalDescriptor) Object.defineProperty(host, "computeH", originalDescriptor); else delete host.computeH }
      }
    }
    if (variant === "regionProxy" || variant === "pipelineProxy" || variant === "rootProxy") for (let index = 0; index < hosts.length; index++) {
      const target = variant === "regionProxy" ? hosts[index]!.params.graph.regions[0].d : variant === "pipelineProxy" ? hosts[index]!.tinyPipelineSolver : hosts[index]!
      const proxy = new Proxy(target, {
        get(object, key, receiver): unknown { add(index, `get:${String(key)}`); return Reflect.get(object, key, receiver) },
        ownKeys(object): ArrayLike<string | symbol> { add(index, "keys"); return Reflect.ownKeys(object) },
        getOwnPropertyDescriptor(object, key): PropertyDescriptor | undefined {
          add(index, `descriptor:${String(key)}`); return Reflect.getOwnPropertyDescriptor(object, key)
        },
        getPrototypeOf(object): object | null { add(index, "prototype"); return Reflect.getPrototypeOf(object) },
      })
      if (variant === "regionProxy") hosts[index]!.params.graph.regions[0].d = proxy
      else if (variant === "pipelineProxy") {
        hosts[index]!.tinyPipelineSolver = proxy
        if (index === 1) hosts[index]!.createdTinyPipeline = proxy
      } else hosts[index] = proxy
    }
    try {
      active = 0; hosts[0]!.solve()
      active = 1; hosts[1]!.solve()
      active = -1
      // The parallel wrapper's proxy property reads differ from its serial
      // parent; reflection traps introduced solely by admission must remain 0.
      if (variant === "rootProxy") {
        expect(events[1]!.filter((entry) => entry === "keys" || entry === "prototype" || entry.startsWith("descriptor:"))).toEqual(events[0]!.filter((entry) => entry === "keys" || entry === "prototype" || entry.startsWith("descriptor:")))
      } else if (!["costMemo", "childPrototype", "strategyGetter", "kernelGetter", "kernelCallback"].includes(variant)) expect(events[1]).toEqual(events[0])
      if (variant === "strategyGetter") expect(events[1]!.filter((entry) => entry === "progress")).toEqual(events[0]!.filter((entry) => entry === "progress"))
      expect(snapshot(packed)).toEqual(snapshot(native))
      expect(getTinyNativeSynchronousScope(packed)).toBeUndefined()
      const customKernel = core(packed).wasmNeighborKernel
      expect(customKernel?.validatedScope).toBeUndefined()
      if (customKernel) expect(customKernel.diagnostics.batches).toBe(0)
      if (["costMemo", "childPrototype", "strategyGetter", "kernelGetter", "kernelCallback"].includes(variant)) expect(events[1]!.length).toBeGreaterThan(0)
    } finally { active = -1; restore?.() }
  }

  // Exceptions from original pipeline callbacks keep identity and error state.
  for (const packed of [false, true]) {
    const solver: Host = packed ? new ParallelPortPointPathingSolver(params()) : new TinyHypergraphPortPointPathingSolver(params())
    const error = new RangeError("original factory failure")
    const stage = solver.tinyPipelineSolver.pipelineDef.find((step: Host) => step.solverName === "solveGraph")
    stage.getConstructorParams = (): never => { throw error }
    let received: unknown
    try { solver.solve() } catch (caught) { received = caught }
    expect(received).toBe(error)
    expect(solver.failed).toBe(true)
    expect(getTinyNativeSynchronousScope(solver)).toBeUndefined()
  }
})
