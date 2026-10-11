import { expect, test } from "bun:test"
import { Pipeline9LocalWorkerPool, getNativeSyncReferencePoolBinding } from "../../lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/Pipeline9LocalWorkerPool"
import { createNativeSyncReferenceFactExecutor, initializeNativeSyncReferenceTransport } from "../../lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/NativeSyncReferenceBatchTransport"

test("inactive reference bookkeeping observes no added constructor, array method or caller-replaced ledger getter", async () => {
  await initializeNativeSyncReferenceTransport()
  let observations = 0
  const setDescriptor = Object.getOwnPropertyDescriptor(globalThis, "Set")!
  Object.defineProperty(globalThis, "Set", { configurable: true, get(): never { observations++; throw new Error("added Set observation") } })
  let cold: Pipeline9LocalWorkerPool
  try { cold = new Pipeline9LocalWorkerPool() }
  finally { Object.defineProperty(globalThis, "Set", setDescriptor) }
  expect(observations).toBe(0)
  cold!.dispose()

  const ordinary = new Pipeline9LocalWorkerPool()
  const binding = getNativeSyncReferencePoolBinding(ordinary)!
  const slots = Object.getOwnPropertyDescriptor(binding.book, "slots")!.value as object
  const methods = ["some", "find", "push"] as const
  const descriptors = methods.map((method): PropertyDescriptor => Object.getOwnPropertyDescriptor(Array.prototype, method)!)
  try {
    for (let index = 0; index < methods.length; index++) {
      const descriptor = descriptors[index]!
      Object.defineProperty(Array.prototype, methods[index]!, { configurable: true, get(this: object): unknown {
        if (this === slots) { observations++; throw new Error("added ledger array observation") }
        return descriptor.value
      } })
    }
    await ordinary.warmup()
    expect(ordinary.stats.tasksCompleted).toBe(4)
    expect(observations).toBe(0)
  } finally {
    for (let index = 0; index < methods.length; index++) Object.defineProperty(Array.prototype, methods[index]!, descriptors[index]!)
    ordinary.dispose()
  }

  for (const field of ["slots", "queued", "stats"] as const) {
    const pool = new Pipeline9LocalWorkerPool()
    const owned = getNativeSyncReferencePoolBinding(pool)!
    Object.defineProperty(owned.book, field, { configurable: true, get(): never { observations++; throw new Error(`added ledger ${field} observation`) } })
    try {
      await pool.warmup()
      expect(pool.stats.tasksCompleted).toBe(4)
      expect(observations).toBe(0)
      expect(getNativeSyncReferencePoolBinding(pool)).toBeUndefined()
      expect(createNativeSyncReferenceFactExecutor(pool)).toBeUndefined()
    } finally { pool.dispose() }
    expect(observations).toBe(0)
  }

  const late = new Pipeline9LocalWorkerPool()
  try {
    await late.warmup()
    const owned = getNativeSyncReferencePoolBinding(late)!
    Object.defineProperty(owned.book, "stats", { configurable: true, get(): never { observations++; throw new Error("late ledger observation") } })
    await late.warmup()
    expect(late.stats.tasksCompleted).toBe(8)
    expect(observations).toBe(0)
    expect(createNativeSyncReferenceFactExecutor(late)).toBeUndefined()
  } finally { late.dispose() }
  expect(observations).toBe(0)
})
