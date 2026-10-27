import { expect, test } from "bun:test"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { SameNetViaMergerSolver } from "@tscircuit/trace-simplification-solver"
import { Pipeline9TraceSimplificationSolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9TraceSimplificationSolver"
import { materializePipeline9HdRouteVias } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/materializePipeline9HdRouteVias"
import { getPipeline9RouteCopperGeometry } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/pipeline9FixedRouteCopper"
import type { HighDensityRoute } from "lib/types/high-density-types"

// Actual SRJ18/13 loop1 output: the physical via belongs to the diagonal's start.
const diagonal: HighDensityRoute = {
  connectionName: "source_trace_6__source_net_6_mst8",
  rootConnectionName: "source_trace_6",
  traceThickness: 0.1,
  viaDiameter: 0.3,
  route: [
    { x: -35.705, y: 1.82, z: 3 },
    { x: -35.646263502285414, y: 1.82, z: 3 },
    { x: -35.2098222239329, y: 2.2564412783525123, z: 3 },
    { x: -34.314, y: 2.354, z: 3 },
    { x: -33.98, y: 2.07, z: 0 },
  ],
  vias: [{ x: -34.314, y: 2.354 }],
}

test("owned simplification retains exact copper and explicit via transitions between phases", (): void => {
  const keep: HighDensityRoute = {
    connectionName: "keep",
    traceThickness: 0.1,
    viaDiameter: 0.3,
    route: [
      { x: -34.214, y: 2.354, z: 0 },
      { x: -34.214, y: 2.354, z: 3 },
    ],
    vias: [{ x: -34.214, y: 2.354 }],
  }
  const connMap = new ConnectivityMap({
    net: [keep.connectionName, diagonal.connectionName],
  })
  const options = { obstacles: [], connMap, colorMap: {}, layerCount: 4 }
  const original = JSON.stringify([keep, diagonal])
  expect(() =>
    new SameNetViaMergerSolver({
      ...options,
      inputHdRoutes: [keep, diagonal],
    }).solve(),
  ).toThrow("SameNetViaMergerSolver could not find")
  const solver = new Pipeline9TraceSimplificationSolver({
    ...options,
    hdRoutes: [keep, diagonal],
    defaultViaDiameter: 0.3,
  })
  const normalized = solver.markThroughObstacleSegments([diagonal])[0]
  expect(normalized.vias).toEqual(diagonal.vias)
  const lostMetadata = { ...diagonal, vias: [] }
  expect(() => materializePipeline9HdRouteVias([lostMetadata])).toThrow(
    "without an explicit via",
  )
  const restored = solver.markThroughObstacleSegments([lostMetadata])[0]
  expect(restored).toEqual(normalized)
  const changedSpan = structuredClone(lostMetadata)
  changedSpan.route.at(-1)!.z = 1
  expect(() => solver.markThroughObstacleSegments([changedSpan])).toThrow(
    "without an explicit via",
  )
  const ambiguous = {
    ...diagonal,
    vias: [...diagonal.vias, { x: -33.98, y: 2.07 }],
  }
  expect(() => materializePipeline9HdRouteVias([ambiguous])).toThrow(
    "ambiguous layer transition",
  )
  const merger = new SameNetViaMergerSolver({
    ...options,
    inputHdRoutes: [keep, normalized],
  })
  merger.solve()
  expect(merger.solved).toBe(true)
  for (const reverse of [false, true]) {
    for (const blind of [false, true]) {
      const input = structuredClone(diagonal)
      input.route.at(-2)!.traceThickness = 0.2
      input.route.at(-1)!.traceThickness = 0.15
      if (blind) input.route.at(-1)!.z = 1
      if (reverse) input.route.reverse()
      const context = { layerCount: 4, allowBlindAndBuriedVias: blind }
      const before = getPipeline9RouteCopperGeometry(input, context)
      const output = materializePipeline9HdRouteVias([input])[0]
      const after = getPipeline9RouteCopperGeometry(output, context)
      const wiresBefore = before.wireSegments.map(
        ({ start, end, z, width }): number[] => [
          start.x,
          start.y,
          end.x,
          end.y,
          z,
          width,
        ],
      )
      const wiresAfter = after.wireSegments.map(
        ({ start, end, z, width }): number[] => [
          start.x,
          start.y,
          end.x,
          end.y,
          z,
          width,
        ],
      )
      expect(wiresAfter).toEqual(wiresBefore)
      expect(after.viaSpans).toEqual(before.viaSpans)
      expect(output.vias).toEqual(input.vias)
    }
  }
  const barrel: HighDensityRoute = {
    ...diagonal,
    route: [
      { x: 0, y: 0, z: 0, toNextSegmentType: "through_obstacle" },
      { x: 1, y: 1, z: 3 },
    ],
    vias: [],
  }
  expect(materializePipeline9HdRouteVias([barrel])).toEqual([barrel])
  const padSolver = new Pipeline9TraceSimplificationSolver({
    ...options,
    hdRoutes: [barrel],
    defaultViaDiameter: 0.3,
    obstacles: [
      {
        type: "rect",
        center: { x: 0.5, y: 0.5 },
        width: 4,
        height: 4,
        layers: ["top", "bottom"],
        connectedTo: [diagonal.connectionName],
      },
    ],
  })
  expect(padSolver.hdRoutes[0].route[0].toNextSegmentType).toBe(
    "through_obstacle",
  )
  expect(padSolver.hdRoutes[0].vias).toHaveLength(0)
  expect(JSON.stringify([keep, diagonal])).toBe(original)
})
