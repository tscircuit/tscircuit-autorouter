import { expect, test } from "bun:test"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import type { SimpleRouteJson } from "lib/types"
import type { HighDensityRoute } from "lib/types/high-density-types"

test("Pipeline9 exports exactly connected wires around an explicit endpoint via", (): void => {
  const srj: SimpleRouteJson = {
    layerCount: 2,
    minTraceWidth: 0.1,
    bounds: { minX: -2, maxX: 2, minY: -2, maxY: 2 },
    obstacles: [],
    connections: [
      {
        name: "signal",
        pointsToConnect: [
          { x: -1, y: 0, layer: "top" },
          { x: 1, y: 0, layer: "bottom" },
        ],
      },
    ],
  }
  const hdRoute: HighDensityRoute = {
    connectionName: "signal",
    traceThickness: 0.1,
    viaDiameter: 0.3,
    route: [
      { x: -1, y: 0, z: 0 },
      { x: 0, y: 0, z: 0 },
      { x: 0.0005, y: 0, z: 1 },
      { x: 1, y: 0, z: 1 },
    ],
    vias: [{ x: 0, y: 0 }],
  }
  const pipeline = new AutoroutingPipelineSolver9_PreloadedTraceGraph(srj)
  pipeline.highDensityRouteSolver = {
    routes: [hdRoute],
  } as NonNullable<typeof pipeline.highDensityRouteSolver>
  pipeline.highDensityStitchSolver = {
    mergedHdRoutes: [hdRoute],
  } as NonNullable<typeof pipeline.highDensityStitchSolver>
  pipeline.netToPointPairsSolver = {
    newConnections: srj.connections,
  } as NonNullable<typeof pipeline.netToPointPairsSolver>
  const original = structuredClone(hdRoute)
  const [trace] = pipeline.getNewTracesBeforePowerExpansion()
  const viaIndex = trace!.route.findIndex((point) => point.route_type === "via")
  expect(viaIndex).toBeGreaterThan(0)
  const via = trace!.route[viaIndex]!
  expect(via).toMatchObject({ route_type: "via", x: 0, y: 0 })
  for (const point of [
    trace!.route[viaIndex - 1],
    trace!.route[viaIndex + 1],
  ]) {
    expect(point).toMatchObject({ route_type: "wire", x: 0, y: 0 })
  }
  expect(hdRoute).toEqual(original)
})
