export type Pipeline9SharedContextFamily = "high-density" | "simplification" | "global-drc"
export type Pipeline9SharedContextReference = {
  encoding: "bun-structured-clone"
  family: Pipeline9SharedContextFamily
  contextId: number
  bytes: SharedArrayBuffer
}
export type Pipeline9ContextTransportStats = {
  contextSerializationCalls: number
  contextSerializedBytes: number
  sharedContextMessages: number
  contextAliasNativeMessages: number
  contextShapeNativeMessages: number
}
type BunContextSerializer = {
  serialize(value: unknown, options: { binaryType: "arraybuffer" }): SharedArrayBuffer
  deserialize(value: SharedArrayBuffer): unknown
}
type ContextSnapshot = {
  objects: WeakSet<object>
  eligible: boolean
  bytes?: SharedArrayBuffer
}
let serializerPromise: Promise<BunContextSerializer> | undefined

/** Load only on the explicitly selected Bun transport, including bundled imports. */
async function loadBunContextSerializer(): Promise<BunContextSerializer> {
  if (typeof Bun === "undefined" || typeof SharedArrayBuffer === "undefined") {
    throw new Error("Pipeline9 bun-shared context transport requires Bun and SharedArrayBuffer")
  }
  if (!serializerPromise) {
    // A variable keeps browser bundlers from resolving a Bun-only module while
    // importing the public autorouter. No unavailable-runtime error is hidden.
    const moduleName = ["bun", "jsc"].join(":")
    serializerPromise = import(moduleName).then((module: BunContextSerializer): BunContextSerializer => {
      if (typeof module.serialize !== "function" || typeof module.deserialize !== "function") {
        throw new Error("Bun does not provide its structured context serializer")
      }
      return module
    })
  }
  return serializerPromise
}

/** Accessors/custom objects keep native transport, without evaluating them twice. */
function collectContextObjects(value: unknown, objects: WeakSet<object>, forbidden?: WeakSet<object>): "eligible" | "alias" | "shape" {
  const pending: unknown[] = [value]
  while (pending.length > 0) {
    const current = pending.pop()
    if (typeof current === "function" || typeof current === "symbol") return "shape"
    if (current === null || typeof current !== "object") continue
    if (forbidden?.has(current)) return "alias"
    if (objects.has(current)) continue
    objects.add(current)
    if (current instanceof SharedArrayBuffer) {
      if (forbidden) continue
      return "shape"
    }
    if (ArrayBuffer.isView(current)) {
      if (Object.hasOwn(current, "buffer")) return "shape"
      pending.push(current.buffer)
      continue
    }
    if (current instanceof ArrayBuffer || current instanceof Date || current instanceof RegExp) continue
    if (current instanceof Map) {
      Map.prototype.forEach.call(current, (entry: unknown, key: unknown): void => { pending.push(key, entry) })
      continue
    }
    if (current instanceof Set) {
      Set.prototype.forEach.call(current, (entry: unknown): void => { pending.push(entry) })
      continue
    }
    const prototype = Object.getPrototypeOf(current)
    if (!Array.isArray(current) && prototype !== Object.prototype && prototype !== null) return "shape"
    for (const key of Object.keys(current)) {
      const descriptor = Object.getOwnPropertyDescriptor(current, key)!
      if (!("value" in descriptor)) return "shape"
      pending.push(descriptor.value)
    }
  }
  return "eligible"
}

/**
 * Board contexts have immutable IDs, as required by the existing worker cache.
 * Each worker still deserializes its own graph; only encoded bytes are shared.
 */
export class Pipeline9SharedContextCodec {
  private readonly snapshots = new WeakMap<object, Map<string, ContextSnapshot>>()

  private constructor(
    private readonly serializer: BunContextSerializer,
    private readonly stats: Pipeline9ContextTransportStats,
  ) {}

  static async create(stats: Pipeline9ContextTransportStats): Promise<Pipeline9SharedContextCodec> {
    return new Pipeline9SharedContextCodec(await loadBunContextSerializer(), stats)
  }

  getReference(
    family: Pipeline9SharedContextFamily, contextId: number,
    context: object, mutableJob: object,
  ): Pipeline9SharedContextReference | undefined {
    let contexts = this.snapshots.get(context)
    if (!contexts) {
      contexts = new Map()
      this.snapshots.set(context, contexts)
    }
    const key = `${family}:${contextId}`
    let snapshot = contexts.get(key)
    if (!snapshot) {
      const objects = new WeakSet<object>()
      snapshot = { objects, eligible: collectContextObjects(context, objects) === "eligible" }
      contexts.set(key, snapshot)
    }
    if (!snapshot.eligible) {
      this.stats.contextShapeNativeMessages++
      return undefined
    }
    const boundary = collectContextObjects(mutableJob, new WeakSet<object>(), snapshot.objects)
    if (boundary !== "eligible") {
      if (boundary === "alias") this.stats.contextAliasNativeMessages++
      else this.stats.contextShapeNativeMessages++
      return undefined
    }
    if (!snapshot.bytes) {
      const bytes = this.serializer.serialize(context, { binaryType: "arraybuffer" })
      if (!(bytes instanceof SharedArrayBuffer)) throw new Error("Bun context serializer did not return shared bytes")
      snapshot.bytes = bytes
      this.stats.contextSerializationCalls++
      this.stats.contextSerializedBytes += bytes.byteLength
    }
    this.stats.sharedContextMessages++
    return { encoding: "bun-structured-clone", family, contextId, bytes: snapshot.bytes }
  }
}

export async function deserializePipeline9SharedContext(reference: Pipeline9SharedContextReference): Promise<unknown> {
  if (reference.encoding !== "bun-structured-clone" || !(reference.bytes instanceof SharedArrayBuffer) ||
    !Number.isSafeInteger(reference.contextId)) throw new Error("Invalid Pipeline9 shared context reference")
  const serializer = await loadBunContextSerializer()
  const context: unknown = serializer.deserialize(reference.bytes)
  if (!context || typeof context !== "object") throw new Error("Pipeline9 shared context decoded an invalid board context")
  return context
}
