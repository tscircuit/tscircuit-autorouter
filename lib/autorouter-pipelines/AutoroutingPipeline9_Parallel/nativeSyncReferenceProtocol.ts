import type { MessagePort } from "node:worker_threads"
import { getReferenceDrcProxyInspector } from "./authoritative-drc-fork/initializeReferenceDrcRuntime"
import type { ParallelReferenceContinuityBatch, ParallelReferenceContinuityBatchResult } from "./parallelReferenceContinuityTypes"

/** Versioned fields, native fact semantics and original ordered row layout. */
export const nativeSyncReferenceSchema = "reference-continuity-facts/v2:ordinal-snapshot-port-trace-polygon-kind-row-value-visits-exception"
export const nativeSyncReferenceSchemaHash = "bf84c29a41ee3a6b7477bd9c3a7ca7fbb656f855aee113c0aed868c1da9e96e7"
export type NativeSyncReferenceIdentity = {
  schema: typeof nativeSyncReferenceSchema
  schemaHash: typeof nativeSyncReferenceSchemaHash
  reservationId: number
  ordinal: number
  laneCount: number
  snapshotId: number
  taskCount: number
}
export type NativeSyncReferenceRequest = NativeSyncReferenceIdentity & {
  kind: "nativeSyncReferenceFacts"
  port: MessagePort
  signal: SharedArrayBuffer
  batch: ParallelReferenceContinuityBatch
}
export type NativeSyncReferenceResponse = NativeSyncReferenceIdentity & ({
  status: "evaluated"
  result: ParallelReferenceContinuityBatchResult
} | { status: "infrastructure-error"; error: { name: string; message: string; stack?: string } })
const getDescriptor = Object.getOwnPropertyDescriptor
const getPrototype = Object.getPrototypeOf
const apply = Reflect.apply
const hasOwn = Object.prototype.hasOwnProperty
const isInteger = Number.isSafeInteger
const isArray = Array.isArray
const plainPrototype = Object.prototype
const arrayPrototype = Array.prototype
const maximumSafeInteger = Number.MAX_SAFE_INTEGER

export class NativeSyncReferenceInfrastructureError extends Error {
  constructor(message: string) { super(message); this.name = "NativeSyncReferenceInfrastructureError" }
}

function invariant(value: unknown, message: string): asserts value {
  if (!value) throw new NativeSyncReferenceInfrastructureError(message)
}

function plain(value: unknown): asserts value is object {
  const isProxy = getReferenceDrcProxyInspector()
  invariant(isProxy !== undefined && typeof value === "object" && value !== null && !isProxy(value), "Expected an owned non-proxy reference protocol record")
  const prototype = getPrototype(value)
  invariant(prototype === plainPrototype || prototype === null, "Expected an owned plain reference protocol record")
}

function ownValue(value: object, name: string): unknown {
  const descriptor = getDescriptor(value, name)
  invariant(descriptor !== undefined && apply(hasOwn, descriptor, ["value"]), `Expected own data reference field ${name}`)
  return descriptor.value
}

function whole(value: unknown, minimum: number, maximum: number, name: string): asserts value is number {
  invariant(typeof value === "number" && isInteger(value) && value >= minimum && value <= maximum, `Invalid reference ${name}`)
}

/** Snapshot/task descriptors come from the private prepared request, never LIVE CJ. */
export function assertNativeSyncReferenceIdentity(value: unknown): asserts value is NativeSyncReferenceIdentity {
  plain(value)
  invariant(ownValue(value, "schema") === nativeSyncReferenceSchema, "Reference protocol schema mismatch")
  invariant(ownValue(value, "schemaHash") === nativeSyncReferenceSchemaHash, "Reference protocol schema hash mismatch")
  whole(ownValue(value, "reservationId"), 1, maximumSafeInteger, "reservationId")
  whole(ownValue(value, "laneCount"), 1, 3, "laneCount")
  whole(ownValue(value, "ordinal"), 0, (ownValue(value, "laneCount") as number) - 1, "ordinal")
  whole(ownValue(value, "snapshotId"), 0, maximumSafeInteger - 1, "snapshotId")
  whole(ownValue(value, "taskCount"), 1, 4_000_000, "taskCount")
}

