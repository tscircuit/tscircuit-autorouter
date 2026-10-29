import { expect, test } from "bun:test"
import { convertPipeline7HdRoutesToSimplifiedPcbTraces } from "lib/autorouter-pipelines/AutoroutingPipeline7_MultiGraph/convertPipeline7HdRoutesToSimplifiedPcbTraces"
import { Pipeline9JointDrcRepairSolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9JointDrcRepairSolver"
import { evaluateRelaxedDrc } from "lib/testing/evaluate-relaxed-drc"
import type { SimpleRouteJson } from "lib/types"
import type { HighDensityRoute } from "lib/types/high-density-types"
import { convertSrjToGraphicsObject } from "lib/utils/convertSrjToGraphicsObject"
import { getConnectivityMapFromSimpleRouteJson } from "lib/utils/getConnectivityMapFromSimpleRouteJson"
import { getGraphicsSvgFrames } from "../fixtures/solver-svg-frames"
import capturedInput from "./assets/pipeline9-t113-hdmi-ddc-joint-vias.json"

test("Pipeline9 joint repair honors the T113 via-hole clearance", async (): Promise<void> => {
  const srj = structuredClone(capturedInput.srj) as SimpleRouteJson
  const hdRoutes = structuredClone(capturedInput.hdRoutes) as HighDensityRoute[]
  const connMap = getConnectivityMapFromSimpleRouteJson(srj)
  const solver = new Pipeline9JointDrcRepairSolver({
    srj,
    srjWithPointPairs: srj,
    originalSrj: srj,
    newConnections: srj.connections,
    newHdRoutes: hdRoutes,
    updatedPreloadedTraces: [],
    mutatedPreloadedTraceIds: new Set(),
    connMap,
    obstacles: srj.obstacles,
    layerCount: srj.layerCount,
    defaultViaDiameter: srj.minViaDiameter!,
    defaultViaHoleDiameter: srj.minViaHoleDiameter!,
    effort: 2,
    colorMap: {},
  })

  expect(solver.stats.initialJointDrcIssueCount).toBe(1)
  solver.solve()
  expect(solver.solved).toBe(true)
  expect(solver.failed).toBe(false)
  expect(solver.error).toBeNull()

  const outputRoutes = solver.getOutput()
  const routedTraces = convertPipeline7HdRoutesToSimplifiedPcbTraces({
    connections: srj.connections,
    originalConnections: srj.connections,
    hdRoutes: outputRoutes,
    layerCount: srj.layerCount,
    obstacles: srj.obstacles,
    defaultViaHoleDiameter: srj.minViaHoleDiameter!,
    connMap,
  })
  const drc = evaluateRelaxedDrc({
    inputSrj: srj,
    srjWithPointPairs: srj,
    routedTraces,
    drcOptions: {
      viaClearance: srj.minViaHoleEdgeToViaHoleEdgeClearance,
    },
  })
  expect(drc.errors).toEqual([])

  const beforeGraphics = convertSrjToGraphicsObject({
    ...srj,
    traces: convertPipeline7HdRoutesToSimplifiedPcbTraces({
      connections: srj.connections,
      originalConnections: srj.connections,
      hdRoutes,
      layerCount: srj.layerCount,
      obstacles: srj.obstacles,
      defaultViaHoleDiameter: srj.minViaHoleDiameter!,
      connMap,
    }),
  })
  const afterGraphics = convertSrjToGraphicsObject({
    ...srj,
    traces: routedTraces,
  })
  beforeGraphics.points = []
  afterGraphics.points = []
  await expect(
    getGraphicsSvgFrames({
      frames: [
        {
          name: "INPUT: 0.176mm drill-edge gap",
          step: 0,
          graphics: beforeGraphics,
        },
        {
          name: "FIXED: declared 0.20mm drill clearance",
          step: 1,
          graphics: afterGraphics,
        },
      ],
      columns: 2,
      backgroundColor: "white",
    }),
  ).toMatchSvgSnapshot(import.meta.path)
})
