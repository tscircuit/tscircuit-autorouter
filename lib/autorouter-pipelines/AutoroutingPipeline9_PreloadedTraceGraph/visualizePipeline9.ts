import type { GraphicsObject, Line } from "graphics-debug"
import type { SimpleRouteJson } from "lib/types"
import { combineVisualizations } from "lib/utils/combineVisualizations"
import { applyNetColorsToGraphicsObject } from "lib/utils/applyNetColorsToGraphicsObject"
import { createObstacleLabelFormatter } from "lib/utils/formatObstacleLabel"
import {
  getGraphicsLayerForConnectionPoint,
  getGraphicsLayerForObstacle,
} from "lib/utils/getGraphicsObjectLayer"
import { getPresuppliedTraceVisualization } from "lib/utils/getPresuppliedTraceVisualization"
import type { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "./AutoroutingPipelineSolver9_PreloadedTraceGraph"

function getProblemGraphics(srj: SimpleRouteJson): GraphicsObject {
  const { outline, bounds } = srj
  const lines: Line[] = []

  lines.push({
    points: [
      {
        x: bounds?.minX ?? -50,
        y: bounds?.minY ?? -50,
      },
      {
        x: bounds?.maxX ?? 50,
        y: bounds?.minY ?? -50,
      },
      {
        x: bounds?.maxX ?? 50,
        y: bounds?.maxY ?? 50,
      },
      {
        x: bounds?.minX ?? -50,
        y: bounds?.maxY ?? 50,
      },
      {
        x: bounds?.minX ?? -50,
        y: bounds?.minY ?? -50,
      },
    ],
    strokeColor: "rgba(255,0,0,0.25)",
  })

  if (outline && outline.length >= 2) {
    const outlinePoints = outline.map(({ x, y }) => ({ x, y }))

    outlinePoints.push({ ...outlinePoints[0]! })

    lines.push({
      points: outlinePoints,
      strokeColor: "rgba(0, 136, 255, 0.95)",
    })
  }

  const formatObstacleLabel = createObstacleLabelFormatter(srj)

  return {
    points: srj.connections.flatMap((c) =>
      c.pointsToConnect.map((p) => ({
        ...p,
        layer: getGraphicsLayerForConnectionPoint(p, srj.layerCount),
        label: `${c.name} ${p.pcb_port_id ?? ""}`,
      })),
    ),
    rects: (srj.obstacles ?? [])
      .filter((o) => !o.isCopperPour)
      .map((o) => ({
        ...o,
        fill: o.layers?.includes("top")
          ? "rgba(255,0,0,0.25)"
          : o.layers?.includes("bottom")
            ? "rgba(0,0,255,0.25)"
            : "rgba(255,0,0,0.25)",
        layer: getGraphicsLayerForObstacle(o, srj.layerCount),
        label: formatObstacleLabel(o),
      })),
    lines,
  }
}

export function visualizePipeline9(
  pipeline: AutoroutingPipelineSolver9_PreloadedTraceGraph,
): GraphicsObject {
  if (!pipeline.solved && pipeline.activeSubSolver)
    return pipeline.visualizeStage(pipeline.activeSubSolver)
  const problemGraphics = getProblemGraphics(pipeline.originalSrj)
  const preloadedTraces = getPresuppliedTraceVisualization({
    srj: pipeline.originalSrj,
    visualizationOptions: {
      traceColorMode: pipeline.visualizationTraceColorMode,
    },
  })
  const highDensity = pipeline.highDensityRouteSolver?.visualize()
  const stages = [
    combineVisualizations(problemGraphics, preloadedTraces),
    pipeline.preprocessSimpleRouteJsonSolver?.visualize(),
    pipeline.componentDetectionSolver?.visualize(),
    pipeline.componentTopologyGeneratorSolver?.visualize(),
    pipeline.escapeViaLocationSolver?.visualize(),
    pipeline.netToPointPairsSolver?.visualize(),
    pipeline.globalTopologyGeneratorSolver?.visualize(),
    pipeline.topologyMergingSolver?.visualize(),
    pipeline.nodeDimensionSubdivisionSolver?.visualize(),
    pipeline.nodeTargetMerger?.visualize(),
    pipeline.singleLayerNodeMerger?.visualize(),
    pipeline.strawSolver?.visualize(),
    pipeline.edgeSolver?.visualize(),
    pipeline.deadEndSolver?.visualize(),
    pipeline.availableSegmentPointSolver?.visualize(),
    pipeline.necessaryCrampedPortPointSolver?.visualize(),
    pipeline.portPointPathingSolver?.visualize(),
    pipeline.multiSectionPortPointOptimizer?.visualize(),
    pipeline.uniformPortDistributionSolver?.visualize(),
    highDensity && combineVisualizations(problemGraphics, highDensity),
    pipeline.highDensityForceImproveSolver?.visualize(),
    pipeline.highDensityRepairSolver?.visualize(),
    pipeline.highDensityStitchSolver?.visualize(),
    pipeline.traceSimplificationSolver?.visualize(),
    pipeline.mutatedPreloadedTraceSimplificationSolver?.visualize(),
    pipeline.traceWidthSolver?.visualize(),
    pipeline.globalDrcForceImproveSolver?.visualize(),
    pipeline.pipeline9JointDrcRepairSolver?.visualize(),
    pipeline.lengthMatchingPostProcessingSolver?.visualize(),
    pipeline.powerTraceExpansionSolver?.visualize(),
    pipeline.solved
      ? combineVisualizations(
          { lines: problemGraphics.lines },
          preloadedTraces,
          pipeline.visualizeFinalOutput(),
        )
      : undefined,
  ].filter((graphics): graphics is GraphicsObject => Boolean(graphics))
  const graphics = combineVisualizations(...stages)
  return pipeline.visualizationTraceColorMode === "net"
    ? applyNetColorsToGraphicsObject(graphics, pipeline.colorMap)
    : graphics
}
