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
    expect(completedByRecord).toEqual([0,2166,1922,1923,1509,427,1384,63,8,1231,0,709,168,0,694,0,11])
    expect(binding.book.stats.batchesCompleted).toBe(13)
    expect(binding.book.stats.factRowsCompleted + binding.book.stats.mainFactRowsCompleted).toBe(12215)
    expect(binding.book.stats.workersReserved).toBe(39)
    expect(binding.book.stats.protocolFailures).toBe(0)
    expect(pool.stats.tasksStarted).toBe(4)
    expect(pool.stats.tasksCompleted).toBe(4)
    await pool.warmup()
    expect(pool.stats.tasksStarted).toBe(8)
    expect(pool.stats.tasksCompleted).toBe(8)
  } finally { pool.dispose() }
})
