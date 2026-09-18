import type { GraphicsObject } from "graphics-debug"
import type { TinyHyperGraphSolver } from "tiny-hypergraph/lib/index"

/** Preserve native route hues while keeping the selected route and search opaque. */
export function fadeInactiveRoutes(
  graphics: GraphicsObject,
  solver: TinyHyperGraphSolver,
  activeRouteId: number,
): void {
  const metadata = solver.problem.routeMetadata?.[activeRouteId]
  const activeLabel = `route: ${metadata?.connectionId ?? metadata?.mutuallyConnectedNetworkId ?? `route-${activeRouteId}`}`
  for (const line of graphics.lines ?? []) {
    const routeLabel = line.label?.split("\n")[0]
    if (
      routeLabel?.startsWith("route: ") &&
      routeLabel !== activeLabel &&
      line.strokeColor
    ) {
      line.strokeColor = line.strokeColor.replace(/,\s*[\d.]+\)$/, ", 0.15)")
    }
  }
  for (const point of graphics.points ?? []) {
    const routeLabel = point.label?.split("\n")[0]
    if (
      routeLabel?.startsWith("route: ") &&
      routeLabel !== activeLabel &&
      point.color
    ) {
      point.color = point.color.replace(/,\s*[\d.]+\)$/, ", 0.15)")
    }
  }
}
