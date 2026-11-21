import { readFileSync } from "node:fs"
import { gunzipSync } from "node:zlib"
import { Pipeline9HighDensityForceImproveSolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9HighDensityForceImproveSolver"
import type { SimpleRouteJson } from "lib/types"
import type {
  HighDensityRoute,
  NodeWithPortPoints,
} from "lib/types/high-density-types"

export type Srj19Sample76ForceImproveInput = {
  inputSrj: SimpleRouteJson
  nodeWithPortPoints: NodeWithPortPoints[]
  hdRoutes: HighDensityRoute[]
  fixedHdRoutes: HighDensityRoute[]
  colorMap: Record<string, string>
}

export type ForceImproveViaPadViolation = {
  connectionName: string
  x: number
  y: number
  gap: number
}

export const SRJ19_SAMPLE76_PAD_CENTER = { x: 0.8, y: -4 } as const
export const SRJ19_SAMPLE76_PAD_SIZE = 0.36
export const SRJ19_SAMPLE76_VIA_DIAMETER = 0.3
export const SRJ19_SAMPLE76_REQUIRED_VIA_TO_PAD_CLEARANCE = 0.1

export function loadSrj19Sample76ForceImproveInput(): Srj19Sample76ForceImproveInput {
  return JSON.parse(
    gunzipSync(
      new Uint8Array(
        readFileSync(
          new URL(
            "./assets/srj19-sample76-hd-force-improve.json.gz",
            import.meta.url,
          ),
        ),
      ),
    ).toString("utf8"),
  ) as Srj19Sample76ForceImproveInput
}

export function createSrj19Sample76ForceImproveSolver(
  fixture: Srj19Sample76ForceImproveInput,
): Pipeline9HighDensityForceImproveSolver {
  const solver = new Pipeline9HighDensityForceImproveSolver({
    inputSrj: fixture.inputSrj,
    nodeWithPortPoints: fixture.nodeWithPortPoints,
    hdRoutes: fixture.hdRoutes,
    fixedHdRoutes: fixture.fixedHdRoutes,
    colorMap: fixture.colorMap,
    totalStepsPerNode: 20,
    nodeAssignmentMargin: 0.2,
    preserveTopologyPortAnchors: true,
  })
  solver.solve()
  if (solver.failed) {
    throw new Error(String(solver.error))
  }
  return solver
}

export function getViaToPadCopperGap(via: { x: number; y: number }): number {
  const halfPad = SRJ19_SAMPLE76_PAD_SIZE / 2
  const padMinX = SRJ19_SAMPLE76_PAD_CENTER.x - halfPad
  const padMaxX = SRJ19_SAMPLE76_PAD_CENTER.x + halfPad
  const padMinY = SRJ19_SAMPLE76_PAD_CENTER.y - halfPad
  const padMaxY = SRJ19_SAMPLE76_PAD_CENTER.y + halfPad
  const dx = Math.max(padMinX - via.x, 0, via.x - padMaxX)
  const dy = Math.max(padMinY - via.y, 0, via.y - padMaxY)
  return Math.hypot(dx, dy) - SRJ19_SAMPLE76_VIA_DIAMETER / 2
}

export function findSrj19Sample76ViaPadViolations(
  routes: HighDensityRoute[],
): ForceImproveViaPadViolation[] {
  const violations: ForceImproveViaPadViolation[] = []
  for (const route of routes) {
    if (!route.connectionName.includes("bga_conn_013")) continue
    for (const via of route.vias) {
      const gap = getViaToPadCopperGap(via)
      if (gap >= SRJ19_SAMPLE76_REQUIRED_VIA_TO_PAD_CLEARANCE) continue
      violations.push({
        connectionName: route.connectionName,
        x: via.x,
        y: via.y,
        gap,
      })
    }
  }
  return violations
}
