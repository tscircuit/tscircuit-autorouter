import { expect, test } from "bun:test"
import {
  asNetworkedFetch,
  createDeferred,
  createNetworkedHighDensitySolver,
  createNetworkedNode,
} from "tests/fixtures/pipeline9-networked-fixtures"

test("Pipeline9 eventually aborts a hung background cache transport", async () => {
  const transportAborted = createDeferred<void>()
  const requestStarted = createDeferred<AbortSignal>()
  const solver = createNetworkedHighDensitySolver({
    nodes: [
      createNetworkedNode({
        nodeId: "cmn_transport_timeout",
        connectionName: "A",
      }),
    ],
    requestTimeoutMs: 5,
    transportTimeoutMs: 50,
    fetchImpl: asNetworkedFetch(
      async (_url, init) =>
        new Promise<Response>((_resolve, reject) => {
          const requestSignal = init?.signal as AbortSignal
          requestStarted.resolve(requestSignal)
          requestSignal.addEventListener(
            "abort",
            () => {
              transportAborted.resolve()
              reject(requestSignal.reason)
            },
            { once: true },
          )
        }),
    ),
  })

  solver.step()
  const requestSignal = await requestStarted.promise
  await solver.pendingEffects![0]!.promise
  expect(requestSignal.aborted).toBeFalse()

  solver.step()
  expect(solver.activeRegularSolver).not.toBeNull()
  await transportAborted.promise
  expect(requestSignal.aborted).toBeTrue()
})
