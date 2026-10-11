import { getReferenceDrcProxyInspector } from "./authoritative-drc-fork/initializeReferenceDrcRuntime"
import { configurePreparedMemoizedReferenceDrcEvaluator } from "./createMemoizedReferenceDrcEvaluator"
import { canUseNativePathLookaheadPool, Pipeline9LocalWorkerPool } from "./Pipeline9LocalWorkerPool"
import { createNativeSyncReferenceFactExecutor, type NativeSyncReferenceFactExecutor } from "./NativeSyncReferenceBatchTransport"

const nativeApply = Reflect.apply
const nativeDescriptor = Object.getOwnPropertyDescriptor
const nativeHasOwn = Object.prototype.hasOwnProperty
const nativeWeakMapGet = WeakMap.prototype.get
const nativeWeakMapSet = WeakMap.prototype.set
const poolExecutors = new WeakMap<Pipeline9LocalWorkerPool, NativeSyncReferenceFactExecutor>()
const nativeInitialize = nativeDescriptor(Pipeline9LocalWorkerPool.prototype, "initializeReferenceTransport")!.value as Pipeline9LocalWorkerPool["initializeReferenceTransport"]

/** The optional Native path never reads an owner getter or custom pool hook. */
function ownedPool(owner: unknown): Pipeline9LocalWorkerPool | undefined {
  if ((typeof owner !== "object" || owner === null) && typeof owner !== "function") return undefined
  const inspector = getReferenceDrcProxyInspector()
  if (!inspector || inspector(owner)) return undefined
  const field = nativeDescriptor(owner, "workerPool")
  if (!field || !nativeApply(nativeHasOwn, field, ["value"]) || !canUseNativePathLookaheadPool(field.value)) return undefined
  return field.value
}

/** Runtime imports finish before entering a synchronous Native checker frame. */
export function initializeNativeReferenceDrcPoolForOwner(owner: unknown): Promise<void> | undefined {
  const pool = ownedPool(owner)
  return pool === undefined ? undefined : nativeApply(nativeInitialize, pool, []) as Promise<void>
}

/** The same evaluator/checker keeps all existing memo IDs, FIFO and counters. */
export function bindNativeReferenceDrcEvaluatorToPool(owner: unknown, evaluator: unknown): boolean {
  const pool = ownedPool(owner)
  if (pool === undefined) return false
  let executor = nativeApply(nativeWeakMapGet, poolExecutors, [pool]) as NativeSyncReferenceFactExecutor | undefined
  if (executor === undefined) {
    executor = createNativeSyncReferenceFactExecutor(pool)
    if (executor === undefined) return false
    nativeApply(nativeWeakMapSet, poolExecutors, [pool, executor])
  }
  return configurePreparedMemoizedReferenceDrcEvaluator(evaluator, executor)
}
