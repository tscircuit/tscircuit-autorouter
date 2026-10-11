import { expect, test } from "bun:test"

function runWorkerOracle(experimentalArena: boolean): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject): void => {
    const worker = new Worker(new URL("../fixtures/parallel-owner-grid-quantum/worker.ts", import.meta.url).href)
    worker.onmessage = (event: MessageEvent): void => {
      worker.terminate()
      if (event.data.error) reject(new Error(event.data.error))
      else resolve(event.data.result)
    }
    worker.postMessage({ experimentalArena })
    worker.onerror = (event: ErrorEvent): void => {
      worker.terminate()
      reject(new Error(event.message))
    }
  })
}

test("default JS and experimental arena native 100-step worker quanta preserve every A01/A03 checkpoint", async (): Promise<void> => {
  for (const experimentalArena of [false, true]) {
    const result = await runWorkerOracle(experimentalArena)
    expect(result.actualWorkerKernels).toBe(true)
    expect(result.lateObserversRejected).toBe(true)
    expect(result.storageProxyTraps).toBe(0)
    expect(result.a01Steps).toBe(957_175)
    expect(result.a03Steps).toBe(75_624)
    expect(result.nativeSteps).toBe(1_032_799)
    expect(result.checkpoints).toBe(result.quanta)
    expect(result.quanta).toBe(10_329)
    expect(result.arenaBatches).toBe(experimentalArena ? 9572 : 0)
    expect(result.arenaHydratedRows).toBe(experimentalArena ? 4_744_007 : 0)
    expect(result.arenaFlushedRows).toBe(experimentalArena ? 1_427_773 : 0)
  }
})
