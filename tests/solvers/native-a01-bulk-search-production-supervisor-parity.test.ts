import { expect,test } from "bun:test"

function runWorkerOracle():Promise<Record<string,unknown>> {
  return new Promise((resolve,reject):void=>{
    const worker=new Worker(new URL("../fixtures/parallel-owner-bulk-a01/worker.ts",import.meta.url).href)
    worker.onmessage=(event:MessageEvent):void=>{
      worker.terminate()
      if(event.data.error) reject(new Error(event.data.error))
      else resolve(event.data.result)
    }
    worker.onerror=(event:ErrorEvent):void=>{worker.terminate();reject(new Error(event.message))}
    worker.postMessage({productionLoop:true})
  })
}

test("default selected A01 supervisor retains the native100-step loop and leaves the experimental bulk kernel inactive",async():Promise<void>=>{
  const result=await runWorkerOracle()
  expect(result.actualWorker).toBe(true)
  expect(result.productionLoop).toBe(true)
  expect(result.steps).toBe(957175)
  expect(result.checkpoints).toBe(9572)
  expect(result.bulkSteps).toBe(0)
  expect(result.batches).toBe(0)
  expect(result.heapPops).toBe(0)
  expect(result.heapPushes).toBe(0)
  expect(result.lateObservers).toBe(11)
  expect(result.productionObservers).toBe(8)
  expect(result.noDefaultActivation).toBe(true)
  expect(result.noLeaseAfterQuantum).toBe(true)
  if(process.env.BULK_A01_PRODUCTION_PROOF_PATH) await Bun.write(process.env.BULK_A01_PRODUCTION_PROOF_PATH,
    JSON.stringify({kind:"production-selected-loop-functional-proof",noTimingComparison:true,...result},null,2))
})
