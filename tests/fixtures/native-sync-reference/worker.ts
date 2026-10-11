import { executeNativeSyncReferenceWorkerRequest, initializeNativeSyncReferenceTransport } from "../../../lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/NativeSyncReferenceBatchTransport"
import { executeParallelReferenceContinuityBatch } from "../../../lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/parallelReferenceContinuityKernel"
import type { NativeSyncReferenceRequest, NativeSyncReferenceResponse } from "../../../lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/nativeSyncReferenceProtocol"

type FixtureMode = "native" | "stale" | "duplicate" | "malformed-unused" | "bad-signal" | "no-signal" | "death"
let mode: FixtureMode = "native"
await initializeNativeSyncReferenceTransport()

self.onmessage = (event: MessageEvent<NativeSyncReferenceRequest | { kind: "ordinary"; mode?: FixtureMode; taskId: number }>): void => {
  const request = event.data
  if (request.kind === "ordinary") {
    mode = request.mode ?? "native"
    self.postMessage({ taskId: request.taskId, result: "ordinary-completed" })
    return
  }
  if (mode === "native") { void executeNativeSyncReferenceWorkerRequest(request); return }
  if (mode === "death") { self.close(); return }
  if (mode === "no-signal") return
  const result = executeParallelReferenceContinuityBatch(request.batch)
  const response: NativeSyncReferenceResponse = { schema: request.schema, schemaHash: request.schemaHash,
    reservationId: request.reservationId, ordinal: request.ordinal, laneCount: request.laneCount,
    snapshotId: request.snapshotId, taskCount: request.taskCount, status: "evaluated", result }
  if (mode === "stale") response.reservationId--
  if (mode === "malformed-unused") {
    const last = response.result.facts[response.result.facts.length - 1]!
    ;(last as { consumedVisits: unknown }).consumedVisits = "not-a-number"
  }
  request.port.postMessage(response)
  if (mode === "duplicate") request.port.postMessage(response)
  request.port.close()
  const words = new Int32Array(request.signal)
  Atomics.store(words, 0, mode === "bad-signal" ? 2 : 1)
  Atomics.notify(words, 0)
}
