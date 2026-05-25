import type { PortPoint } from "lib/types/high-density-types"
import { getPortPointIdentity } from "./getPortPointIdentity"

/**
 * Creates a stable key for a specific routed pair of port points.
 *
 * @param connectionName - Logical connection that owns the paired endpoints.
 * @param start - First endpoint in the pair.
 * @param end - Second endpoint in the pair.
 * @returns A deterministic key that includes the connection name and both
 * endpoint identities.
 * @note The key preserves endpoint order. Reversing `start` and `end` changes
 * the returned key.
 */
export const getPortPointPairKey = (
  connectionName: string,
  start: Pick<PortPoint, "portPointId" | "x" | "y" | "z" | "connectionName">,
  end: Pick<PortPoint, "portPointId" | "x" | "y" | "z" | "connectionName">,
): string =>
  `${connectionName}:${getPortPointIdentity(start)}->${getPortPointIdentity(end)}`
