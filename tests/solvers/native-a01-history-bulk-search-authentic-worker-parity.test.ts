import { expect,test } from "bun:test"
import { createWorkerNativeA01HistoryBulkTask } from "lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/native-a01-history-bulk-search/workerNativeA01HistoryBulkPrototype"
import type { GridHistoryJob } from "lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/parallelGridHistoryTypes"
import type { NodeWithPortPoints } from "lib/types/high-density-types"
import cmn45 from "../fixtures/parallel-grid-history-cmn45.json"

function runWorkerOracle(job:GridHistoryJob):Promise<Record<string,unknown>> {
  return new Promise((resolve,reject):void=>{
    const worker=new Worker(new URL("../fixtures/parallel-history-bulk-a01/worker.ts",import.meta.url).href)
    worker.onmessage=(event:MessageEvent):void=>{
      worker.terminate()
      if(event.data.error) reject(new Error(event.data.error))
      else resolve(event.data.result)
    }
    worker.onerror=(event:ErrorEvent):void=>{worker.terminate();reject(new Error(event.message))}
    worker.postMessage(job)
  })
}

test("isolated physical history bulk uses its own genuine worker capability and preserves native state, atomic loads, cancellation and retirement",async():Promise<void>=>{
  const job:GridHistoryJob={kind:"gridHistory",algorithm:"a01",candidateId:0,maxIterations:160000,ownerIterations:0,
    params:{nodeWithPortPoints:structuredClone(cmn45) as NodeWithPortPoints,cellSizeMm:.1,viaDiameter:.3,
      traceThickness:.1,viaMinDistFromBorder:.15,traceMargin:.1,effort:1},cancellationBuffer:new SharedArrayBuffer(4)}
  expect(createWorkerNativeA01HistoryBulkTask(job)).toBeNull()
  const result=await runWorkerOracle(job)
  expect(result.actualWorker).toBe(true)
  expect(result.steps).toBe(957175)
  expect(result.atomicLoads).toBe(957175)
  expect(result.checkpoints).toBe(9572)
  expect(result.pureSteps).toBe(954765)
  expect(result.batches).toBe(10746)
  expect(result.events).toBe(2410)
  expect(result.negativeCases).toBe(14)
  expect(result.cancellationCases).toBe(7)
  expect(result.ordinaryReplayCapabilityUsed).toBe(false)
  expect(result.noLeaseAfterRun).toBe(true)
  if(process.env.HISTORY_BULK_A01_PROOF_PATH) await Bun.write(process.env.HISTORY_BULK_A01_PROOF_PATH,
    JSON.stringify({kind:"isolated-physical-history-functional-proof",noTimingComparison:true,...result},null,2))
})
