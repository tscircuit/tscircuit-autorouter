import { mergeRepairRegion } from "@tscircuit/repair04"
import type { HighDensityRoute } from "lib/types/high-density-types"
import type { Pipeline9ParallelRegionalTaskOutput } from "./Pipeline9ParallelRegionalTaskSolver"

/** Merge only whole candidates that modify distinct source routes. */
export function mergePipeline9ParallelRegionalResults(
  routes: HighDensityRoute[],
  results: Pipeline9ParallelRegionalTaskOutput[],
): { routes: HighDensityRoute[]; deferredCount: number; deferredIndices: number[] } {
  const combined = [...routes]
  const changedIndices = new Set<number>()
  let deferredCount = 0
  const deferredIndices: number[] = []
  for (const [resultIndex, { region, result }] of results.entries()) {
    if (!result) {
      deferredCount++
      deferredIndices.push(resultIndex)
      continue
    }
    // Each candidate must be spliced against the exact source snapshot from
    // which its provenance was generated, never against a previous splice.
    const candidate = mergeRepairRegion({ routes, region, repairedRoutes: result.routes })
    const changes = candidate.flatMap((route, index): number[] =>
      route !== routes[index] ? [index] : [],
    )
    if (changes.some((index) => changedIndices.has(index))) {
      deferredCount++
      deferredIndices.push(resultIndex)
      continue
    }
    for (const index of changes) {
      combined[index] = candidate[index]!
      changedIndices.add(index)
    }
  }
  return { routes: combined, deferredCount, deferredIndices }
}
