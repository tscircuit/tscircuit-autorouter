import { ObstacleSpatialHashIndex } from "lib/data-structures/ObstacleTree"
import { SegmentTree } from "lib/data-structures/SegmentTree"
import { BaseSolver } from "../BaseSolver"
import {
  HighDensityIntraNodeRoute,
  HighDensityRoute,
} from "lib/types/high-density-types"
import { Obstacle } from "lib/types"
import { GraphicsObject } from "graphics-debug"
import { mapZToLayerName } from "lib/utils/mapZToLayerName"
import { HighDensityRouteSpatialIndex } from "lib/data-structures/HighDensityRouteSpatialIndex"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { SingleRouteUselessViaRemovalSolver } from "../UselessViaRemovalSolver/SingleRouteUselessViaRemovalSolver"
import {} from "@tscircuit/checks"

export interface UselessViaMergerSolverInput {
  unsimplifiedHdRoutes: HighDensityRoute[]
  obstacles: Obstacle[]
  colorMap: Record<string, string>
  layerCount: number
  connMap?: ConnectivityMap
  outline?: Array<{ x: number; y: number }>
  obstacles: Obstacle[]
}

type Via = {
  x: number
  y: number
  diameter: number
  net: string
  routeIndex: number
  layers: number[]
}

export class UselessViaMergerSolver extends BaseSolver {
  unsimplifiedHdRoutes: HighDensityRoute[]
  optimizedHdRoutes: HighDensityRoute[]
  unprocessedRoutes: HighDensityRoute[]
  vias: Via[]
  offendingVias: [Via, Via][]
  currentViaRoutes: HighDensityIntraNodeRoute
  connMap?: ConnectivityMap
  colorMap: Record<string, string>
  outline?: Array<{ x: number; y: number }>
  obstacles: Obstacle[]
  viasByNet: Map<string, Via[]>

  activeSubSolver?: SingleRouteUselessViaMergerSolver | null | undefined = null

  obstacleSHI: ObstacleSpatialHashIndex | null = null
  hdRouteSHI: HighDensityRouteSpatialIndex | null = null

  constructor(private input: UselessViaMergerSolverInput) {
    super()
    this.MAX_ITERATIONS = 1e6
    this.unsimplifiedHdRoutes = input.unsimplifiedHdRoutes
    this.optimizedHdRoutes = this.unsimplifiedHdRoutes
    this.unprocessedRoutes = [...input.unsimplifiedHdRoutes]
    this.colorMap = input.colorMap
    this.outline = input.outline
    this.obstacles = input.obstacles

    this.obstacleSHI = new ObstacleSpatialHashIndex("flatbush", input.obstacles)
    this.hdRouteSHI = new HighDensityRouteSpatialIndex(
      this.unsimplifiedHdRoutes,
    )
    this.vias = []
    this.offendingVias = []
    this.connMap = input.connMap

    for (let i = 0; i < this.unprocessedRoutes.length; i++) {
      const route = this.unprocessedRoutes[i]
      for (let j = 0; j < route.vias.length; j++) {
        const via = route.vias[j]
        this.vias.push({
          ...via,
          diameter: route.viaDiameter,
          net: this.connMap.idToNetMap[route.connectionName],
          layers: [...new Set(route.route.map((p) => p.z))],
          routeIndex: i,
        })
      }
    }

    this.viasByNet = new Map<string, Via[]>();

    for (const via of this.vias) {
      const list = this.viasByNet.get(via.net);
      if (list) {
        list.push(via);
      } else {
        this.viasByNet.set(via.net, [via]);
      }
    }

    for (let i = 0; i < this.vias.length - 1; i++) {
      const firstVia = this.vias[i]
      const viasInNet = this.viasByNet.get(firstVia.net)
      for (let j = 0; j < viasInNet.length; j++) {
        const secondVia = viasInNet[j]
        if (firstVia.net !== secondVia.net) continue
        const squaredDistance =
          (firstVia.x - secondVia.x) ** 2 + (firstVia.y - secondVia.y) ** 2
        const maxDistance = firstVia.diameter / 2 + secondVia.diameter / 2
        const maxSquaredDistance = maxDistance ** 2
        if (squaredDistance <= maxSquaredDistance) {
          this.offendingVias.push([firstVia, secondVia])
        }
      }
    }
  }

  _step() {
    if (this.offendingVias.length === 0) {
      this.solved = true
      return
    }
    console.log(this.offendingVias)
    const currentOffendingVias = this.offendingVias[0]
    const viaToRemove =
      currentOffendingVias[0].layers.length <
      currentOffendingVias[1].layers.length
        ? currentOffendingVias[0]
        : currentOffendingVias[1]
    const viaNotToRemove =
      currentOffendingVias[0].layers.length <
      currentOffendingVias[1].layers.length
        ? currentOffendingVias[1]
        : currentOffendingVias[0]
    console.log(this.optimizedHdRoutes[viaToRemove.routeIndex].route)

    const route = this.optimizedHdRoutes[viaToRemove.routeIndex].route
    for (let i = 0; i < viaToRemove.layers.length; i++) {
      const layer = viaToRemove.layers[i]

      for (let j = 1; j < route.length; j++) {
        const prev = route[j - 1]
        const curr = route[j]

        const crossesIntoLayer = prev.z !== layer && curr.z === layer

        const crossesOutOfLayer = prev.z === layer && curr.z !== layer

        if (crossesIntoLayer || crossesOutOfLayer) {
          route.splice(j, 0, {
            x: viaNotToRemove.x,
            y: viaNotToRemove.y,
            z: layer,
          })
          break
        }
      }
    }

    this.optimizedHdRoutes[viaToRemove.routeIndex].vias =
      this.optimizedHdRoutes[viaToRemove.routeIndex].vias.filter((via) => {
        return via.x !== viaToRemove.x && via.y !== viaToRemove.y
      })
    console.log(this.optimizedHdRoutes[viaToRemove.routeIndex].vias)

    this.offendingVias.shift()
  }

  getOptimizedHdRoutes(): HighDensityRoute[] | null {
    return this.optimizedHdRoutes
  }
}
