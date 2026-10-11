import { TinyHyperGraphSolver, type Candidate, type TinyHyperGraphProblem, type TinyHyperGraphTopology } from "tiny-hypergraph/lib/core"
import { TinyRegionCostMemo } from "../TinyRegionCostMemo"
import { PackedIndexedCandidateHeap } from "../PackedIndexedCandidateHeap"
import { neighborKernelBytes } from "./neighborKernelBytes"
import { canTrustTinyNativeScopeChild, isTinyNativeFallbackRun, registerTinyScopedChild, type TinyNativeSynchronousScope } from "./TinyNativeSynchronousScope"

const getDescriptor = Object.getOwnPropertyDescriptor
const getPrototype = Object.getPrototypeOf
const mathObject = Math
const numberObject = Number
const objectObject = Object
const nativeMax = Math.max
const nativeCeil = Math.ceil
const nativeApply = Reflect.apply
const typedArrayPrototype = getPrototype(Uint8Array.prototype)
const nativeTypedFill = getDescriptor(typedArrayPrototype, "fill")!.value
const nativeTypedSet = getDescriptor(typedArrayPrototype, "set")!.value
const mathNames = ["sqrt", "min", "max", "clz32"]
const nativeMath = mathNames.map((name) => getDescriptor(mathObject, name)?.value)
const intrinsicSnapshots: Array<readonly [object, string, unknown]> = []
const capture = (object: object, name: string): void => {
  intrinsicSnapshots[intrinsicSnapshots.length] = [object, name, getDescriptor(object, name)?.value]
}
capture(globalThis, "Math"); capture(globalThis, "Number"); capture(globalThis, "Object")
capture(numberObject, "isFinite"); capture(numberObject, "isInteger"); capture(numberObject, "isSafeInteger")
capture(objectObject, "is")
capture(Map.prototype, "has"); capture(Map.prototype, "get")
capture(typedArrayPrototype, "fill"); capture(typedArrayPrototype, "set")
capture(TinyHyperGraphSolver.prototype, "computeRegionCostForRegion")
const nativeMemoGet = getDescriptor(TinyRegionCostMemo.prototype, "get")!.value
const nativeQueueValues = getDescriptor(PackedIndexedCandidateHeap.prototype, "queueValues")!.value
const policyNames = ["DISTANCE_TO_COST", "minViaPadDiameter", "TRACE_DENSITY_COST_FACTOR"]
const stateNames = ["currentRouteNetId", "goalPortId", "candidateBestCostGeneration"]
const nativeInteger = Number.isInteger
const nativeSafeInteger = Number.isSafeInteger
const MAX_BYTES = 512 * 1024 * 1024
let compiledModule: WebAssembly.Module | undefined

type MethodTable = ReadonlyArray<readonly [string, unknown]>
type Provenance = { methods: MethodTable; scope?: TinyNativeSynchronousScope; excluded?: boolean }
const ownedInputs = new WeakMap<TinyHyperGraphTopology, WeakMap<TinyHyperGraphProblem, Provenance>>()

/** Inspect eligibility without invoking a public method or policy getter. */
function dataDescriptor(object: object, name: string): PropertyDescriptor | undefined {
  for (let current: object | null = object; current !== null; current = getPrototype(current)) {
    const descriptor = getDescriptor(current, name)
    if (descriptor) return descriptor
  }
  return undefined
}

const METHOD_NAMES = [
  "computeG", "computeH", "getCandidateBestCost", "setCandidateBestCost",
  "isPortReservedForDifferentNet", "isRegionReservedForDifferentNet",
  "populateBaseSegmentGeometryScratch",
  "isKnownSingleLayerRegion", "computeRegionCostForRegion", "getRouteHeuristic",
  "getRouteEndPortId",
]

/** Internal factory provenance, independent of public constructor options. */
export function captureTinyKernelFactoryMethods(prototype: object): MethodTable {
  const methods: Array<readonly [string, unknown]> = []
  for (let index = 0; index < METHOD_NAMES.length; index++) {
    const name = METHOD_NAMES[index]!
    methods[index] = [name, dataDescriptor(prototype, name)?.value]
  }
  return methods
}

