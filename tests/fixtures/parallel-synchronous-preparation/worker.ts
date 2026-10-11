import { deepStrictEqual, strictEqual } from "node:assert"
import { ParallelPortfolioSingleIntraNodeSolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/ParallelPortfolioSingleIntraNodeSolver"
import { ReplayHighDensityA01Solver } from "lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/ReplayHighDensityA01Solver"
import { ReplayMultiHeadPolyLineSolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/ReplayMultiHeadPolyLineSolver"
import { initializeWorkerNativeGridRuntime, hasWorkerNativeGridRuntime } from "lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/workerNativeGridRuntime"
import { registerWorkerNativeGridKernelDispatcher, isWorkerNativeGridKernelQuantumActive } from "lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/workerNativeGridKernelQuantum"
import type { GridHistoryDispatcher, GridHistoryResult } from "lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/parallelGridHistoryTypes"
import type { MultiHeadHistoryResult } from "lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/parallelMultiHeadHistoryTypes"
import type { NodeWithPortPoints } from "lib/types/high-density-types"
import cmn45 from "../parallel-grid-history-cmn45.json"
import { InMemoryCache } from "lib/cache/InMemoryCache"

type Portfolio = ParallelPortfolioSingleIntraNodeSolver
const define = Object.defineProperty
const caches = new WeakMap<Portfolio, InMemoryCache>()
function activateCache(portfolio: Portfolio): void {
  globalThis.TSCIRCUIT_AUTOROUTER_IN_MEMORY_CACHE = caches.get(portfolio)!
}
function setField(object: object, name: string, value: unknown): void {
  define(object, name, { configurable: true, enumerable: true, writable: true, value })
}

function createPortfolio(firstValid = false): Portfolio {
  const cache = new InMemoryCache()
  globalThis.TSCIRCUIT_AUTOROUTER_IN_MEMORY_CACHE = cache
  const dispatcher: GridHistoryDispatcher = async (): Promise<Map<number, Promise<GridHistoryResult>>> => new Map()
  registerWorkerNativeGridKernelDispatcher(dispatcher)
  const portfolio = new ParallelPortfolioSingleIntraNodeSolver({ nodeWithPortPoints: structuredClone(cmn45) as NodeWithPortPoints,
    viaDiameter: .3, traceWidth: .1 }, async (): Promise<Map<number, Promise<MultiHeadHistoryResult>>> => new Map(),
    { policy: firstValid ? "first-valid" : "ordered", gridHistoryDispatcher: dispatcher })
  caches.set(portfolio, cache)
  return portfolio
}

function snapshot(portfolio: Portfolio): object {
  return { iterations: portfolio.iterations, maxIterations: portfolio.MAX_ITERATIONS,
    solved: portfolio.solved, failed: portfolio.failed, error: portfolio.error, progress: portfolio.progress,
    stats: portfolio.stats,
    candidates: portfolio.supervisedSolvers?.map((row): object => ({ f: row.f, g: row.g, h: row.h,
      type: row.solver.constructor.name, iterations: row.solver.iterations, maxIterations: row.solver.MAX_ITERATIONS,
      solved: row.solver.solved, failed: row.solver.failed, error: row.solver.error,
      progress: row.solver.progress, stats: row.solver.stats })),
    routes: portfolio.solved ? portfolio.solvedRoutes : undefined }
}

async function selectA01(portfolio: Portfolio): Promise<ReplayHighDensityA01Solver> {
  activateCache(portfolio)
  await portfolio.prepareForNextStep()
  const row = portfolio.supervisedSolvers!.find((entry): boolean => entry.solver instanceof ReplayHighDensityA01Solver)!
  strictEqual(row !== undefined, true)
  portfolio.supervisedSolvers = [row]
  row.f = 0
  // The isolated proof keeps this native request predicate false; production
  // readiness itself separately tests its exact1000/16 thresholds below.
  setField(portfolio, "lastGridRequestIteration", Infinity)
  return row.solver as unknown as ReplayHighDensityA01Solver
}

async function runParity(): Promise<object> {
  await initializeWorkerNativeGridRuntime()
  strictEqual(hasWorkerNativeGridRuntime(), true)
  const native = createPortfolio(), synchronous = createPortfolio()
  strictEqual(synchronous.tryPrepareForNextStepSynchronously(), false, "native initialization remains original async preparation")
  activateCache(native)
  await native.prepareForNextStep()
  activateCache(synchronous)
  await synchronous.prepareForNextStep()
  deepStrictEqual(snapshot(synchronous), snapshot(native))
  let syncPreparations = 0, nativeAwaitPreparations = 0, checkpoints = 0
  for (let prefix = 0; prefix < 32 && !native.solved && !native.failed; prefix++) {
    activateCache(native)
    await native.prepareForNextStep()
    activateCache(synchronous)
    if (synchronous.tryPrepareForNextStepSynchronously()) syncPreparations++
    else { nativeAwaitPreparations++; await synchronous.prepareForNextStep() }
    activateCache(native)
    native.step()
    activateCache(synchronous)
    synchronous.step()
    deepStrictEqual(snapshot(synchronous), snapshot(native))
    checkpoints++
  }

  const nativeGridPortfolio = createPortfolio(), syncGridPortfolio = createPortfolio()
  const nativeGrid = await selectA01(nativeGridPortfolio), syncGrid = await selectA01(syncGridPortfolio)
  for (let prefix = 0; prefix < 24 && !nativeGridPortfolio.solved && !nativeGridPortfolio.failed; prefix++) {
    await nativeGridPortfolio.prepareForNextStep()
    strictEqual(syncGridPortfolio.tryPrepareForNextStepSynchronously(), true)
    nativeGridPortfolio.step()
    syncGridPortfolio.step()
    strictEqual(isWorkerNativeGridKernelQuantumActive(syncGrid), false, "no quantum is retained after an original100-step call")
    deepStrictEqual(snapshot(syncGridPortfolio), snapshot(nativeGridPortfolio))
    deepStrictEqual(syncGrid.getOutput(), nativeGrid.getOutput())
    deepStrictEqual(syncGrid.gridStats, nativeGrid.gridStats)
    checkpoints++
    syncPreparations++
  }
  setField(syncGridPortfolio, "lastGridRequestIteration", -Infinity)
  strictEqual(syncPreparations > 0, true)
  const originalIterations = syncGrid.iterations
  syncGrid.iterations = 999
  strictEqual(syncGridPortfolio.tryPrepareForNextStepSynchronously(), true)
  syncGrid.iterations = 1000
  strictEqual(syncGridPortfolio.tryPrepareForNextStepSynchronously(), false, "due idle grant is a real async path")
  syncGrid.iterations = originalIterations
  setField(syncGridPortfolio, "lastGridRequestIteration", Infinity)
  setField(syncGridPortfolio, "adaptiveSearchExpanded", true)
  strictEqual(syncGridPortfolio.tryPrepareForNextStepSynchronously(), false)
  setField(syncGridPortfolio, "adaptiveSearchExpanded", false)
  const penalty = Object.getOwnPropertyDescriptor(syncGrid, "initialPenaltyFn")!
  setField(syncGrid, "initialPenaltyFn", (): number => 0)
  strictEqual(syncGridPortfolio.tryPrepareForNextStepSynchronously(), false)
  define(syncGrid, "initialPenaltyFn", penalty)

  const historyPortfolio = createPortfolio()
  await historyPortfolio.prepareForNextStep()
  const historySolver = new ReplayMultiHeadPolyLineSolver({ nodeWithPortPoints: structuredClone(cmn45) as NodeWithPortPoints,
    viaDiameter: .3, hyperParameters: {} })
  historyPortfolio.supervisedSolvers = [{ solver: historySolver as never, f: 0, g: 0, h: 0, hyperParameters: {} }]
  setField(historyPortfolio, "requestedAtSelection", true)
  strictEqual(historyPortfolio.tryPrepareForNextStepSynchronously(), true)
  const initial = { iterations: 0, maxIterations: historySolver.MAX_ITERATIONS, solved: false, failed: false,
    error: historySolver.error, progress: historySolver.progress }
  const history: MultiHeadHistoryResult = { kind: "multiHeadHistory", initial, steps: [], solvedRoutes: [] }
  historySolver.setHistoryRequest(Promise.resolve(history))
  await Promise.resolve()
  strictEqual(historyPortfolio.tryPrepareForNextStepSynchronously(), false, "fulfilled history must still be installed by native async validation")
  await historyPortfolio.prepareForNextStep()
  strictEqual(historyPortfolio.tryPrepareForNextStepSynchronously(), true)

  const failureSolver = new ReplayMultiHeadPolyLineSolver({ nodeWithPortPoints: structuredClone(cmn45) as NodeWithPortPoints,
    viaDiameter: .3, hyperParameters: {} })
  const sentinel = new RangeError("selected original history failure")
  failureSolver.setHistoryRequest(Promise.reject(sentinel))
  historyPortfolio.supervisedSolvers![0]!.solver = failureSolver as never
  await Promise.resolve()
  strictEqual(historyPortfolio.tryPrepareForNextStepSynchronously(), false)
  let error: unknown
  try { await historyPortfolio.prepareForNextStep() } catch (caught: unknown) { error = caught }
  strictEqual(error, sentinel)

  const invalidSolver = new ReplayMultiHeadPolyLineSolver({ nodeWithPortPoints: structuredClone(cmn45) as NodeWithPortPoints,
    viaDiameter: .3, hyperParameters: {} })
  invalidSolver.setHistoryRequest(Promise.resolve({ ...history, initial: { ...initial, maxIterations: -1 } }))
  historyPortfolio.supervisedSolvers![0]!.solver = invalidSolver as never
  await Promise.resolve()
  strictEqual(historyPortfolio.tryPrepareForNextStepSynchronously(), false)
  try { await historyPortfolio.prepareForNextStep() } catch (caught: unknown) { error = caught }
  strictEqual(error instanceof Error && error.message.includes("initial solver state"), true)

  let prototypeTraps = 0
  const proxyPrototype = new Proxy(Object.create(null) as object, { getPrototypeOf(): never {
    prototypeTraps++; throw sentinel
  } })
  for (let depth = 0; depth < 2; depth++) {
    const solver = { solved: false, failed: false, iterations: 0, progress: 0, MAX_ITERATIONS: 1 }
    Object.setPrototypeOf(solver, depth === 0 ? proxyPrototype : Object.create(proxyPrototype))
    historyPortfolio.supervisedSolvers![0]!.solver = solver as never
    strictEqual(historyPortfolio.tryPrepareForNextStepSynchronously(), false)
    strictEqual(prototypeTraps, depth)
    try { await historyPortfolio.prepareForNextStep() } catch (caught: unknown) { error = caught }
    strictEqual(error, sentinel)
    strictEqual(prototypeTraps, depth + 1)
  }

  const math = Object.getOwnPropertyDescriptor(Math, "min")!
  let getterCalls = 0
  try {
    define(Math, "min", { configurable: true, get(): never { getterCalls++; throw sentinel } })
    strictEqual(syncGridPortfolio.tryPrepareForNextStepSynchronously(), false)
    strictEqual(getterCalls, 0)
  } finally { define(Math, "min", math) }
  let classObserverCalls = 0
  try {
    define(ReplayMultiHeadPolyLineSolver, Symbol.hasInstance, { configurable: true, get(): never {
      classObserverCalls++; throw sentinel
    } })
    strictEqual(syncGridPortfolio.tryPrepareForNextStepSynchronously(), false)
    strictEqual(classObserverCalls, 0)
    try { await syncGridPortfolio.prepareForNextStep() } catch (caught: unknown) { error = caught }
    strictEqual(error, sentinel)
    strictEqual(classObserverCalls, 1)
  } finally { Reflect.deleteProperty(ReplayMultiHeadPolyLineSolver, Symbol.hasInstance) }
  setField(syncGrid, "prepareForNextStep", (): Promise<void> => { throw sentinel })
  strictEqual(syncGridPortfolio.tryPrepareForNextStepSynchronously(), false)
  try { await syncGridPortfolio.prepareForNextStep() } catch (caught: unknown) { error = caught }
  strictEqual(error, sentinel)
  Reflect.deleteProperty(syncGrid, "prepareForNextStep")
  strictEqual(createPortfolio(true).tryPrepareForNextStepSynchronously(), false)
  return { actualWorker: true, checkpoints, syncPreparations, nativeAwaitPreparations,
    selectedNativeSteps: syncGrid.iterations, noLeaseAfterQuantum: true,
    settledUninstalledRemainsAsync: true, exactSelectedErrors: true, noDefaultActivation: true }
}

let pingReceived = false
async function runResponsive(cancellationBuffer: SharedArrayBuffer): Promise<object> {
  await initializeWorkerNativeGridRuntime()
  const portfolio = createPortfolio(), owner = await selectA01(portfolio)
  const cancellation = new Int32Array(cancellationBuffer)
  postMessage({ ready: true })
  let lastYield = performance.now(), yields = 0, quanta = 0
  while (!portfolio.solved && !portfolio.failed && quanta < 2000) {
    if (Atomics.load(cancellation, 0) !== 0) break
    if (performance.now() - lastYield >= 50) {
      strictEqual(isWorkerNativeGridKernelQuantumActive(owner), false)
      await new Promise<void>((resolve): void => { setTimeout(resolve, 0) })
      lastYield = performance.now()
      yields++
    }
    if (!portfolio.tryPrepareForNextStepSynchronously()) await portfolio.prepareForNextStep()
    if (Atomics.load(cancellation, 0) !== 0) break
    portfolio.step()
    strictEqual(isWorkerNativeGridKernelQuantumActive(owner), false)
    quanta++
  }
  strictEqual(pingReceived, true)
  strictEqual(Atomics.load(cancellation, 0), 1)
  strictEqual(isWorkerNativeGridKernelQuantumActive(owner), false)
  return { pingReceived, cancelled: true, yields, quanta, steps: owner.iterations, noLeaseAfterQuantum: true }
}

onmessage = (event: MessageEvent<{ ping?: boolean; cancellationBuffer?: SharedArrayBuffer }>): void => {
  if (event.data.ping) { pingReceived = true; postMessage({ pong: true }); return }
  const task = event.data.cancellationBuffer ? runResponsive(event.data.cancellationBuffer) : runParity()
  void task.then((result): void => { postMessage({ result }) }, (error: unknown): void => {
    postMessage({ error: error instanceof Error ? error.stack : String(error) })
  })
}
