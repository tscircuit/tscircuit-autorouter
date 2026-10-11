import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { HighDensitySolverA13WithDrcValidation } from "../../solvers/HyperHighDensitySolver/HighDensitySolverA13WithDrcValidation"
import { NativeA13WasmSearchKernel } from "./a13-search-wasm/NativeA13WasmSearchKernel"
import type { SearchInputs } from "./a13-search-wasm/SearchInputs"
import { hasNativeDescriptorMetadata } from "./nativeDescriptorMetadataGuard"
import { beginNativeGridIntrinsicQuantum, finishNativeGridIntrinsicQuantum, hasNativeGridKernelIntrinsics,
  type NativeGridIntrinsicQuantum } from "./nativeGridKernelIntrinsics"
import { captureWorkerNativeGridPortfolioContract, isWorkerNativeGridKernelDispatcher,
  type WorkerNativeGridPortfolioContract } from "./workerNativeGridKernelQuantum"
import { isWorkerNativeGridProxy } from "./workerNativeGridRuntime"
import type { GridHistoryDispatcher } from "./parallelGridHistoryTypes"
import { hasNativeA13ValidationContract, getNativeA13ValidationContractCensus } from "./nativeA13ValidationContract"

type Owner = HighDensitySolverA13WithDrcValidation
type PrivateOwner = { cols: number; rows: number; layers: number[]; pitchX: number; pitchY: number; searchKernel: unknown }
type State = { setup?: (...args: never[]) => void; wrapper?: () => void; kernel?: NativeA13WasmSearchKernel;
  active: boolean; owner: Owner; portfolio: object; roots?: readonly unknown[]; buffers?: readonly unknown[];
  kernelFields?: readonly PropertyDescriptor[]; exportsFields?: readonly PropertyDescriptor[]; offsets?: readonly number[] }
export type NativeA13SearchQuantum = { intrinsic: NativeGridIntrinsicQuantum; state: State }
export type ParallelNativeA13SearchInstaller = {
  install(owner: Owner, portfolio: object, dispatcher?: GridHistoryDispatcher): boolean
  beginQuantum(owner: Owner, portfolio: object, dispatcher?: GridHistoryDispatcher): NativeA13SearchQuantum | null
  finishQuantum(quantum: NativeA13SearchQuantum | null): void
  getGuardCensus(): object
}
const descriptor = Object.getOwnPropertyDescriptor, prototype = Object.getPrototypeOf
const keys = Reflect.ownKeys, hasOwn = Object.hasOwn, is = Object.is
const apply = Reflect.apply, define = Object.defineProperty, remove = Reflect.deleteProperty
const source = Function.prototype.toString
const extraGlobals = ["Uint16Array", "Int8Array", "Int16Array", "Uint8ClampedArray", "BigInt64Array", "BigUint64Array", "DataView",
  "Proxy", "parseInt", "parseFloat", "isFinite", "isNaN", "Symbol", "RegExp", "JSON", "Error", "Date", "Boolean", "Promise", "atob", "performance", "console", "WebAssembly"]
const extraGlobalDescriptors = extraGlobals.map(name => descriptor(globalThis, name)!)
const extraContracts: WorkerNativeGridPortfolioContract[] = []
for (const original of extraGlobalDescriptors) {
  if (!original || !hasOwn(original, "value") || !original.value) continue
  extraContracts.push(captureWorkerNativeGridPortfolioContract(original.value))
  const ownPrototype = descriptor(original.value, "prototype")
  if (ownPrototype?.value) extraContracts.push(captureWorkerNativeGridPortfolioContract(ownPrototype.value))
}
const wasmObject = descriptor(globalThis, "WebAssembly")?.value
if (wasmObject) for (const name of ["Module", "Instance", "Memory", "Global"]) {
  const constructor = descriptor(wasmObject, name)?.value
  if (constructor) {
    extraContracts.push(captureWorkerNativeGridPortfolioContract(constructor))
    const ownPrototype = descriptor(constructor, "prototype")?.value
    if (ownPrototype) extraContracts.push(captureWorkerNativeGridPortfolioContract(ownPrototype))
  }
}
const ownerContract = captureWorkerNativeGridPortfolioContract(HighDensitySolverA13WithDrcValidation.prototype)
const connContract = captureWorkerNativeGridPortfolioContract(ConnectivityMap.prototype)
const nativeSources = [Object.getOwnPropertyDescriptor, Reflect.ownKeys, Reflect.apply, Object.hasOwn,
  Object.is, Math.ceil, Uint16Array, Uint8Array.from, descriptor(globalThis, "atob")?.value]
  .map(fn => typeof fn === "function" && source.call(fn).includes("[native code]"))
