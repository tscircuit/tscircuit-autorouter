import { strict as assert } from "node:assert"
import { createHash } from "node:crypto"

export const OWNER_FIELDS = ["usedCellsFlat", "portOwnerFlat", "usedDiagFlat"] as const
const BLOCK = 4096
const CONTROL_FIELDS = ["MAX_ITERATIONS", "MAX_RIPS", "stepMultiplier"] as const
type Solver = Record<string, any>
type Controls = Record<(typeof CONTROL_FIELDS)[number], number>

// Tagged plain JSON preserves optional undefined, -0, aliases and property order.
// Functions, accessors, symbols, nonfinite numbers and non-JSON objects fail shut.
export function encodeParams(value: unknown): any {
  const seen = new WeakMap<object, number>()
  let next = 0
  function encode(item: any): any {
    if (item === undefined) return ["undefined"]
    if (item === null || typeof item === "boolean" || typeof item === "string") return ["scalar", item]
    if (typeof item === "number") {
      assert(Number.isFinite(item), "Nonfinite constructor parameter")
      return Object.is(item, -0) ? ["minus-zero"] : ["scalar", item]
    }
    assert(typeof item === "object", "Unsupported constructor parameter type")
    const prior = seen.get(item)
    if (prior !== undefined) return ["ref", prior]
    assert(Array.isArray(item) || Object.getPrototypeOf(item) === Object.prototype || Object.getPrototypeOf(item) === null, "Unsupported constructor parameter object")
    assert.equal(Object.getOwnPropertySymbols(item).length, 0, "Symbol constructor parameter key")
    const id = next++
    seen.set(item, id)
    const entries: any[] = []
    for (const key of Object.getOwnPropertyNames(item)) {
      if (Array.isArray(item) && key === "length") continue
      const descriptor = Object.getOwnPropertyDescriptor(item, key)!
      assert("value" in descriptor && descriptor.enumerable, "Accessor or hidden constructor parameter")
      entries.push([key, encode(descriptor.value)])
    }
    return [Array.isArray(item) ? "array" : Object.getPrototypeOf(item) === null ? "null-object" : "object", id, Array.isArray(item) ? item.length : null, entries]
  }
  return encode(value)
}

export function decodeParams(encoded: any): any {
  const objects = new Map<number, any>()
  function decode(item: any): any {
    assert(Array.isArray(item), "Invalid tagged parameter")
    const tag = item[0]
    if (tag === "undefined") return undefined
    if (tag === "minus-zero") return -0
    if (tag === "scalar") return item[1]
    if (tag === "ref") {
      assert(objects.has(item[1]), "Forward or invalid parameter reference")
      return objects.get(item[1])
    }
    assert(["array", "object", "null-object"].includes(tag), "Invalid parameter tag")
    assert(!objects.has(item[1]), "Duplicate parameter object id")
    const value = tag === "array" ? new Array(item[2]) : tag === "null-object" ? Object.create(null) : {}
    objects.set(item[1], value)
    for (const [key, child] of item[3]) Object.defineProperty(value, key, { value: decode(child), enumerable: true, configurable: true, writable: true })
    return value
  }
  return decode(encoded)
}

export function jsonSha(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex")
}

export function controls(solver: Solver): Controls {
  const result = {} as Controls
  for (const key of CONTROL_FIELDS) {
    assert(Number.isFinite(solver[key]), "Nonfinite observed solver control " + key)
    result[key] = solver[key]
  }
  return result
}

export function applyControls(solver: Solver, value: Controls): void {
  assert.deepEqual(Object.keys(value), [...CONTROL_FIELDS])
  for (const key of CONTROL_FIELDS) {
    assert(Number.isFinite(value[key]), "Invalid replay control " + key)
    solver[key] = value[key]
  }
}

export function publicState(solver: Solver): any {
  return { solved: solver.solved, failed: solver.failed, error: solver.error, iterations: solver.iterations, progress: solver.progress }
}

