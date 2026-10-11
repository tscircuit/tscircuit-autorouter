import type { MessagePort } from "node:worker_threads"
import { initializeReferenceDrcRuntime, getReferenceDrcProxyInspector } from "./authoritative-drc-fork/initializeReferenceDrcRuntime"
import { executeParallelReferenceContinuityBatch } from "./parallelReferenceContinuityKernel"
import type { ParallelReferenceContinuityBatch, ParallelReferenceContinuityBatchResult } from "./parallelReferenceContinuityTypes"
import { getNativeSyncReferencePoolBinding, failNativeSyncReferencePool, type Pipeline9LocalWorkerPool } from "./Pipeline9LocalWorkerPool"
import { assertNativeSyncReferenceIdentity, assertNativeSyncReferenceResponse, assertParallelReferenceContinuityBatchResult, NativeSyncReferenceInfrastructureError,
  nativeSyncReferenceSchema, nativeSyncReferenceSchemaHash, type NativeSyncReferenceIdentity,
  type NativeSyncReferenceRequest, type NativeSyncReferenceResponse } from "./nativeSyncReferenceProtocol"

type NativeRuntime = {
  channel: typeof import("node:worker_threads").MessageChannel
  portPrototype: object
  receive: typeof import("node:worker_threads").receiveMessageOnPort
  portPost: typeof import("node:worker_threads").MessagePort.prototype.postMessage
  portClose: typeof import("node:worker_threads").MessagePort.prototype.close
  portHasRef: (this: MessagePort) => boolean
}
type WorkerLane = { worker: Worker; batch: ParallelReferenceContinuityBatch }
type PendingLane = WorkerLane & { identity: NativeSyncReferenceIdentity; port: MessagePort; words: Int32Array }
type ReservationSlot = { worker: Worker; state: "unready" | "idle" | "active" | "reserved" | "dead" }
export type NativeSyncReferenceReservation = { reservationId: number; workers: readonly Worker[] }
export type NativeSyncReferenceTransportStats = {
  reservationsGranted: number; reservationsDeclined: number; workersReserved: number; workersRetired: number
  batchesCompleted: number; factRowsCompleted: number; mainFactRowsCompleted: number; protocolFailures: number
}
export type NativeSyncReferenceFactStats = {
  reservationsGranted: number; reservationsDeclined: number; workersReserved: number; workersRetired: number
  batchesCompleted: number; workerFactRowsCompleted: number; mainFactRowsCompleted: number; protocolFaults: number
  maxFactWorkerLanes: number; mainFactLaneCount: number
}
export type NativeSyncReferenceFactExecutor = (batch: ParallelReferenceContinuityBatch) => ParallelReferenceContinuityBatchResult | undefined
const getDescriptor = Object.getOwnPropertyDescriptor
const getDescriptors = Object.getOwnPropertyDescriptors
const getPrototype = Object.getPrototypeOf
const ownKeys = Reflect.ownKeys
const apply = Reflect.apply
const hasOwn = Object.prototype.hasOwnProperty
const nativeIsSafeInteger = Number.isSafeInteger
const NativeInt32 = Int32Array
const NativeShared = getDescriptor(globalThis, "SharedArrayBuffer")?.value as typeof SharedArrayBuffer | undefined
const sharedPrototype = NativeShared && getDescriptor(NativeShared, "prototype")!.value as object
const sharedLength = sharedPrototype && getDescriptor(sharedPrototype, "byteLength")!.get!
const atomicLoad = Atomics.load
const atomicStore = Atomics.store
const atomicWait = Atomics.wait
const atomicNotify = Atomics.notify
const nativeNow = Date.now
const minimum = Math.min
const maximum = Math.max
const nativeArraySort = Array.prototype.sort
const nativeArrayPush = Array.prototype.push
const nativeArraySome = Array.prototype.some
const nativeArrayFind = Array.prototype.find
const nativeArrayFilter = Array.prototype.filter
const nativeArraySlice = Array.prototype.slice
const nativeArrayMap = Array.prototype.map
const NativeWeakSet = WeakSet
const nativeWeakSetAdd = WeakSet.prototype.add
const nativeWeakSetHas = WeakSet.prototype.has
const NativeWeakMap = WeakMap
const nativeWeakMapGet = WeakMap.prototype.get
const nativeWeakMapSet = WeakMap.prototype.set
const nativeBooks = new NativeWeakSet<object>()
const nativeTransports = new NativeWeakSet<object>()
const nativeFactExecutors = new NativeWeakSet<object>()
const executorBindings = new NativeWeakMap<object, { pool: Pipeline9LocalWorkerPool; book: NativeSyncReferenceReservationBook; transport: NativeSyncReferenceBatchTransport }>()
const bookFailures = new NativeWeakMap<object, Error>()
const nativeTransportDeadlines = new NativeWeakMap<object, number>()
const nativeBookGraphs = new NativeWeakMap<object, { slots: ReservationSlot[]; stats: NativeSyncReferenceTransportStats }>()
const authoritativeFactStats = new NativeWeakMap<object, NativeSyncReferenceFactStats>()
const countedFactFaults = new NativeWeakSet<object>()
const nativeReservationRows = new NativeWeakMap<object, Worker>()
const nativeArrayIsArray = Array.isArray
const nativeArrayPrototype = Array.prototype
const nativeObjectPrototype = Object.prototype
const nativeWorker = getDescriptor(globalThis, "Worker")?.value as typeof Worker | undefined
const workerPrototype = nativeWorker && getDescriptor(nativeWorker, "prototype")!.value as object
const workerPost = workerPrototype && getDescriptor(workerPrototype, "postMessage")!.value as Worker["postMessage"]
const workerTerminate = workerPrototype && getDescriptor(workerPrototype, "terminate")!.value as Worker["terminate"]
let runtime: NativeRuntime | undefined
let initialization: Promise<void> | undefined