const arrayBufferPrototype = ArrayBuffer.prototype
const wasmMemoryConstructor = wasmObject && descriptor(wasmObject, "Memory")?.value
const wasmMemoryPrototype = wasmMemoryConstructor && descriptor(wasmMemoryConstructor, "prototype")?.value
const inputNames = ["traceCost", "viaCost", "fixed", "fixedVia", "history", "viaHistory", "heuristicCost", "viaAllowed"] as const
const rootNames = ["props", "validationParams", "nodeWithPortPoints", "hyperParameters"] as const
const inputPrototypes = [Uint16Array.prototype, Uint16Array.prototype, Uint8Array.prototype, Uint8Array.prototype,
  Float64Array.prototype, Float64Array.prototype, Float64Array.prototype, Uint8Array.prototype]
const nativeIsView = ArrayBuffer.isView
const typedArrayBuffer = descriptor(prototype(Uint8Array.prototype), "buffer")!.get!

function matches(contract: WorkerNativeGridPortfolioContract, owner?: object, ownSetup?: () => void): boolean {
  const snapshots = contract.snapshots
  if (owner && (isWorkerNativeGridProxy(owner) || prototype(owner) !== snapshots[0]!.prototype)) return false
  for (let level = 0; level < snapshots.length; level++) {
    const snapshot = snapshots[level]!
    if (prototype(snapshot.prototype) !== snapshot.parent || keys(snapshot.prototype).length !== snapshot.names.length) return false
    for (let index = 0; index < snapshot.names.length; index++) {
      const name = snapshot.names[index]!, original = snapshot.descriptors[index]!, current = descriptor(snapshot.prototype, name)
      if (!current || !is(current.value, original.value) || current.get !== original.get || current.set !== original.set ||
        current.writable !== original.writable || current.enumerable !== original.enumerable || current.configurable !== original.configurable) return false
      if (owner && name !== "constructor" && hasOwn(owner, name)) {
        const own = descriptor(owner, name)!
        if (name !== "_setup" || !ownSetup || own.value !== ownSetup || own.get || own.set) return false
      }
    }
  }
  if (owner) {
    const names = keys(owner)
    for (let index = 0; index < names.length; index++) {
      const own = descriptor(owner, names[index]!)!
      if (!hasOwn(own, "value")) return false
    }
  }
  return true
}

function hasExtraIntrinsics(): boolean {
  if (!hasNativeDescriptorMetadata()) return false
  for (let index = 0; index < nativeSources.length; index++) if (!nativeSources[index]) return false
  for (let index = 0; index < extraGlobals.length; index++) {
    const current = descriptor(globalThis, extraGlobals[index]!), original = extraGlobalDescriptors[index]!
    if (!current || !original || !is(current.value, original.value) || current.get !== original.get || current.set !== original.set) return false
  }
  for (let index = 0; index < extraContracts.length; index++) if (!matches(extraContracts[index]!)) return false
  return matches(connContract) && hasNativeA13ValidationContract()
}

