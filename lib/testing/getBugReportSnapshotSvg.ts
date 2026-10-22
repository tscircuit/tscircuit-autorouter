import { getSvgFromGraphicsObject, type GraphicsObject } from "graphics-debug"
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
 * Custom graphics can show a detail view; the count still evaluates the full
 * routed input, so cropping the drawing never hides DRC errors.
 */
export const getBugReportSnapshotSvg = (
  input: EvaluateRelaxedDrcInput,
  options: { graphics?: GraphicsObject; includeTextLabels?: boolean } = {},
): string => {
  const { errors } = evaluateRelaxedDrc(input)
  const graphics =
    options.graphics ??
    convertSrjToGraphicsObject({
      ...input.inputSrj,
      traces: combinePreloadedAndRoutedTraces(
        input.inputSrj.traces ?? [],
        input.routedTraces,
      ),
    })
  // Connection debug dots obscure fine-pitch pads and escape traces.
  graphics.points = []
  const svg = getSvgFromGraphicsObject(graphics, {
    backgroundColor: "white",
    includeTextLabels: options.includeTextLabels,
  })
  const color = errors.length === 0 ? "#166534" : "#b91c1c"
  const overlay = `<g data-testid="relaxed-drc-summary"><rect x="12" y="12" width="300" height="44" rx="6" fill="white" stroke="${color}"/><text x="24" y="40" font-family="Arial, sans-serif" font-size="20" font-weight="600" fill="${color}">Relaxed DRC errors: ${errors.length}</text></g>`
  // Solid trace segments have round copper caps, matching clearance geometry.
  // Dashed lines denote other layers and retain their existing dash rendering.
  const copperCaps = "<style>polyline:not([stroke-dasharray]) { stroke-linecap: round; }</style>"
  return svg.replace("</svg>", `${copperCaps}${overlay}</svg>`)
}
