import { expect, test } from "bun:test"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import { Pipeline9Repair04Solver } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9Repair04Solver"
import { createPipeline9RelaxedDrcEvaluator } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/createPipeline9RelaxedDrcEvaluator"
import { createPipeline9Repair04Fixture } from "../fixtures/pipeline9-repair04-fixture"

test("advanced repair follows joint repair, uses its current preloaded copper, and skips a clean input unchanged", (): void => {
  const fixture = createPipeline9Repair04Fixture()
  fixture.srj.obstacles = []
  const originalPreload = fixture.srj.traces[0]!
  originalPreload.route = [
    {
      route_type: "wire",
      x: 0,
      y: -2,
      width: 0.15,
      layer: "top",
      start_pcb_port_id: "pcb_port_preload_start",
    },
    {
      route_type: "wire",
      x: 0,
      y: 2,
      width: 0.15,
      layer: "top",
      end_pcb_port_id: "pcb_port_preload_end",
    },
  ]
  const preloadConnection = fixture.srj.connections.find(
    (connection): boolean => connection.name === "distant-preload",
  )!
  preloadConnection.pointsToConnect[0]!.x = 0
  preloadConnection.pointsToConnect[0]!.y = -2
  preloadConnection.pointsToConnect[1]!.x = 0
  preloadConnection.pointsToConnect[1]!.y = 2
  const updatedPreload: typeof originalPreload = {
    ...structuredClone(originalPreload),
    __replaces_pcb_trace_id: originalPreload.pcb_trace_id,
    route: [
      originalPreload.route[0]!,
      { route_type: "wire", x: 0, y: -1.5, width: 0.15, layer: "top" },
      {
        route_type: "via",
        x: 0,
        y: -1.5,
        from_layer: "top",
        to_layer: "bottom",
        via_diameter: 0.6,
        via_hole_diameter: 0.3,
      },
      { route_type: "wire", x: 0, y: -1.5, width: 0.15, layer: "bottom" },
      { route_type: "wire", x: 0, y: 1.5, width: 0.15, layer: "bottom" },
      {
        route_type: "via",
        x: 0,
        y: 1.5,
        from_layer: "bottom",
        to_layer: "top",
        via_diameter: 0.6,
        via_hole_diameter: 0.3,
      },
      { route_type: "wire", x: 0, y: 1.5, width: 0.15, layer: "top" },
      originalPreload.route[1]!,
    ],
  }
  const currentPreloads = [updatedPreload]
  const originalRoutes = structuredClone(fixture.hdRoutes)
  const originalCurrentPreloads = structuredClone(currentPreloads)
  const pipeline = new AutoroutingPipelineSolver9_PreloadedTraceGraph(
    fixture.srj,
    { cacheProvider: null },
  )
  pipeline.srjWithPointPairs = fixture.srj
  type Fixture = ReturnType<typeof createPipeline9Repair04Fixture>
  const access = pipeline as unknown as {
    netToPointPairsSolver: { newConnections: Fixture["srj"]["connections"] }
    pipeline9JointDrcRepairSolver: {
      getOutput(): Fixture["hdRoutes"]
      getUpdatedPreloadedTraces(): typeof currentPreloads
      getMutatedPreloadedTraces(): typeof currentPreloads
    }
    getPreloadedTraceUpdatesAfterHighDensity(): never
  }
  access.netToPointPairsSolver = { newConnections: fixture.srj.connections }
  access.pipeline9JointDrcRepairSolver = {
    getOutput: (): Fixture["hdRoutes"] => fixture.hdRoutes,
    getUpdatedPreloadedTraces: (): typeof currentPreloads => currentPreloads,
    getMutatedPreloadedTraces: (): typeof currentPreloads => currentPreloads,
  }
  access.getPreloadedTraceUpdatesAfterHighDensity = (): never => {
    throw new Error("Advanced repair must not reload pre-joint copper")
  }
  const stageNames = pipeline.pipelineDef.map((step): string => step.solverName)
  const firstRepair = stageNames.indexOf("repair04Solver")
  expect(stageNames.slice(firstRepair - 1, firstRepair + 5)).toEqual([
    "globalDrcForceImproveSolver",
    "repair04Solver",
    "pipeline9JointDrcRepairSolver",
    "repair04AdvancedSolver",
    "lengthMatchingPostProcessingSolver",
    "powerTraceExpansionSolver",
  ])
  const definition = pipeline.pipelineDef.find(
    (step): boolean => step.solverName === "repair04AdvancedSolver",
  )!
  const [params] = definition.getConstructorParams(
    pipeline,
  ) as ConstructorParameters<typeof Pipeline9Repair04Solver>
  expect(params.hdRoutes).toBe(fixture.hdRoutes)
  expect(params.srj.traces).toBe(currentPreloads)
  expect(params.allowLayerChanges).toBe(true)
  expect(params.allowExistingViaRelocation).toBe(true)
  expect(params.maxInitialCandidateAttempts).toBe(1024)
  expect(params.maxCandidateAttemptsSinceAcceptance).toBe(10_000)
  expect(params.maxTotalCandidateAttempts).toBe(32_768)
  expect(params.fullEffortReferenceErrorCount).toBe(16)
  expect(params.maxPathSearchNodesPerRegion).toBe(500_000)
  expect(params.maxPathSearchNodesSinceAcceptance).toBe(1_000_000)
  const currentReference = params.referenceDrcEvaluator({
    routes: fixture.hdRoutes,
    traces: [],
  })
  expect(
    Array.isArray(currentReference)
      ? currentReference
      : currentReference.errors,
  ).toEqual([])
  const staleReferenceEvaluator = createPipeline9RelaxedDrcEvaluator({
    includeViaPadChecks: true,
    connections: fixture.srj.connections,
    originalConnections: fixture.srj.connections,
    layerCount: 2,
    obstacles: [],
    defaultViaHoleDiameter: 0.3,
    connMap: pipeline.connMap,
    srjWithPointPairs: fixture.srj,
    originalSrj: fixture.srj,
    mutatedPreloadedTraces: [],
  })
  const staleReference = staleReferenceEvaluator({
    routes: fixture.hdRoutes,
    traces: [],
  })
  expect(
    Array.isArray(staleReference)
      ? staleReference.length
      : staleReference.errors.length,
  ).toBeGreaterThan(0)
  const solver = new Pipeline9Repair04Solver(params)
  solver.solve()
  expect(solver.failed).toBe(false)
  expect(solver.solved).toBe(true)
  expect(solver.getOutput()).toBe(fixture.hdRoutes)
  expect(solver.getOutput()).toEqual(originalRoutes)
  expect((solver as unknown as { regionCount: number }).regionCount).toBe(0)
  expect(currentPreloads).toEqual(originalCurrentPreloads)
  pipeline.repair04AdvancedSolver = solver
  expect(pipeline._getOutputHdRoutes()).toBe(fixture.hdRoutes)
  const lengthStep = pipeline.pipelineDef.find(
    (step): boolean => step.solverName === "lengthMatchingPostProcessingSolver",
  )!
  const [lengthParams] = lengthStep.getConstructorParams(pipeline) as [
    { hdRoutes: Fixture["hdRoutes"] },
  ]
  expect(lengthParams.hdRoutes).toBe(fixture.hdRoutes)
})