/** Only the pipeline's native solveGraph parameter factory calls this hook. */
export function registerOwnedTinyKernelInput(
  topology: TinyHyperGraphTopology, problem: TinyHyperGraphProblem, methods: MethodTable,
  scope?: TinyNativeSynchronousScope,
  excluded = false,
): void {
  let problems = ownedInputs.get(topology)
  if (!problems) { problems = new WeakMap(); ownedInputs.set(topology, problems) }
  problems.set(problem, { methods, scope, excluded })
}

/** Resume an already constructed owned child inside a fresh closed solve. */
export function attachOwnedTinyKernelScope(topology: TinyHyperGraphTopology, problem: TinyHyperGraphProblem,
  scope: TinyNativeSynchronousScope): void {
  const provenance = ownedInputs.get(topology)?.get(problem)
  if (provenance) provenance.scope = scope
}

export function excludeOwnedTinyKernelInput(topology: TinyHyperGraphTopology, problem: TinyHyperGraphProblem): void {
  const provenance = ownedInputs.get(topology)?.get(problem)
  if (provenance) provenance.excluded = true
}

type KernelExports = {
  memory: WebAssembly.Memory
  __heap_base: WebAssembly.Global
  scan: (...args: number[]) => number
}

type KernelInput = {
  owner: TinyHyperGraphSolver
  offsets: Int32Array
  ports: Int32Array
  nextRegions: Int32Array
  hops: Float64Array
  getActiveWord: (word: number) => number
  costMemo?: TinyRegionCostMemo
}

export type TinyOrderedNeighborBatch = {
  readonly positions: Int32Array
  readonly distances: Float64Array
  readonly count: number
}

/**
 * Private mirrors preserve the original JS arrays, their retained aliases,
 * and native solved-state snapshot ownership. Only factory-owned immutable
 * topology and plain native scorer state use this kernel; native commits
 * retain all JS visitors. Intrinsics must be built in when this module loads.
 */
export class TinyOrderedNeighborKernel {
  readonly diagnostics = { batches: 0, survivors: 0, bytes: 0, disabledReason: "" }
  private readonly exports: KernelExports
  private readonly pointers: number[]
  private readonly words: Uint32Array
  private readonly assigned: Int32Array
  private readonly best: Float64Array
  private readonly bestGeneration: Uint32Array
  private readonly positions: Int32Array
  private readonly distances: Float64Array
  private readonly batch: { positions: Int32Array; distances: Float64Array; count: number }
  private readonly references: ReadonlyArray<readonly [object, string, unknown]>
  private readonly originalBest: Float64Array
  private readonly originalBestGeneration: Uint32Array
  private assignedReference: Int32Array
  private lastSearchGeneration = -1
  private currentBestGeneration: number
  private disabled = false
  private validatedScope?: TinyNativeSynchronousScope

