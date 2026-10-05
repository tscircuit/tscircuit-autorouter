import { CachableSolver } from "./types"

export function attemptToUseCacheSync(solver: CachableSolver): boolean {
  const cacheProvider = solver.cacheProvider
  if (!cacheProvider) return false
  if (!cacheProvider.isSyncCache) {
    console.log("Cache provider is not synchronous, skipping sync cache check.")
    return false
  }

  if (!solver.cacheKey) {
    solver.computeCacheKeyAndTransform()
  }

  if (!solver.cacheKey) {
    console.error("Failed to compute cache key.")
    return false
  }

  try {
    const cachedSolution = cacheProvider.getCachedSolutionSync(solver.cacheKey)

    if (cachedSolution) {
      solver.applyCachedSolution(cachedSolution)
      return true
    } else {
      // console.log(`Cache miss for UnravelSectionSolver: ${solver.cacheKey}`)
    }
  } catch (error) {
    console.error("Error attempting to use cache:", error)
  }

  return false
}
