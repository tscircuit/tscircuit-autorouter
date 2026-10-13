import type { HighDensityRoute } from "lib/types/high-density-types"

/** Rebind point identity after geometry improvement, using authoritative contacts. */
export const normalizePipeline9HdRouteTerminalIds = (
  hdRoutes: readonly HighDensityRoute[],
): HighDensityRoute[] => {
  return hdRoutes.map(
    (hdRoute): HighDensityRoute => ({
      ...hdRoute,
      route: hdRoute.route.map(
        (point, index): HighDensityRoute["route"][number] => {
          const { pcb_port_id, ...geometryPoint } = point
          const terminalId =
            index === 0
              ? hdRoute.startPcbPortId
              : index === hdRoute.route.length - 1
                ? hdRoute.endPcbPortId
                : undefined
          return terminalId === undefined
            ? geometryPoint
            : { ...geometryPoint, pcb_port_id: terminalId }
        },
      ),
    }),
  )
}
