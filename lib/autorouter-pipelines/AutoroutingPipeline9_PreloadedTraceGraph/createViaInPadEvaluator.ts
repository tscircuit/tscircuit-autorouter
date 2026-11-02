import { checkViasInPads } from "@tscircuit/checks"
import { getRepairViaGeometry } from "@tscircuit/repair04"
import type { PcbVia } from "circuit-json"
import type { SimpleRouteJson } from "lib/types"
import type { HighDensityRoute } from "lib/types/high-density-types"
import { createPcbPadElements } from "lib/utils/convertToCircuitJson"
import { createSrjWithBoardValidObstacleLayers } from "lib/utils/create-srj-with-board-valid-obstacle-layers"
import { getViaDimensions } from "lib/utils/getViaDimensions"
import { mapZToLayerName } from "lib/utils/mapZToLayerName"

type ViaInPadInput = {
  previousRoutes: HighDensityRoute[]
  routes: HighDensityRoute[]
}

type ViaInPadEvaluator = (input: ViaInPadInput) => boolean

function getViaElements({
  routes,
  srj,
}: {
  routes: HighDensityRoute[]
  srj: SimpleRouteJson
}): PcbVia[] {
  const { holeDiameter } = getViaDimensions(srj)
  return routes.flatMap((route, routeIndex) =>
    getRepairViaGeometry(route, srj.layerCount).map((via, viaIndex): PcbVia => {
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
    }),
  )
}

/** Reject new drilled holes in pads; touching same-net copper is not via-in-pad. */
export function createViaInPadEvaluator({
  srj,
}: {
  srj: SimpleRouteJson
}): ViaInPadEvaluator {
  const padElements = createPcbPadElements(
    createSrjWithBoardValidObstacleLayers(srj),
  )
  return ({ previousRoutes, routes }): boolean => {
    const existingDrills = new Set(
      getViaElements({ routes: previousRoutes, srj }).map((via) =>
        JSON.stringify([via.x, via.y, via.hole_diameter, via.layers]),
      ),
    )
    const newVias = getViaElements({ routes, srj }).filter(
      (via) =>
        !existingDrills.has(
          JSON.stringify([via.x, via.y, via.hole_diameter, via.layers]),
        ),
    )
    return checkViasInPads([...padElements, ...newVias]).length > 0
  }
}
