import { test, expect } from "bun:test"
import { doInteractionRoutesConflict } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9InteractionGroupedHighDensitySolver"
import type { HighDensityRoute } from "lib/types/high-density-types"

test("actual drill spacing is independent of annulus spacing, net and electrical span", () => {
  const via = (x: number, from: number, to: number): HighDensityRoute => ({ connectionName: `via-${x}`, traceThickness: 0.1, viaDiameter: 0.3, route: [{ x, y: 0, z: from }, { x, y: 0, z: to }], vias: [{ x, y: 0 }] })
  const stats = { experimentalInteractionCopperPrimitiveTests: 0, experimentalInteractionDrillPrimitiveTests: 0, experimentalInteractionDrillConflicts: 0 }
  const options = { left: via(0, 0, 1), right: via(0.5, 2, 3), clearance: 0.1, layerCount: 4, allowBlindAndBuriedVias: true, viaHoleDiameter: 0.2, minViaHoleEdgeToViaHoleEdgeClearance: 0.6, stats }
  // Centers exceed the old annulus+margin threshold 0.4, but the physical
  // holes require 0.8. Disjoint electrical spans do not remove drill spacing.
  expect(doInteractionRoutesConflict({ ...options, sameNet: true })).toBe(true)
  expect(doInteractionRoutesConflict({ ...options, sameNet: false })).toBe(true)
  expect(doInteractionRoutesConflict({ ...options, right: via(0.8, 2, 3), sameNet: true })).toBe(false)
  expect(doInteractionRoutesConflict({ ...options, right: via(0, 2, 3), sameNet: true })).toBe(false)
  expect(doInteractionRoutesConflict({ ...options, right: via(0, 2, 3), sameNet: false })).toBe(true)
  const smallHoles = { ...options, viaHoleDiameter: 0.05, minViaHoleEdgeToViaHoleEdgeClearance: 0.01, right: via(0.2, 0, 1) }
  expect(doInteractionRoutesConflict({ ...smallHoles, sameNet: true })).toBe(false)
  expect(doInteractionRoutesConflict({ ...smallHoles, sameNet: false })).toBe(true)
  expect(doInteractionRoutesConflict({ ...smallHoles, right: via(0.2, 2, 3), sameNet: false })).toBe(false)
  expect(stats.experimentalInteractionDrillPrimitiveTests).toBeGreaterThan(0)
  expect(stats.experimentalInteractionDrillConflicts).toBeGreaterThan(0)
})
