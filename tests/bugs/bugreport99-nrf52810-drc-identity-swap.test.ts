import { checkViaPadClearance } from "@tscircuit/checks"
import { expect, test } from "bun:test"
import { VisualizedGlobalDrcForceImproveSolver } from "high-density-repair03/fixture-support/VisualizedGlobalDrcForceImproveSolver"
import type {
  HighDensityRoute,
  SimpleRouteJson as RepairSimpleRouteJson,
} from "high-density-repair03/lib"
import { AutoroutingPipelineSolver7_MultiGraph } from "lib/autorouter-pipelines/AutoroutingPipeline7_MultiGraph/AutoroutingPipelineSolver7_MultiGraph"
import { createPipeline7AutoroutingDrcEvaluator } from "lib/autorouter-pipelines/AutoroutingPipeline7_MultiGraph/create-pipeline7-autorouting-drc-evaluator"
import { evaluateRelaxedDrc } from "lib/testing/evaluate-relaxed-drc"
import type { SimpleRouteJson, SimplifiedPcbTraces } from "lib/types"
import srjJson from "../../fixtures/bug-reports/bugreport99-nrf52810-drc-identity-swap/bugreport99-nrf52810-drc-identity-swap.srj.json" with {
  type: "json",
}
import knownBadExactRoutesJson from "../../fixtures/bug-reports/bugreport99-nrf52810-drc-identity-swap/bugreport99-nrf52810-known-bad-exact-routes.json" with {
  type: "json",
}
import {
  getGraphicsSvgFrames,
  type GraphicsSvgFrame,
} from "../fixtures/solver-svg-frames"

const srj = srjJson as SimpleRouteJson
const knownBadExactRoutes = knownBadExactRoutesJson as HighDensityRoute[]

const TARGET_DRC_IDS = [
  "overlap_source_net_1_mst9_0_source_net_0_mst7_0",
  "via_pad_clearance_via_11_pcb_smtpad_87",
] as const

const FOCUS_BOUNDS = {
  minX: 3,
  maxX: 5,
  minY: 5.5,
  maxY: 8.2,
}

const isInFocus = (point: { x: number; y: number }) =>
  point.x >= FOCUS_BOUNDS.minX &&
  point.x <= FOCUS_BOUNDS.maxX &&
  point.y >= FOCUS_BOUNDS.minY &&
  point.y <= FOCUS_BOUNDS.maxY

const clampToFocus = (point: { x: number; y: number }) => ({
  x: Math.max(FOCUS_BOUNDS.minX, Math.min(FOCUS_BOUNDS.maxX, point.x)),
  y: Math.max(FOCUS_BOUNDS.minY, Math.min(FOCUS_BOUNDS.maxY, point.y)),
})

const getDrcId = (error: Record<string, unknown>): string | undefined => {
  for (const key of [
    "pcb_trace_error_id",
    "pcb_pad_pad_clearance_error_id",
    "pcb_pad_trace_clearance_error_id",
    "pcb_via_trace_clearance_error_id",
    "pcb_error_id",
  ]) {
    if (typeof error[key] === "string") return error[key]
  }
  return undefined
}

