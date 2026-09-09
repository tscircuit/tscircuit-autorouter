import { FixedCopperClearanceIndex } from "lib/data-structures/FixedCopperClearanceIndex"
import type { TinyHyperGraphProblem } from "tiny-hypergraph/lib/index"

export type TinyGraphFixedCopperClearanceContext = {
  readonly loadedProblem: TinyHyperGraphProblem
  readonly clearanceIndex: FixedCopperClearanceIndex
  /** Common physical routing width, not a maximum of unequal route widths. */
  readonly traceWidth: number
  readonly canonicalNetIdByNetId: ReadonlyMap<number, string>
  readonly netIdByCanonicalNetId: ReadonlyMap<string, number>
  readonly connectionIdByRouteId: readonly string[]
}

/** Resolve native numeric nets only after the serialized graph has been loaded. */
export function createTinyGraphFixedCopperClearanceContext(params: {
  readonly problem: TinyHyperGraphProblem
  readonly clearanceIndex: FixedCopperClearanceIndex
  readonly traceWidth: number
}): TinyGraphFixedCopperClearanceContext {
  const { problem, clearanceIndex, traceWidth } = params
  const routeMetadata = problem.routeMetadata
  if (
    !(clearanceIndex instanceof FixedCopperClearanceIndex) ||
    !Number.isFinite(traceWidth) ||
    traceWidth / 2 <= 0 ||
    !Number.isSafeInteger(problem.routeCount) ||
    problem.routeCount < 0 ||
    problem.routeNet.length !== problem.routeCount ||
    routeMetadata === undefined ||
    routeMetadata.length !== problem.routeCount
  ) {
    throw new Error(
      "TinyGraph fixed copper requires a loaded common-width problem",
    )
  }
  const canonicalNetIdByNetId = new Map<number, string>()
  const netIdByCanonicalNetId = new Map<string, number>()
  const connectionIdByRouteId: string[] = []
  for (let routeId = 0; routeId < problem.routeCount; routeId++) {
    const metadata: unknown = routeMetadata[routeId]
    if (
      typeof metadata !== "object" ||
      metadata === null ||
      !("connectionId" in metadata) ||
      typeof metadata.connectionId !== "string" ||
      metadata.connectionId.length === 0 ||
      !("mutuallyConnectedNetworkId" in metadata) ||
      typeof metadata.mutuallyConnectedNetworkId !== "string" ||
      metadata.mutuallyConnectedNetworkId.length === 0
    ) {
      throw new Error(
        `TinyGraph fixed copper has invalid metadata for route ${routeId}`,
      )
    }
    const canonicalNetId = metadata.mutuallyConnectedNetworkId
    const netId = problem.routeNet[routeId]!
    const previousCanonicalNetId = canonicalNetIdByNetId.get(netId)
    const previousNetId = netIdByCanonicalNetId.get(canonicalNetId)
    if (
      netId < 0 ||
      (previousCanonicalNetId !== undefined &&
        previousCanonicalNetId !== canonicalNetId) ||
      (previousNetId !== undefined && previousNetId !== netId)
    ) {
      throw new Error(
        `TinyGraph fixed copper has inconsistent loaded net ownership for connection "${metadata.connectionId}"`,
      )
    }
    canonicalNetIdByNetId.set(netId, canonicalNetId)
    netIdByCanonicalNetId.set(canonicalNetId, netId)
    connectionIdByRouteId.push(metadata.connectionId)
  }
  return {
    loadedProblem: problem,
    clearanceIndex,
    traceWidth,
    canonicalNetIdByNetId,
    netIdByCanonicalNetId,
    connectionIdByRouteId,
  }
}
