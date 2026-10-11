import { deepStrictEqual, strictEqual } from "node:assert"
import { HighDensitySolverA01, HighDensitySolverA03 } from "@tscircuit/high-density-a01"
import { ReplayHighDensityA01Solver } from "lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/ReplayHighDensityA01Solver"
import { ReplayHighDensityA03Solver } from "lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/ReplayHighDensityA03Solver"
import { ParallelPortfolioSingleIntraNodeSolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/ParallelPortfolioSingleIntraNodeSolver"
import { initializeWorkerNativeGridRuntime } from "lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/workerNativeGridRuntime"
import { beginWorkerNativeGridKernelQuantum, captureWorkerNativeGridPortfolioContract,
  finishWorkerNativeGridKernelQuantum, isWorkerNativeGridKernelQuantumActive,
  registerWorkerNativeGridKernelDispatcher, registerWorkerNativeGridOwner } from "lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/workerNativeGridKernelQuantum"
import type { GridHistoryDispatcher, GridHistoryResult } from "lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/parallelGridHistoryTypes"
import type { MultiHeadHistoryResult } from "lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/parallelMultiHeadHistoryTypes"
import type { NodeWithPortPoints } from "lib/types/high-density-types"
import cmn45 from "../parallel-grid-history-cmn45.json"
import { getParallelNativeA01HeapArenaDiagnostics } from "lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/installParallelNativeA01Heap"
import { NativeA01HeapArena } from "lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/native-a01-heap-arena/NativeA01HeapArena"

type Grid = HighDensitySolverA01 | HighDensitySolverA03
function nativeFields(solver: Grid, names: readonly string[]): object {
  const fields: Record<string, unknown> = {}, descriptors = Object.getOwnPropertyDescriptors(solver)
  for (let index = 0; index < names.length; index++) fields[names[index]!] = descriptors[names[index]!]!.value
  return fields
}

async function runOracle(experimentalArena: boolean): Promise<object> {
  await initializeWorkerNativeGridRuntime()
  const dispatcher: GridHistoryDispatcher = async (): Promise<Map<number, Promise<GridHistoryResult>>> => new Map()
  registerWorkerNativeGridKernelDispatcher(dispatcher)
  const portfolio = new ParallelPortfolioSingleIntraNodeSolver({ nodeWithPortPoints: structuredClone(cmn45) as NodeWithPortPoints,
    viaDiameter: 0.3, traceWidth: 0.1 }, async (): Promise<Map<number, Promise<MultiHeadHistoryResult>>> => new Map(),
    { policy: "ordered", gridHistoryDispatcher: dispatcher })
  const contract = captureWorkerNativeGridPortfolioContract(ParallelPortfolioSingleIntraNodeSolver.prototype)
  let checkpoints = 0, quanta = 0, nativeSteps = 0, a01Steps = 0, a03Steps = 0
  let arenaBatches = 0, arenaHydratedRows = 0, arenaFlushedRows = 0
  for (let scenario = 0; scenario < 7; scenario++) {
    const nodeWithPortPoints = structuredClone(cmn45) as NodeWithPortPoints
    const common = { nodeWithPortPoints, viaDiameter: 0.3, traceThickness: 0.1,
      viaMinDistFromBorder: 0.15, traceMargin: 0.1, effort: 1 }
    const paramsA01 = { ...common, cellSizeMm: 0.1, hyperParameters: { shuffleSeed: scenario } }
    const paramsA03 = { ...common, highResolutionCellSize: 0.1, highResolutionCellThickness: 8,
      lowResolutionCellSize: 0.4 }
    const native = scenario < 6 ? new HighDensitySolverA01(structuredClone(paramsA01)) : new HighDensitySolverA03(structuredClone(paramsA03))
    const owner = scenario < 6 ? new ReplayHighDensityA01Solver(structuredClone(paramsA01)) :
      new ReplayHighDensityA03Solver(structuredClone(paramsA03), { immutableWorkerGeometry: true })
    registerWorkerNativeGridOwner(owner, dispatcher)
    native.setup()
    owner.setup()
    native.MAX_ITERATIONS = Math.min(native.MAX_ITERATIONS, 160_000)
    owner.MAX_ITERATIONS = native.MAX_ITERATIONS
    const names = Object.keys(native), heap = Object.getOwnPropertyDescriptor(owner, "heap")!.value
    const heapArrays = scenario < 6 ? [heap.f, heap.seq, heap.id] : []
    strictEqual(Object.hasOwn(scenario < 6 ? heap : owner, scenario < 6 ? "push" : "computeH"), true)
    deepStrictEqual(nativeFields(owner, names), nativeFields(native, names))
    while (!native.solved && !native.failed) {
      const quantum = beginWorkerNativeGridKernelQuantum(portfolio, contract, owner, dispatcher, experimentalArena)
      strictEqual(quantum !== null, true, "authentic worker quantum must be admitted")
      strictEqual(isWorkerNativeGridKernelQuantumActive(owner), true)
      try {
        // The exact original supervisor quantum contains 100 step calls, including
        // the no-op calls after the candidate reaches its original terminal state.
        for (let index = 0; index < 100; index++) { native.step(); owner.step() }
      } finally { finishWorkerNativeGridKernelQuantum(quantum) }
      strictEqual(isWorkerNativeGridKernelQuantumActive(owner), false)
      strictEqual(Object.hasOwn(scenario < 6 ? heap : owner, scenario < 6 ? "push" : "computeH"), true,
        "the native storage/method gate must retain the actual installed kernel")
      deepStrictEqual(nativeFields(owner, names), nativeFields(native, names))
      deepStrictEqual(owner.getOutput(), native.getOutput())
      deepStrictEqual(owner.gridStats, native.gridStats)
      checkpoints++
      quanta++
    }
    strictEqual(Object.getOwnPropertyDescriptor(owner, "heap")!.value, heap)
    if (scenario < 6) {
      strictEqual(heap.f, heapArrays[0]); strictEqual(heap.seq, heapArrays[1]); strictEqual(heap.id, heapArrays[2])
      strictEqual(native.iterations, scenario === 5 ? 157_175 : 160_000)
      a01Steps += native.iterations
      const arena = getParallelNativeA01HeapArenaDiagnostics(owner as ReplayHighDensityA01Solver)
      strictEqual(arena !== null, experimentalArena, "arena must require the explicit genuine-worker experiment")
      if (arena) {
        arenaBatches += arena.batches
        arenaHydratedRows += arena.hydratedRows
        arenaFlushedRows += arena.flushedRows
      }
    } else { strictEqual(native.iterations, 75_624); a03Steps += native.iterations }
    nativeSteps += native.iterations
  }
  // A late observer at the next boundary cannot inherit an active kernel.
  const blocked = new ReplayHighDensityA03Solver({ nodeWithPortPoints: structuredClone(cmn45) as NodeWithPortPoints,
    highResolutionCellSize: 0.1, highResolutionCellThickness: 8, lowResolutionCellSize: 0.4,
    viaDiameter: 0.3, traceThickness: 0.1, viaMinDistFromBorder: 0.15, traceMargin: 0.1 },
    { immutableWorkerGeometry: true })
  registerWorkerNativeGridOwner(blocked, dispatcher)
  blocked.setup()
  const mathDescriptor = Object.getOwnPropertyDescriptor(Math, "min")!
  let getterCalls = 0
  try {
    Object.defineProperty(Math, "min", { configurable: true, get(): never {
      getterCalls++
      throw new Error("instrumented native Math.min")
    } })
    strictEqual(beginWorkerNativeGridKernelQuantum(portfolio, contract, blocked, dispatcher, experimentalArena), null)
    strictEqual(getterCalls, 0)
    strictEqual(isWorkerNativeGridKernelQuantumActive(blocked), false)
  } finally { Object.defineProperty(Math, "min", mathDescriptor) }
  // Metadata preflight precedes portfolio/Base/Replay descriptor reads too.
  const nativeDefine = Object.defineProperty, nativeDelete = Reflect.deleteProperty
  let metadataGetterCalls = 0
  const metadataNames = ["value", "get", "set", "writable", "enumerable", "configurable"]
  for (let index = 0; index < metadataNames.length; index++) {
    const name = metadataNames[index]!
    let quantumWasRejected = false
    try {
      nativeDefine(Object.prototype, name, { __proto__: null, configurable: true, get(): never {
        metadataGetterCalls++
        throw new Error("inherited worker descriptor metadata observer")
      } } as PropertyDescriptor)
      quantumWasRejected = beginWorkerNativeGridKernelQuantum(portfolio, contract, blocked, dispatcher, experimentalArena) === null
    } finally { nativeDelete(Object.prototype, name) }
    strictEqual(quantumWasRejected, true)
    strictEqual(metadataGetterCalls, 0)
  }
  const moduleDescriptor = Object.getOwnPropertyDescriptor(WebAssembly, "Module")!
  let wasmGetterCalls = 0
  try {
    Object.defineProperty(WebAssembly, "Module", { configurable: true, get(): never {
      wasmGetterCalls++
      throw new Error("instrumented WebAssembly.Module getter")
    } })
    const quantum = beginWorkerNativeGridKernelQuantum(portfolio, contract, blocked, dispatcher, experimentalArena)
    try { strictEqual(quantum === null, experimentalArena) }
    finally { finishWorkerNativeGridKernelQuantum(quantum) }
    strictEqual(wasmGetterCalls, 0)
  } finally { Object.defineProperty(WebAssembly, "Module", moduleDescriptor) }
  const arenaDescriptor = Object.getOwnPropertyDescriptor(NativeA01HeapArena.prototype, "begin")!
  let arenaGetterCalls = 0
  try {
    Object.defineProperty(NativeA01HeapArena.prototype, "begin", { configurable: true, get(): never {
      arenaGetterCalls++
      throw new Error("instrumented heap arena begin getter")
    } })
    const quantum = beginWorkerNativeGridKernelQuantum(portfolio, contract, blocked, dispatcher, experimentalArena)
    try { strictEqual(quantum === null, experimentalArena) }
    finally { finishWorkerNativeGridKernelQuantum(quantum) }
    strictEqual(arenaGetterCalls, 0)
  } finally { Object.defineProperty(NativeA01HeapArena.prototype, "begin", arenaDescriptor) }
  const replay = Object.getOwnPropertyDescriptor(blocked, "replay")!.value
  const replayPrototype = Object.getPrototypeOf(replay)
  const applyDescriptor = Object.getOwnPropertyDescriptor(replayPrototype, "applyStep")!
  try {
    Object.defineProperty(replayPrototype, "applyStep", { ...applyDescriptor, value: (): boolean => false })
    strictEqual(beginWorkerNativeGridKernelQuantum(portfolio, contract, blocked, dispatcher, experimentalArena), null)
  } finally { Object.defineProperty(replayPrototype, "applyStep", applyDescriptor) }
  Object.defineProperty(replay, "historyRequest", { configurable: true, value: Promise.resolve() })
  strictEqual(beginWorkerNativeGridKernelQuantum(portfolio, contract, blocked, dispatcher, experimentalArena), null)
  delete replay.historyRequest
  const blockedHeap = Object.getOwnPropertyDescriptor(blocked, "heap")!.value
  const typedName = Object.keys(blockedHeap).find((name): boolean =>
    ArrayBuffer.isView(Object.getOwnPropertyDescriptor(blockedHeap, name)!.value))!
  const typedArray = blockedHeap[typedName]
  let proxyTraps = 0
  blockedHeap[typedName] = new Proxy(typedArray, { getPrototypeOf(): object | null {
    proxyTraps++
    return Object.getPrototypeOf(typedArray)
  }, getOwnPropertyDescriptor(target, name): PropertyDescriptor | undefined {
    proxyTraps++
    return Object.getOwnPropertyDescriptor(target, name)
  } })
  const rejectedStorage = beginWorkerNativeGridKernelQuantum(portfolio, contract, blocked, dispatcher, experimentalArena)
  finishWorkerNativeGridKernelQuantum(rejectedStorage)
  strictEqual(proxyTraps, 0)
  strictEqual(Object.hasOwn(blocked, "computeH"), false)
  blockedHeap[typedName] = typedArray
  return { checkpoints, quanta, nativeSteps, a01Steps, a03Steps, actualWorkerKernels: true,
    arenaBatches, arenaHydratedRows, arenaFlushedRows,
    lateObserversRejected: true, storageProxyTraps: proxyTraps }
}

onmessage = (event: MessageEvent<{ experimentalArena: boolean }>): void => {
  runOracle(event.data.experimentalArena === true).then((result): void => postMessage({ result }),
    (error: unknown): void => postMessage({ error: String(error) }))
}
