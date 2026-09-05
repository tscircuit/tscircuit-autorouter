import { expect, test } from "bun:test"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import { convertPreloadedTraceToHdRoutes } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/convertPreloadedTraceToHdRoutes"
import { MultipleHighDensityRouteStitchSolver3 } from "lib/solvers/RouteStitchingSolver/MultipleHighDensityRouteStitchSolver3"
import { TraceSimplificationSolver } from "lib/solvers/TraceSimplificationSolver/TraceSimplificationSolver"
import type { SimpleRouteJson } from "lib/types"
import type { HighDensityRoute } from "lib/types/high-density-types"
import { minimumDistanceBetweenSegments } from "lib/utils/minimumDistanceBetweenSegments"

test("Pipeline9 simplification recognizes connected preload aliases without ignoring foreign copper", (): void => {
  for (const connected of [true, false]) {
    const srj: SimpleRouteJson = {
      layerCount: 2,
      minTraceWidth: 0.15,
      bounds: { minX: -3, minY: -2, maxX: 3, maxY: 3 },
      obstacles: [],
      connections: [
        {
          name: "new_route",
          pointsToConnect: [
            { x: -2, y: 0, layer: "top" },
            { x: 2, y: 0, layer: "top" },
          ],
        },
      ],
      traces: [
        {
          type: "pcb_trace",
          pcb_trace_id: "existing_trace",
          connection_name: "fanout_alias",
          connectsTo: [connected ? "new_route" : "foreign_net"],
          route: [
            { route_type: "wire", x: 0, y: -1, width: 0.15, layer: "top" },
            { route_type: "wire", x: 0, y: 1, width: 0.15, layer: "top" },
          ],
        },
      ],
    }
    const preloadedSnapshot = structuredClone(srj.traces)
    const pipeline = new AutoroutingPipelineSolver9_PreloadedTraceGraph(srj)
    const route: HighDensityRoute = {
      connectionName: "new_route",
      rootConnectionName: "new_route",
      traceThickness: 0.15,
      viaDiameter: 0.3,
      route: [
        { x: -2, y: 0, z: 0 },
        { x: -1, y: 1, z: 0 },
        { x: -1, y: 2, z: 0 },
        { x: 1, y: 2, z: 0 },
        { x: 1, y: 1, z: 0 },
        { x: 2, y: 0, z: 0 },
      ],
      vias: [],
    }
    pipeline.highDensityStitchSolver = new MultipleHighDensityRouteStitchSolver3({
      connections: srj.connections,
      hdRoutes: [route],
      layerCount: srj.layerCount,
    })
    pipeline.highDensityStitchSolver.solve()
    expect(pipeline.highDensityStitchSolver.failed).toBeFalse()

    const canonicalNet = pipeline.connMap.getNetConnectedToId("fanout_alias")!
    expect(canonicalNet).not.toBe("fanout_alias")
    expect(pipeline.connMap.areIdsConnected("new_route", "fanout_alias")).toBe(
      connected,
    )
    const [convertedRoute] = convertPreloadedTraceToHdRoutes(
      srj.traces![0]!,
      0,
      srj.layerCount,
      pipeline.viaDiameter,
      pipeline.connMap,
    )
    expect(convertedRoute!.rootConnectionName).toBe(canonicalNet)

    const step = pipeline.pipelineDef.find(
      (candidate) => candidate.solverName === "traceSimplificationSolver",
    )!
    const [params] = step.getConstructorParams(pipeline) as ConstructorParameters<
      typeof TraceSimplificationSolver
    >
    const [fixedRoute] = params.otherHdRoutes!
    expect(fixedRoute!.rootConnectionName).toBe("fanout_alias")
    expect(params.netByConnectionName!.get(fixedRoute!.connectionName)).toBe(
      canonicalNet,
    )

    const simplifier = new TraceSimplificationSolver(params)
    simplifier.solve()
    expect(simplifier.failed).toBeFalse()
    const [simplifiedRoute] = simplifier.simplifiedHdRoutes
    expect(simplifiedRoute!.route[0]).toMatchObject({ x: -2, y: 0, z: 0 })
    expect(simplifiedRoute!.route.at(-1)).toMatchObject({ x: 2, y: 0, z: 0 })
    if (connected) {
      expect(simplifiedRoute!.route.every((point) => point.y === 0)).toBeTrue()
    } else {
      expect(simplifiedRoute!.route.length).toBeGreaterThan(2)
      for (let index = 1; index < simplifiedRoute!.route.length; index++) {
        expect(
          minimumDistanceBetweenSegments(
            simplifiedRoute!.route[index - 1]!,
            simplifiedRoute!.route[index]!,
            fixedRoute!.route[0]!,
            fixedRoute!.route[1]!,
          ),
        ).toBeGreaterThanOrEqual(0.25 - 1e-6)
      }
    }
    expect(srj.traces).toEqual(preloadedSnapshot)
  }
})
