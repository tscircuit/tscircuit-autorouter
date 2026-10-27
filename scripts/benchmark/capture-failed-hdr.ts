type CaptureHeader = { solverName: string; scenarioName: string; sampleNumber: number }
type HdrSource = { params?: unknown }

/** Encodes the retained constructor data without traversing a solver instance. */
export const serializeFailedHdrInput = (
  header: CaptureHeader,
  source: HdrSource | undefined,
  error: string | undefined,
): string | undefined => {
  const params = source?.params
  if (!params || typeof params !== "object") return
  const nodes = (params as { nodePortPoints?: unknown }).nodePortPoints
  if (!Array.isArray(nodes)) return
  const failedNodeIds = error?.match(/Failed to solve \d+ nodes, (.*?)\. err0:/)?.[1]
    .split(",").map((id) => id.trim()).filter(Boolean) ?? []
  const matchingFailedNodes = nodes.filter((node) =>
    failedNodeIds.includes(node?.capacityMeshNodeId),
  )
  return JSON.stringify({
    kind: "ACTUAL_FAILED_HDR_RETAINED_CONSTRUCTOR_NOT_ROUTED_BOARD",
    formatVersion: 1,
    ...header,
    constructorName: source!.constructor.name,
    error,
    failedNodeIds,
    matchingFailedNodes,
    retainedConstructorNodeCount: nodes.length,
    constructorParams: params,
    encoding: "Maps, Sets, typed arrays, undefined and nonfinite numbers are tagged. ConnectivityMap is encoded by its actual netMap; reconstruct that object for replay. No constructor or solver method was invoked.",
  }, (key, value: unknown) => {
    if (key === "connMap" && value && typeof value === "object" && "netMap" in value) {
      return { __captureType: "ConnectivityMap", netMap: value.netMap }
    }
    if (value instanceof Map) return { __captureType: "Map", entries: [...value] }
    if (value instanceof Set) return { __captureType: "Set", values: [...value] }
    if (ArrayBuffer.isView(value)) {
      const values = value instanceof DataView
        ? [...new Uint8Array(value.buffer, value.byteOffset, value.byteLength)]
        : Array.from(value as unknown as ArrayLike<number>)
      return { __captureType: value.constructor.name, values }
    }
    if (typeof value === "number" && !Number.isFinite(value)) return { __captureType: "Number", value: String(value) }
    if (typeof value === "undefined") return { __captureType: "Undefined" }
    if (typeof value === "bigint") return { __captureType: "BigInt", value: String(value) }
    if (typeof value === "function") throw new Error(`Unserializable HDR constructor callback: ${key}`)
    return value
  }, 2)
}

/** Optional post-failure I/O must never change the routing result. */
export const captureFailedHdrInput = async (
  input: { directory?: string; header: CaptureHeader; source?: HdrSource; error?: string },
  write: (path: string, data: string) => unknown | Promise<unknown> = (path, data) => Bun.write(path, data),
  report: (message: string) => void = (message) => console.error(message),
): Promise<void> => {
  if (!input.directory) return
  const safeReport = (message: string) => { try { report(message) } catch {} }
  try {
    const data = serializeFailedHdrInput(input.header, input.source, input.error)
    if (data === undefined) return
    const safe = (name: string) => name.replace(/[^a-zA-Z0-9._-]/g, "_")
    const path = `${input.directory}/${safe(input.header.solverName)}-${safe(input.header.scenarioName)}.hdr.json`
    await write(path, data)
    safeReport(`[sample24-hdr-capture] wrote ${path}`)
  } catch (error) {
    safeReport(`[sample24-hdr-capture] capture unavailable: ${error instanceof Error ? error.message : String(error)}`)
  }
}
