import type { Point3 } from "@tscircuit/math-utils"
import type { GraphicsObject } from "graphics-debug"
import type { Obstacle } from "lib/types"
import type { HighDensityIntraNodeRoute } from "lib/types/high-density-types"
import { getJumpersGraphics } from "lib/utils/getJumperGraphics"
import { safeTransparentize } from "../colors"
import type {
  IsValidStitchSegment,
  StitchSegmentRequest,
} from "./SingleHighDensityRouteStitchSolver3"
import type { StitchRepairPolicy } from "./routeStitchingEndpointHelpers"

type StitchTerminal = Point3 & { pcb_port_id?: string }
type StitchSegmentKey = string

export type StitchVisualizationInput = {
  inputHdRoutes: HighDensityIntraNodeRoute[]
  mergedHdRoute?: HighDensityIntraNodeRoute
  remainingHdRoutes: HighDensityIntraNodeRoute[]
  start: StitchTerminal
  end: StitchTerminal
  colorMap: Record<string, string>
  obstacles: Obstacle[]
  stitchRepairPolicy: StitchRepairPolicy
  isValidStitchSegment?: IsValidStitchSegment
}

const getSegmentKey = (start: Point3, end: Point3): StitchSegmentKey => {
  const startKey = `${start.x.toFixed(6)},${start.y.toFixed(6)},${start.z}`
  const endKey = `${end.x.toFixed(6)},${end.y.toFixed(6)},${end.z}`
  return startKey.localeCompare(endKey) <= 0
    ? `${startKey}:${endKey}`
    : `${endKey}:${startKey}`
}

const getInputSegmentKeys = (
  inputHdRoutes: HighDensityIntraNodeRoute[],
): Set<StitchSegmentKey> => {
  const inputSegmentKeys = new Set<StitchSegmentKey>()
  for (const inputHdRoute of inputHdRoutes) {
    for (
      let pointIndex = 0;
      pointIndex < inputHdRoute.route.length - 1;
      pointIndex++
    ) {
      inputSegmentKeys.add(
        getSegmentKey(
          inputHdRoute.route[pointIndex]!,
          inputHdRoute.route[pointIndex + 1]!,
        ),
      )
    }
  }
  return inputSegmentKeys
}

const addObstacleGraphics = ({
  graphics,
  obstacles,
  steps,
}: {
  graphics: GraphicsObject
  obstacles: Obstacle[]
  steps: number[]
}): void => {
  for (const obstacle of obstacles) {
    for (const step of steps) {
      graphics.rects!.push({
        center: obstacle.center,
        width: obstacle.width,
        height: obstacle.height,
        ccwRotationDegrees: obstacle.ccwRotationDegrees,
        fill: "rgba(100, 116, 139, 0.18)",
        stroke: "#64748b",
        label: obstacle.obstacleId
          ? `Blocking obstacle: ${obstacle.obstacleId}`
          : "Blocking obstacle",
        step,
      })
    }
  }
}

const addRouteToGraphics = ({
  graphics,
  hdRoute,
  color,
  step,
  label,
}: {
  graphics: GraphicsObject
  hdRoute: HighDensityIntraNodeRoute
  color: string
  step: number
  label: string
}): void => {
  for (
    let pointIndex = 0;
    pointIndex < hdRoute.route.length - 1;
    pointIndex++
  ) {
    const start = hdRoute.route[pointIndex]!
    const end = hdRoute.route[pointIndex + 1]!
    graphics.lines!.push({
      points: [
        { x: start.x, y: start.y },
        { x: end.x, y: end.y },
      ],
      strokeColor: start.z === 0 ? color : safeTransparentize(color, 0.45),
      strokeDash: start.z === end.z && start.z !== 0 ? [0.1, 0.1] : undefined,
      strokeWidth: hdRoute.traceThickness,
      label,
      step,
    })
  }

  for (const point of hdRoute.route) {
    graphics.points!.push({
      x: point.x,
      y: point.y,
      color: point.z === 0 ? color : safeTransparentize(color, 0.45),
      step,
    })
  }

  for (const via of hdRoute.vias) {
    graphics.circles!.push({
      center: { x: via.x, y: via.y },
      radius: hdRoute.viaDiameter / 2,
      fill: color,
      label: `${label} via`,
      step,
    })
  }

  const jumperGraphics = getJumpersGraphics(hdRoute.jumpers ?? [], {
    color,
    label,
  })
  graphics.rects!.push(
    ...(jumperGraphics.rects ?? []).map((rect) => ({ ...rect, step })),
  )
  graphics.lines!.push(
    ...(jumperGraphics.lines ?? []).map((line) => ({ ...line, step })),
  )
}

const addNewStitchSegments = ({
  graphics,
  hdRoute,
  inputHdRoutes,
  isValidStitchSegment,
}: {
  graphics: GraphicsObject
  hdRoute: HighDensityIntraNodeRoute
  inputHdRoutes: HighDensityIntraNodeRoute[]
  isValidStitchSegment?: IsValidStitchSegment
}): void => {
  const inputSegmentKeys = getInputSegmentKeys(inputHdRoutes)
  for (
    let pointIndex = 0;
    pointIndex < hdRoute.route.length - 1;
    pointIndex++
  ) {
    const start = hdRoute.route[pointIndex]!
    const end = hdRoute.route[pointIndex + 1]!
    if (start.z !== end.z) continue
    if (inputSegmentKeys.has(getSegmentKey(start, end))) continue

    const isValidated =
      !isValidStitchSegment ||
      isValidStitchSegment({
        connectionName: hdRoute.connectionName,
        start,
        end,
        traceThickness: hdRoute.traceThickness,
      })
    graphics.lines!.push({
      points: [
        { x: start.x, y: start.y },
        { x: end.x, y: end.y },
      ],
      strokeColor: isValidated ? "#f97316" : "#dc2626",
      strokeDash: isValidated
        ? undefined
        : [hdRoute.traceThickness, hdRoute.traceThickness * 0.6],
      strokeWidth: hdRoute.traceThickness,
      label: isValidated
        ? "Validated stitch segment"
        : "Provisional stitch segment",
      step: 2,
    })
  }
}