/** Inspect descriptors, never getters/proxy traps, before the original setup. */
function hasPlainInputs(owner: Owner): boolean {
  const seen = new WeakSet<object>(), pending: unknown[] = []
  for (const name of rootNames) {
    const own = descriptor(owner, name)
    if (!own || !hasOwn(own, "value")) return false
    pending.push(own.value)
  }
  while (pending.length > 0) {
    const value = pending.pop()
    if (value === null || value === undefined || typeof value === "string" || typeof value === "number" || typeof value === "boolean") continue
    if (typeof value !== "object" || isWorkerNativeGridProxy(value)) return false
    if (seen.has(value)) continue
    seen.add(value)
    const parent = prototype(value), isConnectionMap = parent === ConnectivityMap.prototype
    if (!isConnectionMap && parent !== Object.prototype && parent !== Array.prototype && parent !== null) return false
    const names = keys(value)
    for (let index = 0; index < names.length; index++) {
      const name = names[index]!, own = descriptor(value, name)!
      if (!hasOwn(own, "value") || (isConnectionMap && name !== "netMap" && name !== "idToNetMap")) return false
      pending.push(own.value)
    }
  }
  return true
}

/** The wrapper's i32 ABI must not reinterpret nonfinite native JS budgets. */
function hasNativeSearchDomain(owner: Owner): boolean {
  const props = descriptor(owner, "props")!.value
  const steps = descriptor(props, "stepMultiplier")?.value ?? 1000
  const budget = descriptor(props, "maxSearchIterations")?.value ?? 50_000_000
  const backend = descriptor(props, "searchBackend")?.value
  return typeof steps === "number" && Number.isFinite(steps) && steps > 0 && steps <= 1_000_000 &&
    typeof budget === "number" && Number.isFinite(budget) && budget >= 0 && budget <= 0x7fffffff &&
    (backend === undefined || backend === "auto" || backend === "javascript")
}

/** All native cost buffers are private ArrayBuffers; no other worker can write. */
function hasPrivateNativeBuffers(owner: PrivateOwner): boolean {
  for (let index = 0; index < inputNames.length; index++) {
    const own = descriptor(owner, inputNames[index]!)
    if (!own || !hasOwn(own, "value") || isWorkerNativeGridProxy(own.value) || !nativeIsView(own.value) || prototype(own.value) !== inputPrototypes[index]) return false
    const view = own.value as ArrayBufferView
    if (prototype(apply(typedArrayBuffer, view, [])) !== arrayBufferPrototype) return false
    for (const name of ["buffer", "byteLength", "byteOffset", "length", "set", "fill", "subarray", "BYTES_PER_ELEMENT"])
      if (hasOwn(view, name)) return false
  }
  return true
}

