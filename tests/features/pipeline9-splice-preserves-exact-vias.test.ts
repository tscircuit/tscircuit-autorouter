import { expect, test } from "bun:test"
import { getRepairViaGeometry } from "@tscircuit/repair04"
import type { PreloadedHighDensityRoute } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/convertPreloadedTraceToHdRoutes"
import { spliceFixedRouteSectionWithMutationMask } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/pipeline9RegionalFallback"

function verifyExactViaAfterSplicing(): void {
  // Native OrangeCrab RAM_A6 coordinates, board-world mm (+X right, +Y up).
  // The tiny planar segment ends at an exact, valid layer transition.
  const source: PreloadedHighDensityRoute = {
    connectionName: "RAM_A6",
    rootConnectionName: "RAM_A6",
    preloadedTraceIndex: 0,
    preloadedRouteIndex: 0,
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
  const original = structuredClone(source)
  const spliced = spliceFixedRouteSectionWithMutationMask({
    section: {
      sourceRoutes: [source],
      start: { segmentIndex: 4, point: source.route[4]! },
      end: { segmentIndex: 4, point: source.route[5]! },
    },
    replacement: {
      ...source,
      route: [source.route[4]!, { x: 14.5, y: 6, z: 1 }, source.route[5]!],
      vias: [],
    },
    sourceMutationMasks: new Map(),
    replacementIsMutated: true,
  })
  expect(source).toEqual(original)
  expect(spliced.route.route.slice(0, 5)).toEqual(source.route.slice(0, 5))
  expect(spliced.mutatedSegments).toHaveLength(spliced.route.route.length - 1)
  expect(spliced.mutatedSegments.slice(0, 4)).toEqual([
    false,
    false,
    false,
    false,
  ])
  expect(getRepairViaGeometry(spliced.route, 6)).toHaveLength(1)
}

test.failing(
  "regional splicing retains exact via anchors beside roundoff-length wires",
  verifyExactViaAfterSplicing,
)
