import { expect, test } from "bun:test"
import signals from "../../fixtures/bug-reports/usb-c-ethernet-v3v3-detour/signals.srj.json"
import groundConnections from "../../fixtures/bug-reports/usb-c-ethernet-v3v3-detour/ground-connections.json"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import { getBugReportSnapshotSvg } from "lib/testing/getBugReportSnapshotSvg"
import type { SimpleRouteJson } from "lib/types"

test("USB-C Ethernet V3V3 rectangular detour above the RJ45 mounting hole", async (): Promise<void> => {
  const signalSolver = new AutoroutingPipelineSolver9_PreloadedTraceGraph(
    signals as SimpleRouteJson,
  )
  signalSolver.solve()
  expect(signalSolver.solved).toBe(true)

  const groundInput: SimpleRouteJson = {
    ...(signals as SimpleRouteJson),
    connections: groundConnections as SimpleRouteJson["connections"],
    differentialPairs: [],
    traces: signalSolver.getOutputSimpleRouteJson().traces,
  }
  const groundSolver = new AutoroutingPipelineSolver9_PreloadedTraceGraph(groundInput)
  groundSolver.solve()
  expect(groundSolver.solved).toBe(true)

  await expect(
    getBugReportSnapshotSvg({
      inputSrj: groundInput,
      srjWithPointPairs: groundSolver.srjWithPointPairs!,
      routedTraces: groundSolver.getOutputSimplifiedPcbTraces(),
    }),
  ).toMatchSvgSnapshot(import.meta.path)
})
