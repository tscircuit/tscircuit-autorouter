import { expect, test } from "bun:test"
import { AUTOROUTER_VERSION } from "lib"
import type { Pipeline9NetworkedSolveRequest } from "lib/autorouter-pipelines/AutoroutingPipeline9_Networked/pipeline9-networked-types"
import {
  asNetworkedFetch,
  createDeferred,
  createNetworkedHighDensitySolver,
  createNetworkedNode,
  createNetworkedResponse,
  createNetworkedRoute,
} from "tests/fixtures/pipeline9-networked-fixtures"

test("Pipeline9 networked launches every node request in parallel and preserves sequential output metadata", async () => {
  const firstNode = createNetworkedNode({
    nodeId: "cmn_first",
    connectionName: "A",
    xOffset: -5,
  })
  const secondNode = createNetworkedNode({
    nodeId: "cmn_second",
    connectionName: "B",
    xOffset: 5,
  })
  const releaseRequests = createDeferred<void>()
  const requestBodies: Pipeline9NetworkedSolveRequest[] = []
  const fetchImpl = asNetworkedFetch(async (_input, init) => {
    const request = JSON.parse(String(init?.body)) as Pipeline9NetworkedSolveRequest
    requestBodies.push(request)
    await releaseRequests.promise
    return createNetworkedResponse({
      status: "solved",
      routes: [createNetworkedRoute(request.input.nodeWithPortPoints)],
    })
  })
  const solver = createNetworkedHighDensitySolver({
    nodes: [firstNode, secondNode],
    fetchImpl,
  })

  solver.step()

  expect(requestBodies).toHaveLength(2)
  expect(requestBodies.map((request) => request.autorouterVersion)).toEqual([
    AUTOROUTER_VERSION,
    AUTOROUTER_VERSION,
  ])
  expect(requestBodies.map((request) => request.input.effort)).toEqual([1, 1])
  expect(solver.pendingEffects).toHaveLength(1)

  releaseRequests.resolve()
  await solver.pendingEffects![0]!.promise
  while (!solver.solved && !solver.failed) solver.step()

  expect(solver.solved).toBeTrue()
  expect(solver.failed).toBeFalse()
  expect(solver.routes.map((route) => route.connectionName)).toEqual(["B", "A"])
  expect(solver.routes.map((route) => route.rootConnectionName)).toEqual([
    "root_B",
    "root_A",
  ])
  expect(solver.routes.map((route) => route.startPcbPortId)).toEqual([
    "cmn_second_start",
    "cmn_first_start",
  ])
  expect(solver.routes.map((route) => route.endPcbPortId)).toEqual([
    "cmn_second_end",
    "cmn_first_end",
  ])
  expect(solver.stats.remoteRequestsStarted).toBe(2)
  expect(solver.stats.remoteCacheHits).toBe(2)
})
