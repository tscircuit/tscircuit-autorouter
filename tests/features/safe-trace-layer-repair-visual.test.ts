import { expect, test } from "bun:test"
import { getSvgFromGraphicsObject, type GraphicsObject } from "graphics-debug"
import { stackSvgsHorizontally } from "stack-svgs"
import { VisualizedGlobalDrcForceImproveSolver } from "high-density-repair03/fixture-support/VisualizedGlobalDrcForceImproveSolver"
import type {
  DrcEvaluator,
  HighDensityRoute,
  SimpleRouteJson,
} from "high-density-repair03/lib"

const addPanelHeader = ({
  svg,
  title,
  details,
}: {
  svg: string
  title: string
  details: [string, string]
}) => {
  const headerHeight = 76
  const bodyStart = svg.indexOf(">") + 1
  const bodyEnd = svg.lastIndexOf("</svg>")
  const width = Number(svg.match(/\bwidth="([^"]+)"/)?.[1] ?? 560)
  const height = Number(svg.match(/\bheight="([^"]+)"/)?.[1] ?? 360)

  return `<svg width="${width}" height="${
    height + headerHeight
  }" viewBox="0 0 ${width} ${
    height + headerHeight
  }" xmlns="http://www.w3.org/2000/svg"><rect width="100%" height="100%" fill="white"/><text x="16" y="22" font-family="monospace" font-size="15" font-weight="700" fill="#111">${title}</text><text x="16" y="43" font-family="monospace" font-size="12" fill="#444">${details[0]}</text><text x="16" y="61" font-family="monospace" font-size="12" fill="#444">${details[1]}</text><g transform="translate(0 ${headerHeight})">${svg.slice(
    bodyStart,
    bodyEnd,
  )}</g></svg>`
}

