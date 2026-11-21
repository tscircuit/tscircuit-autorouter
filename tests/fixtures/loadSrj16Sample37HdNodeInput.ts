import { readFileSync } from "node:fs"
import { gunzipSync } from "node:zlib"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { GrowShrinkHighDensityIntraNodeSolver } from "lib/solvers/HyperHighDensitySolver/GrowShrinkHighDensityIntraNodeSolver/GrowShrinkHighDensityIntraNodeSolver"
import type { Obstacle } from "lib/types"
import type { NodeWithPortPoints } from "lib/types/high-density-types"

export type Srj16Sample37HdNodeInput = {
  nodeWithPortPoints: NodeWithPortPoints
  obstacles: Obstacle[]
  colorMap: Record<string, string>
  connMapNetMap: Record<string, string[]>
  traceWidth: number
  viaDiameter: number
  viaHoleDiameter: number
  obstacleMargin: number
  effort: number
  layerCount: number
  allowBlindAndBuriedVias: boolean
  minViaHoleEdgeToViaHoleEdgeClearance: number
}

export const SRJ16_SAMPLE37_NODE_ID = "topology_merge_134"
export const SRJ16_SAMPLE37_PAD_ID = "pcb_smtpad_bga_pin_003"
export const SRJ16_SAMPLE37_PAD_CENTER = { x: -0.8, y: 2.4 } as const
export const SRJ16_SAMPLE37_PAD_SIZE = 0.36
export const SRJ16_SAMPLE37_REQUIRED_VIA_TO_PAD_CLEARANCE = 0.1

export function loadSrj16Sample37HdNodeInput(): Srj16Sample37HdNodeInput {
  return JSON.parse(
    gunzipSync(
      new Uint8Array(
        readFileSync(
          new URL(
            "./assets/srj16-sample37-hd-node-via-pad.json.gz",
            import.meta.url,
          ),
        ),
      ),
    ).toString("utf8"),
  ) as Srj16Sample37HdNodeInput
}

export function getViaToPadCopperGap(via: {
  x: number
  y: number
  viaDiameter: number
}): number {
  const halfPad = SRJ16_SAMPLE37_PAD_SIZE / 2
  const padMinX = SRJ16_SAMPLE37_PAD_CENTER.x - halfPad
  const padMaxX = SRJ16_SAMPLE37_PAD_CENTER.x + halfPad
  const padMinY = SRJ16_SAMPLE37_PAD_CENTER.y - halfPad
  const padMaxY = SRJ16_SAMPLE37_PAD_CENTER.y + halfPad
  const dx = Math.max(padMinX - via.x, 0, via.x - padMaxX)
  const dy = Math.max(padMinY - via.y, 0, via.y - padMaxY)
  return Math.hypot(dx, dy) - via.viaDiameter / 2
}

export function createSrj16Sample37NodeSolver(): GrowShrinkHighDensityIntraNodeSolver {
  const input = loadSrj16Sample37HdNodeInput()
  return new GrowShrinkHighDensityIntraNodeSolver({
    nodeWithPortPoints: input.nodeWithPortPoints,
    obstacles: input.obstacles,
    colorMap: input.colorMap,
    connMap: new ConnectivityMap(input.connMapNetMap),
    fixedHdRoutes: [],
    preservePhysicalGeometry: false,
    traceWidth: input.traceWidth,
    viaDiameter: input.viaDiameter,
    viaHoleDiameter: input.viaHoleDiameter,
    obstacleMargin: input.obstacleMargin,
    effort: input.effort,
    layerCount: input.layerCount,
    allowBlindAndBuriedVias: input.allowBlindAndBuriedVias,
    minViaHoleEdgeToViaHoleEdgeClearance:
      input.minViaHoleEdgeToViaHoleEdgeClearance,
  })
}
