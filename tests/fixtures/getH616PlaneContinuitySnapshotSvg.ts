import { getSvgFromGraphicsObject } from "graphics-debug"
import { createPipeline9AutoroutingDrcEvaluator } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/createPipeline9AutoroutingDrcEvaluator"
import type { EvaluateRelaxedDrcInput } from "lib/testing/evaluate-relaxed-drc"
import { convertSrjToGraphicsObject } from "lib/utils/convertSrjToGraphicsObject"

export function getH616PlaneContinuitySnapshotSvg(input: EvaluateRelaxedDrcInput): string {
  const evaluate = createPipeline9AutoroutingDrcEvaluator(input)
  const { errors } = evaluate(input.routedTraces)
  const continuityErrors = errors.filter((error) => error.type === "pcb_trace_error").length
  const graphics = convertSrjToGraphicsObject({ ...input.inputSrj, traces: input.routedTraces })
  graphics.points = []
  graphics.rects.push({
    center: { x: -10, y: 16.5 },
    width: 6,
    height: 7,
    fill: "none",
    stroke: "#94a3b8",
  })
  const svg = getSvgFromGraphicsObject(graphics, {
    backgroundColor: "white",
    svgWidth: 1000,
    svgHeight: 1100,
  })
  const color = errors.length === 0 ? "#166534" : "#b91c1c"
  const label = `H616: five escapes into one declared inner2 plane`
  const status = `Continuity errors: ${continuityErrors}; clearance errors: ${errors.length - continuityErrors}`
  const overlay = `<g><rect x="12" y="12" width="976" height="78" rx="6" fill="white" stroke="${color}"/><text x="24" y="40" font-family="Arial, sans-serif" font-size="20" fill="#334155">${label}</text><text x="24" y="72" font-family="Arial, sans-serif" font-size="20" fill="${color}">${status}</text></g>`
  return svg.replace("</svg>", `${overlay}</svg>`)
}
