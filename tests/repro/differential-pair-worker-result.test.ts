import { Worker } from "node:worker_threads"
import { expect, test } from "bun:test"
import type { RouterResult } from "lib"
import { assertDifferentialPairOutput } from "lib/utils/assertDifferentialPairOutput"
import { getDifferentialPairEsdRepro } from "../fixtures/getDifferentialPairEsdRepro"

test("async worker routing preserves separate copper ownership through its result", async (): Promise<void> => {
  const srj = await getDifferentialPairEsdRepro()
  const worker = new Worker(
    new URL("../fixtures/differentialPairResult.worker.ts", import.meta.url),
  )
  try {
    const result = await new Promise<RouterResult>((resolve, reject): void => {
      worker.once("message", resolve)
      worker.once("error", reject)
      worker.postMessage(srj)
    })
    expect(result.status).toBe("solved")
    if (result.status !== "solved") throw new Error("Expected an owned path")
    expect(() => assertDifferentialPairOutput(srj, result.traces)).not.toThrow()
    expect(result.traces).toHaveLength(srj.connections.length)
    expect(JSON.parse(JSON.stringify(result))).toEqual(result)
  } finally {
    await worker.terminate()
  }
})
