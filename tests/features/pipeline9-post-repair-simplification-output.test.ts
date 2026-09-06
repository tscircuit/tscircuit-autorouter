import { expect, test } from "bun:test"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import type { Pipeline9HighDensitySolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9HighDensitySolver"
import type { Pipeline9JointDrcRepairSolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9JointDrcRepairSolver"
import { Pipeline9PostRepairTraceSimplificationSolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9PostRepairTraceSimplificationSolver"
import type { NetToPointPairsSolver } from "lib/solvers/NetToPointPairsSolver/NetToPointPairsSolver"
import type { LengthMatchingPostProcessingSolver } from "lib/solvers/length-matching-post-processing-solver"
import type { HighDensityRoute } from "lib/types/high-density-types"
import type {
  SimpleRouteJson,
  SimplifiedPcbTrace,
  SimplifiedPcbTraces,
} from "lib/types"

type PipelineStep =
  AutoroutingPipelineSolver9_PreloadedTraceGraph["pipelineDef"][number]
type SimplificationParams = ConstructorParameters<
  typeof Pipeline9PostRepairTraceSimplificationSolver
>
type LengthMatchingParams = ConstructorParameters<
  typeof LengthMatchingPostProcessingSolver
>

test("Pipeline9 uses repaired-route simplification while preserving current preload copper", (): void => {
  for (const viaY of [-2, 0]) {
    const repairedRoute: HighDensityRoute = {
      connectionName: "signal",
      traceThickness: 0.4,
      viaDiameter: 0.3,
      vias: [],
      route: [
        { x: -2, y: 0, z: 1, pcb_port_id: "start" },
        { x: -1, y: 1, z: 1 },
        { x: 1, y: 1, z: 1 },
        { x: 2, y: 0, z: 1, pcb_port_id: "end" },
      ],
    }
    const preload: SimplifiedPcbTrace = {
      type: "pcb_trace",
      pcb_trace_id: "foreign_preload",
      connection_name: "fanout_alias",
      connectsTo: ["foreign_net"],
      __replaces_pcb_trace_id: "foreign_preload",
      route: [
        {
          route_type: "via",
          x: 0,
          y: viaY,
          from_layer: "top",
          to_layer: "bottom",
          via_diameter: 0.5,
        },
      ],
    }
    const srj: SimpleRouteJson = {
      layerCount: 4,
      minTraceWidth: 0.15,
      bounds: { minX: -3, maxX: 3, minY: -3, maxY: 3 },
      obstacles: [],
      connections: [
        {
          name: "signal",
          pointsToConnect: [
            { x: -2, y: 0, layer: "inner1", pcb_port_id: "start" },
            { x: 2, y: 0, layer: "inner1", pcb_port_id: "end" },
          ],
        },
      ],
      traces: [preload],
    }
    const inputSnapshot: {
      repairedRoute: HighDensityRoute
      preload: SimplifiedPcbTrace
    } = structuredClone({ repairedRoute, preload })
    const pipeline: AutoroutingPipelineSolver9_PreloadedTraceGraph =
      new AutoroutingPipelineSolver9_PreloadedTraceGraph(srj, {
        cacheProvider: null,
      })
    pipeline.pipeline9JointDrcRepairSolver = {
      getOutput: (): HighDensityRoute[] => [repairedRoute],
      getUpdatedPreloadedTraces: (): SimplifiedPcbTraces => [preload],
      getMutatedPreloadedTraces: (): SimplifiedPcbTraces => [preload],
    } as Pipeline9JointDrcRepairSolver
    pipeline.netToPointPairsSolver = {
      newConnections: srj.connections,
    } as NetToPointPairsSolver
    pipeline.highDensityRouteSolver = {
      routes: [repairedRoute],
    } as Pipeline9HighDensitySolver

    const names: string[] = pipeline.pipelineDef.map(
      (step: PipelineStep): string => step.solverName,
    )
    const postIndex: number = names.indexOf(
      "postRepairTraceSimplificationSolver",
    )
    expect(postIndex).toBe(names.indexOf("pipeline9JointDrcRepairSolver") + 1)
    expect(names[postIndex + 1]).toBe("lengthMatchingPostProcessingSolver")
    const postStep: PipelineStep = pipeline.pipelineDef[postIndex]!
    const params: SimplificationParams = postStep.getConstructorParams(
      pipeline,
    ) as SimplificationParams
    expect(postStep.solverClass).toBe(
      Pipeline9PostRepairTraceSimplificationSolver,
    )
    expect(params[0].hdRoutes).toHaveLength(1)
    const postSolver: Pipeline9PostRepairTraceSimplificationSolver =
      new Pipeline9PostRepairTraceSimplificationSolver(...params)
    postSolver.solve()
    expect(postSolver.solved).toBeTrue()
    expect(postSolver.failed).toBeFalse()
    pipeline.postRepairTraceSimplificationSolver = postSolver

    const output: HighDensityRoute = postSolver.simplifiedHdRoutes[0]!
    expect(output.route[0]).toEqual(repairedRoute.route[0])
    expect(output.route.at(-1)).toEqual(repairedRoute.route.at(-1))
    expect(output.traceThickness).toBe(0.4)
    expect(output.route).toEqual(repairedRoute.route)
    expect(pipeline._getOutputHdRoutes()).toEqual(postSolver.simplifiedHdRoutes)
    const lengthStep: PipelineStep = pipeline.pipelineDef[postIndex + 1]!
    const lengthParams: LengthMatchingParams = lengthStep.getConstructorParams(
      pipeline,
    ) as LengthMatchingParams
    expect(lengthParams[0].hdRoutes).toEqual(postSolver.simplifiedHdRoutes)
    const convertedOutput: SimplifiedPcbTraces =
      pipeline.getNewTracesBeforePowerExpansion()
    expect(convertedOutput).toHaveLength(1)
    expect(pipeline.getUpdatedPreloadedTraces()).toEqual([preload])
    expect(pipeline.getMutatedPreloadedTraces()).toEqual([preload])
    expect({ repairedRoute, preload }).toEqual(inputSnapshot)
  }
})
