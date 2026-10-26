import type { ConnectivityMap } from "circuit-json-to-connectivity-map"
import Flatbush from "flatbush"
import type { Obstacle, SimpleRouteJson } from "lib/types"
import { createSrjWithBoardValidObstacleLayers } from "lib/utils/create-srj-with-board-valid-obstacle-layers"
import { getConnectivityMapFromSimpleRouteJson } from "lib/utils/getConnectivityMapFromSimpleRouteJson"

export type Pipeline9PhysicalGeometryContext = {
  srj: SimpleRouteJson
  connMap: ConnectivityMap
  obstacles: Obstacle[]
  index?: Flatbush
}

const contexts = new WeakMap<
  SimpleRouteJson,
  Pipeline9PhysicalGeometryContext
>()

/** Share immutable indexed board geometry across local and whole-route checks. */
export function getPipeline9PhysicalGeometryContext(
  physicalSrj: SimpleRouteJson,
): Pipeline9PhysicalGeometryContext {
  const cached = contexts.get(physicalSrj)
  if (cached) return cached
  const srj = createSrjWithBoardValidObstacleLayers(physicalSrj)
  const connMap = getConnectivityMapFromSimpleRouteJson(srj, {
    includeGeometricPointConnections: false,
  })
  const obstacles = [
    ...srj.obstacles,
    ...(srj.jumpers?.flatMap((jumper) => jumper.pads) ?? []),
  ]
  const index = obstacles.length ? new Flatbush(obstacles.length) : undefined
  for (const obstacle of obstacles) {
    const reach = Math.hypot(obstacle.width, obstacle.height) / 2
    if (
      ![obstacle.center.x, obstacle.center.y, reach].every(Number.isFinite) ||
      obstacle.width < 0 ||
      obstacle.height < 0
    )
      throw new Error(
        "Physical route validation requires finite obstacle geometry",
      )
    index!.add(
      obstacle.center.x - reach,
      obstacle.center.y - reach,
      obstacle.center.x + reach,
      obstacle.center.y + reach,
    )
  }
  index?.finish()
  const context = { srj, connMap, obstacles, index }
  contexts.set(physicalSrj, context)
  return context
}
