import {
  computeTransformFromViewbox,
  getBounds,
  getSvgFromGraphicsObject,
} from "graphics-debug"
import {
  combinePreloadedAndRoutedTraces,
  type EvaluateRelaxedDrcInput,
} from "lib/testing/evaluate-relaxed-drc"
import { convertSrjToGraphicsObject } from "lib/utils/convertSrjToGraphicsObject"
import { applyToPoint } from "transformation-matrix"

export function getA13ViaCleanupSnapshotSvg({
  input,
  errorCount,
  focused = false,
}: {
  input: EvaluateRelaxedDrcInput
  errorCount: number
  focused?: boolean
}): string {
  const graphics = convertSrjToGraphicsObject({
    ...input.inputSrj,
    traces: combinePreloadedAndRoutedTraces(
      input.inputSrj.traces ?? [],
      input.routedTraces,
    ),
  })
  graphics.points = []
  const svgSizePx = 1000
  const svg = getSvgFromGraphicsObject(graphics, {
    backgroundColor: "white",
    svgWidth: svgSizePx,
    svgHeight: svgSizePx,
  })
  const contents = svg.replace(/^<svg[^>]*>/, "").replace(/<\/svg>$/, "")
  let view = contents
  if (focused) {
    // Match graphics-debug's SVG projection, then change only the camera.
    const svgPaddingPx = 40
    const worldToSvg = computeTransformFromViewbox(
      getBounds(graphics),
      svgSizePx,
      svgSizePx,
      { padding: svgPaddingPx, yFlip: true },
    )
    const topLeft = applyToPoint(worldToSvg, { x: 6, y: -0.5 })
    const bottomRight = applyToPoint(worldToSvg, { x: 10, y: -4.5 })
    const width = bottomRight.x - topLeft.x
    const height = bottomRight.y - topLeft.y
    view = `<svg width="${svgSizePx}" height="${svgSizePx}" viewBox="${topLeft.x} ${topLeft.y} ${width} ${height}">${contents}</svg>`
  }
  return `<svg width="${svgSizePx}" height="${svgSizePx}" viewBox="0 0 ${svgSizePx} ${svgSizePx}" xmlns="http://www.w3.org/2000/svg"><rect width="100%" height="100%" fill="white"/>${view}<rect x="15" y="15" width="970" height="54" rx="6" fill="white" stroke="#475569"/><text x="30" y="51" font-family="sans-serif" font-size="22" fill="#0f172a">Allwinner A13 repair: ${errorCount} native DRC errors</text></svg>`
}
