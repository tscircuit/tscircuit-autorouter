import { expect, test } from "bun:test"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { convertPreloadedTraceToHdRoutes } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/convertPreloadedTraceToHdRoutes"
import type { SimplifiedPcbTrace } from "lib/types"
import input from "../fixtures/features/portpointpathing/tinyhypergraph-port-bridge-repro-input.json"
import { AutoroutingPipelineSolver4_TinyHypergraph } from "lib/autorouter-pipelines/AutoroutingPipeline4_TinyHypergraph/AutoroutingPipelineSolver4_TinyHypergraph"
import { TinyHypergraphPortPointPathingSolver } from "lib/solvers/PortPointPathingSolver/tinyhypergraph/TinyHypergraphPortPointPathingSolver"
import type { HgPortPointPathingSolverParams } from "lib/solvers/PortPointPathingSolver/hgportpointpathingsolver/types"
import type {
  TinyHyperGraphSectionPipelineInput,
  TinyHyperGraphSolver,
} from "tiny-hypergraph/lib/index"

type TinyPipelineView = {
  tinyPipelineSolver: {
    inputProblem: TinyHyperGraphSectionPipelineInput
    getInitialVisualizationSolver: () => TinyHyperGraphSolver
  }
}

test("physical routing retains capacity pressure without changing legacy policies", (): void => {
  const params = structuredClone(
    input,
  ) as unknown as HgPortPointPathingSolverParams
  params.layerCount = 2
  params.inputSolvedRoutes = []
  params.flags.USE_PHYSICAL_VIA_COSTS = true
  const originalParams = structuredClone(params)
  const physical = new TinyHypergraphPortPointPathingSolver(params)
  const reconstructed = new TinyHypergraphPortPointPathingSolver(
    ...physical.getConstructorParams(),
  )

  for (const solver of [physical, reconstructed]) {
    const pipeline = (solver as unknown as TinyPipelineView).tinyPipelineSolver
    const { solveGraphOptions, sectionSolverOptions } = pipeline.inputProblem
    for (const options of [solveGraphOptions!, sectionSolverOptions!]) {
      expect(options.CROSS_LAYER_INTERSECTION_COST_FACTOR).toBe(1)
      expect(options.VIA_COST).toBe(0.6)
      expect(options.TRACE_DENSITY_COST_FACTOR).toBe(10)
      expect(options.PARTIAL_RIP_MAX_REGION_COST_GROWTH_RATIO).toBe(
        Number.POSITIVE_INFINITY,
      )
    }
    expect(solveGraphOptions!.PARTIAL_RIP_MAX_TOTAL_COST_GROWTH_RATIO).toBe(0.1)
    expect(solveGraphOptions!.MAX_ITERATIONS).toBe(2_000_000 * params.effort)
    expect(solveGraphOptions!.PARTIAL_RIP_MAX_ATTEMPTS).toBe(7)
    expect(solveGraphOptions!.PARTIAL_RIP_WARMUP_FULL_RIP_ATTEMPTS).toBe(1)
    const tinySolver = pipeline.getInitialVisualizationSolver()
    expect(tinySolver.CROSS_LAYER_INTERSECTION_COST_FACTOR).toBe(1)
    expect(tinySolver.VIA_COST).toBe(0.6)
    expect(tinySolver.TRACE_DENSITY_COST_FACTOR).toBe(10)
    expect(tinySolver.PARTIAL_RIP_MAX_REGION_COST_GROWTH_RATIO).toBe(
      Number.POSITIVE_INFINITY,
    )
    expect(tinySolver.PARTIAL_RIP_MAX_TOTAL_COST_GROWTH_RATIO).toBe(0.1)
  }
  expect(physical.getConstructorParams()[0]).toBe(params)
  expect(params).toEqual(originalParams)

  const explicitlyDisabled = structuredClone(params)
  explicitlyDisabled.flags.USE_PHYSICAL_VIA_COSTS = false
  const legacyPipeline = structuredClone(params)
  delete legacyPipeline.flags.USE_PHYSICAL_VIA_COSTS
  const fourLayer = structuredClone(params)
  fourLayer.layerCount = 4
  const preloaded = structuredClone(params)
  for (const [index, port] of preloaded.graph.ports.slice(0, 2).entries()) {
    port.d._preloadedFixedNetIds = ["bridge-repro"]
    port.d._preloadedTracePortAssignments = [
      {
        traceId: "existing-trace",
        fixedNetId: "bridge-repro",
        routePosition: index,
        tracePoint: { x: port.d.x, y: port.d.y },
        z: port.d.z,
      },
    ]
  }
  const componentOnly = structuredClone(params)
  const componentTrace: SimplifiedPcbTrace = {
    type: "pcb_trace",
    pcb_trace_id: "original-component",
    connection_name: "component-source",
    route: [
      {
        route_type: "through_obstacle",
        start: { x: 100, y: 100 },
        end: { x: 101, y: 100 },
        from_layer: "top",
        to_layer: "bottom",
        width: 0.2,
      },
    ],
  }
  const componentMap = new ConnectivityMap({
    componentNet: [componentTrace.connection_name],
  })
  const componentHdRoutes = convertPreloadedTraceToHdRoutes(
    componentTrace,
    0,
    2,
    0.45,
    componentMap,
  )
  componentOnly.hasPreloadedTraces = true
  expect(componentHdRoutes).toHaveLength(2)
  expect(
    componentOnly.graph.ports.every(
      (port): boolean => !port.d._preloadedTracePortAssignments?.length,
    ),
  ).toBeTrue()
  const pipeline4 = new AutoroutingPipelineSolver4_TinyHypergraph({
    layerCount: 2,
    minTraceWidth: 0.1,
    bounds: { minX: -2, maxX: 2, minY: -2, maxY: 2 },
    obstacles: [],
    connections: [
      {
        name: "legacy-route",
        pointsToConnect: [
          { x: -1, y: 0, layer: "top" },
          { x: 1, y: 0, layer: "top" },
        ],
      },
    ],
  })
  while (!pipeline4.portPointPathingSolver && !pipeline4.failed) {
    pipeline4.step()
  }
  expect(pipeline4.failed).toBeFalse()
  expect(pipeline4.portPointPathingSolver).toBeDefined()
  const pipeline4Params =
    pipeline4.portPointPathingSolver!.getConstructorParams()[0]
  expect(pipeline4Params.flags.USE_PHYSICAL_VIA_COSTS).toBeUndefined()
  for (const legacyParams of [
    explicitlyDisabled,
    legacyPipeline,
    fourLayer,
    preloaded,
    componentOnly,
    pipeline4Params,
  ]) {
    const solver = new TinyHypergraphPortPointPathingSolver(legacyParams)
    expect(solver.physicalViaMode).toBeFalse()
    const pipeline = (solver as unknown as TinyPipelineView).tinyPipelineSolver
    const { solveGraphOptions, sectionSolverOptions } = pipeline.inputProblem
    expect(solveGraphOptions!.VIA_COST).toBeUndefined()
    expect(sectionSolverOptions!.VIA_COST).toBeUndefined()
    expect(solveGraphOptions!.PARTIAL_RIP_MAX_REGION_COST_GROWTH_RATIO).toBe(
      0.05,
    )
    expect(
      sectionSolverOptions!.PARTIAL_RIP_MAX_REGION_COST_GROWTH_RATIO,
    ).toBeUndefined()
    expect(solveGraphOptions!.PARTIAL_RIP_MAX_TOTAL_COST_GROWTH_RATIO).toBe(0.1)
    const tinySolver = pipeline.getInitialVisualizationSolver()
    expect(tinySolver.VIA_COST).toBe(0)
    expect(tinySolver.CROSS_LAYER_INTERSECTION_COST_FACTOR).toBe(1)
    expect(tinySolver.PARTIAL_RIP_MAX_REGION_COST_GROWTH_RATIO).toBe(0.05)
    expect(tinySolver.PARTIAL_RIP_MAX_TOTAL_COST_GROWTH_RATIO).toBe(0.1)
  }
})
