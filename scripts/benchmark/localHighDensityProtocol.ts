export type LocalHighDensityJson =
  | null
  | boolean
  | number
  | string
  | LocalHighDensityJson[]
  | { [key: string]: LocalHighDensityJson }
export type LocalHighDensityObject = { [key: string]: LocalHighDensityJson }
export type LocalHighDensityRequest = {
  autorouterVersion: string
  cacheVersion?: string
  input: LocalHighDensityObject
}
export type LocalHighDensityBatchRequest = {
  autorouterVersion: string
  cacheVersion?: string
  items: Array<{ requestId: string; input: LocalHighDensityObject }>
}
export type LocalHighDensityServerStats = {
  solveRequests: number
  batchRequests: number
  cacheHits: number
  cacheMisses: number
  jobsComputed: number
  computeMs: number
}

/** Keep output metadata JSON-safe without discarding any supported field. */
export function normalizeLocalHighDensityJson(
  value: unknown,
): LocalHighDensityJson {
  if (value === null || typeof value === "string" || typeof value === "boolean")
    return value
  if (typeof value === "number" && Number.isFinite(value)) return value
  if (Array.isArray(value)) return value.map(normalizeLocalHighDensityJson)
  if (
    typeof value !== "object" ||
    value === undefined ||
    Object.getPrototypeOf(value) !== Object.prototype
  ) {
    throw new TypeError("Local high-density payload contains a non-JSON value")
  }
  return Object.fromEntries(
    Object.entries(value)
      .filter(([_key, item]) => item !== undefined)
      .map(([key, item]) => [key, normalizeLocalHighDensityJson(item)]),
  )
}

export function canonicalLocalHighDensityJson(
  value: LocalHighDensityJson,
): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value)
  if (Array.isArray(value)) {
    return `[${value.map(canonicalLocalHighDensityJson).join(",")}]`
  }
  return `{${Object.keys(value)
    .sort()
    .map(
      (key) =>
        `${JSON.stringify(key)}:${canonicalLocalHighDensityJson(value[key])}`,
    )
    .join(",")}}`
}

export function getLocalHighDensityCacheKey(
  request: LocalHighDensityRequest,
): string {
  return canonicalLocalHighDensityJson({
    autorouterVersion: request.autorouterVersion,
    cacheVersion:
      request.cacheVersion === undefined ? null : request.cacheVersion,
    input: request.input,
  })
}

export function getLocalHighDensityServerIndex(
  request: LocalHighDensityRequest,
  serverCount: number,
): number {
  // Revision and run namespace isolate caches but must not move equal jobs
  // between CPUs when comparing repeats or different checkout versions.
  const key = canonicalLocalHighDensityJson(request.input)
  let hash = 2166136261
  for (let index = 0; index < key.length; index++) {
    hash = Math.imul(hash ^ key.charCodeAt(index), 16777619)
  }
  return (hash >>> 0) % serverCount
}

export function parseLocalHighDensityRequest(
  value: unknown,
  autorouterVersion: string,
  batch: false,
): LocalHighDensityRequest
export function parseLocalHighDensityRequest(
  value: unknown,
  autorouterVersion: string,
  batch: true,
): LocalHighDensityBatchRequest
export function parseLocalHighDensityRequest(
  value: unknown,
  autorouterVersion: string,
  batch: boolean,
): LocalHighDensityRequest | LocalHighDensityBatchRequest {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("Local high-density request must be an object")
  }
  const object = value as Record<string, unknown>
  const allowedKeys = batch
    ? ["autorouterVersion", "cacheVersion", "items"]
    : ["autorouterVersion", "cacheVersion", "input"]
  if (Object.keys(object).some((key) => !allowedKeys.includes(key))) {
    throw new TypeError(
      "Local high-density request contains unsupported fields",
    )
  }
  if (object.autorouterVersion !== autorouterVersion) {
    throw new TypeError(
      `Local high-density autorouter version must equal ${autorouterVersion}`,
    )
  }
  if (
    object.cacheVersion !== undefined &&
    (typeof object.cacheVersion !== "string" ||
      object.cacheVersion.trim().length === 0)
  ) {
    throw new TypeError(
      "Local high-density cache namespace must be a nonempty string",
    )
  }
  const parseInput = (input: unknown): LocalHighDensityObject => {
    const normalized = normalizeLocalHighDensityJson(input)
    if (
      normalized === null ||
      typeof normalized !== "object" ||
      Array.isArray(normalized)
    ) {
      throw new TypeError("Local high-density input must be an object")
    }
    if (typeof normalized.solvePolicy !== "string") {
      throw new TypeError(
        "Local high-density input requires an explicit solve policy",
      )
    }
    return normalized
  }
  const identity = {
    autorouterVersion,
    ...(object.cacheVersion === undefined
      ? {}
      : { cacheVersion: object.cacheVersion as string }),
  }
  if (!batch) return { ...identity, input: parseInput(object.input) }
  if (!Array.isArray(object.items) || object.items.length > 10_000) {
    throw new TypeError(
      "Local high-density batch must contain at most 10000 items",
    )
  }
  const requestIds = new Set<string>()
  const items = object.items.map(
    (item: unknown): LocalHighDensityBatchRequest["items"][number] => {
      if (item === null || typeof item !== "object" || Array.isArray(item)) {
        throw new TypeError("Local high-density batch item must be an object")
      }
      const entry = item as Record<string, unknown>
      if (
        Object.keys(entry).some(
          (key) => !["requestId", "input"].includes(key),
        ) ||
        typeof entry.requestId !== "string" ||
        entry.requestId.length === 0 ||
        requestIds.has(entry.requestId)
      ) {
        throw new TypeError(
          "Local high-density batch requires unique nonempty request IDs",
        )
      }
      requestIds.add(entry.requestId)
      return { requestId: entry.requestId, input: parseInput(entry.input) }
    },
  )
  return { ...identity, items }
}
