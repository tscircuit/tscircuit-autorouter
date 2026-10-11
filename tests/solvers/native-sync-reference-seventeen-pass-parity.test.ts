import { expect, test } from "bun:test"
import type { AnyCircuitElement } from "circuit-json"
import { readFileSync } from "node:fs"
import { gunzipSync } from "node:zlib"
import { Pipeline9LocalWorkerPool, getNativeSyncReferencePoolBinding } from "../../lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/Pipeline9LocalWorkerPool"
import { createNativeSyncReferenceFactExecutor } from "../../lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/NativeSyncReferenceBatchTransport"
import { createPrivatelyMemoizedTraceContinuityChecker, createPreparedPrivatelyMemoizedTraceContinuityChecker } from "../../lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/authoritative-drc-fork/native/lib/check-traces-are-contiguous/check-traces-are-contiguous"
import { checkViaTraceClearanceWithLazyCenters } from "../../lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/authoritative-drc-fork/checkViaTraceClearanceWithLazyCenters"
import { getDrcErrors } from "../../lib/testing/getDrcErrors"

test("actual default worker facts preserve all seventeen native reference executions and warm-cache routing", async () => {
  type Capture = { number: number; circuitJson: AnyCircuitElement[]; options: Parameters<typeof getDrcErrors>[1]; expected: unknown }
  const captures = JSON.parse(gunzipSync(new Uint8Array(readFileSync(new URL("../fixtures/reference-drc-srj18/sample015-native-reference.json.gz", import.meta.url)))).toString()) as { records: Capture[] }
  const pool = new Pipeline9LocalWorkerPool({ workerCount: 4 })
  await pool.initializeReferenceTransport()
  await pool.warmup()
  const executor = createNativeSyncReferenceFactExecutor(pool)!
  const prepared = createPreparedPrivatelyMemoizedTraceContinuityChecker(executor)
  const native = createPrivatelyMemoizedTraceContinuityChecker()
  const binding = getNativeSyncReferencePoolBinding(pool)!
  const completedByRecord: number[] = []
  try {
    for (const capture of captures.records) {
      const original = structuredClone(capture.circuitJson), candidate = structuredClone(capture.circuitJson)
      const options: Parameters<typeof getDrcErrors>[1] = { ...capture.options,
        viaTraceChecker: (circuit, options) => checkViaTraceClearanceWithLazyCenters(circuit, { ...options, enableAxisRejection: true, enableConnectivityMemo: true }) }
      const expected = getDrcErrors(original, { ...options, traceContinuityChecker: native })
      const before = binding.book.stats.factRowsCompleted + binding.book.stats.mainFactRowsCompleted
      const output = getDrcErrors(candidate, { ...options, traceContinuityChecker: prepared })
      expect(JSON.parse(JSON.stringify(expected))).toEqual(capture.expected)
      expect(output).toEqual(expected)
      expect(candidate).toEqual(original)
      completedByRecord.push(binding.book.stats.factRowsCompleted + binding.book.stats.mainFactRowsCompleted - before)
      expect(binding.book.stats.workersReserved).toBe(binding.book.stats.workersRetired)
    }
    expect(completedByRecord).toEqual([0,4837,3557,4053,2341,2600,2265,403,1650,1810,0,2051,208,0,1094,0,1247])
    expect(binding.book.stats.batchesCompleted).toBe(26)
    expect(binding.book.stats.factRowsCompleted + binding.book.stats.mainFactRowsCompleted).toBe(28116)
    expect(binding.book.stats.workersReserved).toBe(78)
    expect(binding.book.stats.protocolFailures).toBe(0)
    expect(pool.stats.tasksStarted).toBe(4)
    expect(pool.stats.tasksCompleted).toBe(4)
    await pool.warmup()
    expect(pool.stats.tasksStarted).toBe(8)
    expect(pool.stats.tasksCompleted).toBe(8)
    const counts = pool.getNativeReferenceFactStats()!
    expect(counts.batchesCompleted).toBe(26)
    expect(counts.workerFactRowsCompleted + counts.mainFactRowsCompleted).toBe(28116)
    expect(counts.workersReserved).toBe(78)
    expect(counts.workersRetired).toBe(78)
    expect(counts.protocolFaults).toBe(0)
    expect(counts.maxFactWorkerLanes).toBe(3)
    expect(counts.mainFactLaneCount).toBe(1)
  } finally { pool.dispose() }
  expect(pool.getNativeReferenceFactStats()!.protocolFaults).toBe(0)
  expect(pool.getNativeReferenceFactStats()!.batchesCompleted).toBe(26)
})
