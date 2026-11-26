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
  options: {
    bounds?: EvaluateRelaxedDrcInput["inputSrj"]["bounds"]
    showErrorLocations?: boolean
    showBoardOutline?: boolean
  } = {},
): string => {
  const { errors, locationAwareErrors } = evaluateRelaxedDrc(input)
  const graphics = convertSrjToGraphicsObject({
    ...input.inputSrj,
    traces: combinePreloadedAndRoutedTraces(
      input.inputSrj.traces ?? [],
      input.routedTraces,
    ),
  })
  // Connection debug dots obscure fine-pitch pads and escape traces.
  graphics.points = options.showErrorLocations
    ? locationAwareErrors.map(({ center, message }) => ({
        ...center,
        label: message,
      }))
    : []
  const outline = input.inputSrj.outline
  if (options.showBoardOutline && outline && outline.length >= 3) {
    graphics.lines.push({
      points: [...outline, outline[0]!],
      strokeColor: "#111827",
      strokeWidth: 0.2,
      label: "Board outline",
    })
  }
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
  const markerLegend = options.showErrorLocations
    ? '<circle cx="24" cy="77" r="4" fill="white" stroke="#5b21b6" stroke-width="2"/><text x="36" y="82" font-family="Arial, sans-serif" font-size="15" fill="#351568">DRC location</text>'
    : ""
  const overlay = `<g data-testid="relaxed-drc-summary"><rect x="12" y="12" width="300" height="44" rx="6" fill="white" stroke="${color}"/><text x="24" y="40" font-family="Arial, sans-serif" font-size="20" font-weight="600" fill="${color}">Relaxed DRC errors: ${errors.length}</text>${markerLegend}</g>`
  // Draw the markers above the copper, keeping their centers visible.
  const markerStyle = options.showErrorLocations
    ? '<style>circle[data-type="point"]{r:4px;fill:white;fill-opacity:0.35;stroke:#5b21b6;stroke-width:2}</style>'
    : ""
  return svg.replace("</svg>", `${markerStyle}${overlay}</svg>`)
}