/** Missing Node/SAB support declines before reservation; public browser imports stay valid. */
export async function initializeNativeSyncReferenceTransport(): Promise<void> {
  initialization ??= (async (): Promise<void> => {
    await initializeReferenceDrcRuntime()
    if (!NativeShared || !getReferenceDrcProxyInspector()) return
    let module: typeof import("node:worker_threads")
    try { module = await import(["node", "worker_threads"].join(":")) as typeof import("node:worker_threads") }
    catch { return }
    const channel = getDescriptor(module, "MessageChannel")?.value as NativeRuntime["channel"] | undefined
    const port = getDescriptor(module, "MessagePort")?.value as typeof import("node:worker_threads").MessagePort | undefined
    const receive = getDescriptor(module, "receiveMessageOnPort")?.value as NativeRuntime["receive"] | undefined
    if (typeof channel !== "function" || typeof port !== "function" || typeof receive !== "function") return
    const portPrototype = getDescriptor(port, "prototype")!.value as object
    const portPost = getDescriptor(portPrototype, "postMessage")?.value as NativeRuntime["portPost"] | undefined
    const portClose = getDescriptor(portPrototype, "close")?.value as NativeRuntime["portClose"] | undefined
    const portHasRef = getDescriptor(portPrototype, "hasRef")?.value as NativeRuntime["portHasRef"] | undefined
    if (typeof portPost !== "function" || typeof portClose !== "function" || typeof portHasRef !== "function") return
    runtime = { channel, portPrototype, receive, portPost, portClose, portHasRef }
  })()
  await initialization
}

function invariant(condition: unknown, message: string): asserts condition {
  if (!condition) throw new NativeSyncReferenceInfrastructureError(message)
}

function factStatsForBook(book: object): NativeSyncReferenceFactStats {
  const stats = apply(nativeWeakMapGet, authoritativeFactStats, [book]) as NativeSyncReferenceFactStats | undefined
  if (!stats) {
    throw new NativeSyncReferenceInfrastructureError("Reference fact counters lost their private book ownership")
  }
  return stats
}

function recordFactProtocolFault(book: object, reservation: NativeSyncReferenceReservation): void {
  if (apply(nativeWeakSetHas, countedFactFaults, [reservation])) return
  const stats = factStatsForBook(book)
  apply(nativeWeakSetAdd, countedFactFaults, [reservation])
  stats.protocolFaults++
}

/** A copied private ledger survives disposal without reading public control or stats fields. */
export function snapshotNativeSyncReferenceBookStats(book: unknown): NativeSyncReferenceFactStats | undefined {
  if ((typeof book !== "object" || book === null) && typeof book !== "function") return undefined
  const stats = apply(nativeWeakMapGet, authoritativeFactStats, [book]) as NativeSyncReferenceFactStats | undefined
  if (!stats) return undefined
  return { reservationsGranted: stats.reservationsGranted, reservationsDeclined: stats.reservationsDeclined,
    workersReserved: stats.workersReserved, workersRetired: stats.workersRetired, batchesCompleted: stats.batchesCompleted,
    workerFactRowsCompleted: stats.workerFactRowsCompleted, mainFactRowsCompleted: stats.mainFactRowsCompleted,
    protocolFaults: stats.protocolFaults, maxFactWorkerLanes: stats.maxFactWorkerLanes, mainFactLaneCount: stats.mainFactLaneCount }
}

/** Ledger has no callbacks: synchronous work cannot await ordinary task retirement. */
export class NativeSyncReferenceReservationBook {
  private readonly slots: ReservationSlot[] = []
  private queued = 0
  private nextReservationId = 0
  private activeReservation: NativeSyncReferenceReservation | undefined
  private terminalError: Error | undefined
  readonly stats: NativeSyncReferenceTransportStats = { reservationsGranted: 0, reservationsDeclined: 0,
    workersReserved: 0, workersRetired: 0, batchesCompleted: 0, factRowsCompleted: 0,
    mainFactRowsCompleted: 0, protocolFailures: 0 }

