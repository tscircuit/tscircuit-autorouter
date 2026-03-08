import { normalizeVersion } from "../versioning/normalizeVersion.ts"
import type { CachedResultFile } from "../types/CachedResultFile.ts"

export const parseCachedResultFile = (
  fileName: string,
): CachedResultFile | null => {
  if (!fileName.endsWith(".json")) return null

  // Result files are stored as "<version>-<timestamp>.json".
  const withoutExtension = fileName.slice(0, -".json".length)
  const separatorIndex = withoutExtension.lastIndexOf("-")
  if (separatorIndex === -1) return null

  const version = normalizeVersion(withoutExtension.slice(0, separatorIndex))
  const timestamp = Number.parseInt(
    withoutExtension.slice(separatorIndex + 1),
    10,
  )

  if (!version || Number.isNaN(timestamp)) return null

  return {
    fileName,
    timestamp,
    version,
  }
}
