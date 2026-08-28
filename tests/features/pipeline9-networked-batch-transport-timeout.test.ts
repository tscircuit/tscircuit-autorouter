import { expect, test } from "bun:test"
import {
  asNetworkedBatchFetch,
  createDeferred,
  createNetworkedHighDensitySolver,
  createNetworkedNode,
} from "tests/fixtures/pipeline9-networked-fixtures"

test("Pipeline9 batch transport timeout settles only unresolved nodes after a logical fallback", async () => {
  const transportAborted = createDeferred<void>()
  const requestStarted = createDeferred<AbortSignal>()
  const solver = createNetworkedHighDensitySolver({
    nodes: [
      createNetworkedNode({
        nodeId: "cmn_batch_transport_first",
        connectionName: "first",
        xOffset: -5,
      }),
      createNetworkedNode({
        nodeId: "cmn_batch_transport_second",
        connectionName: "second",
        xOffset: 5,
      }),
    ],
    requestTimeoutMs: 5,
    transportTimeoutMs: 50,
    fetchImpl: asNetworkedBatchFetch(
      async (_input, init) =>
        new Promise<Response>((_resolve, reject) => {
          const signal = init?.signal as AbortSignal
          requestStarted.resolve(signal)
          signal.addEventListener(
            "abort",
            () => {
              transportAborted.resolve()
              reject(signal.reason)
            },
            { once: true },
          )
        }),
    ),
  })

  solver.step()
  const signal = await requestStarted.promise
  await solver.pendingEffects![0]!.promise
  expect(signal.aborted).toBeFalse()

  solver.step()
  expect(solver.activeRegularSolver).not.toBeNull()
  await transportAborted.promise
  while (solver.stats.remoteRequestsCompleted < 2) {
    await new Promise((resolve) => setTimeout(resolve, 0))
  }

  expect(signal.aborted).toBeTrue()
  expect(solver.stats.remoteRequestsCompleted).toBe(2)
  expect(solver.stats.remoteTransportFallbacks).toBe(2)
  expect(solver.stats.remoteFallbackReasonCounts).toEqual({
    logical_timeout: 1,
    transport_timeout: 1,
  })
})
