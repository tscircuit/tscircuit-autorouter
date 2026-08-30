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
  const colored: { readonly region: DynamicRoutingRegion; readonly color: number }[] = []
  while (pending.length > 0) {
    const ready = pending
      .filter((region) =>
        region.dependencyRegionIds.every((dependencyRegionId) =>
          colored.some(
            (entry) => entry.region.regionId === dependencyRegionId,
          ),
        ),
      )
      .sort(compareRegionPriority)
    if (ready.length === 0) {
      throw new Error("dynamic region dependency graph contains a cycle")
    }
    for (const candidate of ready) {
      const dependencyColors = candidate.dependencyRegionIds.map(
        (dependencyRegionId) =>
          colored.find(
            (entry) => entry.region.regionId === dependencyRegionId,
          )!.color,
      )
      const minimumColor =
        dependencyColors.length === 0 ? 0 : Math.max(...dependencyColors) + 1
      const forbiddenColors = new Set(
        colored
          .filter(
            (entry) =>
              candidate.conflictRegionIds.includes(entry.region.regionId) ||
              entry.region.conflictRegionIds.includes(candidate.regionId),
          )
          .map((entry) => entry.color),
      )
      let color = minimumColor
      while (forbiddenColors.has(color)) color += 1
      colored.push(Object.freeze({ region: candidate, color }))
      pending.splice(
        pending.findIndex((region) => region.regionId === candidate.regionId),
        1,
      )
    }
  }
  const waves: DeterministicScheduleWave[] = []
  const colors = [...new Set(colored.map((entry) => entry.color))].sort(
    (first, second) => first - second,
  )
  for (const color of colors) {
    const colorEntries = colored
      .filter((entry) => entry.color === color)
      .sort((first, second) =>
        compareRegionPriority(first.region, second.region),
      )
    let batch: typeof colorEntries = []
    let batchMemoryBytes = 0
    const flushBatch = (): void => {
      if (batch.length === 0) return
      const waveIndex = waves.length
      const regions = batch.map(
        (entry, priority): ScheduledRegion =>
          Object.freeze({
            regionId: entry.region.regionId,
            priority,
            color,
            estimatedSolverWork: entry.region.estimatedSolverWork,
            estimatedMemoryBytes: entry.region.estimatedMemoryBytes,
          }),
      )
      waves.push(
        Object.freeze({ waveIndex, regions: Object.freeze(regions) }),
      )
      batch = []
      batchMemoryBytes = 0
    }
    for (const entry of colorEntries) {
      if (
        batch.length >= maximumConcurrency ||
        (batch.length > 0 &&
          batchMemoryBytes + entry.region.estimatedMemoryBytes >
            maximumWaveMemoryBytes)
      ) {
        flushBatch()
      }
      batch.push(entry)
      batchMemoryBytes += entry.region.estimatedMemoryBytes
    }
    flushBatch()
  }
  return Object.freeze(waves)
}

function compareRegionPriority(
  first: DynamicRoutingRegion,
  second: DynamicRoutingRegion,
): number {
  return (
    second.criticality - first.criticality ||
    first.estimatedSolverWork - second.estimatedSolverWork ||
    second.congestionPressure - first.congestionPressure ||
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
