import { expect,test } from "bun:test"
import { HighDensitySolverA01 } from "@tscircuit/high-density-a01"
import { runWorkerNativeA01BulkSearchPrototype } from "lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/native-a01-bulk-search/workerNativeA01BulkSearchPrototype"
import type { NodeWithPortPoints } from "lib/types/high-density-types"
import cmn45 from "../fixtures/parallel-grid-history-cmn45.json"

function runWorkerOracle():Promise<Record<string,unknown>> {
  return new Promise((resolve,reject):void=>{
    const worker=new Worker(new URL("../fixtures/parallel-owner-bulk-a01/worker.ts",import.meta.url).href)
    worker.onmessage=(event:MessageEvent):void=>{
      worker.terminate()
      if(event.data.error) reject(new Error(event.data.error))
      else resolve(event.data.result)
    }
    worker.onerror=(event:ErrorEvent):void=>{worker.terminate();reject(new Error(event.message))}
    worker.postMessage({})
  })
}

test("isolated bulk A01 requires a genuine live worker quantum and preserves every original selected boundary",async():Promise<void>=>{
  const direct=new HighDensitySolverA01({nodeWithPortPoints:structuredClone(cmn45) as NodeWithPortPoints,
    cellSizeMm:.1,viaDiameter:.3,traceThickness:.1})
  direct.setup()
  expect(runWorkerNativeA01BulkSearchPrototype(direct,100)).toBeNull()
  const result=await runWorkerOracle()
  expect(result.actualWorker).toBe(true)
  expect(result.steps).toBe(957175)
  expect(result.checkpoints).toBe(9572)
  expect(result.frontiers).toBe(11951)
  expect(result.bulkSteps).toBe(954765)
  expect(result.batches).toBe(10746)
  expect(result.heapPops).toBe(954765)
  expect(result.heapPushes).toBe(1062783)
  expect(result.lateObservers).toBe(11)
  expect(result.noDefaultActivation).toBe(true)
  expect(result.noLeaseAfterQuantum).toBe(true)
  if(process.env.BULK_A01_WORKER_PROOF_PATH) await Bun.write(process.env.BULK_A01_WORKER_PROOF_PATH,
    JSON.stringify({kind:"authentic-worker-functional-proof",noTimingComparison:true,...result},null,2))
})
