import {
  BusLanesPipelineSolver,
  type SimpleRouteJson as BusLanesInput,
  type Trace as BusLanesTrace,
} from "@tscircuit/bus-lanes-solver"
import { checkEachPcbPortConnectedToPcbTraces } from "@tscircuit/checks"
import { expect } from "bun:test"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import {
  combinePreloadedAndRoutedTraces,
  evaluateRelaxedDrc,
  type EvaluateRelaxedDrcInput,
} from "lib/testing/evaluate-relaxed-drc"
import { getBugReportSnapshotSvg } from "lib/testing/getBugReportSnapshotSvg"
import type { SimpleRouteJson, SimplifiedPcbTrace } from "lib/types"

interface PaperDdr3Handoff {
  case: string
  inputSrj: SimpleRouteJson
  preloadedConnections: SimpleRouteJson["connections"]
  bytePhases: Pick<BusLanesInput, "connections" | "buses">[]
}

export async function runPaperDdr3Routing(
  caseName: string,
): Promise<EvaluateRelaxedDrcInput> {
  const fixture = Bun.file(
    new URL(
      "../../fixtures/repro/whole-route-ddr3.handoff.json.gz",
      import.meta.url,
    ),
  )
  const { cases } = JSON.parse(
    new TextDecoder().decode(Bun.gunzipSync(await fixture.bytes())),
  ) as { cases: PaperDdr3Handoff[] }
  const handoff = cases.find((entry) => entry.case === caseName)
  if (!handoff) throw new Error(`Missing ${caseName} handoff`)

  const { inputSrj, bytePhases, preloadedConnections } = handoff
  expect(bytePhases).toHaveLength(2)
  const traces: SimplifiedPcbTrace[] = [...(inputSrj.traces ?? [])]
  for (const phase of bytePhases) {
    const supplied: BusLanesTrace[] = traces.map((trace) => {
      const route = trace.route.map((point) => {
        if (point.route_type === "wire" || point.route_type === "via") return point
        throw new Error(`Unsupported supplied copper in ${trace.pcb_trace_id}`)
      })
      return { ...trace, route }
    })
    const lanes = new BusLanesPipelineSolver({
      ...inputSrj,
      ...phase,
      differentialPairs: undefined,
      traces: supplied,
    })
    lanes.solve()
    expect(lanes.error).toBeNull()
    expect(lanes.solved).toBeTrue()
    expect(lanes.traces.map((trace) => trace.connection_name).sort()).toEqual(
      phase.connections.map((connection) => connection.name).sort(),
    )
    for (const trace of lanes.traces) {
      if (trace.connection_name === undefined) {
        throw new Error(`Missing Bus Lanes owner for ${trace.pcb_trace_id}`)
      }
      traces.push({ ...trace, connection_name: trace.connection_name })
    }
  }

  const solver = new AutoroutingPipelineSolver9_PreloadedTraceGraph(
    structuredClone({ ...inputSrj, traces }),
    { cacheProvider: null },
  )
  solver.solve()
  expect(solver.error).toBeNull()
  expect(solver.solved).toBeTrue()

  const referenceSrj = {
    ...inputSrj,
    traces,
    connections: [...preloadedConnections, ...inputSrj.connections],
  }
  return {
    inputSrj: referenceSrj,
    srjWithPointPairs: referenceSrj,
    routedTraces: solver.getOutputSimplifiedPcbTraces(),
  }
}

export async function expectPaperDdr3RoutingSnapshot(
  snapshotInput: EvaluateRelaxedDrcInput,
  testPath: string,
): Promise<void> {
  const { circuitJson, errors } = evaluateRelaxedDrc(snapshotInput)
  const combined = combinePreloadedAndRoutedTraces(
    snapshotInput.inputSrj.traces ?? [],
    snapshotInput.routedTraces,
  )
  const routedNames = new Set(combined.map((trace) => trace.connection_name))
  expect(
    snapshotInput.inputSrj.connections.filter(({ name }) => !routedNames.has(name)),
  ).toEqual([])
  expect(errors).toEqual([])
  expect(checkEachPcbPortConnectedToPcbTraces(circuitJson)).toEqual([])
  await expect(
    getBugReportSnapshotSvg(snapshotInput, { showViaCount: true }),
  ).toMatchSvgSnapshot(testPath)
}