  constructor() {
    apply(nativeWeakSetAdd, nativeBooks, [this])
    apply(nativeWeakMapSet, nativeBookGraphs, [this, { slots: this.slots, stats: this.stats }])
    apply(nativeWeakMapSet, authoritativeFactStats, [this, { reservationsGranted: 0, reservationsDeclined: 0,
      workersReserved: 0, workersRetired: 0, batchesCompleted: 0, workerFactRowsCompleted: 0,
      mainFactRowsCompleted: 0, protocolFaults: 0, maxFactWorkerLanes: 0, mainFactLaneCount: 0 }])
  }

  register(worker: Worker): void {
    invariant(!this.terminalError && this.slots.length < 4 && !apply(nativeArraySome, this.slots, [(slot: ReservationSlot): boolean => slot.worker === worker]),
      "Invalid synchronous reference worker registration")
    const slot: ReservationSlot = { worker, state: "unready" }
    apply(nativeWeakMapSet, nativeReservationRows, [slot, worker])
    apply(nativeArrayPush, this.slots, [slot])
  }

  setQueuedCount(count: number): void {
    invariant(nativeIsSafeInteger(count) && count >= 0 && !this.terminalError, "Invalid synchronous reference queue count")
    this.queued = count
  }

  beginOrdinary(worker: Worker): void {
    const slot = apply(nativeArrayFind, this.slots, [(item: ReservationSlot): boolean => item.worker === worker]) as ReservationSlot | undefined
    invariant(slot && !this.terminalError && (slot.state === "unready" || slot.state === "idle"),
      "Ordinary dispatch attempted to consume a reference reservation")
    slot.state = "active"
  }

  finishOrdinary(worker: Worker): void {
    const slot = apply(nativeArrayFind, this.slots, [(item: ReservationSlot): boolean => item.worker === worker]) as ReservationSlot | undefined
    invariant(slot && !this.terminalError && slot.state === "active", "Unexpected ordinary reference worker retirement")
    slot.state = "idle"
  }

  reserve(maximum = 3): NativeSyncReferenceReservation | undefined {
    if (this.terminalError) throw this.terminalError
    invariant(nativeIsSafeInteger(maximum) && maximum >= 1 && maximum <= 3, "Reference lane count must leave main as the fourth core")
    if (!runtime || !NativeShared || this.activeReservation || this.queued > 0 ||
      apply(nativeArraySome, this.slots, [(slot: ReservationSlot): boolean => slot.state === "active" || slot.state === "reserved" || slot.state === "dead"])) {
      this.stats.reservationsDeclined++
      factStatsForBook(this).reservationsDeclined++
      return undefined
    }
    const selected = apply(nativeArraySlice, apply(nativeArrayFilter, this.slots, [(slot: ReservationSlot): boolean => slot.state === "idle"]), [0, maximum]) as ReservationSlot[]
    if (selected.length === 0) { this.stats.reservationsDeclined++; factStatsForBook(this).reservationsDeclined++; return undefined }
    for (let index = 0; index < selected.length; index++) selected[index]!.state = "reserved"
    const reservation = { reservationId: ++this.nextReservationId, workers: apply(nativeArrayMap, selected, [(slot: ReservationSlot): Worker => slot.worker]) as Worker[] }
    this.activeReservation = reservation
    this.stats.reservationsGranted++
    this.stats.workersReserved += selected.length
    const facts = factStatsForBook(this)
    facts.reservationsGranted++
    facts.workersReserved += selected.length
    if (selected.length > facts.maxFactWorkerLanes) facts.maxFactWorkerLanes = selected.length
    return reservation
  }

  retire(reservation: NativeSyncReferenceReservation): void {
    this.assertReservation(reservation)
    for (let index = 0; index < reservation.workers.length; index++) {
      const worker = reservation.workers[index]!
      const slot = apply(nativeArrayFind, this.slots, [(item: ReservationSlot): boolean => item.worker === worker]) as ReservationSlot | undefined
      invariant(slot?.state === "reserved", "Reference reservation lost worker ownership")
      slot.state = "idle"
      this.stats.workersRetired++
      factStatsForBook(this).workersRetired++
    }
    this.activeReservation = undefined
  }

  assertReservation(reservation: NativeSyncReferenceReservation): void {
    if (this.terminalError) throw this.terminalError
    invariant(reservation === this.activeReservation, "Stale synchronous reference reservation")
    for (let index = 0; index < reservation.workers.length; index++) {
      const worker = reservation.workers[index]!
      const slot = apply(nativeArrayFind, this.slots, [(item: ReservationSlot): boolean => item.worker === worker]) as ReservationSlot | undefined
      invariant(slot?.state === "reserved", "Reference reservation lost worker ownership")
    }
  }