const addRepairRequiredSegments = ({
  graphics,
  hdRoute,
  inputHdRoutes,
  isValidStitchSegment,
}: {
  graphics: GraphicsObject
  hdRoute: HighDensityIntraNodeRoute
  inputHdRoutes: HighDensityIntraNodeRoute[]
  isValidStitchSegment: IsValidStitchSegment
}): void => {
  const inputSegmentKeys = getInputSegmentKeys(inputHdRoutes)

  for (
    let pointIndex = 0;
    pointIndex < hdRoute.route.length - 1;
    pointIndex++
  ) {
    const start = hdRoute.route[pointIndex]!
    const end = hdRoute.route[pointIndex + 1]!
    if (start.z !== end.z) continue
    if (inputSegmentKeys.has(getSegmentKey(start, end))) continue

    const request: StitchSegmentRequest = {
      connectionName: hdRoute.connectionName,
      start,
      end,
      traceThickness: hdRoute.traceThickness,
    }
    if (isValidStitchSegment(request)) continue

    graphics.lines!.push({
      points: [
        { x: start.x, y: start.y },
        { x: end.x, y: end.y },
      ],
      strokeColor: "#dc2626",
      strokeDash: [hdRoute.traceThickness, hdRoute.traceThickness * 0.6],
      strokeWidth: hdRoute.traceThickness,
      label: "Requires downstream DRC repair",
      step: 3,
    })
  }
}

export const visualizeSingleHighDensityRouteStitchSolver3 = (
  stitchState: StitchVisualizationInput,
): GraphicsObject => {
  const hasRepairHandoffStep =
    stitchState.stitchRepairPolicy === "allow_drc_repair" &&
    Boolean(stitchState.isValidStitchSegment)
  const graphics: GraphicsObject = {
    points: [
      {
        x: stitchState.start.x,
        y: stitchState.start.y,
        color: "green",
        label: "Connection start",
        step: 1,
      },
      {
        x: stitchState.start.x,
        y: stitchState.start.y,
        color: "green",
        label: "Connection start",
        step: 2,
      },
      {
        x: stitchState.end.x,
        y: stitchState.end.y,
        color: "red",
        label: "Connection end",
        step: 1,
      },
      {
        x: stitchState.end.x,
        y: stitchState.end.y,
        color: "red",
        label: "Connection end",
        step: 2,
      },
    ],
    lines: [],
    circles: [],
    rects: [],
    title: "Single High Density Route Stitch Solver 3",
  }
  addObstacleGraphics({
    graphics,
    obstacles: stitchState.obstacles,
    steps: hasRepairHandoffStep ? [1, 2, 3] : [1, 2],
  })

  const inputRoutes =
    stitchState.inputHdRoutes.length > 0
      ? stitchState.inputHdRoutes
      : stitchState.remainingHdRoutes
  for (const hdRoute of inputRoutes) {
    addRouteToGraphics({
      graphics,
      hdRoute,
      color: safeTransparentize(
        stitchState.colorMap[hdRoute.connectionName] ?? "orange",
        0.25,
      ),
      step: 1,
      label: `Input fragment: ${hdRoute.connectionName}`,
    })
  }

  if (!stitchState.mergedHdRoute) return graphics
  const mergedHdRoute = stitchState.mergedHdRoute
  addRouteToGraphics({
    graphics,
    hdRoute: mergedHdRoute,
    color: stitchState.colorMap[mergedHdRoute.connectionName] ?? "green",
    step: 2,
    label: `Stitched output: ${mergedHdRoute.connectionName}`,
  })
  addNewStitchSegments({
    graphics,
    hdRoute: mergedHdRoute,
    inputHdRoutes: stitchState.inputHdRoutes,
    isValidStitchSegment: stitchState.isValidStitchSegment,
  })

  if (hasRepairHandoffStep && stitchState.isValidStitchSegment) {
    graphics.points!.push(
      {
        x: stitchState.start.x,
        y: stitchState.start.y,
        color: "green",
        label: "Connection start",
        step: 3,
      },
      {
        x: stitchState.end.x,
        y: stitchState.end.y,
        color: "red",
        label: "Connection end",
        step: 3,
      },
    )
    for (const inputHdRoute of stitchState.inputHdRoutes) {
      addRouteToGraphics({
        graphics,
        hdRoute: inputHdRoute,
        color: safeTransparentize("#64748b", 0.35),
        step: 3,
        label: "Existing copper around the repair handoff",
      })
    }
    addRouteToGraphics({
      graphics,
      hdRoute: mergedHdRoute,
      color: safeTransparentize("#16a34a", 0.3),
      step: 3,
      label: `Repair handoff output: ${mergedHdRoute.connectionName}`,
    })
    addRepairRequiredSegments({
      graphics,
      hdRoute: mergedHdRoute,
      inputHdRoutes: stitchState.inputHdRoutes,
      isValidStitchSegment: stitchState.isValidStitchSegment,
    })
  }

  return graphics
}
