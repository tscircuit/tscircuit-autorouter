import type { RoutingBenchmarkMetrics } from "./benchmark-types"

type NetworkedMetrics = NonNullable<
  RoutingBenchmarkMetrics["networkedHighDensity"]
>

/** Count existing geometry rejections without allowing transport failures. */
export function countDeterministicNetworkedValidationRejections(
  metrics: NetworkedMetrics,
): number {
  const counts = metrics.remoteFallbackReasonCounts
  if (counts === undefined) return 0
  let totalCount = 0
  let validationRejections = 0
  for (const [reason, count] of Object.entries(counts)) {
    if (!Number.isSafeInteger(count) || count < 0) {
      throw new Error(
        `Networked benchmark has an invalid ${reason} fallback count`,
      )
    }
    totalCount += count
    if (reason === "invalid_response") validationRejections = count
  }
  if (totalCount !== metrics.remoteTransportFallbacks) {
    throw new Error(
      "Networked benchmark fallback reasons do not match the total fallback count",
    )
  }
  return validationRejections
}
