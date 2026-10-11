import { expect, test } from "bun:test"

test("A13 worker C admission declines public/custom observations and fails active private mutations without stale JS fallback", async (): Promise<void> => {
  const result = await new Promise<any>((resolve, reject): void => {
    const worker = new Worker(new URL("../fixtures/parallel-native-a13/eligibilityWorker.ts", import.meta.url).href)
    worker.onmessage = (event: MessageEvent): void => {
      worker.terminate()
      if (event.data.error) reject(new Error(event.data.error))
      else resolve(event.data.result)
    }
    worker.onerror = (event: ErrorEvent): void => { worker.terminate(); reject(new Error(event.message)) }
    worker.postMessage({})
  })
  expect(result.actualKernel).toBe(true)
  expect(result.publicNative).toBe(true)
  expect(result.observers).toBe(0)
  expect(result.proxyTraps).toBe(0)
  expect(result.rejected).toBe(6)
})