test("bugreport99 keeps nRF exact DRC net aliases electrically equivalent", async () => {
  const pipeline = new AutoroutingPipelineSolver7_MultiGraph(
    structuredClone(srj),
    { cacheProvider: null },
  )

  pipeline.solveUntilPhase("exactGeometryDrcForceImproveSolver")
  expect(pipeline.failed).toBe(false)

  const srjWithPointPairs = pipeline.srjWithPointPairs as SimpleRouteJson
  const exactInputRoutes = pipeline.globalDrcForceImproveSolver!.getOutput()
  const conversionOptions = {
    connections: pipeline.netToPointPairsSolver?.newConnections ?? [],
    originalConnections: pipeline.originalSrj.connections,
    layerCount: srjWithPointPairs.layerCount,
    obstacles: srjWithPointPairs.obstacles,
    defaultViaHoleDiameter: pipeline.viaHoleDiameter,
    connMap: pipeline.connMap,
    srjWithPointPairs,
    originalSrj: pipeline.originalSrj,
  }
  const exactDrcEvaluator =
    createPipeline7AutoroutingDrcEvaluator(conversionOptions)
  const getExactErrors = (routes: HighDensityRoute[]) => {
    const result = exactDrcEvaluator({ traces: [], hdRoutes: routes })
    return Array.isArray(result) ? result : result.errors
  }

  pipeline.step()
  while (
    pipeline.getCurrentPhase() === "exactGeometryDrcForceImproveSolver" &&
    !pipeline.failed
  ) {
    pipeline.step()
  }

  const exactSolver = pipeline.exactGeometryDrcForceImproveSolver!
  const exactOutputRoutes = exactSolver.getOutput()
  const knownBadRoutes = structuredClone(knownBadExactRoutes)
  const inputErrors = getExactErrors(exactInputRoutes)
  const inputTargetIds = inputErrors
    .map(getDrcId)
    .filter((id): id is string => id !== undefined)
    .filter((id) =>
      TARGET_DRC_IDS.includes(id as (typeof TARGET_DRC_IDS)[number]),
    )
  const knownBadTargetIds = getExactErrors(knownBadRoutes)
    .map(getDrcId)
    .filter((id): id is string => id !== undefined)
    .filter((id) =>
      TARGET_DRC_IDS.includes(id as (typeof TARGET_DRC_IDS)[number]),
    )
  const outputTargetIds = getExactErrors(exactOutputRoutes)
    .map(getDrcId)
    .filter((id): id is string => id !== undefined)
    .filter((id) =>
      TARGET_DRC_IDS.includes(id as (typeof TARGET_DRC_IDS)[number]),
    )

  expect(inputTargetIds).toEqual([])
  expect(inputErrors).toHaveLength(2)
  expect(knownBadTargetIds.sort()).toEqual([...TARGET_DRC_IDS].sort())
  expect(outputTargetIds).toEqual([])

  const viewer = new VisualizedGlobalDrcForceImproveSolver({
    srj: srjWithPointPairs as unknown as RepairSimpleRouteJson,
    hdRoutes: exactInputRoutes,
    connMap: pipeline.connMap,
    drcEvaluator: exactDrcEvaluator,
    viaHoleDiameter: pipeline.viaHoleDiameter,
    maxIterations: 1,
    enableLargeBoardBroadFallback: false,
    enablePostSolveClearanceRelaxation: false,
  })
  const focusGraphics = (routes: HighDensityRoute[]) => {
    viewer.outputHdRoutes = routes
    const graphics = viewer.visualize()
    return {
      ...graphics,
      lines: graphics.lines?.flatMap((line) => {
        const xs = line.points.map((point) => point.x)
        const ys = line.points.map((point) => point.y)
        if (
          Math.max(...xs) < FOCUS_BOUNDS.minX ||
          Math.min(...xs) > FOCUS_BOUNDS.maxX ||
          Math.max(...ys) < FOCUS_BOUNDS.minY ||
          Math.min(...ys) > FOCUS_BOUNDS.maxY
        ) {
          return []
        }
        return [{ ...line, points: line.points.map(clampToFocus) }]
      }),
      circles: graphics.circles?.filter((circle) => isInFocus(circle.center)),
      points: graphics.points?.filter(isInFocus),
      rects: [
        ...(graphics.rects?.filter(
          (rect) => rect.label !== "board bounds" && isInFocus(rect.center),
        ) ?? []),
        {
          center: { x: 4, y: 6.85 },
          width: FOCUS_BOUNDS.maxX - FOCUS_BOUNDS.minX,
          height: FOCUS_BOUNDS.maxY - FOCUS_BOUNDS.minY,
          fill: "rgba(255, 255, 255, 0)",
          stroke: "#0f172a",
          label: "focused nRF hotspot",
        },
      ],
    }
  }
  const frames: GraphicsSvgFrame[] = [
    {
      name: "EXACT INPUT · 2 REAL DRC",
      graphics: focusGraphics(exactInputRoutes),
    },
    {
      name: "OLD FALSE-NET CANDIDATE · +2 DRC",
      graphics: focusGraphics(knownBadRoutes),
    },
    {
      name: "FIXED EXACT OUTPUT · NO NEW DRC",
      graphics: focusGraphics(exactOutputRoutes),
    },
  ]

  pipeline.solve()
  expect(pipeline.failed).toBe(false)
  expect(pipeline.solved).toBe(true)

  const prePowerTraces = pipeline.getPrePowerTraceOutputSimplifiedPcbTraces()
  const finalTraces = pipeline.getOutputSimplifiedPcbTraces()
  const getReferenceDrcIds = (traces: SimplifiedPcbTraces) => {
    const drc = evaluateRelaxedDrc({
      inputSrj: pipeline.originalSrj,
      srjWithPointPairs,
      routedTraces: traces,
    })
    return [
      ...drc.errors,
      ...checkViaPadClearance(drc.circuitJson, {
        minClearance: 0.1,
      }),
    ]
      .map((error) => getDrcId(error as unknown as Record<string, unknown>))
      .filter((id): id is string => id !== undefined)
  }
  const prePowerDrcIds = new Set(getReferenceDrcIds(prePowerTraces))
  const finalDrcIds = getReferenceDrcIds(finalTraces)

  expect(finalDrcIds.filter((id) => !prePowerDrcIds.has(id))).toEqual([])
  expect(
    finalDrcIds.filter((id) =>
      id.includes("source_net_1_mst9_0_source_net_0_mst7_0"),
    ),
  ).toEqual([])
  expect(finalDrcIds.filter((id) => id.includes("pcb_smtpad_87"))).toEqual([])

  await expect(
    getGraphicsSvgFrames({
      frames,
      columns: 3,
      backgroundColor: "white",
    }),
  ).toMatchSvgSnapshot(import.meta.path, { tolerance: 0 })
})