  fail(error: Error): void {
    if (this.terminalError) return
    this.terminalError = error
    apply(nativeWeakMapSet, bookFailures, [this, error])
    this.stats.protocolFailures++
    for (let index = 0; index < this.slots.length; index++) {
      const slot = this.slots[index]!
      if (slot.state === "reserved") { this.stats.workersRetired++; factStatsForBook(this).workersRetired++ }
      slot.state = "dead"
      if (workerTerminate) apply(workerTerminate, slot.worker, [])
    }
    this.activeReservation = undefined
  }
}

/** Private pool leases supply already-idle workers; main never waits on pool.onmessage. */
export class NativeSyncReferenceBatchTransport {
  constructor(private readonly book: NativeSyncReferenceReservationBook, private readonly deadlineMs = 30_000) {
    invariant(nativeIsSafeInteger(deadlineMs) && deadlineMs > 0 && deadlineMs <= 30_000, "Invalid synchronous reference infrastructure deadline")
    apply(nativeWeakSetAdd, nativeTransports, [this])
    apply(nativeWeakMapSet, nativeTransportDeadlines, [this, deadlineMs])
  }

  execute(reservation: NativeSyncReferenceReservation, lanes: readonly WorkerLane[], mainBatch?: ParallelReferenceContinuityBatch): ParallelReferenceContinuityBatchResult[] {
    const native = runtime
    const pending: PendingLane[] = []
    const results: ParallelReferenceContinuityBatchResult[] = []
    try {
      invariant(native && NativeShared && workerPost && lanes.length > 0 && lanes.length <= 3 &&
        lanes.length === reservation.workers.length, "Reference transport has no admitted runtime/reservation")
      this.book.assertReservation(reservation)
      const expires = nativeNow() + this.deadlineMs
      for (let ordinal = 0; ordinal < lanes.length; ordinal++) {
        const lane = lanes[ordinal]!
        invariant(lane.worker === reservation.workers[ordinal], "Reference lane changed reserved worker")
        const channel = new native.channel()
        const signal = new NativeShared(NativeInt32.BYTES_PER_ELEMENT)
        const words = new NativeInt32(signal)
        const identity: NativeSyncReferenceIdentity = { schema: nativeSyncReferenceSchema, schemaHash: nativeSyncReferenceSchemaHash,
          reservationId: reservation.reservationId, ordinal, laneCount: lanes.length,
          snapshotId: lane.batch.context.snapshotId, taskCount: lane.batch.tasks.length }
        assertNativeSyncReferenceIdentity(identity)
        pending.push({ ...lane, identity, port: channel.port1, words })
        const request: NativeSyncReferenceRequest = { ...identity, kind: "nativeSyncReferenceFacts", port: channel.port2, signal, batch: lane.batch }
        try { apply(workerPost, lane.worker, [request, [channel.port2]]) }
        catch (error: unknown) { apply(native.portClose, channel.port2, []); throw error }
      }
      if (mainBatch) {
        factStatsForBook(this.book).mainFactLaneCount = 1
        const result = executeParallelReferenceContinuityBatch(mainBatch)
        assertParallelReferenceContinuityBatchResult(result, mainBatch)
        results.push(result)
        this.book.stats.mainFactRowsCompleted += result.facts.length
      }
      for (const lane of pending) {
        let remaining = expires - nativeNow()
        while (atomicLoad(lane.words, 0) === 0 && remaining > 0) {
          atomicWait(lane.words, 0, 0, remaining)
          remaining = expires - nativeNow()
        }
        invariant(remaining > 0 && atomicLoad(lane.words, 0) === 1, "Synchronous reference infrastructure deadline/terminal signal failed")
        const received = native.receive(lane.port)
        invariant(received !== undefined, "Reference worker signalled without an owned MessagePort result")
        assertNativeSyncReferenceResponse(received.message, lane.identity, lane.batch)
        invariant(native.receive(lane.port) === undefined, "Duplicate synchronous reference result")
        if (received.message.status === "infrastructure-error") {
          throw new NativeSyncReferenceInfrastructureError(`Reference worker infrastructure failure: ${received.message.error.name}: ${received.message.error.message}`)
        }
        results.push(received.message.result)
        this.book.stats.factRowsCompleted += received.message.result.facts.length
      }
      this.book.stats.batchesCompleted++
      this.book.retire(reservation)
      return results
    } catch (error: unknown) {
      const failure = error instanceof Error ? error : new NativeSyncReferenceInfrastructureError("Reference transport threw a non-error value")
      recordFactProtocolFault(this.book, reservation)
      this.book.fail(failure)
      throw failure
    } finally {
      for (const lane of pending) apply(native!.portClose, lane.port, [])
    }
  }
}