/** Validate every returned row, including unused geometry exception facts. */
export function assertNativeSyncReferenceResponse(
  value: unknown,
  expected: NativeSyncReferenceIdentity,
  batch: ParallelReferenceContinuityBatch,
): asserts value is NativeSyncReferenceResponse {
  assertNativeSyncReferenceIdentity(value)
  const fields = ["schema", "schemaHash", "reservationId", "ordinal", "laneCount", "snapshotId", "taskCount"] as const
  for (let index = 0; index < fields.length; index++) {
    const field = fields[index]!
    invariant(ownValue(value, field) === expected[field], `Stale or mismatched reference ${field}`)
  }
  invariant(batch.tasks.length === expected.taskCount, "Reference response task identity differs from its private request")
  const status = ownValue(value, "status")
  if (status === "infrastructure-error") { assertException(ownValue(value, "error")); return }
  invariant(status === "evaluated", "Unknown reference result status")
  assertParallelReferenceContinuityBatchResult(ownValue(value, "result"), batch)
}

function assertException(exception: unknown): void {
  plain(exception)
  invariant(typeof ownValue(exception, "name") === "string" && typeof ownValue(exception, "message") === "string", "Malformed reference exception metadata")
  const stack = getDescriptor(exception, "stack")
  if (stack !== undefined) invariant(apply(hasOwn, stack, ["value"]) && typeof stack.value === "string", "Malformed reference exception stack")
}

/** The caller holds the immutable task group that originally crossed workers. */
export function assertParallelReferenceContinuityBatchResult(
  result: unknown,
  batch: ParallelReferenceContinuityBatch,
): asserts result is ParallelReferenceContinuityBatchResult {
  plain(result)
  invariant(ownValue(result, "kind") === "referenceContinuityFacts" && ownValue(result, "snapshotId") === batch.context.snapshotId,
    "Reference fact result context mismatch")
  const facts = ownValue(result, "facts")
  const isProxy = getReferenceDrcProxyInspector()!
  invariant(typeof facts === "object" && facts !== null && !isProxy(facts) && isArray(facts) && getPrototype(facts) === arrayPrototype,
    "Expected an owned reference fact array")
  invariant(ownValue(facts, "length") === batch.tasks.length, "Reference fact count mismatch")
  for (let index = 0; index < batch.tasks.length; index++) {
    const fact = ownValue(facts, `${index}`)
    plain(fact)
    const task = batch.tasks[index]!
    invariant(ownValue(fact, "rowIndex") === task.rowIndex && ownValue(fact, "kind") === task.kind, "Reference row/task order mismatch")
    const visits = ownValue(fact, "consumedVisits")
    whole(visits, 0, 4_000_000, "consumedVisits")
    if (task.kind === "port-connectivity") {
      const componentLength = batch.context.componentOffsets[task.componentIndex + 1]! - batch.context.componentOffsets[task.componentIndex]!
      invariant(visits <= componentLength, "Reference membership visits exceed original component")
    } else invariant(visits === 1, "Native geometry fact must execute exactly one predicate")
    const factStatus = ownValue(fact, "status")
    if (factStatus === "exception") {
      invariant(task.kind === "native-trace-pair-miss" || task.kind === "native-polygon-contact-miss", "Membership fact cannot report an algorithm exception")
      assertException(ownValue(fact, "exception"))
    } else {
      invariant(factStatus === "evaluated" && typeof ownValue(fact, "value") === "boolean", "Malformed native boolean fact")
      if (task.kind === "port-connectivity") {
        const componentLength = batch.context.componentOffsets[task.componentIndex + 1]! - batch.context.componentOffsets[task.componentIndex]!
        invariant(ownValue(fact, "value") ? visits > 0 : visits === componentLength, "Reference membership visit boundary mismatch")
      }
    }
  }
}
