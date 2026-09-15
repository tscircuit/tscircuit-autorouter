import { expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { gunzipSync } from "node:zlib"
import type { CircuitJson } from "circuit-json"
import { convertCircuitJsonToPcbSvg } from "circuit-to-svg"
import { getSvgFromGraphicsObject } from "graphics-debug"
import { Pipeline9HighDensitySolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9HighDensitySolver"
import {
  UniformPortDistributionSolver,
  type UniformPortDistributionSolverInput,
} from "lib/solvers/UniformPortDistributionSolver/UniformPortDistributionSolver"
import { getDrcErrors } from "lib/testing/getDrcErrors"
import { convertToCircuitJson } from "lib/testing/utils/convertToCircuitJson"
import type { SimpleRouteJson, SimplifiedPcbTrace } from "lib/types"
import { convertHdRouteToSimplifiedRoute } from "lib/utils/convertHdRouteToSimplifiedRoute"
import { getConnectivityMapFromSimpleRouteJson } from "lib/utils/getConnectivityMapFromSimpleRouteJson"
import { stackSvgsHorizontally } from "stack-svgs"

const exactBoardFixtureDirectory =
  "../../fixtures/bug-reports/t113-linux-exact-pipeline9-root/"
const stageFixtureDirectory =
  "../../fixtures/bug-reports/t113-uniform-terminal-collision/"
const targetPortPointId = "ce750_pp1_z0::0"
const foreignTerminalId = "tiny-terminal:end-port:breakout:pcb_breakout_point_5"

const readCompressedFixture = <T>(directory: string, filename: string): T =>
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

test("does not redistribute a real T113 U1 route onto a foreign terminal", async () => {
  const circuitJson = readCompressedFixture<CircuitJson>(
    exactBoardFixtureDirectory,
    "t113-linux-exact-unrouted.circuit.json.gz",
  )
  const srj = readCompressedFixture<SimpleRouteJson>(
    exactBoardFixtureDirectory,
    "t113-linux-exact.srj.json.gz",
  )
  const input = readCompressedFixture<
    UniformPortDistributionSolverInput & {
      layerCount: number
      minTraceWidth: number
    }
  >(stageFixtureDirectory, "t113-uniform-terminal-collision.input.json.gz")

  expect(
    circuitJson.filter((element) => element.type === "source_component"),
  ).toHaveLength(96)
  expect(
    circuitJson.filter((element) => element.type === "pcb_component"),
  ).toHaveLength(96)
  expect(
    circuitJson.filter(
      (element) => element.type === "pcb_trace" || element.type === "pcb_via",
    ),
  ).toEqual([])

  const solver = new UniformPortDistributionSolver({
    ...input,
    connMap: getConnectivityMapFromSimpleRouteJson(srj),
    traceClearance: srj.minTraceToPadEdgeClearance,
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
  const foreignTerminal = findPortPoint(
    input.nodeWithPortPoints,
    foreignTerminalId,
  )
  const requiredCenterDistance =
    input.minTraceWidth + (srj.minTraceToPadEdgeClearance ?? 0)
  const actualCenterDistance = Math.hypot(
    redistributedPortPoint.x - foreignTerminal.x,
    redistributedPortPoint.y - foreignTerminal.y,
  )

  expect(originalPortPoint.x).toBeCloseTo(3.098215714, 6)
  expect(redistributedPortPoint.x).toBe(originalPortPoint.x)
  expect(actualCenterDistance).toBeGreaterThanOrEqual(requiredCenterDistance)

  const affectedNode = solver
    .getOutput()
    .find((node) => node.capacityMeshNodeId === "cmn_18")
  if (!affectedNode) throw new Error("Missing affected node cmn_18")
  const highDensitySolver = new Pipeline9HighDensitySolver({
    nodePortPoints: [affectedNode],
    fixedHdRoutes: [],
    connMap: getConnectivityMapFromSimpleRouteJson(srj),
    obstacles: [],
    boardGeometry: { bounds: srj.bounds, outline: srj.outline },
    layerCount: srj.layerCount,
    viaDiameter: 0.45,
    traceWidth: srj.minTraceWidth,
    obstacleMargin: srj.minTraceToPadEdgeClearance ?? 0.1,
    effort: 1,
    enableRegionalFallback: false,
  })
  highDensitySolver.solve()
  expect(highDensitySolver.solved).toBe(true)
  expect(highDensitySolver.failed).toBe(false)
  expect(highDensitySolver.routes).toHaveLength(6)

  const routedTraces: SimplifiedPcbTrace[] = highDensitySolver.routes.map(
    (route, routeIndex) => ({
      type: "pcb_trace",
      pcb_trace_id: `t113_cmn_18_${routeIndex}`,
      connection_name: route.connectionName,
      route: convertHdRouteToSimplifiedRoute(route, srj.layerCount),
    }),
  )
  const routedCopper = convertToCircuitJson(srj, routedTraces).filter(
    (element) => element.type === "pcb_trace" || element.type === "pcb_via",
  )
  expect(
    routedCopper.filter((element) => element.type === "pcb_trace"),
  ).toHaveLength(6)
  expect(
    routedCopper.filter((element) => element.type === "pcb_via"),
  ).toHaveLength(5)
  expect(
    getDrcErrors(routedCopper, {
      traceClearance: srj.minTraceToPadEdgeClearance,
      includeTraceContinuity: false,
    }).errors,
  ).toEqual([])

  const focusCenter = {
    x: (originalPortPoint.x + foreignTerminal.x) / 2,
    y: foreignTerminal.y,
  }
  const issueSvg = getSvgFromGraphicsObject(
    {
      circles: [
        {
          center: foreignTerminal,
          radius: input.minTraceWidth / 2,
          fill: "#3388ff",
          label: foreignTerminalId,
        },
        {
          center: redistributedPortPoint,
          radius: input.minTraceWidth / 2,
          fill: "#ff334488",
          stroke: "#ff3344",
          label: targetPortPointId,
        },
      ],
      rects: [
        {
          center: focusCenter,
          width: 1.7,
          height: 0.8,
          fill: "#00000000",
        },
      ],
    },
    {
      backgroundColor: "white",
      svgWidth: 900,
      svgHeight: 500,
    },
  )

  await expect(
    stackSvgsHorizontally(
      [
        convertCircuitJsonToPcbSvg(circuitJson),
        issueSvg,
        convertCircuitJsonToPcbSvg([...circuitJson, ...routedCopper]),
      ],
      { gap: 12, normalizeSize: false },
    ).replace(/[ \t]+$/gm, ""),
  ).toMatchSvgSnapshot(import.meta.path, {
    svgName: "real-pcb-and-uniform-stage",
    tolerance: 0.02,
  })
})