const bookPrototype = NativeSyncReferenceReservationBook.prototype
const transportPrototype = NativeSyncReferenceBatchTransport.prototype
const bookPrototypeDescriptors = getDescriptors(bookPrototype)
const transportPrototypeDescriptors = getDescriptors(transportPrototype)
const reserveNative = NativeSyncReferenceReservationBook.prototype.reserve
const executeNative = NativeSyncReferenceBatchTransport.prototype.execute

function hasOwnedTransportState(transport: NativeSyncReferenceBatchTransport, book: NativeSyncReferenceReservationBook): boolean {
  const keys = ownKeys(transport)
  if (keys.length !== 2 || keys[0] !== "book" || keys[1] !== "deadlineMs" || getPrototype(transport) !== transportPrototype) return false
  const owner = getDescriptor(transport, "book"), deadline = getDescriptor(transport, "deadlineMs")
  return !!owner && apply(hasOwn, owner, ["value"]) && owner.value === book && !!deadline &&
    apply(hasOwn, deadline, ["value"]) && deadline.value === apply(nativeWeakMapGet, nativeTransportDeadlines, [transport])
}

function ownDataField(value: object, name: string): unknown {
  const descriptor = getDescriptor(value, name)
  return descriptor && apply(hasOwn, descriptor, ["value"]) ? descriptor.value : undefined
}

/** Inactive ordinary bookkeeping never reads caller-replaced ledger accessors. */
export function canMaintainNativeSyncReferenceLedger(book: NativeSyncReferenceReservationBook): boolean {
  const graph = apply(nativeWeakMapGet, nativeBookGraphs, [book]) as { slots: ReservationSlot[]; stats: NativeSyncReferenceTransportStats } | undefined
  if (!graph || !matchesPrototype(bookPrototype, bookPrototypeDescriptors)) return false
  const fields = ["slots", "queued", "nextReservationId", "activeReservation", "terminalError", "stats"]
  const keys = ownKeys(book)
  if (keys.length !== fields.length) return false
  for (let index = 0; index < fields.length; index++) {
    const descriptor = getDescriptor(book, fields[index]!)
    if (keys[index] !== fields[index] || !descriptor || !apply(hasOwn, descriptor, ["value"]) || !descriptor.writable) return false
  }
  if (ownDataField(book, "slots") !== graph.slots || ownDataField(book, "stats") !== graph.stats ||
    ownDataField(book, "terminalError") !== undefined || ownDataField(book, "activeReservation") !== undefined ||
    !nativeIsSafeInteger(ownDataField(book, "queued")) || !nativeIsSafeInteger(ownDataField(book, "nextReservationId"))) return false
  const length = getDescriptor(graph.slots, "length")
  if (!length || !apply(hasOwn, length, ["value"]) || !length.writable || !nativeIsSafeInteger(length.value) ||
    length.value < 0 || length.value > 4 || getPrototype(graph.slots) !== nativeArrayPrototype) return false
  for (let index = 0; index < length.value; index++) {
    const row = getDescriptor(graph.slots, `${index}`)
    if (!row || !apply(hasOwn, row, ["value"]) || typeof row.value !== "object" || row.value === null) return false
    const worker = apply(nativeWeakMapGet, nativeReservationRows, [row.value]) as Worker | undefined
    if (!worker || getPrototype(row.value) !== nativeObjectPrototype || ownKeys(row.value).length !== 2) return false
    const identity = getDescriptor(row.value, "worker"), state = getDescriptor(row.value, "state")
    if (!identity || !apply(hasOwn, identity, ["value"]) || identity.value !== worker || !state ||
      !apply(hasOwn, state, ["value"]) || !state.writable || (state.value !== "unready" && state.value !== "idle" && state.value !== "active")) return false
  }
  const statsFields = ["reservationsGranted", "reservationsDeclined", "workersReserved", "workersRetired",
    "batchesCompleted", "factRowsCompleted", "mainFactRowsCompleted", "protocolFailures"]
  if (getPrototype(graph.stats) !== nativeObjectPrototype || ownKeys(graph.stats).length !== statsFields.length) return false
  for (let index = 0; index < statsFields.length; index++) {
    const descriptor = getDescriptor(graph.stats, statsFields[index]!)
    if (!descriptor || !apply(hasOwn, descriptor, ["value"]) || !descriptor.writable ||
      !nativeIsSafeInteger(descriptor.value) || descriptor.value < 0) return false
  }
  return true
}

