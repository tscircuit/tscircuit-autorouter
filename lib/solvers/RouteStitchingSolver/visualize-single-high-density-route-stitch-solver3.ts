import type { Point3 } from "@tscircuit/math-utils"
import type { GraphicsObject } from "graphics-debug"
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
      strokeDash: "4 3",
      strokeWidth: Math.max(hdRoute.traceThickness * 1.75, 0.2),
      label: "Requires downstream DRC repair",
      step: 3,
    })
  }
}

export const visualizeSingleHighDensityRouteStitchSolver3 = (
  stitchState: StitchVisualizationInput,
): GraphicsObject => {
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
        x: stitchState.end.x,
        y: stitchState.end.y,
        color: "red",
        label: "Connection end",
        step: 1,
      },
    ],
    lines: [],
    circles: [],
    rects: [],
    title: "Single High Density Route Stitch Solver 3",
  }

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

  if (
    stitchState.stitchRepairPolicy === "allow_drc_repair" &&
    stitchState.isValidStitchSegment
  ) {
    for (const inputHdRoute of stitchState.inputHdRoutes) {
      addRouteToGraphics({
        graphics,
        hdRoute: inputHdRoute,
        color: safeTransparentize("#64748b", 0.35),
        step: 3,
        label: "Existing copper around the repair handoff",
      })
    }
    addRepairRequiredSegments({
      graphics,
      hdRoute: mergedHdRoute,
      inputHdRoutes: stitchState.inputHdRoutes,
      isValidStitchSegment: stitchState.isValidStitchSegment,
    })
  }

  return graphics
}
