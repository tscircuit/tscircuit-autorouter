import type { PostProcessingError } from "@tscircuit/length-matching-solver"
import type { AnyCircuitElement } from "circuit-json"
import { convertCircuitJsonToPcbSvg } from "circuit-to-svg"
import { convertPipeline7HdRoutesToSimplifiedPcbTraces } from "lib/autorouter-pipelines/AutoroutingPipeline7_MultiGraph/convertPipeline7HdRoutesToSimplifiedPcbTraces"
import { combinePreloadedAndRoutedTraces } from "lib/testing/evaluate-relaxed-drc"
import { convertToCircuitJson } from "lib/testing/utils/convertToCircuitJson"
import type { SimpleRouteJson } from "lib/types"
import type { HighDensityRoute } from "lib/types/high-density-types"
import { getConnectivityMapFromSimpleRouteJson } from "lib/utils/getConnectivityMapFromSimpleRouteJson"
import { getViaDimensions } from "lib/utils/getViaDimensions"

type SnapshotParams = {
  inputSrj: SimpleRouteJson
  boardCircuitJson: AnyCircuitElement[]
  srjWithPointPairs: SimpleRouteJson
  candidateHdRoutes: HighDensityRoute[]
  diagnostics: PostProcessingError[]
  solver: {
    name: string
    solved: boolean
    failed: boolean
    error: string | null
  }
  outputRouteCount?: number
}

const escapeXmlText = (value: string): string => {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;")
}

export function getRealBoardPostProcessingSnapshotSvg({
  inputSrj,
  boardCircuitJson,
  srjWithPointPairs,
  candidateHdRoutes,
  diagnostics,
  solver,
  outputRouteCount,
}: SnapshotParams): string {
  const routedTraces = convertPipeline7HdRoutesToSimplifiedPcbTraces({
    connections: srjWithPointPairs.connections,
    originalConnections: inputSrj.connections,
    hdRoutes: candidateHdRoutes,
    layerCount: inputSrj.layerCount,
    obstacles: inputSrj.obstacles,
    defaultViaHoleDiameter: getViaDimensions(inputSrj).holeDiameter,
    connMap: getConnectivityMapFromSimpleRouteJson(srjWithPointPairs),
  })
  const traces = combinePreloadedAndRoutedTraces(inputSrj.traces ?? [], routedTraces)
  const boardWidth = 840
  const boardHeight = 700
  const candidateCircuitJson = convertToCircuitJson(srjWithPointPairs, traces, {
      originalSrj: inputSrj,
      includeOriginalConnections: true,
      minTraceWidth: inputSrj.minTraceWidth,
  })
  const boardSvg = convertCircuitJsonToPcbSvg([
    ...boardCircuitJson,
    ...candidateCircuitJson.filter((element) => element.type === "pcb_trace" || element.type === "pcb_via"),
  ], {
    width: boardWidth,
    height: boardHeight,
    layer: "top",
    backgroundColor: "white",
    colorOverrides: {
      boardOutline: "#64748b",
      silkscreen: { top: "#475569", bottom: "#475569" },
    },
    includeVersion: false,
  })
  let status = "INCOMPLETE"
  let statusColor = "#854d0e"
  if (solver.solved) {
    status = "SUCCESS REPORTED"
    statusColor = "#166534"
  }
  if (solver.failed) {
    status = "REJECTED"
    statusColor = "#b91c1c"
  }
  let outputMessage = "Routing output withheld"
  if (outputRouteCount !== undefined) {
    outputMessage = `Routing output available: ${outputRouteCount} traces`
  }
  const summaryLines = [
    `${solver.name}: ${status}`,
    `solved=${solver.solved}, failed=${solver.failed}`,
    outputMessage,
    "",
    "MDI stage replay; RGMII bus tuning excluded",
    `${inputSrj.layerCount} layers; ${inputSrj.obstacles.length} routing obstacles`,
    `${inputSrj.connections.length} connections; ${candidateHdRoutes.length} candidate routes`,
    "",
    "Declared differential-pair constraints (mm)",
  ]
  for (const pair of inputSrj.differentialPairs ?? []) {
    let pairLabel = pair.connectionNames.join(" / ")
    for (const element of boardCircuitJson) {
      if (element.type !== "source_bus") continue
      if (pair.connectionNames.every((name) => element.source_trace_ids.includes(name))) {
        pairLabel = `${element.name}: ${pairLabel}`
      }
    }
    summaryLines.push(pairLabel)
    summaryLines.push(`  skew <= ${pair.lengthTolerance}; gap = ${pair.traceGap ?? "unspecified"}; uncoupled <= ${pair.maxUncoupledLength ?? "unspecified"}`)
  }
  summaryLines.push("", `Producer diagnostics: ${diagnostics.length}`)
  for (const diagnostic of diagnostics) {
    summaryLines.push("", `${diagnostic.stage}: ${diagnostic.reason ?? diagnostic.type}`)
    summaryLines.push(diagnostic.message)
    summaryLines.push(`Returned copper: ${diagnostic.returnedRouteSource}`)
  }
  const wrapText = (text: string): string[] => text.split("\n").flatMap((paragraph) => {
    const lines = paragraph.match(/.{1,68}(?:\s|$)|.{1,68}/g)
    if (!lines) return [""]
    return lines.map((line) => line.trimEnd())
  })
  const wrappedSummary = summaryLines.flatMap(wrapText)
  const errorLines = wrapText(solver.error ?? "No routing error reported")
  const errorTop = boardHeight + 148
  const height = Math.max(errorTop + errorLines.length * 21 + 35, 136 + wrappedSummary.length * 22)
  let svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="${height}" viewBox="0 0 1600 ${height}"><rect width="100%" height="100%" fill="white"/><g font-family="Arial, sans-serif" fill="#172033"><text x="24" y="34" font-size="24" font-weight="700">DP83867 RGMII PHY board: differential-pair post-processing</text><text x="24" y="64" font-size="16">Top copper view. Candidate copper is diagnostic; routing status determines output availability.</text>`
  svg += boardSvg.replace("<svg ", '<svg x="24" y="90" ')
  svg += `<text x="24" y="${errorTop - 27}" font-size="19" font-weight="700" fill="${statusColor}">Reported adapter error</text>`
  for (const [index, line] of errorLines.entries()) {
    svg += `<text x="24" y="${errorTop + index * 21}" font-size="15">${escapeXmlText(line)}</text>`
  }
  svg += `<rect x="894" y="88" width="682" height="${height - 112}" rx="8" fill="#f8fafc" stroke="${statusColor}" stroke-width="2"/>`
  for (const [index, line] of wrappedSummary.entries()) {
    let color = "#172033"
    if (index < 3) color = statusColor
    svg += `<text x="914" y="${118 + index * 22}" font-size="16" fill="${color}">${escapeXmlText(line)}</text>`
  }
  return `${svg}</g></svg>`
}