export function setupState(solver: Solver): any {
  return { ...publicState(solver), setupDone: solver._setupDone, rows: solver.rows, cols: solver.cols, layers: solver.layers, planeSize: solver.planeSize, baseSearchBudgetIters: solver.baseSearchBudgetIters, MAX_ITERATIONS: solver.MAX_ITERATIONS, MAX_RIPS: solver.MAX_RIPS }
}

export type OccupancyEncoding = "logical-owner" | "owner-plus-one-zero"
type DenseOwners = { encoding: OccupancyEncoding; views: Set<Int32Array>; buffers: Set<ArrayBufferLike> }

function denseOwners(solver: Solver, encoding: OccupancyEncoding): DenseOwners {
  assert(encoding === "logical-owner" || encoding === "owner-plus-one-zero", "Unknown occupancy encoding")
  const views = new Set<Int32Array>()
  const buffers = new Set<ArrayBufferLike>()
  for (const field of OWNER_FIELDS) {
    const storage = solver[field]
    assert(storage instanceof Int32Array, "Schema3 requires native Int32 occupancy " + field)
    assert(storage.buffer instanceof ArrayBuffer && storage.byteOffset === 0 && storage.byteLength === storage.buffer.byteLength, "Occupancy must own a full native buffer")
    assert(!buffers.has(storage.buffer), "Occupancy buffers must be distinct")
    views.add(storage)
    buffers.add(storage.buffer)
  }
  return { encoding, views, buffers }
}

// This normalizes VALID in-bounds Int32 values only. Actual solver reads keep
// c237's explicit undefined branch for OOB/NaN/fractional indices unchanged.
function updateOwnerBytes(digest: ReturnType<typeof createHash>, storage: Int32Array, encoding: OccupancyEncoding): void {
  const block = encoding === "owner-plus-one-zero" ? new Int32Array(BLOCK) : null
  for (let start = 0; start < storage.length; start += BLOCK) {
    const count = Math.min(BLOCK, storage.length - start)
    if (block) {
      for (let i = 0; i < count; i++) block[i] = (storage[start + i]! - 1) | 0
      digest.update(new Uint8Array(block.buffer, 0, count * 4))
    } else {
      digest.update(new Uint8Array(storage.buffer, storage.byteOffset + start * 4, count * 4))
    }
  }
}

export function occupancyDiagnostics(solver: Solver, encoding: OccupancyEncoding = "logical-owner"): any {
  const context = denseOwners(solver, encoding)
  const storages: Record<string, unknown> = {}
  let payloadBytes = 0
  let logicalBytes = 0
  for (const field of OWNER_FIELDS) {
    const storage = solver[field] as Int32Array
    const logical = storage.length * Int32Array.BYTES_PER_ELEMENT
    payloadBytes += storage.byteLength
    logicalBytes += logical
    storages[field] = { representation: "native-dense", encoding, logicalLength: storage.length, logicalBytes: logical, payloadBytes: storage.byteLength, byteOffset: storage.byteOffset, bufferByteLength: storage.buffer.byteLength, pageCount: null, directorySlotCount: null }
  }
  return { schemaVersion: 3, representation: "native-dense", encoding, uniqueBufferCount: context.buffers.size, storages, payloadBytes, logicalBytes, qualification: "Three actual distinct full-size native Int32Array buffers. Allocated payload equals logical bytes in BOTH arms; zero encoding does not reduce allocated bytes. Physical page commitment and native RSS are separate observations. No page counts or paging." }
}

