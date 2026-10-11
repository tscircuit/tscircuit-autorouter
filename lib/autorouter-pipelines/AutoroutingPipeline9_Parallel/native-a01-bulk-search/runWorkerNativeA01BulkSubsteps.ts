import type { HighDensitySolverA01 } from "@tscircuit/high-density-a01"
import type { GridHistoryDispatcher } from "../parallelGridHistoryTypes"
import { beginWorkerNativeGridKernelQuantum,finishWorkerNativeGridKernelQuantum,
  isWorkerOwnedNativeGridOwner,type WorkerNativeGridPortfolioContract } from "../workerNativeGridKernelQuantum"
import { nativeOwnerDescriptor,nativeOwnerHasOwn } from "../nativeOwnerKernelContract"
import { hasNativeDescriptorMetadata } from "../nativeDescriptorMetadataGuard"
import { isWorkerNativeGridProxy } from "../workerNativeGridRuntime"
import { runWorkerNativeA01BulkSearchPrototype } from "./workerNativeA01BulkSearchPrototype"

type NativePortfolio={MIN_SUBSTEPS:number}
type NativeSupervisedRecord={solver:{step():void}}

/** Replace only the original selected100-call native loop, never its schedule. */
export function runWorkerNativeA01BulkSubsteps(portfolio:NativePortfolio,
  contract:WorkerNativeGridPortfolioContract,owner:HighDensitySolverA01,
  supervisedSolver:NativeSupervisedRecord,
  dispatcher?:GridHistoryDispatcher):boolean {
  if(!isWorkerOwnedNativeGridOwner(owner)||isWorkerNativeGridProxy(supervisedSolver)||!hasNativeDescriptorMetadata()) return false
  const binding=nativeOwnerDescriptor(supervisedSolver,"solver")
  if(!binding||!nativeOwnerHasOwn(binding,"value")||binding.value!==owner) return false
  const limit=nativeOwnerDescriptor(portfolio,"MIN_SUBSTEPS")
  if(!limit||!nativeOwnerHasOwn(limit,"value")||limit.value!==100) return false
  let quantum=beginWorkerNativeGridKernelQuantum(portfolio,contract,owner,dispatcher)
  if(!quantum) return false
  let offset=0
  try {
    while(offset<100) {
      if(!quantum) {
        finishWorkerNativeGridKernelQuantum(quantum);quantum=null
        // Unknown callbacks use the verbatim native dynamic-loop condition.
        // No changed C work is discarded, retried or recovered.
        for(let index=offset;index<portfolio.MIN_SUBSTEPS;index++) supervisedSolver.solver.step()
        return true
      }
      const result=runWorkerNativeA01BulkSearchPrototype(owner,100-offset)
      if(!result || result.event==="terminal") {
        finishWorkerNativeGridKernelQuantum(quantum);quantum=null
        for(let index=offset;index<portfolio.MIN_SUBSTEPS;index++) supervisedSolver.solver.step()
        return true
      }
      offset+=result.consumed
      if(offset<100&&result.event!=="limit") {
        // All private rows are already authoritative. Native error formatting,
        // goal/start/final acceptance and any callback execute after release.
        finishWorkerNativeGridKernelQuantum(quantum);quantum=null
        supervisedSolver.solver.step();offset++
        if(offset<100) {
          if(!hasNativeDescriptorMetadata()) continue
          const current=nativeOwnerDescriptor(portfolio,"MIN_SUBSTEPS")
          if(!current||!nativeOwnerHasOwn(current,"value")||current.value!==100) continue
          const selected=nativeOwnerDescriptor(supervisedSolver,"solver")
          if(!selected||!nativeOwnerHasOwn(selected,"value")||selected.value!==owner) continue
          quantum=beginWorkerNativeGridKernelQuantum(portfolio,contract,owner,dispatcher)
        }
      }
    }
    return true
  } finally {finishWorkerNativeGridKernelQuantum(quantum)}
}
