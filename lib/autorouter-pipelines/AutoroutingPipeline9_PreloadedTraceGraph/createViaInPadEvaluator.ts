import { getRepairViaGeometry } from "@tscircuit/repair04"
import type { AnyCircuitElement, PcbVia } from "circuit-json"
import type { SimpleRouteJson, SimplifiedPcbTrace } from "lib/types"
import type { HighDensityRoute } from "lib/types/high-density-types"
import {
  createPcbPadElements,
  convertToCircuitJson,
} from "lib/utils/convertToCircuitJson"
import RBush from "rbush"
import {
  compileTraceClearanceObstacle,
  getTraceObstacleClearance,
  type IndexedObstacle,
} from "lib/utils/autorouting-drc/createTraceObstacleClearanceEvaluator"
import { createSrjWithBoardValidObstacleLayers } from "lib/utils/create-srj-with-board-valid-obstacle-layers"
import { getViaDimensions } from "lib/utils/getViaDimensions"
import { mapZToLayerName } from "lib/utils/mapZToLayerName"
import { canonicalizePipeline9HdRoutes } from "./canonicalizePipeline9HdRoutes"

type ViaInPadRoute = HighDensityRoute | SimplifiedPcbTrace

type Pad = Extract<
  AnyCircuitElement,
  { type: "pcb_smtpad" | "pcb_plated_hole" }
>

type ViaInPadEvaluator = (routes: readonly ViaInPadRoute[]) => boolean

const VIA_HOLE_OVERLAP_EPSILON = 1e-6

function getViaElements({
  routes,
  srj,
}: {
  routes: readonly ViaInPadRoute[]
  srj: SimpleRouteJson
}): PcbVia[] {
  const { holeDiameter } = getViaDimensions(srj)
  return routes.flatMap((route, routeIndex): PcbVia[] => {
    if ("type" in route) {
      // Manufacturing checks need via points, without unrelated copper or nets.
      const viaTrace = {
        ...route,
        route: route.route.filter((point) => point.route_type === "via"),
      }
      return convertToCircuitJson(
        { ...srj, obstacles: [], connections: [], traces: undefined },
        [viaTrace],
      ).filter((element): element is PcbVia => element.type === "pcb_via")
    }
    return getRepairViaGeometry(
      canonicalizePipeline9HdRoutes([route])[0]!,
      srj.layerCount,
    ).map((via, viaIndex): PcbVia => {
      let minZ = 0
      let maxZ = srj.layerCount - 1
      if (srj.allowBlindAndBuriedVias === true) {
        minZ = via.minZ
        maxZ = via.maxZ
      }
      return {
        type: "pcb_via",
        pcb_via_id: `repair_via_${routeIndex}_${viaIndex}`,
        x: via.x,
        y: via.y,
        hole_diameter: holeDiameter,
        outer_diameter: via.diameter,
        layers: Array.from({ length: maxZ - minZ + 1 }, (_, index) =>
          mapZToLayerName(minZ + index, srj.layerCount),
        ),
      }
    })
  })
}

/** Reject new drilled holes in pads; touching same-net copper is not via-in-pad. */
export function createViaInPadEvaluator({
  srj,
  previousRoutes,
}: {
  srj: SimpleRouteJson
  previousRoutes: readonly ViaInPadRoute[]
}): ViaInPadEvaluator {
  const padElements = createPcbPadElements(
    createSrjWithBoardValidObstacleLayers(srj),
  )
  const padIndex = new RBush<IndexedObstacle>()
  const pads = padElements.filter(
    (pad): pad is Pad =>
      pad.type === "pcb_smtpad" || pad.type === "pcb_plated_hole",
  )
  padIndex.load(pads.map(compileTraceClearanceObstacle))
  const existingDrills = new Set(
    getViaElements({ routes: previousRoutes, srj }).map((via) =>
      JSON.stringify([via.x, via.y, via.hole_diameter, via.layers]),
    ),
  )
  return (routes): boolean => {
    const newVias = getViaElements({ routes, srj }).filter(
      (via) =>
        !existingDrills.has(
          JSON.stringify([via.x, via.y, via.hole_diameter, via.layers]),
        ),
    )
    for (const via of newVias) {
      const radius = via.hole_diameter / 2
      const pads = padIndex.search({
        minX: via.x - radius,
        minY: via.y - radius,
        maxX: via.x + radius,
        maxY: via.y + radius,
      })
      for (const pad of pads) {
        if (!via.layers.some((layer) => pad.layers.includes(layer))) continue
        const clearance = getTraceObstacleClearance(
          via,
          via,
          via.hole_diameter,
          pad,
        )
        if (clearance.gap < -VIA_HOLE_OVERLAP_EPSILON) return true
      }
    }
    return false
  }
}
