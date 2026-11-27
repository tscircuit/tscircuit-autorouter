import { expect, test } from "bun:test"
import { checkViasInPads } from "@tscircuit/checks"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import { evaluateRelaxedDrc } from "lib/testing/evaluate-relaxed-drc"
import { getBugReportSnapshotSvg } from "lib/testing/getBugReportSnapshotSvg"
import { checkBoardTraceClearance } from "lib/utils/autorouting-drc/checkBoardTraceClearance"
import {
  convertToCircuitJson,
  createPcbBoardElement,
} from "lib/utils/convertToCircuitJson"
import { doesSegmentCrossPolygonBoundary } from "lib/utils/polygonContainment"
import { loadScenarioBySampleNumber } from "../../scripts/benchmark/scenarios"

test("Pipeline9 preserves regional repair for contacts left by a completed exact portfolio", async (): Promise<void> => {
  const { scenario } = await loadScenarioBySampleNumber("srj33", 3)
  const solver: AutoroutingPipelineSolver9_PreloadedTraceGraph =
    new AutoroutingPipelineSolver9_PreloadedTraceGraph(
      structuredClone(scenario),
      { cacheProvider: null, effort: 1 },
    )
  solver.solve()
  expect(solver.solved).toBeTrue()
  expect(solver.failed).toBeFalse()
  const routedTraces = solver.getOutputSimplifiedPcbTraces()
  const snapshotInput = {
    inputSrj: scenario,
    srjWithPointPairs: solver.srjWithPointPairs!,
    routedTraces,
  }
  const { errors, circuitJson } = evaluateRelaxedDrc(snapshotInput)
  // The previous regional baseline crossed the outline and reported over
  // 100 issues once the board-edge clearance was included.
  const edgeErrors = checkBoardTraceClearance(circuitJson, {
    board: createPcbBoardElement(scenario),
  })
  expect(errors.length + edgeErrors.length).toBeLessThanOrEqual(18)
  expect(
    errors.filter((error) => error.message.includes("accidental contact"))
      .length,
  ).toBeLessThanOrEqual(4)

  const outline = scenario.outline
  if (!outline)
    throw new Error("SRJ33 sample 3 needs its concave board outline")
  const viaLocations = new Set<string>()
  for (const trace of routedTraces) {
    const points = trace.route.filter(
      (point) => point.route_type === "wire" || point.route_type === "via",
    )
    for (const [index, start] of points.entries()) {
      // Adjacent same-net traces can share a single drilled hole.
      if (start.route_type === "via") viaLocations.add(`${start.x},${start.y}`)
      const end = points[index + 1]
      if (!end) continue
      expect(
        doesSegmentCrossPolygonBoundary({
          start,
          end,
          polygon: outline,
          margin: 0,
        }),
      ).toBeFalse()
    }
  }
  expect(viaLocations.size).toBeLessThanOrEqual(114)
  const output = solver.getOutputSimpleRouteJson()
  const outputCircuitJson = convertToCircuitJson(output, output.traces!, {
    originalSrj: scenario,
    includeOriginalConnections: true,
    minTraceWidth: scenario.minTraceWidth,
    minViaDiameter: scenario.minViaDiameter,
  })
  expect(checkViasInPads(outputCircuitJson)).toEqual([])
  await expect(
    getBugReportSnapshotSvg(snapshotInput, { showBoardOutline: true }),
  ).toMatchSvgSnapshot(import.meta.path)
})
