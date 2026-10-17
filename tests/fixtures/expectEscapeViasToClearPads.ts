import { expect } from "bun:test"
import { pointToBoxDistance } from "@tscircuit/math-utils"
import type { EscapeViaLocationSolver } from "lib/solvers/EscapeViaLocationSolver/EscapeViaLocationSolver"

const GEOMETRY_TOLERANCE = 1e-4

export const expectEscapeViasToClearPads = (
  solver: EscapeViaLocationSolver | undefined,
): void => {
  if (!solver) throw new Error("Expected the escape-via placement stage")
  expect(solver.solved).toBe(true)
  expect(solver.ogSrj.allowBlindAndBuriedVias).not.toBe(true)
  const escapeVias = [...solver.getEscapeViaMetadataByPointId().values()]
  expect(escapeVias.length).toBeGreaterThan(0)
  for (const via of escapeVias) {
    for (const pad of solver.ogSrj.obstacles) {
      if (pad.isCopperPour) continue
      const clearance = pointToBoxDistance(via, pad) - solver.viaRadius
      expect(clearance).toBeGreaterThanOrEqual(
        solver.requiredViaToPadClearance - GEOMETRY_TOLERANCE,
      )
    }
  }
}
