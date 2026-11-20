import { getSvgFromGraphicsObject } from "graphics-debug"
import {
  evaluateRelaxedDrc,
  type EvaluateRelaxedDrcInput,
} from "lib/testing/evaluate-relaxed-drc"
import { convertSrjToGraphicsObject } from "lib/utils/convertSrjToGraphicsObject"

export const getAllowedLayerSnapshotSvg = (
  input: EvaluateRelaxedDrcInput,
  forbiddenLayers: string[],
): string => {
  // Evaluate the complete input, including every fixed-copper obstacle.
  const { errors } = evaluateRelaxedDrc(input)
  // Display only component pads and the newly generated route. Fixed-copper
  // rectangles remain in the solver and DRC input, but obscure this view.
  const graphics = convertSrjToGraphicsObject({
    ...input.inputSrj,
    obstacles: input.inputSrj.obstacles.filter(
      (obstacle) => obstacle.circuitJsonMetadata?.pcb_smtpad_id,
    ),
    traces: input.routedTraces,
  })
  graphics.points = []
  const svg = getSvgFromGraphicsObject(graphics, {
    backgroundColor: "white",
    svgWidth: 1000,
    svgHeight: 850,
  })
  const summary = `<g transform="translate(0,110)">${svg.slice(svg.indexOf(">") + 1, svg.lastIndexOf("</svg>"))}</g>`
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1000" height="960" viewBox="0 0 1000 960">
<rect width="100%" height="100%" fill="white"/>
${summary}
<g font-family="Arial, sans-serif" font-size="20">
<text x="24" y="32" fill="#111827">Allowed wire layers: top, bottom</text>
<text x="24" y="61" fill="#b91c1c">Forbidden wire layers used: ${forbiddenLayers.join(", ") || "none"}</text>
<text x="24" y="90" fill="#111827">Relaxed DRC errors: ${errors.length} (does not check allowed layers)</text>
<text x="24" y="942" font-size="16" fill="#475569">Pads and new route only; fixed-copper obstacles hidden in this view.</text>
</g></svg>`
}
