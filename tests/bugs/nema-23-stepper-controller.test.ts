import { expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { gunzipSync } from "node:zlib"
import { runAllRoutingChecks } from "@tscircuit/checks"
import { su } from "@tscircuit/circuit-json-util"
import type { AnyCircuitElement, PcbTrace } from "circuit-json"
import { getSvgFromGraphicsObject } from "graphics-debug"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import { getPendingEffectsFromSolverTree } from "lib/solvers/getPendingEffectsFromSolverTree"
import type { SimpleRouteJson } from "lib/types"
import { convertSrjToGraphicsObject } from "lib/utils/convertSrjToGraphicsObject"
import { stackSvgsVertically } from "stack-svgs"
import { Board, RootCircuit } from "tscircuit-for-sepic-repro"
import capturedInput from "../../fixtures/bug-reports/nema-23-stepper-controller/nema-23-stepper-controller.srj.json" with {
  type: "json",
}

// Captured from imrishabh18/nema-23-stepper-controller v1.4.24 after removing
// its hand-routed copper and saved router. The native board fixture retains
// the source trace rules, placements and fixed vias for the routing DRC.
test("Pipeline 9 routes the NEMA 23 stepper controller", async (): Promise<void> => {
  const input = structuredClone(capturedInput) as SimpleRouteJson
  const solver = new AutoroutingPipelineSolver9_PreloadedTraceGraph(input, {
    cacheProvider: null,
    effort: 1,
  })
  while (!solver.solved && !solver.failed) {
    solver.step()
    const effects = getPendingEffectsFromSolverTree(solver)
    if (effects.length > 0) {
      await Promise.all(effects.map((effect) => effect.promise))
    }
  }

  expect(solver.solved, solver.error ?? "").toBe(true)
  const srjWithPointPairs = solver.srjWithPointPairs!
  const routedTraces = solver.getOutputSimplifiedPcbTraces()
  const expectedPairs = srjWithPointPairs.connections
    .map((connection) =>
      connection.pointsToConnect.map((point) => point.pcb_port_id!).sort(),
    )
    .sort()
  const routedPairs = routedTraces
    .map((trace) => [...trace.connectsTo!].sort())
    .sort()
  expect(routedPairs).toEqual(expectedPairs)

  const boardElements = JSON.parse(
    gunzipSync(
      Uint8Array.from(
        readFileSync(
          new URL(
            "../../fixtures/bug-reports/nema-23-stepper-controller/nema-23-stepper-controller-unrouted.circuit.json.gz",
            import.meta.url,
          ),
        ),
      ),
    ).toString("utf8"),
  ) as AnyCircuitElement[]
  const root = new RootCircuit({ platform: { routingDisabled: true } })
  const board = new Board({ width: 56, height: 56, layers: 4 })
  root.add(board)
  root.render()
  root.db = su(boardElements) as typeof root.db
  const pcbBoard = root.db.pcb_board.list()[0]!
  board.subcircuit_id = pcbBoard.subcircuit_id!
  board.pcb_board_id = pcbBoard.pcb_board_id
  // Use Core's route materialization to recover native source trace ownership.
  board._asyncAutoroutingResult = {
    output_pcb_traces: structuredClone(routedTraces) as PcbTrace[],
  }
  board._updatePcbTraceRenderFromPcbTraces()
  const circuitJson = root.getCircuitJson() as AnyCircuitElement[]
  const errors = (await runAllRoutingChecks(circuitJson)).filter((finding) =>
    finding.type.endsWith("_error"),
  )
  const lengthErrors = errors.filter(
    (error) => error.type === "pcb_trace_too_long_error",
  )
  const viaCountErrors = errors.filter(
    (error) =>
      error.type === "pcb_trace_error" &&
      error.pcb_trace_error_id.startsWith("max_via_count_exceeded_"),
  )
  expect(lengthErrors.length).toBeLessThanOrEqual(5)
  expect(viaCountErrors.length).toBeLessThanOrEqual(4)
  const otherErrors =
    errors.length - lengthErrors.length - viaCountErrors.length
  expect(otherErrors).toBe(0)
  const errorSummary = [
    `${lengthErrors.length} trace length`,
    `${viaCountErrors.length} via count`,
    ...(otherErrors > 0 ? [`${otherErrors} other`] : []),
  ].join(" · ")
  const errorDetails = errors
    .map((error) => error.message)
    .join("\n")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")

  const graphics = convertSrjToGraphicsObject({
    ...input,
    traces: routedTraces,
  })
  graphics.points = []
  const svg = getSvgFromGraphicsObject(graphics, { backgroundColor: "white" })
  const summarySvg = `<svg width="640" height="76" viewBox="0 0 640 76" xmlns="http://www.w3.org/2000/svg">
    <rect width="100%" height="100%" fill="white"/>
    <g data-testid="routing-drc-summary">
      <title>${errorDetails}</title>
      <rect x="12" y="12" width="390" height="58" rx="6" fill="white" stroke="#b91c1c"/>
      <text x="24" y="36" font-family="sans-serif" font-size="18" font-weight="600" fill="#b91c1c">Board routing DRC errors: ${errors.length}</text>
      <text x="24" y="57" font-family="sans-serif" font-size="14" fill="#333">${errorSummary}</text>
    </g>
  </svg>`
  const labeledSvg = stackSvgsVertically([summarySvg, svg], {
    normalizeSize: false,
  })
  await expect(labeledSvg).toMatchSvgSnapshot(import.meta.path)
})
