import { expect, test } from "bun:test"
import { AutoroutingPipelineSolver4 } from "lib/autorouter-pipelines/AutoroutingPipeline4_TinyHypergraph/AutoroutingPipelineSolver4_TinyHypergraph"
import bugReport from "../../fixtures/bug-reports/bugreport46-ac4337/bugreport46-ac4337-arduino-uno.json" with {
  type: "json",
}

const TARGET_CONNECTION = "source_net_23"

const isSamePointXY = (
  a: { x: number; y: number },
  b: { x: number; y: number },
  tolerance = 1e-3,
) => Math.abs(a.x - b.x) < tolerance && Math.abs(a.y - b.y) < tolerance

test("bugreport46 stitch avoids invalid long jump into source_net_23 endpoint at effort 2x", () => {
  const srj = structuredClone(bugReport.simple_route_json as any)
  const targetConnection = srj.connections.find(
    (connection: any) => connection.name === TARGET_CONNECTION,
  )

  expect(targetConnection).toBeDefined()

  const targetPoint = targetConnection.pointsToConnect[1]
  const pipeline = new AutoroutingPipelineSolver4(srj, { effort: 2 })

  pipeline.solveUntilPhase("traceSimplificationSolver")

  const badSegments =
    pipeline.highDensityStitchSolver?.mergedHdRoutes
      .filter((route) => route.connectionName === TARGET_CONNECTION)
      .flatMap((route) =>
        route.route.slice(0, -1).map((point, index) => {
          const nextPoint = route.route[index + 1]!
          return {
            from: point,
            to: nextPoint,
            sameLayer: point.z === nextPoint.z,
            length: Math.hypot(nextPoint.x - point.x, nextPoint.y - point.y),
            touchesTarget:
              isSamePointXY(point, targetPoint) ||
              isSamePointXY(nextPoint, targetPoint),
          }
        }),
      )
      .filter(
        (segment) =>
          segment.sameLayer && segment.touchesTarget && segment.length > 20,
      ) ?? []

  expect(badSegments).toHaveLength(0)
}, 120_000)