  constructor(private readonly input: KernelInput, private readonly provenance: Provenance) {
    const { owner, ports, nextRegions, hops, offsets } = input
    const { topology, problem, state } = owner
    this.originalBest = state.candidateBestCostByHopId as Float64Array
    this.originalBestGeneration = state.candidateBestCostGenerationByHopId as Uint32Array
    this.assignedReference = state.portAssignment
    this.currentBestGeneration = state.candidateBestCostGeneration
    this.references = [
      [topology, "portX", topology.portX], [topology, "portY", topology.portY],
      [problem, "portSectionMask", problem.portSectionMask],
      [problem, "portPenalty", problem.portPenalty], [problem, "regionNetId", problem.regionNetId],
      [owner.problemSetup, "portEndpointReservationNetId", owner.problemSetup.portEndpointReservationNetId],
      [state, "candidateBestCostByHopId", this.originalBest],
      [state, "candidateBestCostGenerationByHopId", this.originalBestGeneration],
    ]
    let maximumIncidences = 0
    for (let region = 0; region < topology.regionCount; region++)
      maximumIncidences = nativeMax(maximumIncidences, offsets[region + 1]! - offsets[region]!)
    const dimensions = [
      ports.length, nextRegions.length, hops.length, topology.portCount, topology.portCount,
      topology.portCount, topology.portCount, topology.portCount, topology.regionCount,
      topology.portCount, this.originalBest.length, this.originalBestGeneration.length,
      nativeCeil(ports.length / 32), maximumIncidences, maximumIncidences,
    ]
    const widths = [4, 4, 4, 8, 8, 1, 4, 4, 4, 8, 8, 4, 4, 4, 8]
    compiledModule ??= new WebAssembly.Module(neighborKernelBytes)
    this.exports = new WebAssembly.Instance(compiledModule).exports as unknown as KernelExports
    let cursor = Number(this.exports.__heap_base.value)
    this.pointers = []
    for (let index = 0; index < dimensions.length; index++) {
      cursor = nativeCeil(cursor / 8) * 8
      this.pointers[index] = cursor
      cursor += dimensions[index]! * widths[index]!
    }
    if (!nativeSafeInteger(cursor) || cursor > MAX_BYTES)
      throw new Error("Native Tiny neighbor kernel exceeded its validated memory bound")
    const requiredPages = nativeCeil(cursor / 65536)
    const existingPages = this.exports.memory.buffer.byteLength / 65536
    if (requiredPages > existingPages) this.exports.memory.grow(requiredPages - existingPages)
    // Grow exactly once before any views are created; no detached views escape.
    const buffer = this.exports.memory.buffer
    const i32 = (index: number): Int32Array => new Int32Array(buffer, this.pointers[index]!, dimensions[index]!)
    const f64 = (index: number): Float64Array => new Float64Array(buffer, this.pointers[index]!, dimensions[index]!)
    const copy = (target: ArrayBufferView, source: ArrayLike<number>): void => {
      nativeApply(nativeTypedSet, target, [source])
    }
    copy(i32(0), ports); copy(i32(1), nextRegions); copy(i32(2), hops)
    copy(f64(3), topology.portX); copy(f64(4), topology.portY)
    copy(new Int8Array(buffer, this.pointers[5]!, dimensions[5]!), problem.portSectionMask)
    copy(i32(6), owner.problemSetup.portEndpointReservationNetId)
    this.assigned = i32(7); copy(this.assigned, state.portAssignment)
    copy(i32(8), problem.regionNetId)
    if (problem.portPenalty) copy(f64(9), problem.portPenalty)
    this.best = f64(10); copy(this.best, this.originalBest)
    this.bestGeneration = new Uint32Array(buffer, this.pointers[11]!, dimensions[11]!)
    copy(this.bestGeneration, this.originalBestGeneration)
    this.words = new Uint32Array(buffer, this.pointers[12]!, dimensions[12]!)
    this.positions = i32(13); this.distances = f64(14)
    this.batch = { positions: this.positions, distances: this.distances, count: 0 }
    this.diagnostics.bytes = cursor
    if (provenance.scope) registerTinyScopedChild(provenance.scope, owner)
  }

  /** Mirror the native setter only; the source arrays remain authoritative. */
  updateBest(hop: number, cost: number, generation: number): void {
    if (this.disabled || hop < 0) return
    this.ensureBestGeneration(generation)
    this.best[hop] = cost
    this.bestGeneration[hop] = generation
  }

  private ensureBestGeneration(generation: number): void {
    if (generation < this.currentBestGeneration) nativeApply(nativeTypedFill, this.bestGeneration, [0])
    this.currentBestGeneration = generation
  }

  private reject(reason: string): false {
    this.disabled = true
    this.diagnostics.disabledReason = reason
    return false
  }

