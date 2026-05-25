import type { NodeWithPortPoints } from "lib/types/high-density-types"
import { getNodePortPointPairs } from "./getNodePortPointPairs"

/**
 * Counts resolved port-point pairs for a node.
 *
 * @param nodeWithPortPoints - Node to inspect.
 * @returns The number of concrete pairs produced by
 * `getNodePortPointPairs`.
 */
export const getNodePortPointPairCount = (
  nodeWithPortPoints: NodeWithPortPoints,
): number => getNodePortPointPairs(nodeWithPortPoints).length
