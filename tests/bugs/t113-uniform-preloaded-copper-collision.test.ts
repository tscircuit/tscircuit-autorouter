import { expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { gunzipSync } from "node:zlib"
import type { CircuitJson } from "circuit-json"
import { convertCircuitJsonToPcbSvg } from "circuit-to-svg"
import { getSvgFromGraphicsObject, type GraphicsObject } from "graphics-debug"
import {
  UniformPortDistributionSolver,
  type UniformPortDistributionSolverInput,
} from "lib/solvers/UniformPortDistributionSolver/UniformPortDistributionSolver"
import { convertToCircuitJson } from "lib/testing/utils/convertToCircuitJson"
import type { SimpleRouteJson, SimplifiedPcbTrace } from "lib/types"
import { convertSrjToGraphicsObject } from "lib/utils/convertSrjToGraphicsObject"
import { getConnectivityMapFromSimpleRouteJson } from "lib/utils/getConnectivityMapFromSimpleRouteJson"
import { stackSvgsHorizontally } from "stack-svgs"

const exactBoardFixtureDirectory =
  "../../fixtures/bug-reports/t113-linux-exact-pipeline9-root/"
const stageFixtureDirectory =
  "../../fixtures/bug-reports/t113-uniform-terminal-collision/"
const targetPortPointId = "ce1188_pp3_z0::0"
const foreignTraceConnectionName = "source_trace_52"
const foreignPcbTraceId =
  "source_trace_52__source_trace_54__source_trace_56__breakout:pcb_breakout_point_21_mst3_0"

const readCompressedFixture = <T>(
  directory: string,
  filename: string,
): T =>
  JSON.parse(
    gunzipSync(
      Uint8Array.from(
        readFileSync(new URL(`${directory}${filename}`, import.meta.url)),
      ),
    ).toString("utf8"),
  ) as T

const findPortPoint = (
  nodes: UniformPortDistributionSolverInput["nodeWithPortPoints"],
  portPointId: string,
) => {
  const portPoint = nodes
    .flatMap((node) => node.portPoints)
    .find((point) => point.portPointId === portPointId)
  if (!portPoint) throw new Error(`Missing port point ${portPointId}`)
  return portPoint
}

const pointToSegmentDistance = (
  point: { x: number; y: number },
  start: { x: number; y: number },
  end: { x: number; y: number },
) => {
  const dx = end.x - start.x
  const dy = end.y - start.y
  const lengthSquared = dx * dx + dy * dy
  if (lengthSquared === 0) return Math.hypot(point.x - start.x, point.y - start.y)
  const projection =
    ((point.x - start.x) * dx + (point.y - start.y) * dy) / lengthSquared
  const clampedProjection = Math.max(0, Math.min(1, projection))
  return Math.hypot(
    point.x - (start.x + clampedProjection * dx),
    point.y - (start.y + clampedProjection * dy),
  )
}

const mergeGraphics = (...objects: GraphicsObject[]): GraphicsObject => ({
  points: objects.flatMap((object) => object.points ?? []),
  lines: objects.flatMap((object) => object.lines ?? []),
  rects: objects.flatMap((object) => object.rects ?? []),
  circles: objects.flatMap((object) => object.circles ?? []),
  texts: objects.flatMap((object) => object.texts ?? []),
})

test("does not redistribute a T113 port onto preloaded copper", async () => {
  const circuitJson = readCompressedFixture<CircuitJson>(
    exactBoardFixtureDirectory,
    "t113-linux-exact-unrouted.circuit.json.gz",
  )
  const srj = readCompressedFixture<SimpleRouteJson>(
    exactBoardFixtureDirectory,
    "t113-linux-exact.srj.json.gz",
  )
  const input = readCompressedFixture<UniformPortDistributionSolverInput>(
    stageFixtureDirectory,
    "t113-uniform-terminal-collision.input.json.gz",
  )

  expect(
    circuitJson.filter((element) => element.type === "source_component"),
  ).toHaveLength(96)
  expect(srj.traces).toHaveLength(342)

  const solver = new UniformPortDistributionSolver({
    ...input,
    traceClearance: srj.minTraceToPadEdgeClearance ?? 0,
    viaDiameter: srj.minViaDiameter,
    preloadedTraces: srj.traces ?? [],
    connMap: getConnectivityMapFromSimpleRouteJson(srj),
  })
  solver.solve()

  const originalPortPoint = findPortPoint(
    input.nodeWithPortPoints,
    targetPortPointId,
  )
  const redistributedPortPoint = findPortPoint(
    solver.getOutput(),
    targetPortPointId,
  )
  const foreignTrace = srj.traces?.find(
    (trace) => trace.pcb_trace_id === foreignPcbTraceId,
  )
  if (!foreignTrace) throw new Error(`Missing ${foreignTraceConnectionName}`)

  let closestSegment: [
    Extract<(typeof foreignTrace.route)[number], { route_type: "wire" }>,
    Extract<(typeof foreignTrace.route)[number], { route_type: "wire" }>,
  ] | null = null
  let redistributedDistance = Number.POSITIVE_INFINITY
  for (let index = 1; index < foreignTrace.route.length; index++) {
    const start = foreignTrace.route[index - 1]
    const end = foreignTrace.route[index]
    if (
      start?.route_type !== "wire" ||
      end?.route_type !== "wire" ||
      start.layer !== "top" ||
      end.layer !== "top"
    ) {
      continue
    }
    const distance = pointToSegmentDistance(
      redistributedPortPoint,
      start,
      end,
    )
    if (distance < redistributedDistance) {
      closestSegment = [start, end]
      redistributedDistance = distance
    }
  }
  if (!closestSegment) throw new Error("Missing top-layer trace segment")

  const originalDistance = pointToSegmentDistance(
    originalPortPoint,
    closestSegment[0],
    closestSegment[1],
  )
  const requiredCenterDistance =
    input.minTraceWidth / 2 +
    closestSegment[1].width / 2 +
    (srj.minTraceToPadEdgeClearance ?? 0)

  expect(originalPortPoint.y).toBeCloseTo(-8.547402, 6)
  expect(redistributedPortPoint.y).toBe(originalPortPoint.y)
  expect(originalDistance).toBeGreaterThanOrEqual(requiredCenterDistance)
  expect(redistributedDistance).toBeGreaterThanOrEqual(
    requiredCenterDistance,
  )

  const exactSegment: SimplifiedPcbTrace = {
    ...foreignTrace,
    route: closestSegment,
  }
  const segmentGraphics = convertSrjToGraphicsObject(
    {
      ...srj,
      bounds: {
        minX: redistributedPortPoint.x - 0.6,
        maxX: redistributedPortPoint.x + 0.6,
        minY: redistributedPortPoint.y - 0.6,
        maxY: redistributedPortPoint.y + 0.6,
      },
      connections: [],
      obstacles: [],
      traces: [exactSegment],
    },
    { traceColorMode: "layer" },
  )
  segmentGraphics.lines = segmentGraphics.lines?.map((line) => ({
    ...line,
    strokeColor: "#222222",
  }))
  const focusGraphics = mergeGraphics(
    segmentGraphics,
    {
      circles: [
        {
          center: originalPortPoint,
          radius: input.minTraceWidth / 2,
          fill: "#3388ff",
          label: `original ${targetPortPointId}`,
        },
        {
          center: redistributedPortPoint,
          radius: input.minTraceWidth / 2,
          fill: "#ff3344",
          label: `redistributed ${targetPortPointId}`,
        },
        {
          center: redistributedPortPoint,
          radius: requiredCenterDistance,
          fill: "#ff334418",
          stroke: "#ff3344",
          label: "required clearance",
        },
      ],
      rects: [
        {
          center: redistributedPortPoint,
          width: 1.2,
          height: 1.2,
          fill: "#00000000",
        },
      ],
    },
  )
  const focusSvg = getSvgFromGraphicsObject(focusGraphics, {
    backgroundColor: "white",
    includeTextLabels: ["lines"],
    svgWidth: 900,
    svgHeight: 900,
  })
  const preloadedCopper = convertToCircuitJson(srj, srj.traces ?? []).filter(
    (element) => element.type === "pcb_trace" || element.type === "pcb_via",
  )

  await expect(
    stackSvgsHorizontally(
      [
        convertCircuitJsonToPcbSvg([...circuitJson, ...preloadedCopper]),
        focusSvg,
      ],
      { gap: 12, normalizeSize: false },
    ).replace(/[ \t]+$/gm, ""),
  ).toMatchSvgSnapshot(import.meta.path, {
    svgName: "real-pcb-and-uniform-stage",
    tolerance: 0.02,
  })
})