// Every token is length delimited. Byte arrays are streamed without Array.from,
// giant JSON strings, or a decoded full-grid allocation. Map/Set order, aliases,
// undefined, -0 and nonfinite private numeric values remain distinguishable.
export function semanticHash(field: string, value: any, owners?: DenseOwners): string {
  const digest = createHash("sha256")
  const seen = new WeakMap<object, number>()
  let next = 0
  function token(kind: string, body = ""): void {
    digest.update(String(Buffer.byteLength(kind)) + ":" + kind + String(Buffer.byteLength(body)) + ":" + body)
  }
  function visit(item: any): void {
    if (item === undefined) { token("undefined"); return }
    if (item === null) { token("null"); return }
    if (typeof item === "number") {
      token("number", Object.is(item, -0) ? "-0" : Number.isNaN(item) ? "NaN" : String(item)); return
    }
    if (typeof item === "string" || typeof item === "boolean") { token(typeof item, String(item)); return }
    assert(typeof item === "object", "Unsupported private state type")
    const prior = seen.get(item)
    if (prior !== undefined) { token("ref", String(prior)); return }
    seen.set(item, next++)
    if (ArrayBuffer.isView(item)) {
      assert(!(item instanceof DataView), "Unexpected DataView private state")
      token("typed-array", item.constructor.name + ":" + (item as ArrayBufferView & { length: number }).length + ":" + item.byteLength)
      if (owners?.buffers.has(item.buffer)) {
        // Direct owner-object aliases share the same WeakMap identity above and
        // normalize logically. Unexpected different/bare views fail shut; actual
        // frozen A01 has no such views, and silently hashing encoded bytes would
        // hide or invent a semantic difference.
        assert(item instanceof Int32Array && owners.views.has(item), "Unsupported private alias view into occupancy buffer")
        updateOwnerBytes(digest, item, owners.encoding)
      } else {
        const bytes = new Uint8Array(item.buffer, item.byteOffset, item.byteLength)
        for (let start = 0; start < bytes.length; start += 65536) digest.update(bytes.subarray(start, start + 65536))
      }
      token("typed-array-end"); return
    }
    if (item instanceof Map) {
      token("map", String(item.size))
      for (const [key, child] of item) { visit(key); visit(child) }
      token("map-end"); return
    }
    if (item instanceof Set) {
      token("set", String(item.size))
      for (const child of item) visit(child)
      token("set-end"); return
    }
    if (item instanceof ArrayBuffer) {
      assert(!owners?.buffers.has(item), "Unsupported bare occupancy-buffer alias")
      token("array-buffer", String(item.byteLength))
      const bytes = new Uint8Array(item)
      for (let start = 0; start < bytes.length; start += 65536) digest.update(bytes.subarray(start, start + 65536))
      token("array-buffer-end"); return
    }
    assert.equal(Object.getOwnPropertySymbols(item).length, 0)
    if (Array.isArray(item)) {
      token("array", String(item.length))
      for (let i = 0; i < item.length; i++) {
        if (!Object.hasOwn(item, i)) { token("array-hole"); continue }
        const descriptor = Object.getOwnPropertyDescriptor(item, String(i))!
        assert("value" in descriptor, "Array accessor in private state")
        visit(descriptor.value)
      }
      // Actual A01 pool/heap arrays have only indexed fields. Enumerate extra
      // enumerable fields lazily rather than allocate all pool index names.
      for (const key in item) {
        if (!Object.hasOwn(item, key) || (/^(0|[1-9][0-9]*)$/.test(key) && Number(key) < item.length)) continue
        const descriptor = Object.getOwnPropertyDescriptor(item, key)!
        assert("value" in descriptor, "Array extra accessor in private state")
        token("array-extra-key", key); visit(descriptor.value)
      }
      token("array-end"); return
    }
    token("own-fields-object")
    for (const key of Object.getOwnPropertyNames(item)) {
      const descriptor = Object.getOwnPropertyDescriptor(item, key)!
      assert("value" in descriptor, "Accessor in captured private state")
      token("key", key); visit(descriptor.value)
    }
    token("object-end")
  }
  token("schema", "a01-component-semantic-v3-zero-dense-little-endian")
  token("field", field)
  visit(value)
  return digest.digest("hex")
}

export function ownersHash(solver: Solver, encoding: OccupancyEncoding = "logical-owner"): string {
  assert(new Uint8Array(new Uint32Array([1]).buffer)[0] === 1, "Expected little-endian runner")
  denseOwners(solver, encoding)
  const digest = createHash("sha256")
  digest.update("a01-logical-owners-v3-zero-dense:Int32LE\n")
  for (const field of OWNER_FIELDS) {
    const storage = solver[field] as Int32Array
    digest.update(JSON.stringify([field, "Int32LE", storage.length]) + "\n")
    updateOwnerBytes(digest, storage, encoding)
    digest.update("\nowner-field-end\n")
  }
  return digest.digest("hex")
}

