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
import type { SimpleRouteJson, SimplifiedPcbTrace } from "lib/types"
import { convertSrjToGraphicsObject } from "lib/utils/convertSrjToGraphicsObject"
import { getConnectivityMapFromSimpleRouteJson } from "lib/utils/getConnectivityMapFromSimpleRouteJson"
import { stackSvgsHorizontally } from "stack-svgs"

const fixtureDirectory =
  "../../fixtures/bug-reports/t113-uniform-preloaded-copper/"
const targetPortPointId = "ce2335_pp0_z3::3"

const readCompressedFixture = <T>(filename: string): T =>
  JSON.parse(
    gunzipSync(
      Uint8Array.from(
        readFileSync(
          new URL(`${fixtureDirectory}${filename}`, import.meta.url),
        ),
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

const mergeGraphics = (...objects: GraphicsObject[]): GraphicsObject => ({
  points: objects.flatMap((object) => object.points ?? []),
  lines: objects.flatMap((object) => object.lines ?? []),
  rects: objects.flatMap((object) => object.rects ?? []),
  circles: objects.flatMap((object) => object.circles ?? []),
  texts: objects.flatMap((object) => object.texts ?? []),
})

test("does not redistribute a real T113 supervisor port onto preloaded copper", async () => {
  const circuitJson = readCompressedFixture<CircuitJson>(
    "t113-uniform-preloaded-copper.circuit.json.gz",
  )
  const srj = readCompressedFixture<SimpleRouteJson>(
    "t113-uniform-preloaded-copper.srj.json.gz",
  )
  const input = readCompressedFixture<
    UniformPortDistributionSolverInput & {
      layerCount: number
      minTraceWidth: number
    }
  >("t113-uniform-preloaded-copper.input.json.gz")

  expect(
    circuitJson.filter((element) => element.type === "source_component"),
  ).toHaveLength(41)
  expect(
    circuitJson.filter((element) => element.type === "pcb_component"),
  ).toHaveLength(41)
  expect(
    circuitJson.filter(
      (element) => element.type === "pcb_trace" || element.type === "pcb_via",
    ),
  ).toEqual([])

  const solver = new UniformPortDistributionSolver({
    ...input,
    preloadedTraces: srj.traces,
    connMap: getConnectivityMapFromSimpleRouteJson(srj),
    traceClearance: srj.minTraceToPadEdgeClearance,
  } as UniformPortDistributionSolverInput)
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
    (trace) => trace.connection_name === "source_trace_27",
  )
  if (!foreignTrace) throw new Error("Missing preloaded source_trace_27")
  const verticalSegment = foreignTrace.route.findIndex(
    (point, index, route) => {
      const previousPoint = route[index - 1]
      return (
        point.route_type === "wire" &&
        previousPoint?.route_type === "wire" &&
        point.x === previousPoint.x &&
        Math.min(point.y, previousPoint.y) <= redistributedPortPoint.y &&
        Math.max(point.y, previousPoint.y) >= redistributedPortPoint.y
      )
    },
  )
  expect(verticalSegment).toBeGreaterThan(0)
  const segmentStart = foreignTrace.route[verticalSegment - 1]!
  const segmentEnd = foreignTrace.route[verticalSegment]!
  if (segmentStart.route_type !== "wire" || segmentEnd.route_type !== "wire") {
    throw new Error("Expected the crossing segment to be copper wire")
  }

  const requiredCenterDistance =
    input.minTraceWidth / 2 +
    segmentEnd.width / 2 +
    (srj.minTraceToPadEdgeClearance ?? 0)
  const actualCenterDistance = Math.abs(redistributedPortPoint.x - segmentEnd.x)

  expect(originalPortPoint.x).toBeCloseTo(-2.042498, 6)
  expect(redistributedPortPoint.x).toBeCloseTo(-1.789999, 6)
  expect(actualCenterDistance).toBeLessThan(requiredCenterDistance)

  const exactSegment: SimplifiedPcbTrace = {
    ...foreignTrace,
    route: [segmentStart, segmentEnd],
  }
  const focusGraphics = mergeGraphics(
    convertSrjToGraphicsObject(
      {
        ...srj,
        bounds: {
          minX: redistributedPortPoint.x - 0.5,
          maxX: redistributedPortPoint.x + 0.5,
          minY: redistributedPortPoint.y - 0.5,
          maxY: redistributedPortPoint.y + 0.5,
        },
        connections: [],
        obstacles: [],
        traces: [exactSegment],
      },
      { traceColorMode: "layer" },
    ),
    {
      circles: [
        {
          center: redistributedPortPoint,
          radius: input.minTraceWidth / 2,
          fill: "#ff3344",
          label: targetPortPointId,
        },
      ],
      rects: [
        {
          center: redistributedPortPoint,
          width: 1,
          height: 1,
          fill: "#00000000",
        },
      ],
    },
  )
  const issueSvg = getSvgFromGraphicsObject(focusGraphics, {
    backgroundColor: "white",
    includeTextLabels: ["lines"],
    svgWidth: 900,
    svgHeight: 900,
  })

  await expect(
    stackSvgsHorizontally([convertCircuitJsonToPcbSvg(circuitJson), issueSvg], {
      gap: 12,
      normalizeSize: false,
    }).replace(/[ \t]+$/gm, ""),
  ).toMatchSvgSnapshot(import.meta.path, {
    svgName: "real-pcb-and-uniform-stage",
    tolerance: 0.02,
  })
})