test("visualizes safe layer moves at internal and terminal boundaries", () => {
  const srj: SimpleRouteJson = {
    bounds: { minX: -3, minY: -2, maxX: 3, maxY: 2 },
    connections: [
      {
        name: "terminal",
        pointsToConnect: [
          { x: -2, y: -0.7, layer: "top", pointId: "terminal-start" },
          { x: 2, y: -0.7, layer: "top", pointId: "terminal-end" },
        ],
      },
      {
        name: "terminalBlocker",
        pointsToConnect: [
          { x: 0, y: -1.2, layer: "top", pointId: "terminal-blocker-a" },
          { x: 0, y: -0.2, layer: "top", pointId: "terminal-blocker-b" },
        ],
      },
      {
        name: "internal",
        pointsToConnect: [
          { x: -2, y: 0.8, layer: "top", pointId: "internal-start" },
          { x: 2, y: 0.8, layer: "top", pointId: "internal-end" },
        ],
      },
      {
        name: "internalBlocker",
        pointsToConnect: [
          { x: 0, y: 0.3, layer: "top", pointId: "internal-blocker-a" },
          { x: 0, y: 1.3, layer: "top", pointId: "internal-blocker-b" },
        ],
      },
    ],
    obstacles: [
      {
        type: "rect",
        layers: ["top"],
        center: { x: -2, y: -0.7 },
        width: 0.4,
        height: 0.4,
        connectedTo: ["terminal", "terminal-start"],
      },
      {
        type: "rect",
        layers: ["top"],
        center: { x: 2, y: -0.7 },
        width: 0.4,
        height: 0.4,
        connectedTo: ["terminal", "terminal-end"],
      },
    ],
    layerCount: 3,
    minTraceWidth: 0.1,
    minViaDiameter: 0.3,
  }
  const hdRoutes: HighDensityRoute[] = [
    {
      connectionName: "terminal",
      route: [
        {
          x: -2,
          y: -0.7,
          z: 0,
          pcb_port_id: "terminal-start",
        },
        { x: -0.5, y: -0.7, z: 0 },
        { x: 0.5, y: -0.7, z: 0 },
        { x: 2, y: -0.7, z: 0, pcb_port_id: "terminal-end" },
      ],
      vias: [],
      traceThickness: 0.1,
      viaDiameter: 0.3,
    },
    {
      connectionName: "terminalBlocker",
      route: [
        { x: 0, y: -1.2, z: 0 },
        { x: 0, y: -0.2, z: 0 },
      ],
      vias: [],
      traceThickness: 0.1,
      viaDiameter: 0.3,
    },
    {
      connectionName: "internal",
      route: [
        { x: -2, y: 0.8, z: 0, pcb_port_id: "internal-start" },
        { x: -1, y: 0.8, z: 0 },
        { x: -1, y: 0.8, z: 2 },
        { x: -0.5, y: 0.8, z: 2 },
        { x: -0.5, y: 0.8, z: 1 },
        { x: 0.5, y: 0.8, z: 1 },
        { x: 0.5, y: 0.8, z: 2 },
        { x: 1, y: 0.8, z: 2 },
        { x: 1, y: 0.8, z: 0 },
        { x: 2, y: 0.8, z: 0, pcb_port_id: "internal-end" },
      ],
      vias: [
        { x: -1, y: 0.8 },
        { x: -0.5, y: 0.8 },
        { x: 0.5, y: 0.8 },
        { x: 1, y: 0.8 },
      ],
      traceThickness: 0.1,
      viaDiameter: 0.3,
    },
    {
      connectionName: "internalBlocker",
      route: [
        { x: 0, y: 0.3, z: 1 },
        { x: 0, y: 1.3, z: 1 },
      ],
      vias: [],
      traceThickness: 0.1,
      viaDiameter: 0.3,
    },
  ]
  const drcEvaluator: DrcEvaluator = ({ hdRoutes, routes }) => {
    const candidateRoutes = hdRoutes ?? routes ?? []
    const terminal = candidateRoutes.find(
      (route) => route.connectionName === "terminal",
    )
    const internal = candidateRoutes.find(
      (route) => route.connectionName === "internal",
    )
    const terminalRepaired =
      terminal?.route.some((point) => point.z === 2) &&
      terminal.vias.length === 2 &&
      terminal.vias.every((via) => Math.abs(via.x) > 1.5)
    const internalRepaired =
      internal?.route
        .filter((point) => Math.abs(point.x) <= 0.5)
        .every((point) => point.z === 2) && internal.vias.length === 2
    const errors = [
      ...(!terminalRepaired
        ? [
            {
              type: "pcb_trace_error",
              pcb_trace_id: "terminalBlocker_0",
              pcb_trace_error_id: "overlap_terminalBlocker_0_terminal_0",
              center: { x: 0, y: -0.7 },
              message: "Terminal trace crosses another trace",
            },
          ]
        : []),
      ...(!internalRepaired
        ? [
            {
              type: "pcb_trace_error",
              pcb_trace_id: "internal_0",
              pcb_trace_error_id: "overlap_internal_0_internalBlocker_0",
              center: { x: 0, y: 0.8 },
              message: "Internal trace span crosses another trace",
            },
          ]
        : []),
    ]
    return { errors, errorsWithCenters: errors }
  }
  const solverParams = {
    srj,
    hdRoutes,
    drcEvaluator,
    maxIterations: 16,
    enableLargeBoardBroadFallback: false,
    enablePostSolveClearanceRelaxation: false,
    enableSafeTraceLayerMoves: true,
    enableViaInPadLayerMoves: false,
  }
  const solver = new VisualizedGlobalDrcForceImproveSolver(solverParams)
  const beforeGraphics = solver.visualize()

  solver.solve()

  const terminal = solver
    .getOutput()
    .find((route) => route.connectionName === "terminal")!
  const internal = solver
    .getOutput()
    .find((route) => route.connectionName === "internal")!
  expect(solver.failed).toBe(false)
  expect(solver.stats.initialDrcIssueCount).toBe(2)
  expect(solver.stats.finalDrcIssueCount).toBe(0)
  expect(solver.stats.globalDrcForceImproveViaInPadCandidatesAccepted).toBe(0)
  expect(terminal.vias).toHaveLength(2)
  expect(terminal.vias.every((via) => Math.abs(via.x) > 1.5)).toBe(true)
  expect(internal.vias).toEqual([
    { x: -1, y: 0.8 },
    { x: 1, y: 0.8 },
  ])
  expect(terminal.route[0]?.pcb_port_id).toBe("terminal-start")
  expect(terminal.route.at(-1)?.pcb_port_id).toBe("terminal-end")
  expect(internal.route[0]?.pcb_port_id).toBe("internal-start")
  expect(internal.route.at(-1)?.pcb_port_id).toBe("internal-end")

  const renderFrame = (graphics: GraphicsObject): string =>
    getSvgFromGraphicsObject(graphics, {
      backgroundColor: "white",
      svgWidth: 560,
      svgHeight: 360,
      hideInlineLabels: true,
    })

  expect(
    stackSvgsHorizontally(
      [
        addPanelHeader({
          svg: renderFrame(beforeGraphics),
          title: "BEFORE • 2 DRC ERRORS",
          details: [
            "Purple markers show both trace crossings.",
            "The internal conflict is bounded by four vias.",
          ],
        }),
        addPanelHeader({
          svg: renderFrame(solver.visualize()),
          title: "AFTER • 0 DRC ERRORS",
          details: [
            "Green z2 spans bypass both crossing traces.",
            "Terminal vias clear pads; internal vias collapse 4 → 2.",
          ],
        }),
      ],
      {
        gap: 12,
        normalizeSize: false,
      },
    ),
  ).toMatchSvgSnapshot(import.meta.path)
})
