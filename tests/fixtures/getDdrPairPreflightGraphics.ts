import type { GraphicsObject } from "graphics-debug"
import type { SimpleRouteJson } from "lib/types"
import { convertSrjToGraphicsObject } from "lib/utils/convertSrjToGraphicsObject"
import { getColorMap } from "lib/solvers/colors"

type PreflightResult = {
  label: string
  solved: boolean
  failed: boolean
  error: string | null
}

/** Native board-space geometry in mm, +X right and +Y up; no routed copper. */
export function getDdrPairPreflightGraphics({
  inputSrj,
  preflightResults,
}: {
  inputSrj: SimpleRouteJson
  preflightResults: PreflightResult[]
}): GraphicsObject {
  const graphics: GraphicsObject = convertSrjToGraphicsObject(inputSrj)
  graphics.coordinateSystem = "cartesian"
  const colorMap = getColorMap(inputSrj)
  for (const connection of inputSrj.connections) {
    graphics.lines!.push({
      points: connection.pointsToConnect,
      strokeColor: colorMap[connection.name],
      strokeWidth: inputSrj.minTraceWidth,
      strokeDash: [0.2, 0.2],
      label: `${connection.name}: unrouted request`,
    })
  }
  if (inputSrj.outline) {
    graphics.lines!.push({
      points: [...inputSrj.outline, inputSrj.outline[0]!],
      strokeColor: "black",
      strokeWidth: inputSrj.minTraceWidth,
      label: "Native board outline",
    })
  }
  const labels = [
    `AM62L / LPDDR4: ${inputSrj.obstacles.length} pads; ${inputSrj.connections.length} unrouted requests; ${inputSrj.layerCount} layers`,
    ...preflightResults.map(
      (result) =>
        `${result.label}: ${result.failed ? "rejected" : "admitted"}; output ${result.solved ? "available" : "unavailable"}`,
    ),
    ...(inputSrj.differentialPairs ?? []).map(
      (pair) =>
        `${pair.connectionNames.join(" / ")}: lengthTolerance ${String(pair.lengthTolerance)}`,
    ),
    ...preflightResults.flatMap((result) =>
      result.error ? [`${result.label}: ${result.error}`] : [],
    ),
  ]
  graphics.texts = labels.map((text, index) => ({
    x: inputSrj.bounds.minX,
    y: inputSrj.bounds.maxY + (labels.length - index) * 0.9,
    text,
    fontSize: 0.55,
    anchorSide: "center_left",
  }))
  return graphics
}