/** Probe only owned descriptors; unsupported metadata cannot invoke callbacks. */
function hasAvailableOwnedReferenceSlots(book: NativeSyncReferenceReservationBook): boolean {
  const failure = apply(nativeWeakMapGet, bookFailures, [book]) as Error | undefined
  if (failure) throw failure
  if (!runtime || !NativeShared || !matchesPrototype(bookPrototype, bookPrototypeDescriptors) ||
    !matchesPrototype(transportPrototype, transportPrototypeDescriptors)) return false
  const fields = ["slots", "queued", "nextReservationId", "activeReservation", "terminalError", "stats"]
  const keys = ownKeys(book)
  if (keys.length !== fields.length) return false
  for (let index = 0; index < fields.length; index++) {
    const descriptor = getDescriptor(book, fields[index]!)
    if (keys[index] !== fields[index] || !descriptor || !apply(hasOwn, descriptor, ["value"]) || !descriptor.writable) return false
  }
  const queued = ownDataField(book, "queued"), active = ownDataField(book, "activeReservation")
  const terminal = ownDataField(book, "terminalError"), slots = ownDataField(book, "slots")
  if (queued !== 0 || active !== undefined || terminal !== undefined || !nativeArrayIsArray(slots)) return false
  const inspector = getReferenceDrcProxyInspector()
  if (!inspector || inspector(slots) || getPrototype(slots) !== nativeArrayPrototype) return false
  const stats = ownDataField(book, "stats")
  if (typeof stats !== "object" || stats === null || inspector(stats) || getPrototype(stats) !== nativeObjectPrototype) return false
  const statFields = ["reservationsGranted", "reservationsDeclined", "workersReserved", "workersRetired",
    "batchesCompleted", "factRowsCompleted", "mainFactRowsCompleted", "protocolFailures"]
  if (ownKeys(stats).length !== statFields.length) return false
  for (let index = 0; index < statFields.length; index++) {
    const descriptor = getDescriptor(stats, statFields[index]!)
    if (!descriptor || !apply(hasOwn, descriptor, ["value"]) || !descriptor.writable || !nativeIsSafeInteger(descriptor.value) || descriptor.value < 0) return false
  }
  const length = ownDataField(slots, "length")
  if (typeof length !== "number" || length > 4) return false
  let available = 0
  for (let index = 0; index < length; index++) {
    const slot = ownDataField(slots, `${index}`)
    if (typeof slot !== "object" || slot === null || inspector(slot)) return false
    const stateDescriptor = getDescriptor(slot, "state"), workerDescriptor = getDescriptor(slot, "worker")
    if (!stateDescriptor || !apply(hasOwn, stateDescriptor, ["value"]) || !stateDescriptor.writable ||
      !workerDescriptor || !apply(hasOwn, workerDescriptor, ["value"])) return false
    const state = ownDataField(slot, "state")
    if (state === "active" || state === "reserved" || state === "dead") return false
    if (state === "idle") available++
    else if (state !== "unready") return false
  }
  return available > 0
}

/** Constructor admission compares captured library methods without executing hooks. */
export function hasNativeSyncReferenceTransportContract(): boolean {
  return matchesPrototype(bookPrototype, bookPrototypeDescriptors) &&
    matchesPrototype(transportPrototype, transportPrototypeDescriptors)
}

function matchesPrototype(prototype: object, baseline: PropertyDescriptorMap): boolean {
  const keys = ownKeys(prototype), expected = ownKeys(baseline)
  if (keys.length !== expected.length) return false
  for (let index = 0; index < keys.length; index++) {
    const key = keys[index]!
    if (key !== expected[index]) return false
    const value = getDescriptor(prototype, key)!, original = getDescriptor(baseline, key)!.value as PropertyDescriptor
    if (!apply(hasOwn, value, ["value"]) || value.value !== original.value || value.writable !== original.writable ||
      value.configurable !== original.configurable || value.enumerable !== original.enumerable) return false
  }
  return true
}

