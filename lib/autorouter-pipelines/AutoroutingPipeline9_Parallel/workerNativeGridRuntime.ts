let workerRuntime = false
let initialization: Promise<void> | null = null
let runtimeIsProxy: ((value: unknown) => boolean) | null = null

/** Optional runtime discovery runs only at the asynchronous worker task entry. */
export async function initializeWorkerNativeGridRuntime(): Promise<void> {
  if (!initialization) {
    initialization = (async (): Promise<void> => {
      const threadModuleName = ["node", "worker_threads"].join(":"), utilModuleName = ["node", "util"].join(":")
      let threads: { isMainThread?: boolean }, utilities: { types?: { isProxy?: (value: unknown) => boolean } }
      try {
        threads = await import(threadModuleName)
        utilities = await import(utilModuleName)
      } catch {
        // Unsupported browser/runtime ownership stays on original native code.
        return
      }
      if (threads.isMainThread === false && typeof utilities.types?.isProxy === "function") {
        runtimeIsProxy = utilities.types.isProxy
        workerRuntime = true
      }
    })()
  }
  await initialization
}

export function hasWorkerNativeGridRuntime(): boolean {
  // Neither a constructor option nor a serialized message can enable trust.
  // Only the optional native runtime's actual worker-thread identity is used.
  // Uninitialized main/browser imports have no ownership capability.
  return workerRuntime
}

export function isWorkerNativeGridProxy(value: unknown): boolean {
  // A native runtime predicate examines proxy identity without invoking traps.
  // Kernel eligibility never reads user proxy properties to validate geometry.
  // Unsupported runtimes cannot mint a quantum and keep original execution.
  return runtimeIsProxy ? runtimeIsProxy(value) : false
}
