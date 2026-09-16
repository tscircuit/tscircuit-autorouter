import { expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { gunzipSync } from "node:zlib"
import type { CircuitJson } from "circuit-json"
import { convertCircuitJsonToPcbSvg } from "circuit-to-svg"
import { getSvgFromGraphicsObject } from "graphics-debug"
import {
  UniformPortDistributionSolver,
  type UniformPortDistributionSolverInput,
} from "lib/solvers/UniformPortDistributionSolver/UniformPortDistributionSolver"
import type { SimpleRouteJson } from "lib/types"
import { getConnectivityMapFromSimpleRouteJson } from "lib/utils/getConnectivityMapFromSimpleRouteJson"
import { stackSvgsHorizontally } from "stack-svgs"

const exactBoardFixtureDirectory =
  "../../fixtures/bug-reports/t113-linux-exact-pipeline9-root/"
const stageFixtureDirectory =
  "../../fixtures/bug-reports/t113-uniform-terminal-collision/"
const targetPortPointId = "ce750_pp1_z0::0"
const foreignTerminalId =
  "tiny-terminal:end-port:breakout:pcb_breakout_point_5"

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

test("captures T113 uniform redistribution onto a foreign terminal", async () => {
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
  >(
    stageFixtureDirectory,
    "t113-uniform-terminal-collision.input.json.gz",
  )

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
  expect(redistributedPortPoint.x).toBeCloseTo(4.2, 6)
  expect(actualCenterDistance).toBeLessThan(requiredCenterDistance)

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
      [convertCircuitJsonToPcbSvg(circuitJson), issueSvg],
      { gap: 12, normalizeSize: false },
    ).replace(/[ \t]+$/gm, ""),
  ).toMatchSvgSnapshot(import.meta.path, {
    svgName: "real-pcb-and-uniform-stage",
    tolerance: 0.02,
  })
})
