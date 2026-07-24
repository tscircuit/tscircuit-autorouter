import type { GraphicsObject } from "graphics-debug"
import type { Obstacle } from "lib/types"
import type { HighDensityRoute } from "lib/types/high-density-types"
import { getJumpersGraphics } from "lib/utils/getJumperGraphics"

export type SameNetViaMerge = {
  connectionName: string
  from: { x: number; y: number }
  to: { x: number; y: number }
}

type SameNetViaMergerVisualizationInput = {
  inputHdRoutes: HighDensityRoute[]
  mergedViaHdRoutes: HighDensityRoute[]
  obstacles: Obstacle[]
  colorMap: Record<string, string>
  viaMerges: SameNetViaMerge[]
}

const addObstacleGraphics = ({
  graphics,
  obstacles,
}: {
  graphics: GraphicsObject
  obstacles: Obstacle[]
}): void => {
  for (const obstacle of obstacles) {
    if (!obstacle.__zLayers) {
      throw new Error(
        "SameNetViaMergerSolver found obstacle without zLayers while visualizing",
      )
    }

    const isOnLayer0 = obstacle.__zLayers.includes(0)
    const isOnLayer1 = obstacle.__zLayers.includes(1)
    const fill = isOnLayer0
      ? isOnLayer1
        ? "rgba(128, 0, 128, 0.12)"
        : "rgba(255, 0, 0, 0.12)"
      : isOnLayer1
        ? "rgba(0, 0, 255, 0.12)"
        : "rgba(128, 128, 128, 0.12)"

    for (const step of [1, 2, 3]) {
      graphics.rects!.push({
        center: obstacle.center,
        width: obstacle.width,
        height: obstacle.height,
        fill,
        stroke: "rgba(128, 128, 128, 0.35)",
        label: `Obstacle (Z: ${obstacle.__zLayers.join(", ")})`,
        step,
      })
    }
  }
}

const addRouteGraphics = ({
  graphics,
  routes,
  colorMap,
  step,
  labelPrefix,
  opacity,
  viaFill,
}: {
  graphics: GraphicsObject
  routes: HighDensityRoute[]
  colorMap: Record<string, string>
  step: number
  labelPrefix: string
  opacity: number
  viaFill: string
}): void => {
  for (const route of routes) {
    const color = colorMap[route.connectionName]
    if (!color) {
      throw new Error(
        `SameNetViaMergerSolver could not find color for route "${route.connectionName}"`,
      )
    }

    for (
      let routePointIndex = 0;
      routePointIndex < route.route.length - 1;
      routePointIndex++
    ) {
      const start = route.route[routePointIndex]!
      const end = route.route[routePointIndex + 1]!
      if (start.z !== end.z) continue

      graphics.lines!.push({
        points: [
          { x: start.x, y: start.y },
          { x: end.x, y: end.y },
        ],
        strokeColor:
          start.z === 0
            ? `rgba(255, 0, 0, ${opacity})`
            : `rgba(0, 0, 255, ${opacity})`,
        strokeWidth: route.traceThickness,
        label: `${labelPrefix}: ${route.connectionName} (z=${start.z})`,
        step,
      })
    }

    for (const via of route.vias) {
      graphics.circles!.push({
        center: via,
        radius: route.viaDiameter / 2,
        fill: viaFill,
        label: `${labelPrefix}: ${route.connectionName} via`,
        step,
      })
    }

    const jumperGraphics = getJumpersGraphics(route.jumpers ?? [], {
      color,
      label: `${labelPrefix}: ${route.connectionName}`,
    })
    graphics.rects!.push(
      ...(jumperGraphics.rects ?? []).map((rect) => ({ ...rect, step })),
    )
    graphics.lines!.push(
      ...(jumperGraphics.lines ?? []).map((line) => ({ ...line, step })),
    )
  }
}

export const visualizeSameNetViaMerger = ({
  inputHdRoutes,
  mergedViaHdRoutes,
  obstacles,
  colorMap,
  viaMerges,
}: SameNetViaMergerVisualizationInput): GraphicsObject => {
  const graphics: GraphicsObject = {
    lines: [],
    points: [],
    rects: [],
    circles: [],
    coordinateSystem: "cartesian",
    title: "Same Net Via Merger Solver",
  }

  addObstacleGraphics({ graphics, obstacles })
  addRouteGraphics({
    graphics,
    routes: inputHdRoutes,
    colorMap,
    step: 1,
    labelPrefix: "Input",
    opacity: 0.35,
    viaFill: "rgba(217, 70, 239, 0.45)",
  })
  addRouteGraphics({
    graphics,
    routes: mergedViaHdRoutes,
    colorMap,
    step: 2,
    labelPrefix: "Merged output",
    opacity: 0.55,
    viaFill: "rgba(22, 163, 74, 0.6)",
  })
  addRouteGraphics({
    graphics,
    routes: mergedViaHdRoutes,
    colorMap,
    step: 3,
    labelPrefix: "Merge movement context",
    opacity: 0.18,
    viaFill: "rgba(22, 163, 74, 0.25)",
  })

  for (const viaMerge of viaMerges) {
    graphics.lines!.push({
      points: [viaMerge.from, viaMerge.to],
      strokeColor: "#f97316",
      strokeWidth: 0.03,
      strokeDash: [0.08, 0.05],
      label: "Via merge movement",
      step: 3,
    })
    graphics.circles!.push(
      {
        center: viaMerge.from,
        radius: 0.22,
        fill: "rgba(220, 38, 38, 0.7)",
        label: "Removed via location",
        step: 3,
      },
      {
        center: viaMerge.to,
        radius: 0.1,
        fill: "rgba(22, 163, 74, 0.75)",
        label: "Retained via location",
        step: 3,
      },
    )
  }

  return graphics
}
