import { expect, test } from "bun:test"
import { ParallelPortfolioSingleIntraNodeSolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/ParallelPortfolioSingleIntraNodeSolver"
import type { NodeWithPortPoints } from "lib/types/high-density-types"
import cmn45 from "../fixtures/parallel-grid-history-cmn45.json"

function runOracle(responsiveness: boolean): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject): void => {
    const worker = new Worker(new URL("../fixtures/parallel-synchronous-preparation/worker.ts", import.meta.url).href)
    const cancellation = new Int32Array(new SharedArrayBuffer(4))
    worker.onmessage = (event: MessageEvent): void => {
      if (event.data.ready) { worker.postMessage({ ping: true }); return }
      if (event.data.pong) { Atomics.store(cancellation, 0, 1); return }
      worker.terminate()
      if (event.data.error) reject(new Error(event.data.error))
      else resolve(event.data.result)
    }
    worker.onerror = (event: ErrorEvent): void => { worker.terminate(); reject(new Error(event.message)) }
    worker.postMessage(responsiveness ? { cancellationBuffer: cancellation.buffer } : {})
  })
}

test("isolated worker synchronous readiness preserves native selected prefixes, real history awaits and bounded cancellation", async (): Promise<void> => {
  const direct = new ParallelPortfolioSingleIntraNodeSolver({ nodeWithPortPoints: structuredClone(cmn45) as NodeWithPortPoints,
    viaDiameter: .3, traceWidth: .1 }, async () => new Map(), { policy: "ordered", gridHistoryDispatcher: async () => new Map() })
  await direct.prepareForNextStep()
  expect(direct.tryPrepareForNextStepSynchronously()).toBe(false)
  const parity = await runOracle(false)
  expect(parity.actualWorker).toBe(true)
  expect(parity.checkpoints).toBeGreaterThan(0)
  expect(parity.syncPreparations).toBeGreaterThan(0)
  expect(parity.noLeaseAfterQuantum).toBe(true)
  expect(parity.settledUninstalledRemainsAsync).toBe(true)
  expect(parity.exactSelectedErrors).toBe(true)
  expect(parity.noDefaultActivation).toBe(true)
  const responsiveness = await runOracle(true)
  expect(responsiveness.pingReceived).toBe(true)
  expect(responsiveness.cancelled).toBe(true)
  expect(responsiveness.yields).toBeGreaterThan(0)
  expect(responsiveness.noLeaseAfterQuantum).toBe(true)
  if (process.env.SYNCHRONOUS_PREPARATION_PROOF_PATH) await Bun.write(process.env.SYNCHRONOUS_PREPARATION_PROOF_PATH,
    JSON.stringify({ kind: "isolated-worker-synchronous-preparation-proof", noTimingComparison: true, parity, responsiveness }, null, 2))
})
