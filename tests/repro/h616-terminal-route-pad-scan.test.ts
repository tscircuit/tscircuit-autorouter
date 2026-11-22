import { expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { gunzipSync } from "node:zlib"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { getSvgFromGraphicsObject } from "graphics-debug"
import { preparePreloadedTerminalRoutes } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/pipeline9TerminalRoutes"

type TerminalInput = Parameters<typeof preparePreloadedTerminalRoutes>[0]
type CapturedInput = Omit<TerminalInput, "connMap"> & {
  connMap: Pick<ConnectivityMap, "netMap" | "idToNetMap">
}

test("H616 terminal routes scan pad connectivity", (): void => {
  const captured = JSON.parse(
    gunzipSync(
      new Uint8Array(
        readFileSync(
          new URL(
            "../fixtures/assets/h616-terminal-route-pads.json.gz",
            import.meta.url,
          ),
        ),
      ),
    ).toString(),
  ) as CapturedInput
  const connMap = new ConnectivityMap(captured.connMap.netMap)
  connMap.idToNetMap = captured.connMap.idToNetMap
  let connectivityChecks = 0
  const areIdsConnected = connMap.areIdsConnected
  connMap.areIdsConnected = (
    ...args: Parameters<typeof areIdsConnected>
  ): boolean => {
    connectivityChecks += 1
    return areIdsConnected.apply(connMap, args)
  }
  const routes = preparePreloadedTerminalRoutes({ ...captured, connMap })
  expect(routes).toHaveLength(captured.fixedHdRoutes.length)
  expect(routes.some((route) => route.isThroughObstacle)).toBeFalse()

  const svg = getSvgFromGraphicsObject(
    {
      rects: captured.obstacles
        .filter((obstacle) =>
          routes.some((route) =>
            route.route.some(
              (point) =>
                Math.abs(point.x - obstacle.center.x) < obstacle.width &&
                Math.abs(point.y - obstacle.center.y) < obstacle.height,
            ),
          ),
        )
        .map((obstacle) => ({
          center: obstacle.center,
          width: obstacle.width,
          height: obstacle.height,
          fill: "rgba(120,120,120,0.35)",
        })),
      lines: routes.map((route) => ({
        points: route.route,
        strokeColor: route.isThroughObstacle ? "#dc2626" : "#2563eb",
        strokeWidth: route.traceThickness,
      })),
    },
    { backgroundColor: "white" },
  )
  const summary = `<g data-testid="connectivity-checks"><rect x="12" y="12" width="400" height="44" rx="6" fill="white" stroke="#166534"/><text x="24" y="40" font-family="Arial, sans-serif" font-size="20" fill="#166534">Pad connectivity checks: ${connectivityChecks}</text></g>`
  expect(svg.replace("</svg>", `${summary}</svg>`)).toMatchSvgSnapshot(
    import.meta.path,
  )
})
