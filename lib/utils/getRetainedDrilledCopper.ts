import type { PcbVia } from "circuit-json"
import type { SimpleRouteJson } from "lib/types"
import { mapZToLayerName } from "./mapZToLayerName"

/** Retain original drills in physical DRC, including same-net hole spacing. */
export const getRetainedDrilledCopper = (srj: SimpleRouteJson): PcbVia[] => {
  return srj.obstacles.flatMap((obstacle, index): PcbVia[] => {
    if (obstacle.holeDiameter === undefined || obstacle.isNonPlatedHole)
      return []
    if (
      obstacle.shape !== "circle" ||
      obstacle.width !== obstacle.height ||
      !(obstacle.holeDiameter > 0) ||
      obstacle.holeDiameter > obstacle.width
    ) {
      throw new Error(`Invalid circular drilled copper obstacle ${index}`)
    }
    const layers = obstacle.layers.map((layer) => {
      const valid = Array.from({ length: srj.layerCount }, (_, z) =>
        mapZToLayerName(z, srj.layerCount),
      ).find((name) => name === layer)
      if (!valid) throw new Error(`Invalid retained drill layer ${layer}`)
      return valid
    })
    if (!layers.length)
      throw new Error(`Retained drill ${index} has no copper layers`)
    return [
      {
        type: "pcb_via",
        pcb_via_id:
          obstacle.circuitJsonMetadata?.pcb_via_id ?? `retained_drill_${index}`,
        x: obstacle.center.x,
        y: obstacle.center.y,
        outer_diameter: obstacle.width,
        hole_diameter: obstacle.holeDiameter,
        layers,
        from_layer: layers[0]!,
        to_layer: layers.at(-1)!,
      },
    ]
  })
}
