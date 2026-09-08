import { expect, test } from "bun:test"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import type { PreloadedHighDensityRoute } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/convertPreloadedTraceToHdRoutes"
import { Pipeline9HighDensitySolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9HighDensitySolver"
import { createRegionalFallbackProblem } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/pipeline9RegionalFallback"
import type { NodeWithPortPoints } from "lib/types/high-density-types"

const node: NodeWithPortPoints = {
  capacityMeshNodeId: "closed-hairpin",
  center: { x: 1, y: 0 },
  width: 2,
  height: 2,
  availableZ: [0],
  portPoints: [],
  portPointsInPairs: [],
}
const first: PreloadedHighDensityRoute = {
  connectionName: "fixed_hairpin_0",
  rootConnectionName: "net",
  preloadedTraceIndex: 125,
  preloadedRouteIndex: 36,
  preloadedRoutePositionStart: 37,
  preloadedRoutePositionEnd: 38,
  traceThickness: 0.1,
  viaDiameter: 0.3,
  route: [
    { x: -2, y: 0, z: 0 },
    { x: 1, y: 0, z: 0 },
  ],
  vias: [],
}
const second: PreloadedHighDensityRoute = {
  ...first,
  connectionName: "fixed_hairpin_1",
  preloadedRouteIndex: 37,
  preloadedRoutePositionStart: 38,
  preloadedRoutePositionEnd: 39,
  route: [
    { x: 1, y: 0, z: 0 },
    { x: -1, y: 0, z: 0 },
  ],
}

const prepareAcceptedReplacement = (
  turnX: number,
): Pipeline9HighDensitySolver => {
  const solver = new Pipeline9HighDensitySolver({
    nodePortPoints: [node],
    fixedHdRoutes: [first, second],
    connMap: new ConnectivityMap({
      net: [first.connectionName, second.connectionName],
    }),
    obstacles: [],
    layerCount: 1,
    viaDiameter: 0.3,
    traceWidth: 0.1,
    obstacleMargin: 0.15,
    effort: 1,
  })
  solver.activeNode = node
  solver.activeFallbackFixedRouteSections = createRegionalFallbackProblem(node, [
    first,
    second,
  ]).fixedRouteSectionsByConnectionName
  solver.activeFallbackSolver = {
    stats: {},
    getOutput: (): PreloadedHighDensityRoute[] => [
      {
        ...first,
        route: [
          { x: 0, y: 0, z: 0 },
          { x: turnX, y: 0, z: 0 },
          { x: 0, y: 0, z: 0 },
        ],
      },
    ],
  } as any
  return solver
}

test("Pipeline9 captures a surviving closed hairpin without marking its outside prefix or suffix", () => {
  const solver = prepareAcceptedReplacement(0.5)
  expect(() => (solver as any).finishRegionalFallback()).not.toThrow()
  const replacement = solver.fixedRouteReplacements.get(first.connectionName)!
  expect(replacement.route).toEqual([
    { x: -2, y: 0, z: 0 },
    { x: 0, y: 0, z: 0 },
    { x: 0.5, y: 0, z: 0 },
    { x: 0, y: 0, z: 0 },
    { x: -1, y: 0, z: 0 },
  ])
  expect(solver.preloadedTraceMutationMasks.get(first.connectionName)).toEqual([
    false,
    true,
    true,
    false,
  ])
  expect(
    solver.removedFixedRouteConnectionNames.has(second.connectionName),
  ).toBeTrue()
  expect(
    createRegionalFallbackProblem(node, [replacement])
      .fixedRouteSectionsByConnectionName.size,
  ).toBe(0)
  const sections = createRegionalFallbackProblem(
    node,
    [replacement],
    new Set(),
    { includeClosedSectionsForMutationProvenance: true },
  ).fixedRouteSectionsByConnectionName
  const section = sections.get(first.connectionName)!
  expect(section.start).toEqual({
    segmentIndex: 1,
    point: { x: 0, y: 0, z: 0 },
  })
  expect(section.end).toEqual({
    segmentIndex: 2,
    point: { x: 0, y: 0, z: 0 },
  })
  // Real segments entirely outside the accepted region remain unattributable;
  // mere point contacts at the anchor must not silence the invariant.
  const outside = prepareAcceptedReplacement(-0.5)
  expect(() => (outside as any).finishRegionalFallback()).toThrow(
    "Pipeline9 could not capture accepted mutation provenance for trace 125",
  )
})
