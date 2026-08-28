import { expect, test } from "bun:test"
import type { Pipeline9NetworkedSolveBatchRequest } from "lib"
import {
  asNetworkedBatchFetch,
  createDeferred,
  createNetworkedBatchStream,
  createNetworkedHighDensitySolver,
  createNetworkedNode,
  createNetworkedRoute,
} from "tests/fixtures/pipeline9-networked-fixtures"

test("Pipeline9 batches cold solves in node consumption order", async () => {
  const nodes = [
    createNetworkedNode({
      nodeId: "cmn_consumed_third",
      connectionName: "third",
      xOffset: -10,
    }),
    createNetworkedNode({
      nodeId: "cmn_consumed_second",
      connectionName: "second",
    }),
    createNetworkedNode({
      nodeId: "cmn_consumed_first",
      connectionName: "first",
      xOffset: 10,
    }),
  ]
  const batchStream = createNetworkedBatchStream()
  const requestStarted = createDeferred<Pipeline9NetworkedSolveBatchRequest>()
  const solver = createNetworkedHighDensitySolver({
    nodes,
    requestTimeoutMs: 100,
    transportTimeoutMs: 1_000,
    fetchImpl: asNetworkedBatchFetch(async (_input, init) => {
      requestStarted.resolve(
        JSON.parse(String(init?.body)) as Pipeline9NetworkedSolveBatchRequest,
      )
      return batchStream.response
    }),
  })

  solver.step()
  const request = await requestStarted.promise
  expect(
    request.items.map(
      (item) => item.input.nodeWithPortPoints.capacityMeshNodeId,
    ),
  ).toEqual(["cmn_consumed_first", "cmn_consumed_second", "cmn_consumed_third"])

  const firstItem = request.items[0]!
  batchStream.write({
    requestId: firstItem.requestId,
    ok: true,
    autorouterVersion: request.autorouterVersion,
    source: "solver",
    status: "solved",
    routes: [createNetworkedRoute(firstItem.input.nodeWithPortPoints)],
  })
  await solver.pendingEffects![0]!.promise
  solver.step()

  expect(solver.routes.map((route) => route.connectionName)).toEqual(["first"])
  expect(solver.stats.remoteLogicalTimeoutFallbacks).toBe(0)
  expect(solver.activeRegularSolver).toBeNull()

  for (const item of request.items.slice(1)) {
    batchStream.write({
      requestId: item.requestId,
      ok: true,
      autorouterVersion: request.autorouterVersion,
      source: "solver",
      status: "solved",
      routes: [createNetworkedRoute(item.input.nodeWithPortPoints)],
    })
  }
  batchStream.close()
  while (solver.stats.remoteRequestsCompleted < nodes.length) {
    await new Promise((resolve) => setTimeout(resolve, 0))
  }
  while (!solver.solved && !solver.failed) solver.step()

  expect(solver.solved).toBeTrue()
  expect(solver.routes.map((route) => route.connectionName)).toEqual([
    "first",
    "second",
    "third",
  ])
  expect(solver.stats.remoteSolverResults).toBe(3)
  expect(solver.stats.remoteLogicalTimeoutFallbacks).toBe(0)
})
