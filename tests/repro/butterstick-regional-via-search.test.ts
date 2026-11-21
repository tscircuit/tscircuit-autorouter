import { expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { gunzipSync } from "node:zlib"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { getSvgFromGraphicsObject } from "graphics-debug"
import { SingleHighDensityRouteSolver6_VertHorzLayer_FutureCost } from "lib/solvers/HighDensitySolver/SingleHighDensityRouteSolver6_VertHorzLayer_FutureCost"

type SearchParams = ConstructorParameters<
  typeof SingleHighDensityRouteSolver6_VertHorzLayer_FutureCost
>[0]

test("ButterStick regional route through-via clearance queries", (): void => {
  const { opts } = JSON.parse(
    gunzipSync(
      new Uint8Array(
        readFileSync(
          new URL(
            "../fixtures/assets/butterstick-regional-via-search.json.gz",
            import.meta.url,
          ),
        ),
      ),
    ).toString(),
  ) as { opts: SearchParams }
  if (!opts.connMap) throw new Error("Captured search has no connectivity map")
  const connMap = new ConnectivityMap(opts.connMap.netMap)
  connMap.idToNetMap = opts.connMap.idToNetMap
  const solver = new SingleHighDensityRouteSolver6_VertHorzLayer_FutureCost({
    ...opts,
    connMap,
    captureSearchDebug: false,
  })
  let viaClearanceChecks = 0
  const checkObstacleClearance = solver.isNodeTooCloseToObstacle
  solver.isNodeTooCloseToObstacle = (
    ...args: Parameters<typeof checkObstacleClearance>
  ): boolean => {
    const isVia = args[2] === true
    if (isVia) {
      viaClearanceChecks += 1
    }
    return checkObstacleClearance.apply(solver, args)
  }
  solver.solve()
  expect(solver.solved).toBeTrue()
  expect(solver.failed).toBeFalse()
  expect(solver.solvedPath?.route[0]).toMatchObject(opts.A)
  expect(solver.solvedPath?.route.at(-1)).toMatchObject(opts.B)

  const graphics = solver.visualize()
  const routedLine = graphics.lines?.find(
    (line) => line.points === solver.solvedPath?.route,
  )
  if (!routedLine) throw new Error("Solved route is missing from the drawing")
  routedLine.strokeWidth = solver.traceThickness
  const svg = getSvgFromGraphicsObject(graphics, {
    backgroundColor: "white",
  })
  const summary = `<g data-testid="via-clearance-checks"><rect x="12" y="12" width="500" height="44" rx="6" fill="white" stroke="#166534"/><text x="24" y="40" font-family="Arial, sans-serif" font-size="20" fill="#166534">Via-clearance checks: ${viaClearanceChecks}</text></g>`
  expect(svg.replace("</svg>", `${summary}</svg>`)).toMatchSvgSnapshot(
    import.meta.path,
  )
})
