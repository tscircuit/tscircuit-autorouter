import { expect, test } from "bun:test"
import { AutoroutingPipelineSolver7_MultiGraph } from "lib/autorouter-pipelines/AutoroutingPipeline7_MultiGraph/AutoroutingPipelineSolver7_MultiGraph"
import type { SimpleRouteJson } from "lib/types"

test("disabling blind and buried vias fails closed on crossed copper but permits plane antipads", () => {
  const createInput = ({
    terminalVia = false,
    isCopperPour = false,
    sameNetPad = false,
  }: {
    terminalVia?: boolean
    isCopperPour?: boolean
    sameNetPad?: boolean
  }): SimpleRouteJson => ({
    layerCount: 4,
    allowBlindAndBuriedVias: false,
    bounds: { minX: -1, maxX: 4, minY: -1, maxY: 1 },
    minTraceWidth: 0.15,
    minViaDiameter: 0.5,
    obstacles: [
      {
        type: "rect",
        layers: ["inner2"],
        center: { x: terminalVia ? 0 : 1.5, y: 0 },
        width: terminalVia ? 0.8 : 10,
        height: terminalVia ? 0.8 : 10,
        connectedTo: isCopperPour ? ["GROUND"] : sameNetPad ? ["SIG"] : [],
        obstacleId: isCopperPour
          ? "inner2-pour"
          : sameNetPad
            ? "same-net-pad"
            : "inner2-blocker",
        isCopperPour,
      },
    ],
    connections: [
      {
        name: "SIG",
        pointsToConnect: [
          {
            x: 0,
            y: 0,
            layer: "top",
            pointId: "start",
            ...(terminalVia ? { terminalVia: { toLayer: "inner1" } } : {}),
          },
          { x: 3, y: 0, layer: "inner1", pointId: "end" },
        ],
      },
    ],
  })
  const solve = (input: SimpleRouteJson) => {
    const solver = new AutoroutingPipelineSolver7_MultiGraph(input, {
      cacheProvider: null,
      effort: 0.1,
    })
    solver.solve()
    return solver
  }

  const routedViaCollision = solve(createInput({}))
  expect(routedViaCollision.solved).toBe(false)
  expect(routedViaCollision.failed).toBe(true)
  expect(routedViaCollision.error).toContain(
    "collides with obstacle inner2-blocker on inner2",
  )

  const terminalViaCollision = solve(createInput({ terminalVia: true }))
  expect(terminalViaCollision.solved).toBe(false)
  expect(terminalViaCollision.failed).toBe(true)
  expect(terminalViaCollision.error).toContain(
    "collides with obstacle inner2-blocker on inner2",
  )

  const planeAntipad = solve(createInput({ isCopperPour: true }))
  expect(planeAntipad.solved).toBe(true)
  expect(planeAntipad.failed).toBe(false)
  const vias = planeAntipad
    .getOutputSimplifiedPcbTraces()
    .flatMap((trace) => trace.route)
    .filter((routePoint) => routePoint.route_type === "via")
  expect(vias).not.toHaveLength(0)
  expect(
    vias.every((via) => via.from_layer === "top" && via.to_layer === "bottom"),
  ).toBe(true)

  const sameNetPad = solve(createInput({ sameNetPad: true }))
  expect(sameNetPad.solved).toBe(true)
  expect(sameNetPad.failed).toBe(false)
})