  private eligible(state: TinyHyperGraphSolver["state"]): boolean {
    if (this.disabled) return false
    for (let index = 0; index < this.provenance.methods.length; index++) {
      const name = this.provenance.methods[index]![0]
      const expected = this.provenance.methods[index]![1]
      const descriptor = dataDescriptor(this.input.owner, name)
      if (!descriptor || descriptor.get || descriptor.set || descriptor.value !== expected)
        return this.reject(`custom native method ${name}`)
    }
    for (let index = 0; index < this.references.length; index++) {
      const object = this.references[index]![0]
      const name = this.references[index]![1]
      const expected = this.references[index]![2]
      const descriptor = getDescriptor(object, name)
      if (!descriptor || descriptor.get || descriptor.set || descriptor.value !== expected)
        return this.reject(`changed native vector ${name}`)
    }
    for (let index = 0; index < policyNames.length; index++) {
      const name = policyNames[index]!
      const descriptor = dataDescriptor(this.input.owner, name)
      if (!descriptor || descriptor.get || descriptor.set || typeof descriptor.value !== "number")
        return this.reject(`custom native policy ${name}`)
    }
    const addDistance = dataDescriptor(this.input.owner, "ADD_SEGMENT_DISTANCE_TO_G")
    if (!addDistance || addDistance.get || addDistance.set || addDistance.value !== true)
      return this.reject("custom distance policy")
    const partialRip = dataDescriptor(this.input.owner, "PARTIAL_RIP_ENABLED")
    if (!partialRip || partialRip.get || partialRip.set || typeof partialRip.value !== "boolean")
      return this.reject("custom partial-rip policy")
    if (this.input.costMemo && dataDescriptor(this.input.costMemo, "get")?.value !== nativeMemoGet)
      return this.reject("custom native cost memo")
    if (dataDescriptor(state.candidateQueue, "queueValues")?.value !== nativeQueueValues)
      return this.reject("custom native queue visitor")
    for (let index = 0; index < intrinsicSnapshots.length; index++) {
      const snapshot = intrinsicSnapshots[index]!
      const descriptor = getDescriptor(snapshot[0], snapshot[1])
      if (!descriptor || descriptor.get || descriptor.set || descriptor.value !== snapshot[2])
        return this.reject(`custom native intrinsic ${snapshot[1]}`)
    }
    for (let index = 0; index < mathNames.length; index++) {
      const name = mathNames[index]!
      const expected = nativeMath[index]
      const descriptor = getDescriptor(mathObject, name)
      if (!descriptor || descriptor.get || descriptor.set || descriptor.value !== expected)
        return this.reject(`custom Math.${name}`)
    }
    for (let index = 0; index < stateNames.length; index++) {
      const name = stateNames[index]!
      const descriptor = getDescriptor(state, name)
      if (!descriptor || descriptor.get || descriptor.set || typeof descriptor.value !== "number")
        return this.reject(`custom native state ${name}`)
    }
    const assigned = getDescriptor(state, "portAssignment")
    if (!assigned || assigned.get || assigned.set || !(assigned.value instanceof Int32Array))
      return this.reject("custom assignment state")
    const congestion = getDescriptor(state, "regionCongestionCost")
    if (!congestion || congestion.get || congestion.set || !(congestion.value instanceof Float64Array) ||
      congestion.value.length !== this.input.owner.topology.regionCount)
      return this.reject("custom congestion state")
    if (!nativeInteger(state.candidateBestCostGeneration) || state.candidateBestCostGeneration < 1 ||
      state.candidateBestCostGeneration > 0xffffffff || !nativeInteger(state.goalPortId) ||
      state.goalPortId < 0 || state.goalPortId >= this.assigned.length ||
      !nativeInteger(state.currentRouteNetId) || state.currentRouteNetId! < -0x80000000 ||
      state.currentRouteNetId! > 0x7fffffff) return this.reject("non-native route state")
    return true
  }

  scan(candidate: Candidate, searchGeneration: number, state: TinyHyperGraphSolver["state"],
    sourceX: number, sourceY: number): TinyOrderedNeighborBatch | undefined {
    if (isTinyNativeFallbackRun() || this.provenance.excluded || (this.provenance.scope?.paused && !this.provenance.scope.finished)) {
      this.reject("unverified synchronous owner")
      return undefined
    }
    const scope = this.provenance.scope
    if (scope?.open) {
      if (this.validatedScope !== scope) {
        if (!this.eligible(state)) return undefined
        if (canTrustTinyNativeScopeChild(scope, this.input.owner)) this.validatedScope = scope
        else { this.reject("unverified synchronous child"); return undefined }
      }
      if (this.validatedScope === scope) scope.diagnostics.trustedBatches++
      else if (!this.eligible(state)) return undefined
    } else if (!this.eligible(state)) return undefined
    this.ensureBestGeneration(state.candidateBestCostGeneration)
    if (searchGeneration !== this.lastSearchGeneration || state.portAssignment !== this.assignedReference) {
      nativeApply(nativeTypedSet, this.assigned, [state.portAssignment])
      this.assignedReference = state.portAssignment
      this.lastSearchGeneration = searchGeneration
    }
    const { offsets, getActiveWord, owner } = this.input
    const start = offsets[candidate.nextRegionId]!
    const end = offsets[candidate.nextRegionId + 1]!
    if (start < end) for (let word = start >>> 5; word <= (end - 1) >>> 5; word++)
      this.words[word] = getActiveWord(word)
    const p = this.pointers
    const count = this.exports.scan(p[0]!, p[1]!, p[2]!, p[3]!, p[4]!, p[5]!, p[6]!,
      p[7]!, p[8]!, p[9]!, p[10]!, p[11]!, p[12]!, p[13]!, p[14]!,
      start, end, candidate.portId, state.goalPortId, state.currentRouteNetId!,
      sourceX, sourceY, candidate.g, state.regionCongestionCost[candidate.nextRegionId]!,
      owner.DISTANCE_TO_COST, state.candidateBestCostGeneration)
    if (!nativeInteger(count) || count < 0 || count > this.positions.length)
      throw new Error("Native Tiny neighbor kernel returned an invalid survivor count")
    this.diagnostics.batches++
    this.diagnostics.survivors += count
    this.batch.count = count
    return this.batch
  }
}