export function replayFingerprint(solver: Solver, capture: any, encoding: OccupancyEncoding = "logical-owner"): any {
  const ownerContext = denseOwners(solver, encoding)
  const omitted = new Set([...OWNER_FIELDS, "visitedStamp", "penalty2d", "heap", "nodePool"])
  const other: Record<string, unknown> = {}
  for (const key of Object.getOwnPropertyNames(solver)) {
    if (omitted.has(key as any)) continue
    const descriptor = Object.getOwnPropertyDescriptor(solver, key)!
    assert("value" in descriptor, "Unexpected solver accessor")
    other[key] = descriptor.value
  }
  return { initialParamsSha256: jsonSha(capture.params), sequenceSha256: jsonSha(capture.steps), setupPublicState: capture.setup.publicStateAfterSetup, terminalPublicState: publicState(solver), outputSha256: jsonSha(solver.getOutput()), ownersSha256: ownersHash(solver, encoding), visitedSha256: semanticHash("visitedStamp", solver.visitedStamp, ownerContext), penaltySha256: semanticHash("penalty2d", solver.penalty2d, ownerContext), heapSha256: semanticHash("heap-own-fields", solver.heap, ownerContext), poolSha256: semanticHash("nodePool", solver.nodePool, ownerContext), otherPrivateStateSha256: semanticHash("other-private-own-fields", other, ownerContext) }
}

export function publicTrajectory(): { append(before: any, after: any): void; finish(): string } {
  const digest = createHash("sha256")
  digest.update("a01-every-public-step-scalars-v1\n")
  function normalized(value: any): any {
    assert(typeof value.solved === "boolean" && typeof value.failed === "boolean")
    assert(value.error === null || typeof value.error === "string")
    assert(Number.isFinite(value.iterations) && Number.isFinite(value.progress))
    return [value.solved, value.failed, value.error, Object.is(value.iterations, -0) ? "-0" : String(value.iterations), Object.is(value.progress, -0) ? "-0" : String(value.progress)]
  }
  return {
    append(before: any, after: any): void { digest.update(JSON.stringify([normalized(before), normalized(after)]) + "\n") },
    finish(): string { return digest.digest("hex") },
  }
}

