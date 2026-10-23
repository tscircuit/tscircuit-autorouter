import { expect, test } from "bun:test"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import { evaluateRelaxedDrc } from "lib/testing/evaluate-relaxed-drc"
import { mapLayerNameToZ } from "lib/utils/mapLayerNameToZ"
import { getConnectionPointLayer } from "lib/types/srj-types"
import type { pinPipeline9PreloadedSectionEndpoints } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/pinPipeline9PreloadedSectionEndpoints"
import { loadScenarioBySampleNumber } from "../../scripts/benchmark/scenarios"

test("Pipeline9 retains exact preload seams and full physical clearance on migrated SRJ23 sample 52", async (): Promise<void> => {
  const { scenario } = await loadScenarioBySampleNumber("srj23", 52)
  const solver = new AutoroutingPipelineSolver9_PreloadedTraceGraph(structuredClone(scenario), { effort: 1, cacheProvider: null })
  solver.solve()
  expect(solver.error).toBeNull()
  expect(solver.solved).toBeTrue()
  expect(solver.failed).toBeFalse()
  const sections = solver.portPointPathingSolver!.getOutput().changedPreloadedTraceSections
  expect(sections.length).toBeGreaterThan(0)
  const pins = (solver as unknown as {
    preloadedSectionEndpointPins: ReturnType<typeof pinPipeline9PreloadedSectionEndpoints>
  }).preloadedSectionEndpointPins
  expect(pins.endpointCount).toBe(sections.length * 2)
  expect(pins.ownedConnectors.length).toBeGreaterThan(0)
  for (const node of solver.uniformPortDistributionSolver!.getOutput()) {
    for (const point of [...node.portPoints, ...(node.portPointsInPairs?.flat() ?? [])]) {
      const pinned = point.portPointId ? pins.immutablePortPositions.get(point.portPointId) : undefined
      if (pinned) expect({ x: point.x, y: point.y }).toEqual(pinned)
    }
  }
  for (const section of sections) {
    const route = solver.highDensityStitchSolver!.mergedHdRoutes.find((route) => route.connectionName === section.connectionName)!
    expect(route).toBeDefined()
    for (const index of [0, 1]) {
      const terminal = section.connection.pointsToConnect[index]!
      const point = index === 0 ? route.route[0] : route.route.at(-1)
      expect(point).toMatchObject({ x: terminal.x, y: terminal.y,
        z: mapLayerNameToZ(getConnectionPointLayer(terminal), scenario.layerCount) })
    }
  }
  const output = solver.getOutputSimpleRouteJson()
  expect(evaluateRelaxedDrc({ inputSrj: output, srjWithPointPairs: solver.srjWithPointPairs!, routedTraces: [], includeBoardClearance: true }).errors).toEqual([])
  expect(new Set(output.traces!.map((trace) => trace.pcb_trace_id)).size).toBe(output.traces!.length)
  const mutable = new Set(solver.getMutatedPreloadedTraces().map((trace) => trace.pcb_trace_id))
  for (const original of scenario.traces ?? []) {
    const trace = output.traces!.find((trace) => trace.pcb_trace_id === original.pcb_trace_id)!
    expect(trace).toBeDefined()
    expect(trace.connection_name).toBe(original.connection_name)
    expect(trace.connectsTo).toEqual(original.connectsTo)
    expect(trace.route[0]).toEqual(original.route[0])
    expect(trace.route.at(-1)).toEqual(original.route.at(-1))
    if (JSON.stringify(trace.route) !== JSON.stringify(original.route)) expect(mutable.has(trace.pcb_trace_id)).toBeTrue()
  }
})
