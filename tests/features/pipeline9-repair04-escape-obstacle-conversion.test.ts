import { expect, test } from "bun:test"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import type { Pipeline9Repair04Solver } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9Repair04Solver"
import { evaluateRelaxedDrc } from "lib/testing/evaluate-relaxed-drc"
import { createPipeline9Repair04Fixture } from "../fixtures/pipeline9-repair04-fixture"

test("both repair04 factories retain real vias when local context contains generated escape obstacles", (): void => {
  const fixture = createPipeline9Repair04Fixture()
  fixture.srj.traces = []
  fixture.srj.obstacles = [
    {
      type: "rect",
      center: { x: 0, y: 0 },
      width: 0.5,
      height: 0.5,
      layers: ["top"],
      connectedTo: ["signal", "pcb_smtpad_own", "pcb_port_own"],
      circuitJsonMetadata: {
        pcb_smtpad_id: "pcb_smtpad_own",
        pcb_port_id: "pcb_port_own",
      },
    },
  ]
  fixture.srj.connections.push({
    name: "pad-attachment",
    rootConnectionName: "signal",
    pointsToConnect: [
      {
        x: 0,
        y: 0,
        layer: "top",
        pointId: "pcb_port_own",
        pcb_port_id: "pcb_port_own",
      },
      structuredClone(fixture.srj.connections[0]!.pointsToConnect[0]!),
    ],
  })
  const route = fixture.hdRoutes[0]!
  route.route = [
    { x: -20, y: 1, z: 0, pcb_port_id: "pcb_port_signal_start" },
    { x: 0, y: 0, z: 0 },
    { x: 0, y: 0, z: 1 },
    { x: 3, y: 0, z: 1 },
    { x: 3, y: 0, z: 0 },
    { x: 20, y: 1, z: 0, pcb_port_id: "pcb_port_signal_end" },
  ]
  route.vias = [
    { x: 0, y: 0 },
    { x: 3, y: 0 },
  ]
  const pipeline = new AutoroutingPipelineSolver9_PreloadedTraceGraph(
    fixture.srj,
    { cacheProvider: null },
  )
  const localSrj = structuredClone(pipeline.srj)
  // EscapeViaLocationSolver adds this routing obstacle to the point-pair SRJ.
  // It is not existing plated copper and cannot replace a via in final output.
  localSrj.obstacles.push({
    obstacleId: "escape-via-obstacle:generated",
    type: "rect",
    center: { x: 0, y: 0 },
    width: route.viaDiameter,
    height: route.viaDiameter,
    layers: ["top", "bottom"],
    __zLayers: [0, 1],
    connectedTo: ["signal"],
  })
  pipeline.srjWithPointPairs = localSrj
  type Fixture = ReturnType<typeof createPipeline9Repair04Fixture>
  type Preloads = Fixture["srj"]["traces"]
  const emptyPreloads: Preloads = []
  const access = pipeline as unknown as {
    highDensityRouteSolver: { solved: boolean }
    netToPointPairsSolver: { newConnections: Fixture["srj"]["connections"] }
    globalDrcForceImproveSolver: { getOutput(): Fixture["hdRoutes"] }
    pipeline9JointDrcRepairSolver: {
      getOutput(): Fixture["hdRoutes"]
      getUpdatedPreloadedTraces(): Preloads
      getMutatedPreloadedTraces(): Preloads
    }
    getSrjWithMaterializedPreloadedTraces(): typeof localSrj
    getPreloadedTraceUpdatesAfterHighDensity(): {
      updatedPreloadedTraces: Preloads
      mutatedPreloadedTraces: Preloads
    }
  }
  access.highDensityRouteSolver = { solved: true }
  access.netToPointPairsSolver = { newConnections: localSrj.connections }
  access.globalDrcForceImproveSolver = {
    getOutput: (): Fixture["hdRoutes"] => fixture.hdRoutes,
  }
  access.pipeline9JointDrcRepairSolver = {
    getOutput: (): Fixture["hdRoutes"] => fixture.hdRoutes,
    getUpdatedPreloadedTraces: (): Preloads => emptyPreloads,
    getMutatedPreloadedTraces: (): Preloads => emptyPreloads,
  }
  access.getSrjWithMaterializedPreloadedTraces = (): typeof localSrj => localSrj
  access.getPreloadedTraceUpdatesAfterHighDensity = (): {
    updatedPreloadedTraces: Preloads
    mutatedPreloadedTraces: Preloads
  } => ({
    updatedPreloadedTraces: emptyPreloads,
    mutatedPreloadedTraces: emptyPreloads,
  })
  const emitted = pipeline.getNewTracesBeforePowerExpansion()
  expect(
    emitted[0]!.route.filter((point): boolean => point.route_type === "via"),
  ).toHaveLength(2)
  const expected = evaluateRelaxedDrc({
    inputSrj: pipeline.originalSrj,
    srjWithPointPairs: localSrj,
    routedTraces: emitted,
    drcOptions: { includeViaPadChecks: true },
  })
  expect(
    expected.errors.some(
      (error): boolean => error.type === "pcb_placement_error",
    ),
  ).toBe(true)
  for (const name of ["repair04Solver", "repair04AdvancedSolver"]) {
    const definition = pipeline.pipelineDef.find(
      (step): boolean => step.solverName === name,
    )!
    const [params] = definition.getConstructorParams(
      pipeline,
    ) as ConstructorParameters<typeof Pipeline9Repair04Solver>
    expect(params.srj.obstacles).toBe(localSrj.obstacles)
    const evaluated = params.referenceDrcEvaluator({
      routes: fixture.hdRoutes,
      traces: [],
    })
    const errors = Array.isArray(evaluated) ? evaluated : evaluated.errors
    expect(errors.map((error): unknown => [error.type, error.message])).toEqual(
      expected.errors.map((error): unknown => [error.type, error.message]),
    )
    expect(
      errors.find((error): boolean => error.type === "pcb_placement_error")!
        .existingViaRepairTargets,
    ).toEqual([{ routeIndex: 0, viaIndex: 0, x: 0, y: 0 }])
  }
})
