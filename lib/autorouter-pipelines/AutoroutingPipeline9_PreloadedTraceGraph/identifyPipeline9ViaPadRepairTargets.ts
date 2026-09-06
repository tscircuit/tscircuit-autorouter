import { checkViasInPads } from "@tscircuit/checks"
import { getRepairViaGeometry } from "@tscircuit/repair04"
import type { AnyCircuitElement } from "circuit-json"
import type { HighDensityRoute } from "lib/types/high-density-types"

export type ExistingViaRepairTarget = {
  routeIndex: number
  viaIndex: number
  x: number
  y: number
}

/** Resolve checker identities through Circuit JSON; never interpret error IDs. */
export const identifyPipeline9ViaPadRepairTargets = ({
  errors,
  circuitJson,
  routes,
  layerCount,
  finalTraceIdByConvertedTraceId,
}: {
  errors: Record<string, unknown>[]
  circuitJson: AnyCircuitElement[]
  routes: HighDensityRoute[]
  layerCount: number
  finalTraceIdByConvertedTraceId?: ReadonlyMap<string, string>
}): Record<string, unknown>[] => {
  // This is the explicit identity produced by the Pipeline7 converter.
  const routeIndicesByConnection = new Map<string, number>()
  const routeIndexByTraceId = new Map<string, number>()
  routes.forEach((route, routeIndex): void => {
    const connectionIndex =
      routeIndicesByConnection.get(route.connectionName) ?? 0
    routeIndicesByConnection.set(route.connectionName, connectionIndex + 1)
    const convertedId = `${route.connectionName}_${connectionIndex}`
    const finalId = finalTraceIdByConvertedTraceId
      ? finalTraceIdByConvertedTraceId.get(convertedId)
      : convertedId
    if (finalId !== undefined) routeIndexByTraceId.set(finalId, routeIndex)
  })
  const vias = circuitJson.filter(
    (element): element is Extract<AnyCircuitElement, { type: "pcb_via" }> =>
      element.type === "pcb_via",
  )
  const nonViaElements = circuitJson.filter(
    (element): boolean => element.type !== "pcb_via",
  )
  const placementErrorIdsByVia = new Map<(typeof vias)[number], Set<string>>()
  const geometryByRoute = new Map<
    number,
    ReturnType<typeof getRepairViaGeometry>
  >()
  return errors.map((error): Record<string, unknown> => {
    const center = error.center as { x: number; y: number } | undefined
    const ids =
      error.type === "pcb_pad_pad_clearance_error" &&
      Array.isArray(error.pcb_pad_ids)
        ? error.pcb_pad_ids
        : []
    const offendingVias = vias.filter((via): boolean => {
      if (ids.includes(via.pcb_via_id)) return true
      if (
        error.type !== "pcb_placement_error" ||
        center === undefined ||
        via.x !== center.x ||
        via.y !== center.y
      )
        return false
      // Both error views can reference the same via. Its checker identities
      // depend only on this evaluation's unchanged Circuit JSON.
      let placementIds = placementErrorIdsByVia.get(via)
      if (!placementIds) {
        placementIds = new Set(
          checkViasInPads([...nonViaElements, via]).map(
            (placementError): string => placementError.pcb_placement_error_id,
          ),
        )
        placementErrorIdsByVia.set(via, placementIds)
      }
      return placementIds.has(error.pcb_placement_error_id as string)
    })
    const targets = offendingVias.flatMap((via): ExistingViaRepairTarget[] => {
      const routeIndex =
        typeof via.pcb_trace_id === "string"
          ? routeIndexByTraceId.get(via.pcb_trace_id)
          : undefined
      if (routeIndex === undefined) return []
      const route = routes[routeIndex]!
      let geometries = geometryByRoute.get(routeIndex)
      if (!geometries) {
        geometries = getRepairViaGeometry(route, layerCount)
        geometryByRoute.set(routeIndex, geometries)
      }
      const viaLayers = via.layers.map((layer): number =>
        layer === "top"
          ? 0
          : layer === "bottom"
            ? layerCount - 1
            : Number(layer.slice(5)),
      )
      const minZ = Math.min(...viaLayers)
      const maxZ = Math.max(...viaLayers)
      const matching = geometries.flatMap(
        (geometry, viaIndex): ExistingViaRepairTarget[] =>
          geometry.x === via.x &&
          geometry.y === via.y &&
          geometry.diameter === via.outer_diameter &&
          geometry.minZ === minZ &&
          geometry.maxZ === maxZ
            ? [{ routeIndex, viaIndex, x: geometry.x, y: geometry.y }]
            : [],
      )
      // Repeated identical physical spans have ambiguous converter provenance.
      // Keep them fixed until their identity can be established uniquely.
      return matching.length === 1 ? matching : []
    })
    return targets.length
      ? { ...error, existingViaRepairTargets: targets }
      : error
  })
}
