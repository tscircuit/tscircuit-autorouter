import type {
  DeterministicScheduleWave,
  DynamicRegionGraphSnapshot,
  DynamicRoutingRegion,
  ScheduledRegion,
} from "./planning-types"

export function createDeterministicRegionSchedule({
  regionGraph,
  maximumConcurrency,
  maximumWaveMemoryBytes,
}: {
  regionGraph: DynamicRegionGraphSnapshot
  maximumConcurrency: number
  maximumWaveMemoryBytes: number
}): readonly DeterministicScheduleWave[] {
  validatePositiveInteger({ value: maximumConcurrency, name: "maximumConcurrency" })
  validatePositiveInteger({
    value: maximumWaveMemoryBytes,
    name: "maximumWaveMemoryBytes",
  })
  const pending = [...regionGraph.regions]
  const scheduledRegionIds = new Set<string>()
  const waves: DeterministicScheduleWave[] = []
  while (pending.length > 0) {
    const ready = pending
      .filter((region) =>
        region.dependencyRegionIds.every((dependencyRegionId) =>
          scheduledRegionIds.has(dependencyRegionId),
        ),
      )
      .sort(compareRegionPriority)
    if (ready.length === 0) {
      throw new Error("dynamic region dependency graph contains a cycle")
    }
    const selected: DynamicRoutingRegion[] = []
    let selectedMemoryBytes = 0
    for (const candidate of ready) {
      if (selected.length >= maximumConcurrency) break
      if (
        selected.some(
          (region) =>
            region.conflictRegionIds.includes(candidate.regionId) ||
            candidate.conflictRegionIds.includes(region.regionId),
        )
      ) {
        continue
      }
      if (
        selected.length > 0 &&
        selectedMemoryBytes + candidate.estimatedMemoryBytes >
          maximumWaveMemoryBytes
      ) {
        continue
      }
      selected.push(candidate)
      selectedMemoryBytes += candidate.estimatedMemoryBytes
    }
    if (selected.length === 0) selected.push(ready[0]!)
    const waveIndex = waves.length
    const scheduledRegions = selected.map(
      (region, priorityIndex): ScheduledRegion =>
        Object.freeze({
          regionId: region.regionId,
          priority: priorityIndex,
          color: waveIndex,
          estimatedSolverWork: region.estimatedSolverWork,
          estimatedMemoryBytes: region.estimatedMemoryBytes,
        }),
    )
    waves.push(
      Object.freeze({
        waveIndex,
        regions: Object.freeze(scheduledRegions),
      }),
    )
    for (const region of selected) {
      scheduledRegionIds.add(region.regionId)
      pending.splice(
        pending.findIndex((candidate) => candidate.regionId === region.regionId),
        1,
      )
    }
  }
  return Object.freeze(waves)
}

function compareRegionPriority(
  first: DynamicRoutingRegion,
  second: DynamicRoutingRegion,
): number {
  return (
    second.criticality - first.criticality ||
    second.congestionPressure - first.congestionPressure ||
    second.estimatedSolverWork - first.estimatedSolverWork ||
    first.estimatedMemoryBytes - second.estimatedMemoryBytes ||
    first.regionId.localeCompare(second.regionId)
  )
}

function validatePositiveInteger({
  value,
  name,
}: {
  value: number
  name: string
}): void {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive safe integer`)
  }
}
