export const serializeIntraNodeCacheKey = (key: unknown): string =>
  JSON.stringify(key, (_key: string, entry: unknown): unknown => {
    if (typeof entry === "number" && !Number.isFinite(entry)) {
      return `n:${entry.toString()}`
    }
    if (
      typeof entry === "string" &&
      (entry === "u:" || entry.startsWith("n:") || entry.startsWith("s:"))
    ) {
      return `s:${entry}`
    }
    return entry === undefined ? "u:" : entry
  })
