import { join } from "node:path"
import { currentVersion, resultsDir } from "../config/paths.ts"
import { getVersionDistance } from "../versioning/getVersionDistance.ts"
import { parseCachedResultFile } from "./parseCachedResultFile.ts"
import type { CachedResultFile } from "../types/CachedResultFile.ts"
import type { SolveResult } from "../types/SolveResult.ts"
import { readdir } from "node:fs/promises"

export const loadCachedResults = async (): Promise<SolveResult[]> => {
  const candidates = (await readdir(resultsDir))
    .map(parseCachedResultFile)
    .filter((candidate): candidate is CachedResultFile => candidate !== null)

  if (candidates.length === 0) {
    throw new Error(`No cached result files found in ${resultsDir}`)
  }

  candidates.sort((left, right) => {
    const leftExact = left.version === currentVersion ? 0 : 1
    const rightExact = right.version === currentVersion ? 0 : 1

    // Prefer exact version matches, then the nearest version, then newest timestamp.
    if (leftExact !== rightExact) return leftExact - rightExact

    const distanceDelta =
      getVersionDistance(left.version, currentVersion) -
      getVersionDistance(right.version, currentVersion)

    if (distanceDelta !== 0) return distanceDelta

    return right.timestamp - left.timestamp
  })

  const selected = candidates[0]!

  if (selected.version === currentVersion) {
    console.warn(
      `Using cached results for autorouter version ${selected.version} from ${new Date(selected.timestamp).toISOString()}`,
    )
  } else {
    console.warn(
      `No cached results found for version ${currentVersion}; using nearest cached version ${selected.version} from ${new Date(selected.timestamp).toISOString()}`,
    )
  }

  return (await Bun.file(
    join(resultsDir, selected.fileName),
  ).json()) as SolveResult[]
}