/** A scheduling estimate changes only lane assignment, never native fact execution. */
function partitionFactTasks(batch: ParallelReferenceContinuityBatch, laneCount: number): ParallelReferenceContinuityBatch[] {
  const assigned: { position: number; weight: number }[][] = []
  const weights: number[] = []
  const ordered: { position: number; weight: number }[] = []
  const polygonEdges: number[] = []
  if (batch.context.geometryPolygons) {
    for (let index = 0; index < batch.context.geometryPolygons.length; index++) {
      const polygon = batch.context.geometryPolygons[index]!
      let edges = 0
      for (let face = 0; face < polygon.faces.length; face++) edges += polygon.faces[face]!.length
      apply(nativeArrayPush, polygonEdges, [edges])
    }
  }
  for (let lane = 0; lane < laneCount; lane++) { assigned.push([]); weights.push(0) }
  for (let position = 0; position < batch.tasks.length; position++) {
    const task = batch.tasks[position]!
    let weight: number
    if (task.kind === "port-connectivity") {
      weight = maximum(1, batch.context.componentOffsets[task.componentIndex + 1]! - batch.context.componentOffsets[task.componentIndex]!)
    } else if (task.kind === "native-trace-pair-miss") {
      weight = maximum(1, (batch.context.geometryTraces![task.leftTraceIndex]!.route.length - 1) *
        (batch.context.geometryTraces![task.rightTraceIndex]!.route.length - 1))
    } else {
      weight = maximum(1, polygonEdges[task.leftPolygonIndex]! * polygonEdges[task.rightPolygonIndex]!)
    }
    apply(nativeArrayPush, ordered, [{ position, weight }])
  }
  apply(nativeArraySort, ordered, [(left: { position: number; weight: number }, right: { position: number; weight: number }): number =>
    right.weight - left.weight || left.position - right.position])
  for (let index = 0; index < ordered.length; index++) {
    let lane = 0
    for (let candidate = 1; candidate < laneCount; candidate++) if (weights[candidate]! < weights[lane]!) lane = candidate
    const row = ordered[index]!
    apply(nativeArrayPush, assigned[lane]!, [row])
    weights[lane] = weights[lane]! + row.weight
  }
  const groups: ParallelReferenceContinuityBatch[] = []
  for (let lane = 0; lane < laneCount; lane++) {
    const rows = assigned[lane]!
    apply(nativeArraySort, rows, [(left: { position: number }, right: { position: number }): number => left.position - right.position])
    const tasks: ParallelReferenceContinuityBatch["tasks"][number][] = []
    for (let index = 0; index < rows.length; index++) apply(nativeArrayPush, tasks, [batch.tasks[rows[index]!.position]!])
    apply(nativeArrayPush, groups, [{ ...batch, tasks }])
  }
  return groups
}

/** No caller-provided function becomes a native fact executor through this factory. */
export function createNativeSyncReferenceFactExecutor(pool: Pipeline9LocalWorkerPool): NativeSyncReferenceFactExecutor | undefined {
  const binding = getNativeSyncReferencePoolBinding(pool)
  if (!binding) return undefined
  const { book, transport } = binding
  invariant(apply(nativeWeakSetHas, nativeBooks, [book]) && apply(nativeWeakSetHas, nativeTransports, [transport]) &&
    getPrototype(book) === bookPrototype && getPrototype(transport) === transportPrototype,
    "Reference executor requires the exact owned native reservation/transport instances")
  invariant(hasOwnedTransportState(transport, book),
    "Reference executor transport belongs to another reservation book")
  const executor: NativeSyncReferenceFactExecutor = (batch): ParallelReferenceContinuityBatchResult | undefined => {
    const current = getNativeSyncReferencePoolBinding(pool)
    if (!current || current.book !== book || current.transport !== transport) return undefined
    if (!hasOwnedTransportState(transport, book)) return undefined
    let available: boolean
    try { available = hasAvailableOwnedReferenceSlots(book) }
    catch (error: unknown) {
      invariant(error instanceof Error, "Reference availability failed with a non-error value")
      failNativeSyncReferencePool(pool, error)
      throw error
    }
    if (!available || batch.tasks.length < 2) return undefined
    const maximumWorkers = minimum(3, batch.tasks.length - 1)
    const reservation = apply(reserveNative, book, [maximumWorkers]) as NativeSyncReferenceReservation | undefined
    if (!reservation) return undefined
    try {
      const groups = partitionFactTasks(batch, reservation.workers.length + 1)
      const lanes: WorkerLane[] = []
      for (let lane = 0; lane < reservation.workers.length; lane++) lanes.push({ worker: reservation.workers[lane]!, batch: groups[lane]! })
      const results = apply(executeNative, transport, [reservation, lanes, groups[groups.length - 1]!]) as ParallelReferenceContinuityBatchResult[]
      const factsByRow = new Map<number, ParallelReferenceContinuityBatchResult["facts"][number]>()
      for (let lane = 0; lane < results.length; lane++) for (let index = 0; index < results[lane]!.facts.length; index++) {
        const fact = results[lane]!.facts[index]!
        invariant(!factsByRow.has(fact.rowIndex), "Duplicate reference fact across CPU lanes")
        factsByRow.set(fact.rowIndex, fact)
      }
      const facts: ParallelReferenceContinuityBatchResult["facts"] = []
      for (let index = 0; index < batch.tasks.length; index++) {
        const fact = factsByRow.get(batch.tasks[index]!.rowIndex)
        invariant(fact !== undefined, "Reference task lost its CPU lane result")
        facts.push(fact)
      }
      const result: ParallelReferenceContinuityBatchResult = { kind: "referenceContinuityFacts", snapshotId: batch.context.snapshotId, facts }
      assertParallelReferenceContinuityBatchResult(result, batch)
      const stats = factStatsForBook(book)
      stats.batchesCompleted++
      stats.mainFactRowsCompleted += groups[groups.length - 1]!.tasks.length
      stats.workerFactRowsCompleted += batch.tasks.length - groups[groups.length - 1]!.tasks.length
      return result
    } catch (error: unknown) {
      const failure = error instanceof Error ? error : new NativeSyncReferenceInfrastructureError("Reference executor threw a non-error value")
      recordFactProtocolFault(book, reservation)
      book.fail(failure)
      failNativeSyncReferencePool(pool, failure)
      throw failure
    }
  }
  apply(nativeWeakSetAdd, nativeFactExecutors, [executor])
  apply(nativeWeakMapSet, executorBindings, [executor, { pool, book, transport }])
  return executor
}

