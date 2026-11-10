import { Worker } from "node:worker_threads"
import { expect, test } from "bun:test"
import type { DifferentialPairFailure, RoutingFailure, RouterResult } from "lib"
import { getDifferentialPairEsdRepro } from "../fixtures/getDifferentialPairEsdRepro"

test("async worker routing returns the plain differential failure and original pair index", async (): Promise<void> => {
  const worker = new Worker(
    new URL("../fixtures/differentialPairResult.worker.ts", import.meta.url),
  )
  try {
    const result = await new Promise<RouterResult>((resolve, reject): void => {
      worker.once("message", resolve)
      worker.once("error", reject)
      void getDifferentialPairEsdRepro().then((srj): void => {
        worker.postMessage(srj)
      }, reject)
    })
    expect(result.status).toBe("failed")
    if (result.status !== "failed")
      throw new Error("Expected an owned-path failure")
    const failure: RoutingFailure = result.failure
    expect(failure.reason).toBe("ownership_violation")
    if (failure.reason !== "ownership_violation")
      throw new Error("Expected ownership failure")
    expect(failure.pairIndex).toBe(0)
    expect(failure.connectionName).toMatch(/^[PN]:[01]$/)
    expect(failure).not.toBeInstanceOf(Error)
    const pairFailure: DifferentialPairFailure =
      failure as DifferentialPairFailure
    expect(JSON.parse(JSON.stringify(pairFailure))).toEqual(result.failure)
  } finally {
    await worker.terminate()
  }
})
