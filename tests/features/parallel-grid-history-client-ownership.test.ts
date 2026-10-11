import { expect, test } from "bun:test"
import { GridHistoryWorkerClient } from "lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/GridHistoryWorkerClient"
import { executeGridHistoryJob } from "lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/executeGridHistoryJob"
import type { GridHistoryCancellation, GridHistoryJob, GridHistoryRequest } from "lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/parallelGridHistoryTypes"
import { createNetworkedNode } from "tests/fixtures/pipeline9-networked-fixtures"

test("a persistent grid client isolates reused batch candidate IDs and rejects repeated or foreign controls", async (): Promise<void> => {
  const messages: Array<GridHistoryRequest | GridHistoryCancellation> = []
  const client = new GridHistoryWorkerClient(71, (message): void => { messages.push(message) })
  const jobs: GridHistoryJob[] = [0, 1, 2].map((index) => ({ kind: "gridHistory", algorithm: "a01",
    candidateId: 0, maxIterations: 100, ownerIterations: 0,
    params: { cellSizeMm: 0.1, viaDiameter: 0.3,
      nodeWithPortPoints: createNetworkedNode({ nodeId: `grid-batch${index}`, connectionName: `signal${index}` }) } }))
  const pending = jobs.map((job) => client.dispatch([job]))
  for (const requestId of [1, 2, 3]) client.receive({ kind: "gridHistoryGrant", taskId: 71,
    requestId, admittedCandidateIds: [0] })
  const grants = await Promise.all(pending)
  const deliveries = grants.map((grant) => {
    const delivery = grant.get(0)
    if (!delivery) throw new Error("Grid batch client fixture expected one admitted candidate")
    return delivery
  })
  const histories = jobs.map(executeGridHistoryJob)
  for (const requestId of [3, 1, 2]) client.receive({ kind: "gridHistoryDelivery", taskId: 71,
    requestId, candidateId: 0, ok: true, result: histories[requestId - 1]! })
  const resolved = await Promise.all(deliveries)
  for (const [index, history] of resolved.entries()) expect(history).toBe(histories[index])
  expect(messages.filter((message): message is GridHistoryRequest => message.kind === "requestGridHistories")
    .map((message) => message.requestId)).toEqual([1, 2, 3])
  const fourth = client.dispatch([jobs[0]!])
  expect(() => client.receive({ kind: "gridHistoryGrant", taskId: 72, requestId: 4,
    admittedCandidateIds: [0] })).toThrow("Unexpected grid history response")
  expect(() => client.receive({ kind: "gridHistoryGrant", taskId: 71, requestId: 4,
    admittedCandidateIds: [0, 0] })).toThrow("duplicate IDs")
  client.receive({ kind: "gridHistoryGrant", taskId: 71, requestId: 4, admittedCandidateIds: [0] })
  const fourthGrant = await fourth
  expect(() => client.receive({ kind: "gridHistoryGrant", taskId: 71, requestId: 4,
    admittedCandidateIds: [0] })).toThrow("repeated")
  expect(() => client.receive({ kind: "gridHistoryDelivery", taskId: 71, requestId: 4,
    candidateId: 1, ok: true, result: histories[0]! })).toThrow("not admitted")
  client.cancelUnusedHistories()
  expect(messages.at(-1)).toEqual({ kind: "cancelGridHistories", taskId: 71 })
  client.receive({ kind: "gridHistoryDelivery", taskId: 71, requestId: 4, candidateId: 0,
    ok: true, result: histories[0]! })
  expect(await fourthGrant.get(0)).toBe(histories[0])
})