export function observeLargestA01(A01: any): { finish(): any; restore(): void } {
  const prototype = A01.prototype
  const names = ["setup", "step", "_step", "finalizeRoute", "ripTrace"]
  const original = Object.fromEntries(names.map((name) => [name, prototype[name]]))
  assert(names.every((name) => typeof original[name] === "function"), "Frozen A01 observer methods missing")
  const own = new Map(names.map((name) => [name, Object.getOwnPropertyDescriptor(prototype, name)]))
  const metadata = new WeakMap<object, any>()
  let nextIndex = 0
  let selected: any = null
  let trajectory: ReturnType<typeof publicTrajectory> | null = null
  function meta(solver: Solver): any {
    let item = metadata.get(solver)
    if (!item) { item = { instanceIndex: nextIndex++, setup: null, pending: null }; metadata.set(solver, item) }
    return item
  }
  prototype.setup = function(this: Solver): any {
    if (this.constructor !== A01) return original.setup.call(this)
    const item = meta(this)
    const first = !this._setupDone
    const beforeControls = first ? controls(this) : null
    const result = original.setup.call(this)
    if (first) item.setup = { beforeControls, afterControls: controls(this), publicStateAfterSetup: setupState(this) }
    return result
  }
  prototype._step = function(this: Solver): any {
    if (this.constructor === A01) {
      const item = meta(this)
      assert(item.setup && item.pending && this._setupDone, "Missing observed public setup/step lifecycle")
      assert(item.pending.beforeSetupDone, "Lazy-first-step lifecycle outside frozen root portfolio contract")
      assert(OWNER_FIELDS.every((field) => this[field] instanceof Int32Array), "Capture requires actual stock dense owners")
      const logicalOwnerBytes = OWNER_FIELDS.reduce((total, field) => total + this[field].byteLength, 0)
      assert(Number.isSafeInteger(logicalOwnerBytes) && logicalOwnerBytes >= 0)
      if (logicalOwnerBytes > 0 && (selected === null || logicalOwnerBytes > selected.selection.logicalOwnerBytes)) {
        const params = encodeParams(this.getConstructorParams())
        assert.equal(decodeParams(params)[0].initialPenaltyFn, undefined, "Callback constructor cannot be replayed")
        selected = { schemaVersion: 3, params, setup: item.setup, steps: [], totalStepCalls: 0, terminalPublicState: null, terminalOutputSha256: jsonSha(this.getOutput()), selection: { concreteClass: "HighDensitySolverA01", instanceIndex: item.instanceIndex, logicalOwnerBytes, geometry: { rows: this.rows, cols: this.cols, layers: this.layers }, criterion: "Largest sum of three allocated stock occupancy byteLengths among exact A01 instances that actually execute _step; first eligible tie retained." } }
        trajectory = publicTrajectory()
      }
    }
    return original._step.call(this)
  }
  // In the frozen official A01, only finalizeRoute/ripTrace mutate solvedRoutes.
  // getOutput otherwise reads immutable constructor/grid fields. Refresh only on
  // these actual mutations; millions of unchanged public calls do not serialize routes.
  for (const name of ["finalizeRoute", "ripTrace"]) {
    prototype[name] = function(this: Solver, ...args: any[]): any {
      const result = original[name].apply(this, args)
      if (this.constructor === A01 && selected?.selection.instanceIndex === meta(this).instanceIndex) selected.terminalOutputSha256 = jsonSha(this.getOutput())
      return result
    }
  }
  prototype.step = function(this: Solver): any {
    if (this.constructor !== A01) return original.step.call(this)
    const item = meta(this)
    item.pending = { beforeControls: controls(this), beforePublic: publicState(this), beforeSetupDone: this._setupDone }
    let result: any
    let thrown: unknown = null
    try { result = original.step.call(this) } catch (error) { thrown = error }
    if (selected?.selection.instanceIndex === item.instanceIndex) {
      assert.equal(thrown, null, "Captured source step unexpectedly threw")
      assert.equal(result, undefined, "Unexpected frozen BaseSolver.step return value")
      const beforeControls = item.pending.beforeControls
      const last = selected.steps[selected.steps.length - 1]
      if (last && CONTROL_FIELDS.every((key) => Object.is(last.beforeControls[key], beforeControls[key]))) last.count++
      else selected.steps.push({ count: 1, beforeControls })
      const after = publicState(this)
      trajectory!.append(item.pending.beforePublic, after)
      selected.totalStepCalls++
      selected.terminalPublicState = after
    }
    item.pending = null
    if (thrown !== null) throw thrown
    return result
  }
  return {
    finish(): any {
      assert(selected && selected.totalStepCalls > 0 && trajectory, "No eligible actually-stepped A01")
      selected.publicTrajectorySha256 = trajectory.finish()
      selected.expectedPublicReplay = { setupPublicState: selected.setup.publicStateAfterSetup, terminalPublicState: selected.terminalPublicState, outputSha256: selected.terminalOutputSha256, referenceSequenceSha256: jsonSha(selected.steps), captureObservedScalarTrajectorySha256: selected.publicTrajectorySha256, totalStepCalls: selected.totalStepCalls }
      selected.qualification = "Functional diagnostic only. Controls are lossless RLE; EVERY observed selected public-step scalar before/after state contributes to the rolling digest. Terminal route output only, not per-step route snapshots. Actual private states are not captured per frame. Only WeakMap scalar metadata and the selected JSON descriptor/streaming digest are retained, never solver/array/buffer references."
      return selected
    },
    restore(): void {
      for (const [name, descriptor] of own) {
        if (descriptor) Object.defineProperty(prototype, name, descriptor)
        else delete prototype[name]
      }
    },
  }
}
