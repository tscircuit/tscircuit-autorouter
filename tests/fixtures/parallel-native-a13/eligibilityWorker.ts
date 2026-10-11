import { strictEqual, throws } from "node:assert"
import { HighDensitySolverA13WithDrcValidation } from "lib/solvers/HyperHighDensitySolver/HighDensitySolverA13WithDrcValidation"
import { PortfolioSingleIntraNodeSolver } from "lib/solvers/HyperHighDensitySolver/PortfolioSingleIntraNodeSolver"
import { ParallelPortfolioSingleIntraNodeSolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/ParallelPortfolioSingleIntraNodeSolver"
import { createParallelNativeA13SearchInstaller } from "lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/createParallelNativeA13SearchInstaller"
import { NativeA13WasmSearchKernel } from "lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/a13-search-wasm/NativeA13WasmSearchKernel"
import { initializeWorkerNativeGridRuntime } from "lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/workerNativeGridRuntime"
import { registerWorkerNativeGridKernelDispatcher } from "lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/workerNativeGridKernelQuantum"
import type { GridHistoryDispatcher, GridHistoryResult } from "lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/parallelGridHistoryTypes"
import type { NodeWithPortPoints } from "lib/types/high-density-types"
import cmn45 from "../parallel-grid-history-cmn45.json"

async function run(): Promise<object> {
  await initializeWorkerNativeGridRuntime()
  const dispatcher: GridHistoryDispatcher = async (): Promise<Map<number, Promise<GridHistoryResult>>> => new Map()
  registerWorkerNativeGridKernelDispatcher(dispatcher)
  const input = { nodeWithPortPoints: structuredClone(cmn45) as NodeWithPortPoints, viaDiameter: 0.3, traceWidth: 0.1 }
  const parent = new ParallelPortfolioSingleIntraNodeSolver(input, async () => new Map(), { policy: "ordered", gridHistoryDispatcher: dispatcher })
  const native = new PortfolioSingleIntraNodeSolver(input)
  const installer = createParallelNativeA13SearchInstaller(ParallelPortfolioSingleIntraNodeSolver.prototype)
  const make = (): HighDensitySolverA13WithDrcValidation => native.generateSolver({ HIGH_DENSITY_A13: true, SHUFFLE_SEED: 0 }) as unknown as HighDensitySolverA13WithDrcValidation
  const enter = (owner: HighDensitySolverA13WithDrcValidation): void => {
    strictEqual(installer.install(owner, parent, dispatcher), true)
    const quantum = installer.beginQuantum(owner, parent, dispatcher)
    strictEqual(quantum !== null, true)
    try { owner.step() } finally { installer.finishQuantum(quantum) }
    strictEqual((owner as any).searchKernel instanceof NativeA13WasmSearchKernel, true)
  }
  let observers = 0, proxyTraps = 0, rejected = 0
  const publicOwner = make()
  strictEqual(installer.install(publicOwner, parent, async () => new Map()), false)
  publicOwner.setup()
  strictEqual((publicOwner as any).searchKernel instanceof NativeA13WasmSearchKernel, false)
  const getterOwner = make()
  Object.defineProperty(getterOwner.props, "observer", { get(): number { observers++; return 0 } })
  strictEqual(installer.install(getterOwner, parent, dispatcher), true)
  strictEqual(installer.beginQuantum(getterOwner, parent, dispatcher), null)
  strictEqual(observers, 0)
  getterOwner.setup()
  strictEqual((getterOwner as any).searchKernel instanceof NativeA13WasmSearchKernel, false)
  const proxyOwner = make()
  Object.defineProperty(proxyOwner, "validationParams", { value: new Proxy(proxyOwner.validationParams, {
    getPrototypeOf(): object { proxyTraps++; return Object.prototype }, ownKeys(): (string | symbol)[] { proxyTraps++; return [] },
  }) })
  strictEqual(installer.install(proxyOwner, parent, dispatcher), true)
  strictEqual(installer.beginQuantum(proxyOwner, parent, dispatcher), null)
  strictEqual(proxyTraps, 0)
  const patchedOwner = make(), ceil = Object.getOwnPropertyDescriptor(Math, "ceil")!
  strictEqual(installer.install(patchedOwner, parent, dispatcher), true)
  try {
    Object.defineProperty(Math, "ceil", { configurable: true, get(): never { observers++; throw new Error("uninvoked ceil observer") } })
    strictEqual(installer.beginQuantum(patchedOwner, parent, dispatcher), null)
  } finally { Object.defineProperty(Math, "ceil", ceil) }
  strictEqual(observers, 0)
  patchedOwner.setup()
  strictEqual((patchedOwner as any).searchKernel instanceof NativeA13WasmSearchKernel, false)
  for (const maxSearchIterations of [NaN, Infinity, -1, 0x80000000]) {
    const owner = make()
    Object.defineProperty(owner.props, "maxSearchIterations", { value: maxSearchIterations })
    strictEqual(installer.install(owner, parent, dispatcher), true)
    strictEqual(installer.beginQuantum(owner, parent, dispatcher), null)
    owner.setup()
    strictEqual((owner as any).searchKernel instanceof NativeA13WasmSearchKernel, false)
  }
  for (const mutate of [
    (owner: any): void => { owner.searchKernel.run = (): never => { observers++; throw new Error("uninvoked kernel method") } },
    (owner: any): void => { owner.searchKernel.exports = { ...owner.searchKernel.exports, run(): never { observers++; throw new Error("uninvoked export") } } },
    (owner: any): void => { owner.searchKernel.offsets[0]++ },
    (owner: any): void => { owner.fixed = new Uint8Array(owner.fixed) },
    (owner: any): void => { Object.defineProperty(owner.searchKernel.exports.memory, "grow", { get(): never { observers++; throw new Error("uninvoked memory observer") } }) },
  ]) {
    const owner = make(); enter(owner); mutate(owner)
    throws(() => installer.beginQuantum(owner, parent, dispatcher), /Active native A13 kernel contract/)
    rejected++
  }
  const prototypeOwner = make(); enter(prototypeOwner)
  const begin = Object.getOwnPropertyDescriptor(NativeA13WasmSearchKernel.prototype, "begin")!
  try {
    Object.defineProperty(NativeA13WasmSearchKernel.prototype, "begin", { value(): never { observers++; throw new Error("uninvoked base method") }, configurable: true })
    throws(() => installer.beginQuantum(prototypeOwner, parent, dispatcher), /Active native A13 worker ownership/)
    rejected++
  } finally { Object.defineProperty(NativeA13WasmSearchKernel.prototype, "begin", begin) }
  throws(() => (prototypeOwner as any).searchKernel.run(1, 1), /outside its owned quantum/)
  strictEqual(observers, 0)
  return { actualKernel: true, publicNative: true, observers, proxyTraps, rejected }
}
self.onmessage = async (): Promise<void> => {
  try { self.postMessage({ result: await run() }) }
  catch (error) { self.postMessage({ error: error instanceof Error ? error.stack : String(error) }) }
}
