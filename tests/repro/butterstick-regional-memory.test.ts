import { expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { gunzipSync } from "node:zlib"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { getSvgFromGraphicsObject } from "graphics-debug"
import { Pipeline9RegionalFallbackSolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9RegionalFallbackSolver"
import { IntraNodeRouteSolver } from "lib/solvers/HighDensitySolver/IntraNodeSolver"
import { GrowShrinkHighDensityIntraNodeSolver } from "lib/solvers/HyperHighDensitySolver/GrowShrinkHighDensityIntraNodeSolver/GrowShrinkHighDensityIntraNodeSolver"
import { convertHdRouteToSimplifiedRoute } from "lib/utils/convertHdRouteToSimplifiedRoute"
import { convertSrjToGraphicsObject } from "lib/utils/convertSrjToGraphicsObject"

type RegionalParams = ConstructorParameters<
  typeof Pipeline9RegionalFallbackSolver
>[0]

test("ButterStick regional repair retains search diagnostics by default", (): void => {
  const { params } = JSON.parse(
    gunzipSync(
      new Uint8Array(
        readFileSync(
          new URL(
            "../fixtures/assets/butterstick-regional-memory.json.gz",
            import.meta.url,
          ),
        ),
      ),
    ).toString(),
  ) as { params: RegionalParams }
  const connMap = new ConnectivityMap(params.connMap.netMap)
  connMap.idToNetMap = params.connMap.idToNetMap
  const solver = new Pipeline9RegionalFallbackSolver({ ...params, connMap })
  solver.solve()
  // This unsuccessful candidate precedes the repair that completes ButterStick.
  expect(solver.failed).toBeTrue()
  expect(solver.error).toContain("All solvers failed")

  const attempts = solver.highDensitySolver.failedSolvers
    .filter(
      (attempt) => attempt instanceof GrowShrinkHighDensityIntraNodeSolver,
    )
    .flatMap((attempt) => attempt.failedSolvers)
  const candidates = attempts.flatMap(
    (attempt) => attempt.supervisedSolvers ?? [],
  )
  const failedSearches = candidates
    .map((candidate) => candidate.solver)
    .filter((candidate) => candidate instanceof IntraNodeRouteSolver)
    .flatMap((candidate) => candidate.failedSubSolvers)
  const retainedNodes = failedSearches.reduce(
    (count, search) => count + search.debug_exploredNodesOrdered.length,
    0,
  )
  expect(retainedNodes).toBeGreaterThan(0)

  const node = params.nodeWithPortPoints
  const graphics = convertSrjToGraphicsObject({
    layerCount: params.layerCount,
    minTraceWidth: params.traceWidth,
    bounds: {
      minX: node.center.x - node.width / 2,
      maxX: node.center.x + node.width / 2,
      minY: node.center.y - node.height / 2,
      maxY: node.center.y + node.height / 2,
    },
    obstacles: params.obstacles,
    connections: [],
    traces: params.fixedHdRoutes?.map((route, index) => ({
      type: "pcb_trace",
      pcb_trace_id: `fixed_${index}`,
      connection_name: route.connectionName,
      route: convertHdRouteToSimplifiedRoute(route, params.layerCount),
    })),
  })
  graphics.rects.push({
    center: node.center,
    width: node.width,
    height: node.height,
    fill: "none",
    stroke: "#172554",
    label: "Regional repair window",
  })
  const svg = getSvgFromGraphicsObject(graphics, { backgroundColor: "white" })
  const caption = `<g data-testid="retained-search-nodes"><rect x="12" y="12" width="610" height="44" rx="6" fill="white" stroke="#172554"/><text x="24" y="40" font-family="Arial, sans-serif" font-size="19" fill="#172554">Retained diagnostic nodes: ${retainedNodes}</text></g>`
  expect(svg.replace("</svg>", `${caption}</svg>`)).toMatchSvgSnapshot(
    import.meta.path,
  )
})
