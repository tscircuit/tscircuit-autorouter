import type { GraphicsObject } from "graphics-debug"
import type { SimpleRouteJson, SimplifiedPcbTrace } from "lib/types/srj-types"
import { convertSrjToGraphicsObject } from "lib/utils/convertSrjToGraphicsObject"
import { getGraphicsSvgFrames } from "./solver-svg-frames"

type PathLengthsParams = {
  srj: SimpleRouteJson
  traces: SimplifiedPcbTrace[]
}

type PathLengths = {
  fixed: number[]
  carrier: number[]
  full: number[]
  skew: number
  limit: number
}

type SourceFrameParams = PathLengthsParams & {
  status: string
  checkerErrors: number
  diagnostic?: string
}

type MatchingResult =
  | {
      solved: true
      carriers: SimplifiedPcbTrace[]
      checkerErrors: number
    }
  | { solved: false; error: Error }

type StageSvgParams = {
  srj: SimpleRouteJson
  originalCarriers: SimplifiedPcbTrace[]
  originalCheckerErrors: number
  result: MatchingResult
}

const getPlanarLength = (trace: SimplifiedPcbTrace): number => {
  const points = trace.route.flatMap((point) =>
    "x" in point ? [{ x: point.x, y: point.y }] : [point.start, point.end],
  )
  return points.slice(1).reduce((length, point, index) => {
    const previous = points[index]!
    return length + Math.hypot(point.x - previous.x, point.y - previous.y)
  }, 0)
}

export const getOriginalA64PathLengths = ({
  srj,
  traces,
}: PathLengthsParams): PathLengths => {
  const bus = srj.buses![0]!
  const full = bus.connectionNames.map((name) =>
    traces
      .filter((trace) => trace.connection_name === name)
      .reduce((length, trace) => length + getPlanarLength(trace), 0),
  )
  const fixed = bus.connectionNames.map((name) =>
    srj
      .traces!.filter((trace) => trace.connection_name === name)
      .reduce((length, trace) => length + getPlanarLength(trace), 0),
  )
  return {
    fixed,
    carrier: full.map((length, index) => length - fixed[index]!),
    full,
    skew: Math.max(...full) - Math.min(...full),
    limit: bus.maxLengthSkew!,
  }
}

const getSourceFrame = ({
  srj,
  traces,
  status,
  checkerErrors,
  diagnostic,
}: SourceFrameParams): GraphicsObject => {
  const packagePads = srj.obstacles.filter(
    (obstacle) =>
      obstacle.componentId === "U1" || obstacle.componentId === "U2",
  )
  const minX =
    Math.min(...packagePads.map((pad) => pad.center.x - pad.width / 2)) - 1
  const maxX =
    Math.max(...packagePads.map((pad) => pad.center.x + pad.width / 2)) + 1
  const minY =
    Math.min(...packagePads.map((pad) => pad.center.y - pad.height / 2)) - 1
  const maxY =
    Math.max(...packagePads.map((pad) => pad.center.y + pad.height / 2)) + 1
  // Crop only the drawing. Matching and DRC still receive the full board.
  const graphics: GraphicsObject = convertSrjToGraphicsObject(
    {
      ...srj,
      traces,
      obstacles: srj.obstacles.filter(
        (pad) =>
          pad.center.x + pad.width / 2 >= minX &&
          pad.center.x - pad.width / 2 <= maxX &&
          pad.center.y + pad.height / 2 >= minY &&
          pad.center.y - pad.height / 2 <= maxY,
      ),
    },
    { traceColorMode: "net" },
  )
  graphics.points = []
  const lengths = getOriginalA64PathLengths({ srj, traces })
  const labels = [
    "OLIMEX A64-OLinuXino rev H: original CPU-to-DDR source copper",
    status,
    `DQ1/DQ3 retained escapes: ${lengths.fixed.map((n) => n.toFixed(6)).join(" / ")} mm`,
    `DQ1/DQ3 mutable carriers: ${lengths.carrier.map((n) => n.toFixed(6)).join(" / ")} mm`,
    `DQ1/DQ3 full paths: ${lengths.full.map((n) => n.toFixed(6)).join(" / ")} mm`,
    `Full-path skew: ${lengths.skew.toFixed(6)} mm; analyst limit: ${lengths.limit.toFixed(3)} mm`,
    `Source-clearance checker: ${checkerErrors} findings; all ${srj.obstacles.length} pad/hole obstacles evaluated`,
    "11 original byte routes; 22 retained CPU/RAM escapes; 6 native layers",
    diagnostic ?? "Planar source-based stage; no electrical DDR timing claim",
  ]
  graphics.texts = labels.map((text, index) => ({
    x: minX,
    y: maxY + 7 - index * 0.75,
    text,
    fontSize: index === 0 ? 0.6 : 0.48,
    anchorSide: "center_left",
    color: index === 1 && diagnostic ? "red" : "black",
  }))
  return graphics
}

export const getOriginalA64LengthMatchingSvg = ({
  srj,
  originalCarriers,
  originalCheckerErrors,
  result,
}: StageSvgParams): string => {
  const originalTraces = [...srj.traces!, ...originalCarriers]
  const resultFrame = result.solved
    ? getSourceFrame({
        srj,
        traces: [...srj.traces!, ...result.carriers],
        status: "Matching completed; inspect full-path measurements",
        checkerErrors: result.checkerErrors,
      })
    : getSourceFrame({
        srj,
        traces: originalTraces,
        status: "Matching failed: original source shown; no accepted output",
        checkerErrors: originalCheckerErrors,
        diagnostic: result.error.message.replace(
          "LengthMatchingSolver: linear regression ",
          "",
        ),
      })
  return getGraphicsSvgFrames({
    frames: [
      {
        name: "Original manufacturer source",
        step: "start",
        graphics: getSourceFrame({
          srj,
          traces: originalTraces,
          status: "Already-matched DQ1/DQ3 subset of the original byte",
          checkerErrors: originalCheckerErrors,
        }),
      },
      {
        name: result.solved ? "Matching completed" : "Matching failed",
        step: "end",
        graphics: resultFrame,
      },
    ],
    columns: 2,
    backgroundColor: "white",
  })
}
