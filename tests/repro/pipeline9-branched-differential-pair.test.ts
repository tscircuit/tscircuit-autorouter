import { expect, test } from "bun:test"
import type { GraphicsObject } from "graphics-debug"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/autorouting-pipeline-solver9-preloaded-trace-graph"
import type { SimpleRouteJson } from "lib/types"
import { combineVisualizations } from "lib/utils/combineVisualizations"
import { convertSrjToGraphicsObject } from "lib/utils/convertSrjToGraphicsObject"
import { getGraphicsSvgFrames } from "../fixtures/solver-svg-frames"
import rv1106g2 from "./assets/rv1106g2-pipeline9-branched-differential-pair.json" with {
  type: "json",
}

test("Pipeline9 repro from the RV1106G2 branched Ethernet differential pairs", async () => {
  const inputSrj = structuredClone(rv1106g2) as SimpleRouteJson
  const ethernetLineNames = {
    source_trace_230: "ETH_TXP_LINE",
    source_trace_231: "ETH_TXN_LINE",
    source_trace_232: "ETH_RXP_LINE",
    source_trace_233: "ETH_RXN_LINE",
  } as const
  const ethernetLineColors = {
    source_trace_230: "#dc2626",
    source_trace_231: "#ea580c",
    source_trace_232: "#2563eb",
    source_trace_233: "#7c3aed",
  } as const
  const ethernetLineIds = Object.keys(ethernetLineNames) as Array<
    keyof typeof ethernetLineNames
  >
  const solver = new AutoroutingPipelineSolver9_PreloadedTraceGraph(inputSrj, {
    cacheProvider: null,
    visualizationTraceColorMode: "net",
  })

  solver.solveUntilPhase("topologyPlanningSolver")

  const pointPairConnections = solver.netToPointPairsSolver!.newConnections
  for (const connectionName of ethernetLineIds) {
    expect(
      pointPairConnections.filter((connection) =>
        connection.__rootConnectionNames?.includes(connectionName),
      ),
    ).toHaveLength(2)
  }

  const lengthMatchingStep = solver.pipelineDef.find(
    (step) => step.solverName === "lengthMatchingPostProcessingSolver",
  )!
  expect(() => lengthMatchingStep.getConstructorParams(solver)).toThrow(
    'Pipeline9: differential pair connection "source_trace_230" must resolve to exactly one final point-pair connection, got 2',
  )

  const duplicatedPointPairs = pointPairConnections.filter((connection) =>
    ethernetLineIds.some((connectionName) =>
      connection.__rootConnectionNames?.includes(connectionName),
    ),
  )
  const highlightedLines = duplicatedPointPairs.map((connection) => {
    const rootConnectionName = ethernetLineIds.find((connectionName) =>
      connection.__rootConnectionNames?.includes(connectionName),
    )!
    return {
      points: connection.pointsToConnect.map(({ x, y }) => ({ x, y })),
      strokeColor: ethernetLineColors[rootConnectionName],
      strokeWidth: 0.18,
      label: `${ethernetLineNames[rootConnectionName]} child route`,
    }
  })
  const requestedLines = inputSrj.connections
    .filter((connection) =>
      ethernetLineIds.includes(
        connection.name as keyof typeof ethernetLineNames,
      ),
    )
    .map((connection) => ({
      points: connection.pointsToConnect.map(({ x, y }) => ({ x, y })),
      strokeColor: "rgba(17,24,39,0.55)",
      strokeWidth: 0.12,
      strokeDash: [0.25, 0.15],
      label: `${ethernetLineNames[connection.name as keyof typeof ethernetLineNames]} requested route`,
    }))
  const issueGraphics: GraphicsObject = {
    lines: [...requestedLines, ...highlightedLines],
    points: duplicatedPointPairs.flatMap((connection) =>
      connection.pointsToConnect.map(({ x, y }) => ({
        x,
        y,
        color: "#111827",
      })),
    ),
    texts: [
      { x: 1.55, y: 11.75, text: "R14", color: "black", fontSize: 0.28 },
      { x: 3.55, y: 11.75, text: "R15", color: "black", fontSize: 0.28 },
      { x: 1.55, y: 13.05, text: "R16", color: "black", fontSize: 0.28 },
      { x: 3.55, y: 13.05, text: "R17", color: "black", fontSize: 0.28 },
      { x: 2.5, y: 15.5, text: "D3 ESD", color: "black", fontSize: 0.28 },
      { x: 2.5, y: 17.5, text: "D4 ESD", color: "black", fontSize: 0.28 },
      { x: 3.9, y: 22.8, text: "J_ETH", color: "black", fontSize: 0.28 },
      {
        x: -1.6,
        y: 24.2,
        text: "ETH_TXP_LINE",
        color: "#dc2626",
        fontSize: 0.24,
      },
      {
        x: -1.6,
        y: 23.75,
        text: "ETH_TXN_LINE",
        color: "#ea580c",
        fontSize: 0.24,
      },
      {
        x: 2.1,
        y: 24.2,
        text: "ETH_RXP_LINE",
        color: "#2563eb",
        fontSize: 0.24,
      },
      {
        x: 2.1,
        y: 23.75,
        text: "ETH_RXN_LINE",
        color: "#7c3aed",
        fontSize: 0.24,
      },
    ],
  }
  const fullBoardGraphics = combineVisualizations(
    convertSrjToGraphicsObject(inputSrj, { traceColorMode: "layer" }),
    issueGraphics,
  )

  await expect(
    getGraphicsSvgFrames({
      frames: [
        {
          name: "REAL BOARD • RV1106G2 Pipeline9 input",
          step: "start",
          iteration: 0,
          graphics: fullBoardGraphics,
        },
      ],
      columns: 1,
      backgroundColor: "white",
    }),
  ).toMatchSvgSnapshot(import.meta.path, { svgName: "full-board" })
  await expect(
    getGraphicsSvgFrames({
      frames: [
        {
          name: "FAILURE • 4 Ethernet members become 8 child routes",
          step: "end",
          iteration: 2,
          graphics: issueGraphics,
        },
      ],
      columns: 1,
      backgroundColor: "white",
    }),
  ).toMatchSvgSnapshot(import.meta.path, { svgName: "ethernet-split" })
})
