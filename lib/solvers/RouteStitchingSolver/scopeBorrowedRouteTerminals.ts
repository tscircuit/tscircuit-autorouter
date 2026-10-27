import type { Point3 } from "@tscircuit/math-utils"
import type { HighDensityIntraNodeRoute } from "lib/types/high-density-types"

type RequestedTerminal = Point3 & { pcb_port_id?: string }
const TERMINAL_IDENTITY_TOLERANCE = 1e-3

/** Borrowed copper keeps its geometry; terminal roles belong to this demand. */
export const scopeBorrowedRouteTerminals = (args: {
  routes: HighDensityIntraNodeRoute[]
  ownedRoutes: ReadonlySet<HighDensityIntraNodeRoute>
  terminals: RequestedTerminal[]
}): HighDensityIntraNodeRoute[] => {
  const isRequestedTerminal = (
    pcbPortId: string | undefined,
    point: Point3,
  ): boolean => {
    return (
      pcbPortId !== undefined &&
      args.terminals.some(
        (terminal) =>
          terminal.pcb_port_id === pcbPortId &&
          terminal.z === point.z &&
          Math.hypot(terminal.x - point.x, terminal.y - point.y) <=
            TERMINAL_IDENTITY_TOLERANCE,
      )
    )
  }
  return args.routes.map((route) => {
    if (args.ownedRoutes.has(route)) return route
    const { startPcbPortId, endPcbPortId, ...copper } = route
    const first = route.route[0]!
    const last = route.route[route.route.length - 1]!
    return {
      ...copper,
      ...(isRequestedTerminal(startPcbPortId, first) ? { startPcbPortId } : {}),
      ...(isRequestedTerminal(endPcbPortId, last) ? { endPcbPortId } : {}),
      route: route.route.map((point, index) => {
        if (!point.pcb_port_id) return point
        if (
          (index === 0 || index === route.route.length - 1) &&
          isRequestedTerminal(point.pcb_port_id, point)
        ) {
          return point
        }
        const { pcb_port_id, ...copperPoint } = point
        return copperPoint
      }),
    }
  })
}
