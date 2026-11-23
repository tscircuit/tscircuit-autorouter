import { pointToSegmentDistance } from "@tscircuit/math-utils"
import type { ConnectivityMap } from "circuit-json-to-connectivity-map"
import type { CapacityMeshNode, SimpleRouteJson } from "lib/types"
import { getSegmentToObstacleDistance } from "lib/utils/getSegmentToObstacleDistance"
import { getViaToPadClearance } from "lib/utils/getViaToPadClearance"
import { createPreloadedCopperIndex } from "./createPreloadedCopperLookup"

type MarkViaAreaBesideFixedCopperParams = {
  nodes: CapacityMeshNode[]
  srj: SimpleRouteJson
  connMap: ConnectivityMap
  viaDiameter: number
}

/** Edge of one sampled via-center cell, in mm. */
const SAMPLE_CELL_SIZE = 0.05
const MAX_SAMPLES_PER_AXIS = 128
/**
 * Only nodes that keep less than this share of their via centers are priced.
 * Pricing every node beside fixed copper by its share (most keep 0.4 to 0.99)
 * changed planning across the DDR boards: ButterStick went from 55/55 to 16/55
 * nets and the H616 control-signal board stopped solving.
 */
const MAX_PRICED_VIA_AREA_FRACTION = 0.1
/** Share recorded for a node whose sampled via centers are all taken. */
const MIN_VIA_AREA_FRACTION = 0.01

/**
 * Record, on each free-space node that fixed copper leaves almost no room for
 * a via, the share of its via centers that stays legal (`_viaAreaFraction`).
 * Path planning divides the via term of the node's cost by that share, so a
 * layer change in a pocket beside saved traces costs what the pocket is worth
 * instead of what the whole node is worth.
 *
 * The high-density solvers keep a via inside its node, so the candidate
 * centers are the node inset by a via radius. A center is legal when a through
 * via there keeps the declared trace clearance from every fixed wire and via
 * on any layer and the via-to-pad clearance from every pad. Nodes that fixed
 * copper does not reach, nodes narrower than a via, component topology nodes
 * and nodes that hold a pad or a target keep their area price. Board
 * coordinates in mm, +X right, +Y up.
 */
export const markViaAreaBesideFixedCopper = ({
  nodes,
  srj,
  connMap,
  viaDiameter,
}: MarkViaAreaBesideFixedCopperParams): CapacityMeshNode[] => {
  if (
    srj.allowBlindAndBuriedVias ||
    !srj.traces?.some((trace) => trace.isFixed)
  ) {
    return nodes
  }
  const copper = createPreloadedCopperIndex({ srj, connMap, viaDiameter })
  if (!copper) return nodes
  const viaRadius = viaDiameter / 2
  const traceClearance =
    srj.minTraceToPadEdgeClearance ?? srj.defaultObstacleMargin ?? 0
  const copperReach = viaRadius + traceClearance
  const padReach = viaRadius + (getViaToPadClearance(srj) ?? traceClearance)

  const marked = nodes.map((node): CapacityMeshNode => {
    const width = node.width - viaDiameter
    const height = node.height - viaDiameter
    if (
      width < 0 ||
      height < 0 ||
      node.availableZ.length < 2 ||
      node._containsTarget ||
      node._containsObstacle ||
      node._isVirtualOffboard ||
      node._isComponentTopologyNode
    ) {
      return node
    }
    const minX = node.center.x - width / 2
    const minY = node.center.y - height / 2
    const fixedCopper = copper
      .search(
        minX - copperReach,
        minY - copperReach,
        minX + width + copperReach,
        minY + height + copperReach,
      )
      .filter(({ route }) => route.isFixed)
    if (fixedCopper.length === 0) return node
    const pads = srj.obstacles.filter(
      (pad) =>
        getSegmentToObstacleDistance({
          start: { x: minX, y: node.center.y },
          end: { x: minX + width, y: node.center.y },
          obstacle: pad,
        }) <
        height / 2 + padReach,
    )

    const columns = Math.min(
      MAX_SAMPLES_PER_AXIS,
      Math.max(1, Math.ceil(width / SAMPLE_CELL_SIZE)),
    )
    const rows = Math.min(
      MAX_SAMPLES_PER_AXIS,
      Math.max(1, Math.ceil(height / SAMPLE_CELL_SIZE)),
    )
    let legalCells = 0
    for (let cell = 0; cell < columns * rows; cell++) {
      const center = {
        x: minX + (((cell % columns) + 0.5) / columns) * width,
        y: minY + ((Math.floor(cell / columns) + 0.5) / rows) * height,
      }
      const isLegal =
        fixedCopper.every(
          ({ start, end, radius }) =>
            pointToSegmentDistance(center, start, end) >= radius + copperReach,
        ) &&
        pads.every(
          (pad) =>
            getSegmentToObstacleDistance({
              start: center,
              end: center,
              obstacle: pad,
            }) >= padReach,
        )
      if (isLegal) legalCells++
    }
    const viaAreaFraction = legalCells / (columns * rows)
    if (viaAreaFraction >= MAX_PRICED_VIA_AREA_FRACTION) return node
    return {
      ...node,
      _viaAreaFraction: Math.max(MIN_VIA_AREA_FRACTION, viaAreaFraction),
    }
  })
  return marked.some((node, index) => node !== nodes[index]) ? marked : nodes
}
