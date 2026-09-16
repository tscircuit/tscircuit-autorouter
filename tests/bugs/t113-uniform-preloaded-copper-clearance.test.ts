import { expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { gunzipSync } from "node:zlib"
import { getSvgFromGraphicsObject } from "graphics-debug"
import {
  UniformPortDistributionSolver,
  type UniformPortDistributionSolverInput,
} from "lib/solvers/UniformPortDistributionSolver/UniformPortDistributionSolver"
import {
  type PreloadedTraceCopperPrimitive,
  getPointToCopperPrimitiveDistance,
  getPreloadedTraceCopperPrimitives,
} from "lib/solvers/UniformPortDistributionSolver/getPreloadedTraceCopperPrimitives"
import { redistributePortPointsOnSharedEdge } from "lib/solvers/UniformPortDistributionSolver/redistributePortPointsOnSharedEdge"
import { shouldIgnorePortPoint } from "lib/solvers/UniformPortDistributionSolver/shouldIgnorePortPoint"
import type { SimpleRouteJson } from "lib/types"
import { getConnectivityMapFromSimpleRouteJson } from "lib/utils/getConnectivityMapFromSimpleRouteJson"
import { stackSvgsHorizontally, stackSvgsVertically } from "stack-svgs"

const targetPortPointId = "ce1188_pp3_z0::0"
const foreignTraceId =
  "source_trace_52__source_trace_54__source_trace_56__breakout:pcb_breakout_point_21_mst3_0"
const traceClearance = 0.1

const getPoint = (
  nodes: UniformPortDistributionSolverInput["nodeWithPortPoints"],
  portPointId: string,
) => {
  const point = nodes
    .flatMap((node) => node.portPoints)
    .find((candidate) => candidate.portPointId === portPointId)
  if (!point) throw new Error(`Missing exact T113 port point ${portPointId}`)
  return point
}

const createLabel = (title: string, subtitle: string): string => `<svg
  xmlns="http://www.w3.org/2000/svg"
  width="700"
  height="70"
  viewBox="0 0 700 70"
>
  <rect width="700" height="70" fill="#f4f4f4" />
  <text x="350" y="26" fill="#111" font-family="Arial, sans-serif"
    font-size="18" font-weight="700" text-anchor="middle">${title}</text>
  <text x="350" y="51" fill="#4b5563" font-family="Arial, sans-serif"
    font-size="14" text-anchor="middle">${subtitle}</text>
</svg>`

const createPanel = ({
  title,
  subtitle,
  movingPoint,
  fixedCopper,
  sharedEdge,
  requiredCenterDistance,
  traceWidth,
}: {
  title: string
  subtitle: string
  movingPoint: { x: number; y: number }
  fixedCopper: PreloadedTraceCopperPrimitive
  sharedEdge: { x1: number; y1: number; x2: number; y2: number }
  requiredCenterDistance: number
  traceWidth: number
}): string => {
  const graphic = getSvgFromGraphicsObject(
    {
      lines: [
        {
          points: [fixedCopper.start, fixedCopper.end],
          strokeColor: "#2563eb20",
          strokeWidth: requiredCenterDistance * 2,
          label: "required clearance from preloaded copper",
        },
        {
          points: [
            { x: sharedEdge.x1, y: sharedEdge.y1 },
            { x: sharedEdge.x2, y: sharedEdge.y2 },
          ],
          strokeColor: "#9ca3af",
          strokeWidth: 0.02,
          label: "shared capacity edge",
        },
        {
          points: [fixedCopper.start, fixedCopper.end],
          strokeColor: "#2563eb",
          strokeWidth: fixedCopper.width,
          label: "preloaded trace",
        },
      ],
      circles: [
        {
          center: movingPoint,
          radius: traceWidth / 2,
          fill: "#dc2626",
          stroke: "#991b1b",
          label: "redistributed route port",
        },
      ],
      rects: [
        {
          center: {
            x: movingPoint.x,
            y: (sharedEdge.y1 + sharedEdge.y2) / 2,
          },
          width: 1.2,
          height: Math.abs(sharedEdge.y2 - sharedEdge.y1) + 0.4,
          fill: "#00000000",
          stroke: "#00000000",
        },
      ],
    },
    { backgroundColor: "white", svgWidth: 700, svgHeight: 500 },
  )
  return stackSvgsVertically([createLabel(title, subtitle), graphic], {
    gap: 0,
    normalizeSize: false,
  })
}

test("does not redistribute a T113 route port onto preloaded copper", async () => {
  const stageFixturePath = new URL(
    "../../fixtures/bug-reports/t113-uniform-terminal-collision/t113-uniform-terminal-collision.input.json.gz",
    import.meta.url,
  )
  const srjFixturePath = new URL(
    "../../fixtures/bug-reports/t113-linux-exact-pipeline9-root/t113-linux-exact.srj.json.gz",
    import.meta.url,
  )
  const input = JSON.parse(
    gunzipSync(Uint8Array.from(readFileSync(stageFixturePath))).toString(
      "utf8",
    ),
  ) as UniformPortDistributionSolverInput
  const srj = JSON.parse(
    gunzipSync(Uint8Array.from(readFileSync(srjFixturePath))).toString("utf8"),
  ) as SimpleRouteJson
  expect(srj.traces).toHaveLength(342)

  const connMap = getConnectivityMapFromSimpleRouteJson(srj)
  const viaDiameter = srj.minViaPadDiameter ?? srj.minViaDiameter ?? 0.45
  const solver = new UniformPortDistributionSolver({
    ...input,
    traceClearance,
    connMap,
    preloadedCopper: {
      traces: srj.traces ?? [],
      layerCount: srj.layerCount,
      viaDiameter,
    },
  })
  const originalPoint = getPoint(input.nodeWithPortPoints, targetPortPointId)
  const ownerPairEntry = [...solver.mapOfOwnerPairToPortPoints.entries()].find(
    ([, portPoints]) =>
      portPoints.some((point) => point.portPointId === targetPortPointId),
  )
  if (!ownerPairEntry) throw new Error("Missing T113 target owner pair")
  const [ownerPairKey, portPoints] = ownerPairEntry
  const sharedEdge = solver.mapOfOwnerPairToSharedEdge.get(ownerPairKey)
  if (!sharedEdge) throw new Error("Missing T113 target shared edge")
  const movablePortPoints = portPoints.filter(
    (portPoint) =>
      !shouldIgnorePortPoint({
        portPoint,
        ownerNodeIds: portPoint.ownerNodeIds,
        inputNodes: input.inputNodesWithPortPoints,
      }),
  )
  const previousCandidate = redistributePortPointsOnSharedEdge({
    sharedEdge,
    portPoints: movablePortPoints,
  }).find((point) => point.portPointId === targetPortPointId)
  if (!previousCandidate) throw new Error("Missing prior uniform candidate")

  const foreignCopper = getPreloadedTraceCopperPrimitives({
    traces: srj.traces ?? [],
    layerCount: srj.layerCount,
    defaultViaDiameter: viaDiameter,
  })
    .filter(
      (primitive) =>
        primitive.z === previousCandidate.z &&
        primitive.connectedIds.includes(foreignTraceId),
    )
    .sort(
      (a, b) =>
        getPointToCopperPrimitiveDistance(previousCandidate, a) -
        getPointToCopperPrimitiveDistance(previousCandidate, b),
    )[0]
  if (!foreignCopper) throw new Error("Missing exact T113 preloaded segment")
  expect(connMap.areIdsConnected("source_trace_89", foreignTraceId)).toBe(false)

  const requiredCenterDistance =
    input.minTraceWidth / 2 + foreignCopper.width / 2 + traceClearance
  expect(
    getPointToCopperPrimitiveDistance(previousCandidate, foreignCopper),
  ).toBeLessThan(requiredCenterDistance)
  expect(
    getPointToCopperPrimitiveDistance(originalPoint, foreignCopper),
  ).toBeGreaterThanOrEqual(requiredCenterDistance)

  solver.solve()
  const routedPoint = getPoint(solver.getOutput(), targetPortPointId)
  expect(routedPoint).toMatchObject({
    x: originalPoint.x,
    y: originalPoint.y,
  })
  expect(
    getPointToCopperPrimitiveDistance(routedPoint, foreignCopper),
  ).toBeGreaterThanOrEqual(requiredCenterDistance)

  const comparisonSvg = stackSvgsHorizontally(
    [
      createPanel({
        title: "BEFORE · PORT MOVED ONTO PRELOADED TRACE",
        subtitle: "RED route port enters the BLUE copper clearance",
        movingPoint: previousCandidate,
        fixedCopper: foreignCopper,
        sharedEdge,
        requiredCenterDistance,
        traceWidth: input.minTraceWidth,
      }),
      createPanel({
        title: "AFTER · UNSAFE REDISTRIBUTION SKIPPED",
        subtitle: "RED route port keeps its original safe position",
        movingPoint: routedPoint,
        fixedCopper: foreignCopper,
        sharedEdge,
        requiredCenterDistance,
        traceWidth: input.minTraceWidth,
      }),
    ],
    { gap: 16, normalizeSize: false },
  )
  await expect(comparisonSvg.replace(/[ \t]+$/gm, "")).toMatchSvgSnapshot(
    import.meta.path,
    { svgName: "preloaded-copper-clearance", tolerance: 0.02 },
  )
})
