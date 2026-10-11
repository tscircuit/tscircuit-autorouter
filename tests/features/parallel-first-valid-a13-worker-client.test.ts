import { expect, test } from "bun:test"
import { FirstValidA13WorkerClient } from "lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/FirstValidA13WorkerClient"
import type { FirstValidA13CandidateCancellation, FirstValidA13CandidateJob, FirstValidA13CandidateRequest, FirstValidA13CandidateResult } from "lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/firstValidA13CandidateTypes"
import { createFirstValidNode } from "tests/fixtures/first-valid-hd-fixtures"

test("A13 admission resolves independently of execution and correlates cancellation, delivery and errors", async (): Promise<void> => {
  const messages: Array<FirstValidA13CandidateRequest | FirstValidA13CandidateCancellation> = []
  const client = new FirstValidA13WorkerClient(81, (message): void => {
    expect(message.taskId).toBe(81)
    if (message.kind === "requestFirstValidA13Candidate") {
      expect(message.job.kind).toBe("firstValidA13Candidate")
    }
    messages.push(message)
  })
  const job: FirstValidA13CandidateJob = { kind: "firstValidA13Candidate",
    params: { nodeWithPortPoints: createFirstValidNode(), traceWidth: 0.15, viaDiameter: 0.3,
      layerCount: 2, effort: 0.25, obstacles: [] },
    connectivityNetMap: {}, connectivityIdToNetMap: {} }
  const result: FirstValidA13CandidateResult = { kind: "firstValidA13Candidate", status: "failed",
    iterations: 4, maxIterations: 25_000_000, routingIterations: 731, sourceStats: {}, error: "Expected search exhaustion" }

  const deniedRequest = client.dispatch(job)
  client.receive({ kind: "firstValidA13CandidateGrant", taskId: 81, requestId: 1, admitted: false })
  expect(await deniedRequest).toBeNull()
  client.cancelUnusedCandidate()
  expect(messages).toHaveLength(1)

  const acceptedRequest = client.dispatch(job)
  expect(() => client.receive({ kind: "firstValidA13CandidateDelivery", taskId: 81, requestId: 2, ok: true, result })).toThrow("not admitted")
  client.receive({ kind: "firstValidA13CandidateGrant", taskId: 81, requestId: 2, admitted: true })
  const admission = await acceptedRequest
  expect(admission).not.toBeNull()
  if (!admission) throw new Error("Expected an admitted A13 result envelope")
  expect(admission.result).toBeInstanceOf(Promise)
  let resultSettled = false
  const observedResult = admission.result.then((value): FirstValidA13CandidateResult => {
    resultSettled = true
    expect(value.kind).toBe("firstValidA13Candidate")
    expect(value.iterations).toBe(4)
    expect(value.routingIterations).toBe(731)
    return value
  })
  await Promise.resolve()
  expect(resultSettled).toBe(false)
  expect(() => client.receive({ kind: "firstValidA13CandidateGrant", taskId: 81, requestId: 2, admitted: true })).toThrow("repeated")
  expect(() => client.receive({ kind: "firstValidA13CandidateDelivery", taskId: 82, requestId: 2, ok: true, result })).toThrow("Unexpected")
  client.cancelUnusedCandidate()
  expect(messages.at(-1)).toEqual({ kind: "cancelFirstValidA13Candidate", taskId: 81 })
  client.receive({ kind: "firstValidA13CandidateDelivery", taskId: 81, requestId: 2, ok: true, result })
  expect(await observedResult).toBe(result)
  expect(resultSettled).toBe(true)
  const messageCount = messages.length
  client.cancelUnusedCandidate()
  expect(messages).toHaveLength(messageCount)
  expect(() => client.receive({ kind: "firstValidA13CandidateDelivery", taskId: 81, requestId: 2, ok: true, result })).toThrow("Unexpected")

  const failedRequest = client.dispatch(job)
  client.receive({ kind: "firstValidA13CandidateGrant", taskId: 81, requestId: 3, admitted: true })
  const failedAdmission = await failedRequest
  if (!failedAdmission) throw new Error("Expected the failing A13 worker to be admitted")
  const failedResult = failedAdmission.result.catch((error: unknown): unknown => error)
  client.receive({ kind: "firstValidA13CandidateDelivery", taskId: 81, requestId: 3, ok: false, error: "A13 worker transport failed" })
  expect(await failedResult).toMatchObject({ message: "A13 worker transport failed" })
  const finalMessageCount = messages.length
  client.cancelUnusedCandidate()
  expect(messages).toHaveLength(finalMessageCount)
})