export function createTinyOrderedNeighborKernel(input: KernelInput): TinyOrderedNeighborKernel | undefined {
  const { owner, offsets, ports, nextRegions, hops } = input
  const provenance = ownedInputs.get(owner.topology)?.get(owner.problem)
  if (!provenance || provenance.excluded || isTinyNativeFallbackRun() || typeof WebAssembly === "undefined") return undefined
  const { topology, problem, state } = owner
  if (!(topology.portX instanceof Float64Array) || !(topology.portY instanceof Float64Array) ||
    !(problem.portSectionMask instanceof Int8Array) || !(problem.regionNetId instanceof Int32Array) ||
    (problem.portPenalty !== undefined && !(problem.portPenalty instanceof Float64Array)) ||
    !(state.portAssignment instanceof Int32Array) ||
    !(owner.problemSetup.portEndpointReservationNetId instanceof Int32Array) ||
    !(state.candidateBestCostByHopId instanceof Float64Array) ||
    !(state.candidateBestCostGenerationByHopId instanceof Uint32Array) ||
    topology.portX.length !== topology.portCount || topology.portY.length !== topology.portCount ||
    problem.portSectionMask.length !== topology.portCount ||
    owner.problemSetup.portEndpointReservationNetId.length !== topology.portCount ||
    state.portAssignment.length !== topology.portCount || problem.regionNetId.length !== topology.regionCount ||
    (problem.portPenalty !== undefined && problem.portPenalty.length !== topology.portCount) ||
    state.candidateBestCostByHopId.length !== state.candidateBestCostGenerationByHopId.length ||
    offsets.length !== topology.regionCount + 1 || ports.length !== nextRegions.length ||
    ports.length !== hops.length) return undefined
  if (offsets[0] !== 0 || offsets[topology.regionCount] !== ports.length) return undefined
  let maximumIncidences = 0
  for (let region = 0; region < topology.regionCount; region++)
    if (offsets[region]! > offsets[region + 1]!) return undefined
    else if (offsets[region + 1]! - offsets[region]! > maximumIncidences)
      maximumIncidences = offsets[region + 1]! - offsets[region]!
  // The checked-in scalar module has a 64KiB heap base; include all alignment
  // padding conservatively. Oversized graphs retain the original packed loop.
  const mirroredByteBound = 65536 + 15 * 8 + ports.length * 12 + topology.portCount * 33 +
    topology.regionCount * 4 + state.candidateBestCostByHopId.length * 12 +
    ((ports.length + 31) >>> 5) * 4 + maximumIncidences * 12
  if (mirroredByteBound > MAX_BYTES) return undefined
  for (let position = 0; position < ports.length; position++) {
    const port = ports[position]!, region = nextRegions[position]!, hop = hops[position]!
    if (port < 0 || port >= topology.portCount || region < -1 || region >= topology.regionCount ||
      !nativeInteger(hop) || hop < 0 || hop > 0x7fffffff ||
      (region !== -1 && hop >= state.candidateBestCostByHopId.length)) return undefined
  }
  return new TinyOrderedNeighborKernel(input, provenance)
}
