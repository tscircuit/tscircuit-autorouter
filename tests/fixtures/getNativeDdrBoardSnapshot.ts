import { expect } from "bun:test"
import { readFileSync } from "node:fs"
import { gunzipSync } from "node:zlib"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import { evaluateRelaxedDrc } from "lib/testing/evaluate-relaxed-drc"
import { getBugReportSnapshotSvg } from "lib/testing/getBugReportSnapshotSvg"
import type { SimpleRouteJson } from "lib/types"
import { checkTraceContinuity } from "lib/utils/autorouting-drc/checkTraceContinuity"

export function getNativeDdrBoardSnapshot({
  boardName,
  bounds,
  fixtureUrl,
  maxHighDensityIterations = Infinity,
}: {
  boardName: string
  bounds: SimpleRouteJson["bounds"]
  fixtureUrl: URL
  maxHighDensityIterations?: number
}): string {
  const { inputSrj, preloadedConnections } = JSON.parse(
    gunzipSync(new Uint8Array(readFileSync(fixtureUrl))).toString("utf8"),
  ) as {
    inputSrj: SimpleRouteJson
    preloadedConnections: SimpleRouteJson["connections"]
  }
  expect(
    inputSrj.obstacles.every((pad) => pad.circuitJsonMetadata?.pcb_smtpad_id),
  ).toBeTrue()
  const fixedTraces = inputSrj.traces!
  expect(fixedTraces.every((trace) => trace.isFixed)).toBeTrue()
  expect(new Set(fixedTraces.map((trace) => trace.connection_name))).toEqual(
    new Set(preloadedConnections.map((connection) => connection.name)),
  )

  const solver = new AutoroutingPipelineSolver9_PreloadedTraceGraph(inputSrj, {
    cacheProvider: null,
  })
  // Bound only detailed routing; preprocessing keeps its normal iteration budget.
  while (
    !solver.solved &&
    !solver.failed &&
    (solver.highDensityRouteSolver?.iterations ?? 0) < maxHighDensityIterations
  )
    solver.step()
  // Core commits the remaining copper only when the entire phase succeeds.
  if (solver.failed) {
    expect(solver.error).toContain(
      "Pipeline9 primary high-density routing failed",
    )
  }
  const routedTraces = solver.solved
    ? solver.getOutputSimplifiedPcbTraces()
    : []
  const connections = [...preloadedConnections, ...inputSrj.connections]
  const routedNames = new Set(
    [...fixedTraces, ...routedTraces].map((trace) => trace.connection_name),
  )
  if (solver.solved) {
    expect(routedNames).toEqual(
      new Set(connections.map((connection) => connection.name)),
    )
  }
  const snapshotInput = {
    inputSrj: { ...inputSrj, connections },
    srjWithPointPairs: {
      ...solver.srjWithPointPairs!,
      connections: [
        ...preloadedConnections,
        ...solver.srjWithPointPairs!.connections,
      ],
    },
    routedTraces,
    drcOptions: {
      traceClearance: inputSrj.minTraceToPadEdgeClearance,
      viaToPadClearance: inputSrj.minViaEdgeToPadEdgeClearance,
    },
  }
  const { circuitJson, errors } = evaluateRelaxedDrc(snapshotInput)
  expect(errors).toEqual([])
  expect(checkTraceContinuity(circuitJson)).toEqual([])
  const svg = getBugReportSnapshotSvg(snapshotInput, { bounds })
  const caption = `<text x="320" y="622" text-anchor="middle" font-family="Arial, sans-serif" font-size="20" font-weight="600" fill="#172554" stroke="white" stroke-width="4" paint-order="stroke">${boardName} DDR · ${routedNames.size}/${connections.length} nets connected</text>`
  return svg.replace("</svg>", `${caption}</svg>`)
}
