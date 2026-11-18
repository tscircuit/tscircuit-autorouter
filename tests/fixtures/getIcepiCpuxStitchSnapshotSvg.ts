import { getSvgFromGraphicsObject } from "graphics-debug"
import { evaluateRelaxedDrc } from "lib/testing/evaluate-relaxed-drc"
import type { SimpleRouteJson, SimplifiedPcbTrace } from "lib/types"
import { convertSrjToGraphicsObject } from "lib/utils/convertSrjToGraphicsObject"
import fixture from "tests/repro/assets/icepi-cpux-stitch.json"

export function getIcepiCpuxStitchSnapshotSvg({
  input,
  trace,
  reachedTerminals,
  viaSiteCount,
  stage,
}: {
  input: SimpleRouteJson
  trace: SimplifiedPcbTrace
  reachedTerminals: number
  viaSiteCount: number
  stage: "stitching" | "simplification"
}): string {
  const { errors } = evaluateRelaxedDrc({
    inputSrj: input,
    srjWithPointPairs: input,
    routedTraces: [trace],
  })
  const graphics = convertSrjToGraphicsObject({ ...input, traces: [trace] })
  graphics.points = [
    { ...fixture.stitch.start, label: "C15.2 / bottom", color: "#0f172a" },
    { ...fixture.stitch.end, label: "U1.276 / top", color: "#0f172a" },
  ]
  graphics.rects.push({
    center: { x: 15.25, y: -1.75 },
    width: 3.5,
    height: 4.5,
    fill: "none",
    stroke: "#94a3b8",
  })
  const svg = getSvgFromGraphicsObject(graphics, {
    backgroundColor: "white",
    svgWidth: 1000,
    svgHeight: 1100,
    includeTextLabels: ["points"],
  })
  const label = `iCE/Pi CPUX: ${reachedTerminals}/2 terminals; ${viaSiteCount} via site${viaSiteCount === 1 ? "" : "s"}`
  const phase =
    stage === "simplification"
      ? "After stitching + simplification"
      : "Stopped at stitching"
  const status = `${phase}; relaxed DRC errors: ${errors.length}`
  const color = errors.length === 0 ? "#166534" : "#b91c1c"
  const overlay = `<g><rect x="12" y="12" width="976" height="78" rx="6" fill="white" stroke="${color}"/><text x="24" y="40" font-family="Arial, sans-serif" font-size="20" fill="#334155">${label}</text><text x="24" y="72" font-family="Arial, sans-serif" font-size="20" fill="${color}">${status}</text></g>`
  return svg.replace("</svg>", `${overlay}</svg>`)
}
