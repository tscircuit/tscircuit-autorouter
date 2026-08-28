import { expect, test } from "bun:test"
import type { Pipeline9NetworkedSolveRequest } from "lib"
import {
  asNetworkedFetch,
  createDeferred,
  createNetworkedHighDensitySolver,
  createNetworkedNode,
  createNetworkedRoute,
} from "tests/fixtures/pipeline9-networked-fixtures"

test("Pipeline9 falls back logically while a late cache request finishes in the background", async () => {
  const node = createNetworkedNode({
    nodeId: "cmn_background_request",
    connectionName: "A",
  })
  const releaseResponse = createDeferred<Response>()
  const responseBodyRead = createDeferred<void>()
  const requestStarted = createDeferred<AbortSignal>()
  const solver = createNetworkedHighDensitySolver({
    nodes: [node],
    requestTimeoutMs: 5,
    transportTimeoutMs: 1_000,
    fetchImpl: asNetworkedFetch(async (_url, init) => {
      requestStarted.resolve(init?.signal as AbortSignal)
      const request = JSON.parse(
        String(init?.body),
      ) as Pipeline9NetworkedSolveRequest
      await releaseResponse.promise
      return {
        ok: true,
        status: 200,
        text: async () => {
          responseBodyRead.resolve()
          return JSON.stringify({
            ok: true,
            autorouterVersion: request.autorouterVersion,
            source: "solver",
            status: "solved",
            routes: [createNetworkedRoute(request.input.nodeWithPortPoints)],
          })
        },
      } as Response
    }),
  })

  solver.step()
  const requestSignal = await requestStarted.promise
  await solver.pendingEffects![0]!.promise
  expect(requestSignal.aborted).toBeFalse()

  solver.step()
  expect(solver.activeRegularSolver).not.toBeNull()
  expect(solver.stats.remoteTransportFallbacks).toBe(1)

  releaseResponse.resolve(new Response())
  await responseBodyRead.promise
  await Promise.resolve()
  expect(requestSignal.aborted).toBeFalse()
})
