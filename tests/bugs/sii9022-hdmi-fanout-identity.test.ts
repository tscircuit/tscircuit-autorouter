import { expect, test } from "bun:test"
import { FanoutSolver } from "@tscircuit/fanout-solver"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/autorouting-pipeline-solver9-preloaded-trace-graph"
import type {
  SimpleRouteBus,
  SimpleRouteConnection,
  SimpleRouteJson,
} from "lib/types"
import boardPhase from "../../fixtures/bug-reports/sii9022-hdmi-fanout-identity/sii9022-hdmi-routing-phase.srj.json" with {
  type: "json",
}
import u5FanoutPhase from "../../fixtures/bug-reports/sii9022-hdmi-fanout-identity/sii9022-u5-fanout.srj.json" with {
  type: "json",
}
import { getSii9022HdmiRouteVisualization } from "../fixtures/sii9022-hdmi-route-visualization"

type FanoutInput = Omit<SimpleRouteJson, "buses" | "connections"> & {
  buses: SimpleRouteBus[]
  connections: Array<SimpleRouteConnection & { source_trace_id: string }>
}

test("SII9022 HDMI path does not route with pre-fix fanout output", async () => {
  const fanoutInput = structuredClone(u5FanoutPhase) as FanoutInput
  const fanoutSolver = new FanoutSolver(fanoutInput, {
    busDirections: Object.fromEntries(
      fanoutInput.buses.map((bus) => [bus.busId, "right"] as const),
    ),
    sharedBoundary: fanoutInput.bounds,
  })
  fanoutSolver.solve()

  expect(fanoutSolver.failed).toBe(false)
  const generatedU5Traces =
    fanoutSolver.getOutput().simpleRouteJson.traces ?? []
  const sourceTraceIdByConnectionName = new Map(
    fanoutInput.connections.map(
      (connection) => [connection.name, connection.source_trace_id] as const,
    ),
  )
  const generatedTraceIds = new Set(
    generatedU5Traces.map((trace) => trace.pcb_trace_id),
  )
  const inputSrj = structuredClone(boardPhase) as SimpleRouteJson
  inputSrj.traces = [
    ...(inputSrj.traces ?? []).filter(
      (trace) => !generatedTraceIds.has(trace.pcb_trace_id),
    ),
    ...generatedU5Traces,
  ]

  for (const trace of generatedU5Traces) {
    const sourceTraceId = sourceTraceIdByConnectionName.get(
      trace.connection_name,
    )
    const connection = inputSrj.connections.find(
      (candidate) =>
        "source_trace_id" in candidate &&
        candidate.source_trace_id === sourceTraceId,
    )
    const endpoint = [...trace.route]
      .reverse()
      .find((point) => point.route_type === "wire")
    if (!connection || !endpoint) {
      throw new Error(`Missing generated endpoint for ${trace.connection_name}`)
    }
    Object.assign(connection.pointsToConnect[0], {
      x: endpoint.x,
      y: endpoint.y,
      layer: endpoint.layer,
    })
  }

  const solver = new AutoroutingPipelineSolver9_PreloadedTraceGraph(inputSrj, {
    cacheProvider: null,
    visualizationTraceColorMode: "net",
  })

  solver.solve()

  expect(inputSrj.connections).toHaveLength(8)
  expect(inputSrj.traces).toHaveLength(48)
  expect(generatedU5Traces).toHaveLength(8)
  expect(
    generatedU5Traces.filter(
      (trace) =>
        "source_trace_id" in trace &&
        typeof trace.source_trace_id === "string" &&
        trace.connectsTo?.includes(trace.source_trace_id),
    ),
  ).toHaveLength(0)
  expect(solver.solved).toBe(false)
  expect(solver.failed).toBe(true)
  expect(solver.error).toContain(
    "Pipeline9 primary high-density routing failed",
  )

  await expect(
    getSii9022HdmiRouteVisualization({
      inputSrj,
      traces: inputSrj.traces ?? [],
      status: "unrouted",
    }),
  ).toMatchSvgSnapshot(import.meta.path)
}, 20_000)