/** WeakSet membership cannot invoke supplied getters, Proxy traps or callbacks. */
export function isNativeSyncReferenceFactExecutor(executor: unknown): executor is NativeSyncReferenceFactExecutor {
  return (typeof executor === "function" || (typeof executor === "object" && executor !== null)) &&
    apply(nativeWeakSetHas, nativeFactExecutors, [executor]) as boolean
}

/** This read-only probe precedes geometry cloning and never queues changed work. */
export function canAdmitNativeSyncReferenceFacts(executor: unknown): boolean {
  if ((typeof executor !== "function" && (typeof executor !== "object" || executor === null)) ||
    !apply(nativeWeakSetHas, nativeFactExecutors, [executor])) return false
  const binding = apply(nativeWeakMapGet, executorBindings, [executor]) as { pool: Pipeline9LocalWorkerPool; book: NativeSyncReferenceReservationBook; transport: NativeSyncReferenceBatchTransport } | undefined
  if (!binding) return false
  const current = getNativeSyncReferencePoolBinding(binding.pool)
  if (!current || current.book !== binding.book || current.transport !== binding.transport) return false
  if (!hasOwnedTransportState(binding.transport, binding.book)) return false
  try { return hasAvailableOwnedReferenceSlots(binding.book) }
  catch (error: unknown) {
    invariant(error instanceof Error, "Reference availability failed with a non-error value")
    failNativeSyncReferencePool(binding.pool, error)
    throw error
  }
}

/** Dedicated response only; an ordinary pool task acknowledgement would corrupt ownership. */
export async function executeNativeSyncReferenceWorkerRequest(request: unknown): Promise<void> {
  await initializeNativeSyncReferenceTransport()
  invariant(runtime && NativeShared, "Reference worker has no native port/SAB runtime")
  const native = runtime
  assertNativeSyncReferenceIdentity(request)
  const descriptorValue = (name: string): unknown => {
    const descriptor = getDescriptor(request, name)
    invariant(descriptor && apply(hasOwn, descriptor, ["value"]), `Reference request field ${name} is not own data`)
    return descriptor.value
  }
  const port = descriptorValue("port")
  const inspector = getReferenceDrcProxyInspector()!
  invariant(typeof port === "object" && port !== null && !inspector(port) && getPrototype(port) === native.portPrototype,
    "Reference request does not own a native MessagePort")
  apply(native.portHasRef, port, [])
  const signal = descriptorValue("signal")
  invariant(typeof signal === "object" && signal !== null && !inspector(signal) && getPrototype(signal) === sharedPrototype &&
    apply(sharedLength!, signal, []) === NativeInt32.BYTES_PER_ELEMENT, "Reference request has invalid shared terminal storage")
  const words = new NativeInt32(signal as SharedArrayBuffer)
  invariant(atomicLoad(words, 0) === 0, "Reference request terminal word is not fresh")
  let response: NativeSyncReferenceResponse
  const identity: NativeSyncReferenceIdentity = { schema: request.schema, schemaHash: request.schemaHash,
    reservationId: request.reservationId, ordinal: request.ordinal, laneCount: request.laneCount,
    snapshotId: request.snapshotId, taskCount: request.taskCount }
  try {
    invariant(descriptorValue("kind") === "nativeSyncReferenceFacts", "Unknown synchronous reference request")
    const batch = descriptorValue("batch") as ParallelReferenceContinuityBatch
    const result = executeParallelReferenceContinuityBatch(batch)
    response = { ...identity, status: "evaluated", result }
    assertNativeSyncReferenceResponse(response, identity, batch)
  } catch (error: unknown) {
    invariant(error instanceof Error, "Reference worker infrastructure failure is not an Error")
    response = { ...identity, status: "infrastructure-error", error: { name: error.name, message: error.message,
      ...(error.stack === undefined ? {} : { stack: error.stack }) } }
  }
  try { apply(native.portPost, port, [response]); apply(native.portClose, port, []) }
  finally { atomicStore(words, 0, 1); atomicNotify(words, 0) }
}
