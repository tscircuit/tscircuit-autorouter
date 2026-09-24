import { expect, test } from "bun:test"
import bugReport from "../../fixtures/bug-reports/bugreport28-18a9ef/bugreport28-18a9ef.json" with {
  type: "json",
}
import type { SimpleRouteJson } from "lib/types"
import { getLastStepSvg } from "../fixtures/getLastStepSvg"
import { AutoroutingPipelineSolver2_PortPointPathing } from "lib/autorouter-pipelines"

const srj = bugReport.simple_route_json as SimpleRouteJson

test("bugreport28", () => {
  const solver = new AutoroutingPipelineSolver2_PortPointPathing(srj)

  solver.solve()

  // Identify the original vertical pair by its terminals: MST enumeration can
  // change when the spanning-tree algorithm changes.
  const verticalConnection = solver.netToPointPairsSolver?.newConnections.find(
    (connection) =>
      connection.pointsToConnect.length === 2 &&
      connection.pointsToConnect.some(
        (point) => point.pointId === "pcb_port_34",
      ) &&
      connection.pointsToConnect.some(
        (point) => point.pointId === "pcb_port_38",
      ),
  )
  expect(verticalConnection).toBeDefined()
  const verticalTrace =
    solver.traceSimplificationSolver?.simplifiedHdRoutes.find(
      (trace) => trace.connectionName === verticalConnection!.name,
    )
  expect(verticalTrace).toBeDefined()

  const minX = Math.min(...verticalTrace!.route.map((point) => point.x))
  const maxX = Math.max(...verticalTrace!.route.map((point) => point.x))
  const horizontalSpan = maxX - minX
  expect(horizontalSpan).toBeLessThan(5)

  expect(getLastStepSvg(solver.visualize())).toMatchSvgSnapshot(
    import.meta.path,
  )
})