/** Only original callback-free worker quanta may call the private C kernel. */
class OwnedA13WasmSearchKernel extends NativeA13WasmSearchKernel {
  readonly #state: State
  constructor(cols: number, rows: number, layers: number, pitchX: number, pitchY: number, state: State) {
    super(cols, rows, layers, pitchX, pitchY)
    this.#state = state
  }
  override begin(inputs: SearchInputs, start: number, goal: number, presentCost: number): void {
    if (!this.#state.active) throw new Error("Native A13 search began outside its owned quantum")
    super.begin(inputs, start, goal, presentCost)
  }
  override run(steps: number, budget: number): { status: number; expansions: number } {
    if (!this.#state.active) throw new Error("Native A13 search ran outside its owned quantum")
    return super.run(steps, budget)
  }
  override copyParents(target: Int32Array): void {
    if (!this.#state.active) throw new Error("Native A13 parents copied outside their owned quantum")
    super.copyParents(target)
  }
}
extraContracts.push(captureWorkerNativeGridPortfolioContract(NativeA13WasmSearchKernel))
extraContracts.push(captureWorkerNativeGridPortfolioContract(NativeA13WasmSearchKernel.prototype))
extraContracts.push(captureWorkerNativeGridPortfolioContract(OwnedA13WasmSearchKernel))
extraContracts.push(captureWorkerNativeGridPortfolioContract(OwnedA13WasmSearchKernel.prototype))
const ownedKernelContract = captureWorkerNativeGridPortfolioContract(OwnedA13WasmSearchKernel.prototype)
const kernelFieldNames = ["exports", "offsets", "states"] as const
const exportFieldNames = ["memory", "__heap_base", "configure", "begin_search", "run", "get_expansions", "get_pops", "set_heap_capacity"] as const

function hasOriginalKernel(state: State): boolean {
  const kernel = state.kernel!
  if (!matches(ownedKernelContract, kernel) || descriptor(state.owner, "searchKernel")?.value !== kernel) return false
  for (let index = 0; index < kernelFieldNames.length; index++) {
    const current = descriptor(kernel, kernelFieldNames[index]!), original = state.kernelFields![index]!
    if (!current || !hasOwn(current, "value") || !is(current.value, original.value)) return false
  }
  const exports = state.kernelFields![0]!.value, offsets = state.kernelFields![1]!.value
  if (isWorkerNativeGridProxy(exports) || isWorkerNativeGridProxy(offsets) || prototype(offsets) !== Array.prototype || keys(offsets).length !== state.offsets!.length + 1) return false
  for (let index = 0; index < state.offsets!.length; index++) {
    const own = descriptor(offsets, String(index))
    if (!own || !hasOwn(own, "value") || own.value !== state.offsets![index]) return false
  }
  for (let index = 0; index < exportFieldNames.length; index++) {
    const current = descriptor(exports, exportFieldNames[index]!), original = state.exportsFields![index]!
    if (!current || !hasOwn(current, "value") || current.value !== original.value) return false
  }
  const memory = state.exportsFields![0]!.value
  if (isWorkerNativeGridProxy(memory) || prototype(memory) !== wasmMemoryPrototype || keys(memory).length !== 0) return false
  for (let index = 0; index < inputNames.length; index++) {
    // Native prepareSearch replaces heuristicCost before each new search.
    if (inputNames[index] !== "heuristicCost" && descriptor(state.owner, inputNames[index]!)?.value !== state.buffers![index]) return false
  }
  return hasPrivateNativeBuffers(state.owner as unknown as PrivateOwner)
}

/** Public/default A13 construction is unchanged; capability is internal identity. */
export function createParallelNativeA13SearchInstaller(portfolioPrototype: object): ParallelNativeA13SearchInstaller {
  const portfolioContract = captureWorkerNativeGridPortfolioContract(portfolioPrototype)
  const states = new WeakMap<Owner, State>(), live = new WeakSet<NativeA13SearchQuantum>()
  const getState = states.get.bind(states), setState = states.set.bind(states), deleteState = states.delete.bind(states)
  const addLive = live.add.bind(live), hasLive = live.has.bind(live), deleteLive = live.delete.bind(live)
  const contract = (owner: Owner, portfolio: object, wrapper?: () => void): boolean => hasNativeGridKernelIntrinsics() &&
    hasExtraIntrinsics() && matches(ownerContract, owner, wrapper) && matches(portfolioContract, portfolio)
  return {
    install(owner, portfolio, dispatcher): boolean {
      // Most portfolio A13 candidates are never selected. Identity registration
      // performs no geometry walk, setup, allocation or method installation.
      if (!isWorkerNativeGridKernelDispatcher(dispatcher) || isWorkerNativeGridProxy(owner) ||
        prototype(owner) !== HighDensitySolverA13WithDrcValidation.prototype || getState(owner)) return false
      setState(owner, { owner, portfolio, active: false })
      return true
    },
    beginQuantum(owner, portfolio, dispatcher): NativeA13SearchQuantum | null {
      const state = getState(owner)
      if (!state) return null
      if (!hasNativeDescriptorMetadata()) {
        if (state.kernel) throw new Error("Active native A13 descriptor metadata was modified")
        deleteState(owner)
        return null
      }
      const ownSetup = state.wrapper && descriptor(owner, "_setup")?.value === state.wrapper ? state.wrapper : undefined
      if (!isWorkerNativeGridKernelDispatcher(dispatcher) || state.portfolio !== portfolio || !contract(owner, portfolio, ownSetup)) {
        if (state.kernel) throw new Error("Active native A13 worker ownership contract was modified")
        if (ownSetup) remove(owner, "_setup")
        deleteState(owner)
        return null
      }
      if (!state.roots) {
        if (!hasPlainInputs(owner) || !hasNativeSearchDomain(owner) || owner.solved || owner.failed || descriptor(owner, "_setupDone")?.value === true) {
          deleteState(owner)
          return null
        }
        state.roots = rootNames.map(name => descriptor(owner, name)!.value)
      } else for (let index = 0; index < rootNames.length; index++) {
        if (descriptor(owner, rootNames[index]!)?.value !== state.roots[index]) throw new Error("Native A13 immutable input identity was modified")
      }
      if (state.kernel && !hasOriginalKernel(state)) throw new Error("Active native A13 kernel contract was modified")
      if (state.active) throw new Error("Native A13 quantum is already active")
      const intrinsic = beginNativeGridIntrinsicQuantum()
      if (!intrinsic) {
        if (state.kernel) throw new Error("Active native A13 intrinsic contract was modified")
        if (ownSetup) remove(owner, "_setup")
        deleteState(owner)
        return null
      }
      if (!state.setup) {
        state.setup = owner._setup
        state.wrapper = (): void => {
          remove(owner, "_setup")
          // Original setup FIRST, once, including its native exception boundary.
          apply(state.setup!, owner, [])
          if (!state.active) return
          if (!hasPrivateNativeBuffers(owner as unknown as PrivateOwner)) throw new Error("Native A13 setup did not create private cost buffers")
          const native = owner as unknown as PrivateOwner
          const kernel = new OwnedA13WasmSearchKernel(native.cols, native.rows, native.layers.length, native.pitchX, native.pitchY, state)
          native.searchKernel = kernel
          state.kernel = kernel
          state.kernelFields = kernelFieldNames.map(name => descriptor(kernel, name)!)
          state.exportsFields = exportFieldNames.map(name => descriptor(state.kernelFields![0]!.value, name)!)
          state.offsets = [...state.kernelFields[1]!.value]
          state.buffers = inputNames.map(name => descriptor(owner, name)!.value)
        }
        define(owner, "_setup", { value: state.wrapper, writable: true, configurable: true })
      }
      state.active = true
      const quantum = { intrinsic, state }
      addLive(quantum)
      return quantum
    },
    finishQuantum(quantum): void {
      if (!quantum) return
      if (!hasLive(quantum)) throw new Error("Native A13 quantum was not minted or was already released")
      deleteLive(quantum)
      quantum.state.active = false
      finishNativeGridIntrinsicQuantum(quantum.intrinsic)
    },
    getGuardCensus(): object {
      const count = (contracts: readonly WorkerNativeGridPortfolioContract[]): object => ({
        objects: contracts.reduce((sum, contract) => sum + contract.snapshots.length, 0),
        descriptors: contracts.reduce((sum, contract) => sum + contract.snapshots.reduce((rows, snapshot) => rows + snapshot.names.length, 0), 0),
      })
      return { extraGlobals: extraGlobals.length, extraIntrinsics: count(extraContracts),
        owner: count([ownerContract]), connectivity: count([connContract]), portfolio: count([portfolioContract]),
        validation: getNativeA13ValidationContractCensus(),
        note: "Static snapshot counts per eligible quantum; extra ancestry repeats are included. Base JS guard executes twice. Owner and kernel own-data/buffer checks add live descriptors; one-time plain input admission is separate." }
    },
  }
}
