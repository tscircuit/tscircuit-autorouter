import { expect, test } from "bun:test"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import { TinyHypergraphPortPointPathingSolver } from "lib/solvers/PortPointPathingSolver/tinyhypergraph/TinyHypergraphPortPointPathingSolver"
import { IncrementalPreparedPortPointRoutingSolver } from "lib/solvers/PortPointPathingSolver/tinyhypergraph/IncrementalPreparedPortPointRoutingSolver"
import { PreparedPortPointRoutingSolver } from "tiny-hypergraph/lib/prepared/PreparedPortPointRoutingSolver"
import type { TinyHyperGraphSectionPipelineSolver } from "tiny-hypergraph/lib/index"
import type { SimpleRouteJson } from "lib/types"

test("Pipeline9 absent and false flags preserve the exact native factory while true selects the owned prepared engine", (): void => {
  const input: SimpleRouteJson = { layerCount: 2, minTraceWidth: 0.15, bounds: { minX: -2, minY: -2, maxX: 2, maxY: 2 }, obstacles: [], connections: [] }
  const getPathing = (flag?: boolean): { flags: Record<string, unknown>; solver: TinyHypergraphPortPointPathingSolver } => {
    const pipeline = new AutoroutingPipelineSolver9_PreloadedTraceGraph(structuredClone(input), { cacheProvider: null, ...(flag === undefined ? {} : { experimentIncrementalPath: flag }) })
    pipeline.capacityNodes = []
    pipeline.srjWithPointPairs = structuredClone(input)
    pipeline.sharedEdgeSegmentsWithNecessaryCrampedPortPoints = []
    const stage = pipeline.pipelineDef.find((entry) => entry.solverName === "portPointPathingSolver")!
    const params = stage.getConstructorParams(pipeline)[0] as ConstructorParameters<typeof TinyHypergraphPortPointPathingSolver>[0]
    return { flags: params.flags, solver: new TinyHypergraphPortPointPathingSolver(params) }
  }
  const absent = getPathing(), disabled = getPathing(false), enabled = getPathing(true)
  expect(absent.flags).toEqual(disabled.flags)
  expect(Object.hasOwn(absent.flags, "EXPERIMENT_INCREMENTAL_PATH")).toBe(false)
  expect(enabled.flags.EXPERIMENT_INCREMENTAL_PATH).toBe(true)
  for (const [entry, expected] of [[absent, PreparedPortPointRoutingSolver], [disabled, PreparedPortPointRoutingSolver], [enabled, IncrementalPreparedPortPointRoutingSolver]] as const) {
    const internal = (entry.solver as unknown as { tinyPipelineSolver: TinyHyperGraphSectionPipelineSolver }).tinyPipelineSolver
    expect(internal.pipelineDef.find((stage) => stage.solverName === "solveGraph")!.solverClass).toBe(expected)
    expect(Object.hasOwn(entry.solver, "incrementalPath") && entry.solver.incrementalPath !== undefined).toBe(entry === enabled)
  }
  expect(enabled.solver.incrementalPathScope!.maximumVertices).toBe(32768)
})
