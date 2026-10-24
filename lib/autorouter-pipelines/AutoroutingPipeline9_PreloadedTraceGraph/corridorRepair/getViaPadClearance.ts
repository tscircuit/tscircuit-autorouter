import type { SimpleRouteJson } from "./repairTypes"

/** Electrical clearance does not add a manufacturing gap to connected pads. */
export function getViaPadClearance(
  srj: Pick<
    SimpleRouteJson,
    "defaultObstacleMargin" | "minViaEdgeToPadEdgeClearance"
  >,
  viaClearance: number,
  sameNet: boolean,
): number {
  // Preserve explicitly declared obstacle/pad margins even on connected pads.
  // Without one, their annuli must stay outside copper, but need no extra gap.
  return Math.max(
    sameNet ? 0 : viaClearance,
    srj.defaultObstacleMargin ?? 0,
    srj.minViaEdgeToPadEdgeClearance ?? 0,
  )
}
