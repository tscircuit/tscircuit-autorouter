export type Pipeline9RepairKernelDiagnostics = {
  searchCount: number
  denseSearchCount: number
  densePlanarEdgeLookups: number
  densePlanarEdgeCacheHits: number
  denseViaSiteLookups: number
  denseViaSiteCacheHits: number
  sparseEdgeLookups: number
  neighborPointAllocationsAvoided: number
  neighborBufferReuses: number
  copperQueryBufferReuses: number
  additionalCostCalls: number
  ownerCostMapAllocations: number
}

export function createPipeline9RepairKernelDiagnostics(): Pipeline9RepairKernelDiagnostics {
  return {
    searchCount: 0,
    denseSearchCount: 0,
    densePlanarEdgeLookups: 0,
    densePlanarEdgeCacheHits: 0,
    denseViaSiteLookups: 0,
    denseViaSiteCacheHits: 0,
    sparseEdgeLookups: 0,
    neighborPointAllocationsAvoided: 0,
    neighborBufferReuses: 0,
    copperQueryBufferReuses: 0,
    additionalCostCalls: 0,
    ownerCostMapAllocations: 0,
  }
}

export function addPipeline9RepairKernelDiagnostics(
  target: Pipeline9RepairKernelDiagnostics,
  source: Pipeline9RepairKernelDiagnostics,
): void {
  for (const key of Object.keys(source) as Array<keyof Pipeline9RepairKernelDiagnostics>) {
    target[key] += source[key]
  }
}
