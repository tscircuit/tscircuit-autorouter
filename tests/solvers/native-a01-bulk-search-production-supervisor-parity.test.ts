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

test("actual selected A01 supervisor loop bulk-executes while retaining all native100-step checkpoints and caps",async():Promise<void>=>{
  const result=await runWorkerOracle()
  expect(result.actualWorker).toBe(true)
  expect(result.productionLoop).toBe(true)
  expect(result.steps).toBe(957175)
  expect(result.checkpoints).toBe(9572)
  expect(result.bulkSteps).toBe(954765)
  expect(result.batches).toBe(10746)
  expect(result.heapPops).toBe(954765)
  expect(result.heapPushes).toBe(1062783)
  expect(result.lateObservers).toBe(11)
  expect(result.productionObservers).toBe(8)
  expect(result.noLeaseAfterQuantum).toBe(true)
  if(process.env.BULK_A01_PRODUCTION_PROOF_PATH) await Bun.write(process.env.BULK_A01_PRODUCTION_PROOF_PATH,
    JSON.stringify({kind:"production-selected-loop-functional-proof",noTimingComparison:true,...result},null,2))
})
