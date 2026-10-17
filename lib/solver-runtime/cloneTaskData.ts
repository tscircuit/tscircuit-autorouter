/** Synchronous structured cloning, retaining SharedArrayBuffer backing storage. */
export function cloneTaskData<Value>(value: Value): Value {
  const runtime = globalThis as typeof globalThis & {
    process?: {
      getBuiltinModule?: (name: string) => unknown
    }
  }
  // Bun's structuredClone has historically copied shared buffers as ordinary
  // buffers. Native message transport preserves sharing and supports sync reads.
  const native = runtime.process?.getBuiltinModule?.("node:worker_threads") as
    | typeof import("node:worker_threads")
    | undefined
  if (native) {
    const { port1, port2 } = new native.MessageChannel()
    try {
      port1.postMessage({ value })
      const received = native.receiveMessageOnPort(port2)
      if (!received)
        throw new Error("Synchronous task snapshot was not available")
      return received.message.value as Value
    } finally {
      port1.close()
      port2.close()
    }
  }
  return structuredClone(value)
}
