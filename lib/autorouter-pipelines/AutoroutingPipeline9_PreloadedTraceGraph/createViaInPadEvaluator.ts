import { getRepairViaGeometry } from "@tscircuit/repair04"
import type { PcbVia } from "circuit-json"
import type { SimpleRouteJson, SimplifiedPcbTrace } from "lib/types"
import type { HighDensityRoute } from "lib/types/high-density-types"
import {
  createPcbPadElements,
  convertToCircuitJson,
} from "lib/utils/convertToCircuitJson"
import { createViaInPadDrcEvaluator } from "lib/utils/autorouting-drc/createViaInPadDrcEvaluator"
import { createSrjWithBoardValidObstacleLayers } from "lib/utils/create-srj-with-board-valid-obstacle-layers"
import { getViaDimensions } from "lib/utils/getViaDimensions"
import { mapZToLayerName } from "lib/utils/mapZToLayerName"

type ViaInPadRoute = HighDensityRoute | SimplifiedPcbTrace

type ViaInPadEvaluator = (routes: readonly ViaInPadRoute[]) => boolean

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
    return getRepairViaGeometry(route, srj.layerCount).map(
      (via, viaIndex): PcbVia => {
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
      },
    )
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
  const evaluateViaInPad = createViaInPadDrcEvaluator(padElements)
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
    return evaluateViaInPad(newVias).length > 0
  }
}
