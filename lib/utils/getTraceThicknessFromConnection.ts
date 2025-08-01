import type { SimpleRouteConnection } from "../types"

/**
 * Standard trace thickness in mm (industry standard for data lines)
 */
export const STANDARD_TRACE_THICKNESS = 0.15

/**
 * Standard via diameter in mm
 */
export const STANDARD_VIA_DIAMETER = 0.6

/**
 * Get the effective trace thickness for a connection
 *
 * Priority order:
 * 1. Explicit traceThickness if provided
 * 2. traceThicknessMultiplier * STANDARD_TRACE_THICKNESS if provided
 * 3. Default STANDARD_TRACE_THICKNESS
 *
 * @param connection The SimpleRouteConnection to get thickness for
 * @returns The trace thickness in mm
 */
export function getTraceThicknessFromConnection(
  connection: SimpleRouteConnection,
): number {
  // Explicit thickness takes priority
  if (connection.traceThickness !== undefined) {
    return connection.traceThickness
  }

  // Use multiplier if provided
  if (connection.traceThicknessMultiplier !== undefined) {
    return connection.traceThicknessMultiplier * STANDARD_TRACE_THICKNESS
  }

  // Default to standard thickness
  return STANDARD_TRACE_THICKNESS
}

/**
 * Get the effective via diameter for a connection
 *
 * @param connection The SimpleRouteConnection to get via diameter for
 * @returns The via diameter in mm
 */
export function getViaDiameterFromConnection(
  connection: SimpleRouteConnection,
): number {
  return connection.viaDiameter ?? STANDARD_VIA_DIAMETER
}

/**
 * Validate that trace thickness parameters are reasonable
 *
 * @param connection The SimpleRouteConnection to validate
 * @returns Array of validation error messages (empty if valid)
 */
export function validateTraceThicknessParameters(
  connection: SimpleRouteConnection,
): string[] {
  const errors: string[] = []

  // Check for conflicting parameters
  if (
    connection.traceThickness !== undefined &&
    connection.traceThicknessMultiplier !== undefined
  ) {
    errors.push(
      `Connection "${connection.name}" has both traceThickness and traceThicknessMultiplier specified. Use only one.`,
    )
  }

  // Validate explicit thickness
  if (connection.traceThickness !== undefined) {
    if (connection.traceThickness <= 0) {
      errors.push(
        `Connection "${connection.name}" has invalid traceThickness: ${connection.traceThickness}. Must be positive.`,
      )
    }
    if (connection.traceThickness > 5) {
      errors.push(
        `Connection "${connection.name}" has unusually large traceThickness: ${connection.traceThickness}mm. Consider using a smaller value.`,
      )
    }
  }

  // Validate multiplier
  if (connection.traceThicknessMultiplier !== undefined) {
    if (connection.traceThicknessMultiplier <= 0) {
      errors.push(
        `Connection "${connection.name}" has invalid traceThicknessMultiplier: ${connection.traceThicknessMultiplier}. Must be positive.`,
      )
    }
    if (!Number.isInteger(connection.traceThicknessMultiplier)) {
      errors.push(
        `Connection "${connection.name}" has non-integer traceThicknessMultiplier: ${connection.traceThicknessMultiplier}. Consider using integer multiples (1, 2, 4, 8).`,
      )
    }
    if (connection.traceThicknessMultiplier > 20) {
      errors.push(
        `Connection "${connection.name}" has unusually large traceThicknessMultiplier: ${connection.traceThicknessMultiplier}. Consider using a smaller value.`,
      )
    }
  }

  // Validate via diameter
  if (connection.viaDiameter !== undefined) {
    if (connection.viaDiameter <= 0) {
      errors.push(
        `Connection "${connection.name}" has invalid viaDiameter: ${connection.viaDiameter}. Must be positive.`,
      )
    }
    if (connection.viaDiameter > 10) {
      errors.push(
        `Connection "${connection.name}" has unusually large viaDiameter: ${connection.viaDiameter}mm. Consider using a smaller value.`,
      )
    }
  }

  return errors
}

/**
 * Get common trace thickness multipliers and their corresponding thicknesses
 */
export const COMMON_TRACE_MULTIPLIERS = {
  1: 0.15, // Standard data line
  2: 0.3, // Medium power
  4: 0.6, // High power
  8: 1.2, // Very high power
} as const

/**
 * Check if a trace thickness corresponds to a standard multiplier
 *
 * @param thickness The trace thickness in mm
 * @returns The multiplier if it matches a standard value, undefined otherwise
 */
export function getMultiplierForThickness(
  thickness: number,
): number | undefined {
  const tolerance = 0.001 // 1 micron tolerance

  for (const [multiplier, standardThickness] of Object.entries(
    COMMON_TRACE_MULTIPLIERS,
  )) {
    if (Math.abs(thickness - standardThickness) < tolerance) {
      return Number(multiplier)
    }
  }

  return undefined
}
