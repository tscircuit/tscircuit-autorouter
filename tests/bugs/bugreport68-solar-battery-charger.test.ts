import { expect, test } from "bun:test"
import { AutoroutingPipelineSolver7_MultiGraph } from "lib"
import type { SimpleRouteJson } from "lib/types"
import srj from "../../fixtures/bug-reports/bugreport68-solar-battery-charger/bugreport68-solar-battery-charger.srj.json" with {
  type: "json",
}
import { getLastStepSvg } from "../fixtures/getLastStepSvg"

const simpleRouteJson = srj as SimpleRouteJson

test("bugreport68-solar-battery-charger.srj.json", () => {
  const solver = new AutoroutingPipelineSolver7_MultiGraph(simpleRouteJson)
  solver.solve()
  const bgaComponent = solver
    .componentDetectionSolver!.getOutput()
    .find(
      (component) =>
        component.componentId === "pcb_component_12" &&
        component.componentKind === "bga",
    )
  const bgaRoutingNodes = solver
    .componentTopologyGeneratorSolver!.getOutput()
    .filter(
      (node) =>
        node.capacityMeshNodeId.includes("pcb_component_12") &&
        !node._containsObstacle,
    )
  const smallBgaRoutingNodes = bgaRoutingNodes.filter(
    (node) =>
      node.width <= solver.viaDiameter * 1.2 ||
      node.height <= solver.viaDiameter * 1.2,
  )

  expect(bgaComponent).toBeDefined()
  if (!bgaComponent) {
    throw new Error(
      "Expected solar battery fixture to detect pcb_component_12 BGA",
    )
  }
  expect(smallBgaRoutingNodes.length).toBeGreaterThan(0)
  expect(
    smallBgaRoutingNodes.every((node) => node.availableZ.length === 1),
  ).toBe(true)
  const routedTraces = solver.getOutputSimpleRouteJson().traces
  if (!routedTraces) {
    throw new Error("Expected solar battery fixture to produce routed traces")
  }
  const routedViasInsideBga = routedTraces
    .flatMap((trace) => trace.route)
    .filter(
      (routePoint) =>
        routePoint.route_type === "via" &&
        routePoint.x >= bgaComponent.bounds.minX &&
        routePoint.x <= bgaComponent.bounds.maxX &&
        routePoint.y >= bgaComponent.bounds.minY &&
        routePoint.y <= bgaComponent.bounds.maxY,
    )

  expect(routedViasInsideBga).toHaveLength(0)
  expect(getLastStepSvg(solver.visualize())).toMatchSvgSnapshot(
    import.meta.path,
  )
})
