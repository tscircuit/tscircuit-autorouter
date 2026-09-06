import { expect, test } from "bun:test"
import { AutoroutingDrcEngine } from "high-density-repair03/lib"
import {
  convertRepairRoutesToTraces,
  getRepairViaGeometry,
} from "@tscircuit/repair04"
import { Pipeline9Repair04Solver } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9Repair04Solver"
import { createPipeline9RelaxedDrcEvaluator } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/createPipeline9RelaxedDrcEvaluator"
import { getConnectivityMapFromSimpleRouteJson } from "lib/utils/getConnectivityMapFromSimpleRouteJson"
import { createPipeline9Repair04Fixture } from "../fixtures/pipeline9-repair04-fixture"

test("reference-only existing via-in-pad repair moves only the offending physical via", (): void => {
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
  const connMap = getConnectivityMapFromSimpleRouteJson(fixture.srj)
  const referenceDrcEvaluator = createPipeline9RelaxedDrcEvaluator({
    includeViaPadChecks: true,
    connections: fixture.srj.connections,
    originalConnections: fixture.srj.connections,
    layerCount: 2,
    obstacles: fixture.srj.obstacles,
    defaultViaHoleDiameter: 0.3,
    connMap,
    srjWithPointPairs: fixture.srj,
    originalSrj: fixture.srj,
    mutatedPreloadedTraces: [],
  })
  const before = structuredClone(fixture.hdRoutes)
  const initialReference = referenceDrcEvaluator({ routes: before, traces: [] })
  expect(
    Array.isArray(initialReference)
      ? initialReference.length
      : initialReference.errors.length,
  ).toBe(1)
  expect(
    new AutoroutingDrcEngine(fixture.srj).evaluate(
      convertRepairRoutesToTraces(before, 2),
    ).errors,
  ).toEqual([])
  const traceOnly = new Pipeline9Repair04Solver({
    ...fixture,
    connMap,
    referenceDrcEvaluator,
    enabled: true,
    allowExistingViaRelocation: false,
    maxRegions: 3,
    maxCandidatesPerRegion: 512,
  })
  traceOnly.solve()
  expect(traceOnly.failed).toBe(false)
  expect(traceOnly.getOutput()).toEqual(before)
  const solver = new Pipeline9Repair04Solver({
    ...fixture,
    connMap,
    referenceDrcEvaluator,
    enabled: true,
    maxRegions: 3,
    maxCandidatesPerRegion: 512,
  })
  solver.solve()
  expect(solver.failed).toBe(false)
  expect(solver.stats.acceptedRegions).toBe(1)
  const after = solver.getOutput()
  const finalReference = referenceDrcEvaluator({ routes: after, traces: [] })
  expect(
    Array.isArray(finalReference) ? finalReference : finalReference.errors,
  ).toEqual([])
  const beforeVias = getRepairViaGeometry(before[0]!, 2)
  const afterVias = getRepairViaGeometry(after[0]!, 2)
  expect(afterVias).toHaveLength(2)
  expect(afterVias[0]!.identity).not.toBe(beforeVias[0]!.identity)
  expect(afterVias[1]!.identity).toBe(beforeVias[1]!.identity)
  expect(afterVias.map((via): number[] => via.layerSequence)).toEqual(
    beforeVias.map((via): number[] => via.layerSequence),
  )
  expect(after[0]!.route[0]).toEqual(before[0]!.route[0])
  expect(after[0]!.route.at(-1)).toEqual(before[0]!.route.at(-1))
  expect(after[1]).toEqual(before[1])
  expect(fixture.hdRoutes).toEqual(before)
})
