import { expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { gunzipSync } from "node:zlib"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import type { SimpleRouteConnection, SimpleRouteJson } from "lib/types"
import { convertSrjToGraphicsObject } from "lib/utils/convertSrjToGraphicsObject"
import { renderPlanarShortcutView } from "../../fixtures/renderPlanarShortcutView"

test("RVboy reuses the battery regulator's retained ground escape in the signal phase", async (): Promise<void> => {
  const fixture = JSON.parse(
    gunzipSync(
      new Uint8Array(
        readFileSync(
          new URL(
            "../../fixtures/rvboy-native-preloaded-ground.json.gz",
            import.meta.url,
          ),
        ),
      ),
    ).toString(),
  ) as { input: SimpleRouteJson; beforeConnection: SimpleRouteConnection }
  const original = structuredClone(fixture.input)
  const solver = new AutoroutingPipelineSolver9_PreloadedTraceGraph(
    fixture.input,
    { effort: 5, cacheProvider: null },
  )
  while (!solver.netToPointPairsSolver?.solved && !solver.failed) solver.step()
  expect(solver.failed).toBeFalse()
  const escape = solver.escapeViaLocationSolver!
  expect(
    escape.createdEscapeVias.some((via) => via.sourcePointId === "pcb_port_39"),
  ).toBeFalse()
  expect(
    solver.srjWithPointPairs!.connections.some((connection) =>
      connection.pointsToConnect.some(
        (point) => point.pointId === "pcb_port_39",
      ),
    ),
  ).toBeFalse()
  expect(
    escape
      .getOutputSimpleRouteJson()
      .connections.some((connection) =>
        connection.externallyConnectedPointIds?.some(
          (ids) => ids.includes("pcb_port_39") && ids.length > 1,
        ),
      ),
  ).toBeTrue()
  expect(solver.srjWithPointPairs!.traces).toEqual(fixture.input.traces)
  expect(fixture.input).toEqual(original)
  for (const [state, connections] of [
    ["before", [fixture.beforeConnection]],
    ["after", []],
  ] as const) {
    const graphics = convertSrjToGraphicsObject({
      ...fixture.input,
      obstacles: fixture.input.obstacles.filter(
        (obstacle) => !obstacle.isCopperPour,
      ),
      connections: [],
    })
    // Violet outlines are pending routing requests, not manufactured copper.
    // The blue retained via and red retained wire stay identical in both views.
    for (const connection of connections) {
      graphics.lines!.push({
        points: connection.pointsToConnect,
        strokeColor: "#a020f0",
        strokeWidth: 0.04,
        strokeDash: "0.1 0.1",
      })
      for (const point of connection.pointsToConnect) {
        graphics.circles!.push({
          center: point,
          radius: 0.3,
          fill: "none",
          stroke: "#a020f0",
        })
      }
    }
    await expect(
      renderPlanarShortcutView(graphics, {
        minX: -34.5,
        maxX: -29.5,
        minY: -33,
        maxY: -27.5,
      }),
    ).toMatchSvgSnapshot(import.meta.path, { svgName: state })
  }
})
