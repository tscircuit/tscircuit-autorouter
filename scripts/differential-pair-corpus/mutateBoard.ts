import {
  applyToPoint,
  compose,
  rotateDEG,
  scale,
  translate,
} from "transformation-matrix"
import type { SimpleRouteJson } from "../../lib/types"

type BoardMutation = {
  scaleFactor: number
  quarterTurns: number
  reflected: boolean
  translateX: number
  translateY: number
}

/** Rigid orientation plus uniform scaling preserves existing pad ownership and clearance. */
export function mutateBoard(
  source: SimpleRouteJson,
  mutation: BoardMutation,
): SimpleRouteJson {
  if (
    (source.jumpers?.length ?? 0) > 0 ||
    source.obstacles.some(
      (obstacle) =>
        obstacle.ccwRotationDegrees !== undefined &&
        obstacle.ccwRotationDegrees % 180 !== 0,
    )
  )
    throw new Error(
      "Mutation requires axis-aligned obstacles and no jumper footprints",
    )
  const srj = structuredClone(source)
  const { scaleFactor, quarterTurns, reflected, translateX, translateY } =
    mutation
  const matrix = compose(
    translate(translateX, translateY),
    rotateDEG(quarterTurns * 90),
    scale(reflected ? -scaleFactor : scaleFactor, scaleFactor),
  )
  const corners = [
    { x: source.bounds.minX, y: source.bounds.minY },
    { x: source.bounds.maxX, y: source.bounds.maxY },
    { x: source.bounds.minX, y: source.bounds.maxY },
    { x: source.bounds.maxX, y: source.bounds.minY },
  ].map((point) => applyToPoint(matrix, point))
  srj.bounds = {
    minX: Math.min(...corners.map((point) => point.x)),
    maxX: Math.max(...corners.map((point) => point.x)),
    minY: Math.min(...corners.map((point) => point.y)),
    maxY: Math.max(...corners.map((point) => point.y)),
  }
  for (const obstacle of srj.obstacles) {
    obstacle.center = applyToPoint(matrix, obstacle.center)
    if (obstacle.ccwRotationDegrees !== undefined)
      obstacle.ccwRotationDegrees = 0
    const width = obstacle.width * scaleFactor
    const height = obstacle.height * scaleFactor
    obstacle.width = quarterTurns % 2 ? height : width
    obstacle.height = quarterTurns % 2 ? width : height
  }
  for (const connection of srj.connections) {
    connection.pointsToConnect = connection.pointsToConnect.map((point) => ({
      ...point,
      ...applyToPoint(matrix, point),
      ...("terminalVia" in point && point.terminalVia
        ? {
            terminalVia: {
              ...point.terminalVia,
              ...(point.terminalVia.viaDiameter === undefined
                ? {}
                : {
                    viaDiameter: point.terminalVia.viaDiameter * scaleFactor,
                  }),
            },
          }
        : {}),
    }))
    if (connection.nominalTraceWidth !== undefined)
      connection.nominalTraceWidth *= scaleFactor
    if (connection.width !== undefined) connection.width *= scaleFactor
  }
  for (const trace of srj.traces ?? []) {
    for (const point of trace.route) {
      if ("x" in point && "y" in point)
        Object.assign(point, applyToPoint(matrix, point))
      if ("start" in point) point.start = applyToPoint(matrix, point.start)
      if ("end" in point) point.end = applyToPoint(matrix, point.end)
      if ("width" in point) point.width *= scaleFactor
      if ("via_hole_diameter" in point && point.via_hole_diameter !== undefined)
        point.via_hole_diameter *= scaleFactor
      if ("via_diameter" in point && point.via_diameter !== undefined)
        point.via_diameter *= scaleFactor
    }
  }
  for (const pair of srj.differentialPairs ?? []) {
    pair.lengthTolerance *= scaleFactor
    if (pair.traceGap !== undefined) pair.traceGap *= scaleFactor
    if (pair.maxUncoupledLength !== undefined)
      pair.maxUncoupledLength *= scaleFactor
  }
  for (const bus of srj.buses ?? []) {
    if (bus.maxLengthSkew !== undefined) bus.maxLengthSkew *= scaleFactor
    if (bus.traceWidth !== undefined) bus.traceWidth *= scaleFactor
    for (const target of Object.values(bus.connectionExitTargets ?? {})) {
      Object.assign(target, applyToPoint(matrix, target))
    }
  }
  if (srj.outline)
    srj.outline = srj.outline.map((point) => applyToPoint(matrix, point))
  const dimensions = [
    "minTraceWidth",
    "nominalTraceWidth",
    "minViaDiameter",
    "minViaHoleDiameter",
    "minViaPadDiameter",
    "min_via_hole_diameter",
    "min_via_pad_diameter",
    "defaultObstacleMargin",
    "minTraceToPadEdgeClearance",
    "minBoardEdgeClearance",
    "minViaEdgeToPadEdgeClearance",
    "minViaHoleEdgeToViaHoleEdgeClearance",
    "minPlatedHoleDrillEdgeToDrillEdgeClearance",
    "minPadEdgeToPadEdgeClearance",
  ] as const
  for (const dimension of dimensions) {
    if (srj[dimension] !== undefined) srj[dimension] *= scaleFactor
  }
  return srj
}
