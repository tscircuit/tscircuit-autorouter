import { getSvgFromGraphicsObject } from "graphics-debug"
import { convertSrjToGraphicsObject } from "lib/utils/convertSrjToGraphicsObject"
import {
  combinePreloadedAndRoutedTraces,
  evaluateRelaxedDrc,
  type EvaluateRelaxedDrcInput,
} from "./evaluate-relaxed-drc"

/**
 * Final routed-board SVG with the benchmark relaxed-DRC count.
 * Pass newly routed traces: existing copper is included in both the drawing
 * and DRC, respecting explicit replacement metadata. Optional drcOptions use
 * the same overrides as evaluateRelaxedDrc; defaults are benchmark rules.
 */
export const getBugReportSnapshotSvg = (
  input: EvaluateRelaxedDrcInput,
  options: { bounds?: EvaluateRelaxedDrcInput["inputSrj"]["bounds"] } = {},
): string => {
  const { errors } = evaluateRelaxedDrc(input)
  const graphics = convertSrjToGraphicsObject({
    ...input.inputSrj,
    traces: combinePreloadedAndRoutedTraces(
      input.inputSrj.traces ?? [],
      input.routedTraces,
    ),
  })
  // Connection debug dots obscure fine-pitch pads and escape traces.
  graphics.points = []
  // An explicit frame keeps before/after cutouts at the same scale.
  if (options.bounds) {
    const { minX, minY, maxX, maxY } = options.bounds
    graphics.rects.push({
      center: { x: (minX + maxX) / 2, y: (minY + maxY) / 2 },
      width: maxX - minX,
      height: maxY - minY,
      fill: "none",
      stroke: "#94a3b8",
    })
  }
  const svg = getSvgFromGraphicsObject(graphics, {
    backgroundColor: "white",
  })
  const color = errors.length === 0 ? "#166534" : "#b91c1c"
  const overlay = `<g data-testid="relaxed-drc-summary"><rect x="12" y="12" width="300" height="44" rx="6" fill="white" stroke="${color}"/><text x="24" y="40" font-family="Arial, sans-serif" font-size="20" font-weight="600" fill="${color}">Relaxed DRC errors: ${errors.length}</text></g>`
  return svg.replace("</svg>", `${overlay}</svg>`)
}
