import type { AnyCircuitElement } from "circuit-json"
import { convertCircuitJsonToPcbSvg } from "circuit-to-svg"
import { convertToCircuitJson } from "lib/testing/utils/convertToCircuitJson"
import type { SimpleRouteJson } from "lib/types"
import type { HighDensityRoute } from "lib/types/high-density-types"

type Ddr3PipelinePcbSvgInput = {
  originalSrj: SimpleRouteJson
  fannedOutSrj: SimpleRouteJson
  autorouterSrj: SimpleRouteJson
  autoroutedRoutes: HighDensityRoute[]
  focusBounds?: SimpleRouteJson["bounds"]
}

type PhysicalComponentMetadata = {
  ddr3?: {
    componentId?: string
    bodyWidth?: number
    bodyHeight?: number
  }
  controller?: {
    componentId?: string
    bodyWidth?: number
    bodyHeight?: number
  }
}

const safeId = (value: string) => value.replace(/[^a-zA-Z0-9_-]/g, "_")

/**
 * Render the actual DDR3 fixture pads, fanout copper, and Pipeline 9 copper.
 * Every visible PCB element is derived from the reference SRJ or solver output.
 */
export function getDdr3PipelinePcbSvg({
  originalSrj,
  fannedOutSrj,
  autorouterSrj,
  autoroutedRoutes,
  focusBounds,
}: Ddr3PipelinePcbSvgInput): string {
  const preloadedElements = convertToCircuitJson(
    fannedOutSrj,
    fannedOutSrj.traces ?? [],
    { originalSrj: fannedOutSrj, includeOriginalConnections: true },
  ).filter((element) => element.type !== "pcb_smtpad")
  const autoroutedElements = convertToCircuitJson(
    autorouterSrj,
    autoroutedRoutes,
    { originalSrj: fannedOutSrj, includeOriginalConnections: true },
  ).filter(
    (element) => element.type === "pcb_trace" || element.type === "pcb_via",
  )
  const metadata = (
    originalSrj as SimpleRouteJson & {
      metadata?: PhysicalComponentMetadata
    }
  ).metadata
  const physicalMetadataByComponentId = new Map(
    [metadata?.ddr3, metadata?.controller]
      .filter(
        (
          component,
        ): component is NonNullable<PhysicalComponentMetadata["ddr3"]> =>
          typeof component?.componentId === "string",
      )
      .map((component) => [component.componentId!, component]),
  )
  const packageElements: AnyCircuitElement[] = []
  const padElements: AnyCircuitElement[] = []
  const obstaclesByComponent = new Map<string, SimpleRouteJson["obstacles"]>()

  for (const obstacle of originalSrj.obstacles) {
    if (!obstacle.componentId) continue
    if (
      focusBounds &&
      (obstacle.center.x < focusBounds.minX ||
        obstacle.center.x > focusBounds.maxX ||
        obstacle.center.y < focusBounds.minY ||
        obstacle.center.y > focusBounds.maxY)
    ) {
      continue
    }
    const componentObstacles =
      obstaclesByComponent.get(obstacle.componentId) ?? []
    componentObstacles.push(obstacle)
    obstaclesByComponent.set(obstacle.componentId, componentObstacles)
    padElements.push({
      type: "pcb_smtpad",
      pcb_smtpad_id: safeId(obstacle.obstacleId ?? `pad_${padElements.length}`),
      shape: "circle",
      x: obstacle.center.x,
      y: obstacle.center.y,
      radius: Math.min(obstacle.width, obstacle.height) / 2,
      layer: "top",
    })
  }

  for (const [componentId, obstacles] of obstaclesByComponent) {
    if (focusBounds) continue
    const minX = Math.min(
      ...obstacles.map((obstacle) => obstacle.center.x - obstacle.width / 2),
    )
    const maxX = Math.max(
      ...obstacles.map((obstacle) => obstacle.center.x + obstacle.width / 2),
    )
    const minY = Math.min(
      ...obstacles.map((obstacle) => obstacle.center.y - obstacle.height / 2),
    )
    const maxY = Math.max(
      ...obstacles.map((obstacle) => obstacle.center.y + obstacle.height / 2),
    )
    const center = { x: (minX + maxX) / 2, y: (minY + maxY) / 2 }
    const physicalMetadata = physicalMetadataByComponentId.get(componentId)
    const width = physicalMetadata?.bodyWidth ?? maxX - minX + 0.5
    const height = physicalMetadata?.bodyHeight ?? maxY - minY + 0.5
    const safeComponentId = safeId(componentId)
    packageElements.push(
      {
        type: "source_component",
        source_component_id: `source_component_${safeComponentId}`,
        name: componentId,
        ftype: "simple_chip",
      },
      {
        type: "pcb_component",
        pcb_component_id: `pcb_component_${safeComponentId}`,
        source_component_id: `source_component_${safeComponentId}`,
        center,
        width,
        height,
        rotation: 0,
        layer: "top",
        obstructs_within_bounds: false,
      },
      {
        type: "pcb_silkscreen_rect",
        pcb_silkscreen_rect_id: `silkscreen_${safeComponentId}`,
        pcb_component_id: `pcb_component_${safeComponentId}`,
        center,
        width,
        height,
        stroke_width: 0.12,
        layer: "top",
      },
    )
  }

  const bounds = focusBounds ?? originalSrj.bounds
  const board: AnyCircuitElement = {
    type: "pcb_board",
    pcb_board_id: "pcb_board_ddr3_pipeline_repro",
    center: {
      x: (bounds.minX + bounds.maxX) / 2,
      y: (bounds.minY + bounds.maxY) / 2,
    },
    width: bounds.maxX - bounds.minX,
    height: bounds.maxY - bounds.minY,
    thickness: 1.6,
    num_layers: originalSrj.layerCount,
    material: "fr4",
  }

  return convertCircuitJsonToPcbSvg(
    [
      board,
      ...packageElements,
      ...padElements,
      ...preloadedElements,
      ...autoroutedElements,
    ],
    {
      width: 1200,
      height: 800,
      matchBoardAspectRatio: true,
      backgroundColor: "#0d1218",
      drawPaddingOutsideBoard: true,
      renderSolderMask: true,
      shouldDrawRatsNest: false,
      includeVersion: true,
      colorOverrides: {
        boardOutline: "#68a68b",
        soldermask: { top: "#15352b" },
        silkscreen: { top: "#f2eee5" },
        copper: { top: "#e9a23b" },
      },
    },
  )
}
