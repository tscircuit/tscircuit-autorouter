import { expect, test } from "bun:test"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import { createPipeline9RelaxedDrcEvaluator } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/createPipeline9RelaxedDrcEvaluator"
import { evaluateRelaxedDrc } from "lib/testing/evaluate-relaxed-drc"
import { createPipeline9Repair04Fixture } from "../fixtures/pipeline9-repair04-fixture"

test("repair reference matches emitted trace aliases and collision IDs without losing offending via ownership", (): void => {
  const fixture = createPipeline9Repair04Fixture()
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
  fixture.srj.traces[0]!.pcb_trace_id = "signal_0"
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
  const pointPairs = structuredClone(fixture.srj)
  fixture.srj.connections[0]!.__netConnectionName = "declared-signal-net"
  const pipeline = new AutoroutingPipelineSolver9_PreloadedTraceGraph(
    fixture.srj,
    { cacheProvider: null },
  )
  pipeline.srjWithPointPairs = pointPairs
  type Fixture = ReturnType<typeof createPipeline9Repair04Fixture>
  const access = pipeline as unknown as {
    highDensityRouteSolver: { solved: boolean }
    netToPointPairsSolver: { newConnections: Fixture["srj"]["connections"] }
    pipeline9JointDrcRepairSolver: { getOutput(): Fixture["hdRoutes"] }
  }
  access.highDensityRouteSolver = { solved: true }
  access.netToPointPairsSolver = { newConnections: pointPairs.connections }
  access.pipeline9JointDrcRepairSolver = {
    getOutput: (): Fixture["hdRoutes"] => fixture.hdRoutes,
  }
  // Compare against the real emitter, rather than restating the evaluator's
  // converter and collision-renaming steps in this test.
  const emitted = pipeline.getNewTracesBeforePowerExpansion()
  expect(emitted[0]!.pcb_trace_id).toBe("signal_0_routed")
  expect(emitted[0]!.connection_name).toBe("declared-signal-net")
  const expected = evaluateRelaxedDrc({
    inputSrj: pipeline.originalSrj,
    srjWithPointPairs: pointPairs,
    routedTraces: emitted,
    drcOptions: { includeViaPadChecks: true },
  })
  const evaluate = createPipeline9RelaxedDrcEvaluator({
    useFinalOutputConversion: true,
    includeViaPadChecks: true,
    connections: pointPairs.connections,
    originalConnections: pointPairs.connections,
    layerCount: 2,
    obstacles: fixture.srj.obstacles,
    defaultViaHoleDiameter: 0.3,
    connMap: pipeline.connMap,
    srjWithPointPairs: pointPairs,
    originalSrj: pipeline.originalSrj,
    mutatedPreloadedTraces: [],
  })
  const result = evaluate({ routes: fixture.hdRoutes, traces: [] })
  const errors = Array.isArray(result) ? result : result.errors
  expect(errors.map((error): unknown => [error.type, error.message])).toEqual(
    expected.errors.map((error): unknown => [error.type, error.message]),
  )
  const viaPlacement = errors.find(
    (error): boolean => error.type === "pcb_placement_error",
  )
  expect(viaPlacement).toBeDefined()
  expect(viaPlacement!.existingViaRepairTargets).toEqual([
    { routeIndex: 0, viaIndex: 0, x: 0, y: 0 },
  ])
  // Reusing the evaluator must not retain a previous candidate's via location
  // or clearance errors when the caller evaluates another route and returns.
  const relocated = structuredClone(fixture.hdRoutes)
  relocated[0]!.route[1]!.x = 1
  relocated[0]!.route[2]!.x = 1
  relocated[0]!.vias[0]!.x = 1
  const movedResult = evaluate({ routes: relocated, traces: [] })
  const movedErrors = Array.isArray(movedResult)
    ? movedResult
    : movedResult.errors
  expect(
    movedErrors.some(
      (error): boolean => error.type === "pcb_placement_error",
    ),
  ).toBeFalse()
  expect(evaluate({ routes: fixture.hdRoutes, traces: [] })).toEqual(result)
})
