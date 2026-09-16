import { expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { gunzipSync } from "node:zlib"
import { getSvgFromGraphicsObject } from "graphics-debug"
import {
  UniformPortDistributionSolver,
  type UniformPortDistributionSolverInput,
} from "lib/solvers/UniformPortDistributionSolver/UniformPortDistributionSolver"
import { redistributePortPointsOnSharedEdge } from "lib/solvers/UniformPortDistributionSolver/redistributePortPointsOnSharedEdge"
import { shouldIgnorePortPoint } from "lib/solvers/UniformPortDistributionSolver/shouldIgnorePortPoint"
import type { SimpleRouteJson } from "lib/types"
import { getConnectivityMapFromSimpleRouteJson } from "lib/utils/getConnectivityMapFromSimpleRouteJson"
import { stackSvgsHorizontally, stackSvgsVertically } from "stack-svgs"

const targetPortPointId = "ce750_pp1_z0::0"
const fixedTerminalId = "tiny-terminal:end-port:breakout:pcb_breakout_point_5"
const traceClearance = 0.1

const distanceBetween = (
  a: { x: number; y: number },
  b: { x: number; y: number },
): number => Math.hypot(a.x - b.x, a.y - b.y)

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
  fixedPoint,
  edge,
  requiredCenterDistance,
  traceWidth,
}: {
  title: string
  subtitle: string
  movingPoint: { x: number; y: number }
  fixedPoint: { x: number; y: number }
  edge: { x1: number; y1: number; x2: number; y2: number }
  requiredCenterDistance: number
  traceWidth: number
}): string => {
  const graphic = getSvgFromGraphicsObject(
    {
      lines: [
        {
          points: [
            { x: edge.x1, y: edge.y1 },
            { x: edge.x2, y: edge.y2 },
          ],
          strokeColor: "#9ca3af",
          strokeWidth: 0.02,
          label: "shared capacity edge",
        },
      ],
      circles: [
        {
          center: fixedPoint,
          radius: requiredCenterDistance,
          fill: "#2563eb14",
          stroke: "#2563eb",
          label: "required clearance from fixed terminal",
        },
        {
          center: fixedPoint,
          radius: traceWidth / 2,
          fill: "#2563eb",
          label: "fixed HDMI terminal",
        },
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
          center: { x: (edge.x1 + edge.x2) / 2, y: edge.y1 },
          width: edge.x2 - edge.x1 + 0.4,
          height: 0.8,
          fill: "#00000000",
          stroke: "#00000000",
        },
      ],
    },
    { backgroundColor: "white", svgWidth: 700, svgHeight: 360 },
  )
  return stackSvgsVertically([createLabel(title, subtitle), graphic], {
    gap: 0,
    normalizeSize: false,
  })
}

test("does not redistribute a T113 route port onto a fixed terminal", async () => {
  const fixturePath = new URL(
    "../../fixtures/bug-reports/t113-uniform-terminal-collision/t113-uniform-terminal-collision.input.json.gz",
    import.meta.url,
  )
  const input = JSON.parse(
    gunzipSync(Uint8Array.from(readFileSync(fixturePath))).toString("utf8"),
  ) as UniformPortDistributionSolverInput
  const srjFixturePath = new URL(
    "../../fixtures/bug-reports/t113-linux-exact-pipeline9-root/t113-linux-exact.srj.json.gz",
    import.meta.url,
  )
  const srj = JSON.parse(
    gunzipSync(Uint8Array.from(readFileSync(srjFixturePath))).toString("utf8"),
  ) as SimpleRouteJson
  expect(input.nodeWithPortPoints).toHaveLength(177)
  expect(input.inputNodesWithPortPoints).toHaveLength(4055)
  expect(input.obstacles).toHaveLength(458)

  const solver = new UniformPortDistributionSolver({
    ...input,
    traceClearance,
    connMap: getConnectivityMapFromSimpleRouteJson(srj),
  })
  const originalPoint = getPoint(input.nodeWithPortPoints, targetPortPointId)
  const fixedTerminal = getPoint(input.nodeWithPortPoints, fixedTerminalId)
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

  const requiredCenterDistance = input.minTraceWidth + traceClearance
  expect(distanceBetween(previousCandidate, fixedTerminal)).toBeLessThan(
    requiredCenterDistance,
  )

  solver.solve()
  const routedPoint = getPoint(solver.getOutput(), targetPortPointId)
  expect(routedPoint).toMatchObject({
    x: originalPoint.x,
    y: originalPoint.y,
  })
  expect(distanceBetween(routedPoint, fixedTerminal)).toBeGreaterThanOrEqual(
    requiredCenterDistance,
  )

  const comparisonSvg = stackSvgsHorizontally(
    [
      createPanel({
        title: "BEFORE · PORT MOVED ONTO FIXED TERMINAL",
        subtitle: "RED route port overlaps the BLUE terminal clearance",
        movingPoint: previousCandidate,
        fixedPoint: fixedTerminal,
        edge: sharedEdge,
        requiredCenterDistance,
        traceWidth: input.minTraceWidth,
      }),
      createPanel({
        title: "AFTER · UNSAFE REDISTRIBUTION SKIPPED",
        subtitle: "RED route port keeps its original safe position",
        movingPoint: routedPoint,
        fixedPoint: fixedTerminal,
        edge: sharedEdge,
        requiredCenterDistance,
        traceWidth: input.minTraceWidth,
      }),
    ],
    { gap: 16, normalizeSize: false },
  )
  await expect(comparisonSvg.replace(/[ \t]+$/gm, "")).toMatchSvgSnapshot(
    import.meta.path,
    { svgName: "fixed-terminal-clearance", tolerance: 0.02 },
  )
})
