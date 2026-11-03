import { expect, test } from "bun:test"
import { applySafeTraceLayerMoveForError } from "high-density-repair03/lib/solvers/GlobalDrcForceImproveSolver/solverHelpers"
import type { SimpleRouteJson } from "high-density-repair03/lib/types"
import type { HighDensityRoute } from "high-density-repair03/lib/types/high-density-types"

function verifyExactLayerTransitions(): void {
  const input: SimpleRouteJson = {
    layerCount: 6,
    minTraceWidth: 0.0889,
    bounds: { minX: 0, minY: 0, maxX: 20, maxY: 20 },
    obstacles: [],
    connections: [],
  }
  // Board-world XY in mm (+X right, +Y up); z indexes layers from the top.
  // These wire vertices precede the exact native OrangeCrab RAM_A6 via site.
  const original: HighDensityRoute = {
    connectionName: "RAM_A6",
    traceThickness: 0.0889,
    viaDiameter: 0.28,
    route: [
      { x: 11, y: 5.75, z: 0 },
      { x: 12.88099999999999, y: 5.749999999999989, z: 0 },
      { x: 12.881, y: 5.75, z: 0 },
      { x: 12.881, y: 5.75, z: 1 },
      { x: 14, y: 5.75, z: 1 },
      { x: 15, y: 5.75, z: 1 },
    ],
    vias: [{ x: 12.881, y: 5.75 }],
  }
  for (const reverse of [false, true]) {
    for (const x of [11.5, 14.5]) {
      for (const expansion of [0, 1, "full"] as const) {
        const route = structuredClone(original)
        if (reverse) route.route.reverse()
        const endpoints = [route.route[0], route.route.at(-1)]
        expect(
          applySafeTraceLayerMoveForError(
            input,
            [route],
            { type: "pcb_trace_error", center: { x, y: 5.75 } },
            0,
            2,
            expansion,
          ),
        ).toBe(true)
        expect([route.route[0], route.route.at(-1)]).toEqual(endpoints)
        for (let index = 1; index < route.route.length; index++) {
          const from = route.route[index - 1]!
          const to = route.route[index]!
          if (from.z === to.z) continue
          expect({ x: from.x, y: from.y }).toEqual({ x: to.x, y: to.y })
        }
      }
    }
  }
}

test(
  "safe layer moves preserve exact via coordinates beside roundoff-length wire segments",
  verifyExactLayerTransitions,
)
