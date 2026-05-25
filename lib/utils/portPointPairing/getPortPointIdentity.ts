import type { PortPoint } from "lib/types/high-density-types"

/**
 * Builds a stable identity string for a port point.
 *
 * @param portPoint - Port point data used to derive the identity. `portPointId`
 * is preferred when present.
 * @returns A stable identifier for the port point.
 * @note Coordinates are rounded to 6 decimal places to keep derived keys stable
 * across cloning and serialization.
 * @caution Anonymous port points with the same connection name and geometry will
 * produce the same identity string.
 */
export const getPortPointIdentity = (
  portPoint: Pick<
    PortPoint,
    "portPointId" | "x" | "y" | "z" | "connectionName"
  >,
): string =>
  portPoint.portPointId ??
  [
    portPoint.connectionName,
    portPoint.x.toFixed(6),
    portPoint.y.toFixed(6),
    (portPoint.z ?? 0).toString(),
  ].join("@")
