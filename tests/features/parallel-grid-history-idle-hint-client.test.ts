import { expect, test } from "bun:test"
import { GridHistoryWorkerClient } from "lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/GridHistoryWorkerClient"
import { executeGridHistoryJob } from "lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/executeGridHistoryJob"
import type { GridHistoryCancellation, GridHistoryJob, GridHistoryRequest } from "lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/parallelGridHistoryTypes"
import { createNetworkedNode } from "tests/fixtures/pipeline9-networked-fixtures"

test("idle hints avoid denied request transport while preserving validation, stale grants, cancellation and request ownership", async (): Promise<void> => {
  const messages: Array<GridHistoryRequest | GridHistoryCancellation> = []
  const idle = new Int32Array(new SharedArrayBuffer(Int32Array.BYTES_PER_ELEMENT))
  const client = new GridHistoryWorkerClient(71, (message): void => { messages.push(message) }, idle)
  const job: GridHistoryJob = { kind: "gridHistory", algorithm: "a01", candidateId: 0,
    maxIterations: 100, ownerIterations: 0, params: { cellSizeMm: 0.1, viaDiameter: 0.3,
      nodeWithPortPoints: createNetworkedNode({ nodeId: "idle-hint", connectionName: "signal" }) } }
  expect((await client.dispatch([job])).size).toBe(0)
  expect(client.requestsSkippedForNoIdleWorker).toBe(1)
  expect(messages).toHaveLength(0)
  client.cancelUnusedHistories()
  expect(messages).toHaveLength(0)
  expect(() => client.receive({ kind: "gridHistoryGrant", taskId: 71,
    requestId: 1, admittedCandidateIds: [] })).toThrow("Unexpected grid history response")
  await expect(client.dispatch([job, job])).rejects.toThrow("repeats a candidate")
  await expect(client.dispatch([{ ...job, maxIterations: 0 }])).rejects.toThrow("exact candidate cap")
  expect(client.requestsSkippedForNoIdleWorker).toBe(1)

  Atomics.store(idle, 0, 1)
  const stalePositive = client.dispatch([job])
  const denied = messages.at(-1)!
  if (denied.kind !== "requestGridHistories") throw new Error("Expected one actual coordinator request")
  Atomics.store(idle, 0, 0)
  client.receive({ kind: "gridHistoryGrant", taskId: 71,
    requestId: denied.requestId, admittedCandidateIds: [] })
  expect((await stalePositive).size).toBe(0)
  expect(client.requestsSkippedForNoIdleWorker).toBe(1)

  Atomics.store(idle, 0, 3)
  const pending = client.dispatch([job])
  const request = messages.at(-1)!
  if (request.kind !== "requestGridHistories") throw new Error("Expected one admitted request")
  expect(request.requestId).toBeGreaterThan(denied.requestId)
  client.receive({ kind: "gridHistoryGrant", taskId: 71,
    requestId: request.requestId, admittedCandidateIds: [0] })
  const grant = await pending
  client.cancelUnusedHistories()
  expect(messages.at(-1)).toEqual({ kind: "cancelGridHistories", taskId: 71 })
  const history = executeGridHistoryJob(job)
  client.receive({ kind: "gridHistoryDelivery", taskId: 71,
    requestId: request.requestId, candidateId: 0, ok: true, result: history })
  expect(await grant.get(0)).toBe(history)
  expect(client.replayWork).toEqual({ logicalIterationsReplayed: 0,
    equivalentLogicalIterationsReplayed: 0, equivalentCandidatesAdmitted: 0 })

  const legacyMessages: Array<GridHistoryRequest | GridHistoryCancellation> = []
  const legacy = new GridHistoryWorkerClient(72, (message): void => { legacyMessages.push(message) })
  const legacyPending = legacy.dispatch([job])
  expect(legacyMessages).toHaveLength(1)
  legacy.receive({ kind: "gridHistoryGrant", taskId: 72, requestId: 1, admittedCandidateIds: [] })
  expect((await legacyPending).size).toBe(0)
  expect(legacy.requestsSkippedForNoIdleWorker).toBe(0)
})
