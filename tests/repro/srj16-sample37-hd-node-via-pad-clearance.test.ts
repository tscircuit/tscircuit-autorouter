import { expect, test } from "bun:test"
import type { HighDensityRoute } from "lib/types/high-density-types"
import {
  createSrj16Sample37NodeSolver,
  getViaToPadCopperGap,
  SRJ16_SAMPLE37_PAD_ID,
  SRJ16_SAMPLE37_REQUIRED_VIA_TO_PAD_CLEARANCE,
} from "../fixtures/loadSrj16Sample37HdNodeInput"

type Violation = {
  connectionName: string
  x: number
  y: number
  gap: number
}

function findForeignPadViolations(routes: HighDensityRoute[]): Violation[] {
  const violations: Violation[] = []
  for (const route of routes) {
    for (const via of route.vias) {
      const gap = getViaToPadCopperGap({
        x: via.x,
        y: via.y,
        viaDiameter: route.viaDiameter,
      })
      if (gap >= SRJ16_SAMPLE37_REQUIRED_VIA_TO_PAD_CLEARANCE) continue
      violations.push({
        connectionName: route.connectionName,
        x: via.x,
        y: via.y,
        gap,
      })
    }
  }
  return violations
}

test.failing(
  "srj16 sample 37 high density node keeps vias clear of foreign pads",
  (): void => {
    const solver = createSrj16Sample37NodeSolver()
    solver.solve()
    expect(solver.failed).toBe(false)
    const violations = findForeignPadViolations(solver.solvedRoutes)
    expect({ padId: SRJ16_SAMPLE37_PAD_ID, violations }).toEqual({
      padId: SRJ16_SAMPLE37_PAD_ID,
      violations: [],
    })
  },
)
