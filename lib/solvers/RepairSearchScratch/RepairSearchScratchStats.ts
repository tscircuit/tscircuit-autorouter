export type RepairSearchScratchStats = {
  searchInstances: number
  neighborListsServed: number
  neighborScratchBuffersCreated: number
  kernelInstances: number
  costQueriesServed: number
  costScratchFramesCreated: number
  costHitRecordsCreated: number
  costHitRecordsReused: number
  ownerAccumulatorsServed: number
  publicHitArraysCreated: number
}

export function createRepairSearchScratchStats(): RepairSearchScratchStats {
  return {
    searchInstances: 0,
    neighborListsServed: 0,
    neighborScratchBuffersCreated: 0,
    kernelInstances: 0,
    costQueriesServed: 0,
    costScratchFramesCreated: 0,
    costHitRecordsCreated: 0,
    costHitRecordsReused: 0,
    ownerAccumulatorsServed: 0,
    publicHitArraysCreated: 0,
  }
}
