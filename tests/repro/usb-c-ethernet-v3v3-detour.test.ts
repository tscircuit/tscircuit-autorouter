import { expect, test } from "bun:test"
import signals from "../../fixtures/bug-reports/usb-c-ethernet-v3v3-detour/signals.srj.json"
import groundConnections from "../../fixtures/bug-reports/usb-c-ethernet-v3v3-detour/ground-connections.json"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import { getBugReportSnapshotSvg } from "lib/testing/getBugReportSnapshotSvg"
import { evaluateRelaxedDrc } from "lib/testing/evaluate-relaxed-drc"
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
  expect(groundSolver.error).toBeNull()
  expect(groundSolver.solved).toBe(true)

  const routedTraces = groundSolver.getOutputSimplifiedPcbTraces()
  const powerBranch = groundSolver.getOutputSimpleRouteJson().traces!.find(
    (trace) =>
      trace.connectsTo?.includes("pcb_port_78") &&
      trace.connectsTo.includes("pcb_port_64"),
  )!
  const points = powerBranch.route.filter((point) => point.route_type === "wire")
  const length = points.slice(1).reduce(
    (sum, point, index) =>
      sum + Math.hypot(point.x - points[index]!.x, point.y - points[index]!.y),
    0,
  )
  // The captured rectangular detour made this branch 27.17 mm long.
  const maximumCleanedBranchLength = 26
  expect(length).toBeLessThan(maximumCleanedBranchLength)
  expect(
    evaluateRelaxedDrc({
      inputSrj: groundInput,
      srjWithPointPairs: groundSolver.srjWithPointPairs!,
      routedTraces,
    }).errors,
  ).toEqual([])

  await expect(
    getBugReportSnapshotSvg({
      inputSrj: groundInput,
      srjWithPointPairs: groundSolver.srjWithPointPairs!,
      routedTraces,
    }),
  ).toMatchSvgSnapshot(import.meta.path)
})
