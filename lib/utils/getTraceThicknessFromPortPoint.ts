import type { PortPoint } from "../types/high-density-types"
import {
  STANDARD_TRACE_THICKNESS,
  STANDARD_VIA_DIAMETER,
} from "./getTraceThicknessFromConnection"

/**
 * Get the effective trace thickness for a port point
 *
 * @param portPoint The PortPoint to get thickness for
 * @returns The trace thickness in mm
 */
export function getTraceThicknessFromPortPoint(portPoint: PortPoint): number {
  return portPoint.traceThickness ?? STANDARD_TRACE_THICKNESS
}

/**
 * Get the effective via diameter for a port point
 *
 * @param portPoint The PortPoint to get via diameter for
 * @returns The via diameter in mm
 */
export function getViaDiameterFromPortPoint(portPoint: PortPoint): number {
  return portPoint.viaDiameter ?? STANDARD_VIA_DIAMETER
}

/**
 * Get trace thickness for a connection by looking at its port points
 *
 * @param portPoints Array of port points for the connection
 * @param connectionName The connection name to look for
 * @returns The trace thickness in mm
 */
export function getTraceThicknessFromPortPoints(
  portPoints: PortPoint[],
  connectionName: string,
): number {
  const connectionPortPoint = portPoints.find(
    (pp) => pp.connectionName === connectionName,
  )

  if (connectionPortPoint) {
    return getTraceThicknessFromPortPoint(connectionPortPoint)
  }

  return STANDARD_TRACE_THICKNESS
}

/**
 * Get via diameter for a connection by looking at its port points
 *
 * @param portPoints Array of port points for the connection
 * @param connectionName The connection name to look for
 * @returns The via diameter in mm
 */
export function getViaDiameterFromPortPoints(
  portPoints: PortPoint[],
  connectionName: string,
): number {
  const connectionPortPoint = portPoints.find(
    (pp) => pp.connectionName === connectionName,
  )

  if (connectionPortPoint) {
    return getViaDiameterFromPortPoint(connectionPortPoint)
  }

  return STANDARD_VIA_DIAMETER
}
