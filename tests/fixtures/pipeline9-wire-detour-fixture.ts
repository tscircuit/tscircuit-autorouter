import type { DrcEvaluator } from "high-density-repair03/lib"
import { convertPipeline7HdRoutesToSimplifiedPcbTraces } from "lib/autorouter-pipelines/AutoroutingPipeline7_MultiGraph/convertPipeline7HdRoutesToSimplifiedPcbTraces"
import { evaluateRelaxedDrc } from "lib/testing/evaluate-relaxed-drc"
import { getConnectivityMapFromSimpleRouteJson } from "lib/utils/getConnectivityMapFromSimpleRouteJson"
import { createBoundedRegionalRepairFixture } from "./pipeline9-bounded-regional-repair-fixture"

export const createWireDetourFixture = (): ReturnType<
  typeof createBoundedRegionalRepairFixture
> => {
  const fixture = createBoundedRegionalRepairFixture(2)
  const { originalSrj, routes } = fixture
  originalSrj.obstacles = originalSrj.obstacles.filter(
    (obstacle) => obstacle.circuitJsonMetadata?.pcb_smtpad_id !== "foreign_pad_0",
  )
  routes[0]!.route.splice(1, 1)
  originalSrj.connections.push({
    name: "via_owner",
    pointsToConnect: [
      { x: -3, y: 0.25, layer: "top", pcb_port_id: "via_start" },
      { x: 3, y: 0.25, layer: "bottom", pcb_port_id: "via_end" },
    ],
  })
  for (const [x, layer, port] of [
    [-3, "top", "via_start"],
    [3, "bottom", "via_end"],
  ] as const) {
    originalSrj.obstacles.push({
      type: "rect",
      center: { x, y: 0.25 },
      width: 0.1,
      height: 0.1,
      layers: [layer],
      connectedTo: ["via_owner", port],
      circuitJsonMetadata: { pcb_smtpad_id: `${port}_pad`, pcb_port_id: port },
    })
  }
  routes.push({
    connectionName: "via_owner",
    traceThickness: 0.1,
    viaDiameter: 0.3,
    route: [
      { x: -3, y: 0.25, z: 0 },
      { x: 0, y: 0.25, z: 0 },
      { x: 0, y: 0.25, z: 1 },
      { x: 3, y: 0.25, z: 1 },
    ],
    vias: [{ x: 0, y: 0.25 }],
  })
  fixture.drcEvaluator = ({ routes: candidate, hdRoutes }) => {
    const selected = candidate ?? hdRoutes
    if (!selected) throw new Error("Missing candidate routes")
    return evaluateRelaxedDrc({
      inputSrj: originalSrj,
      srjWithPointPairs: originalSrj,
      routedTraces: convertPipeline7HdRoutesToSimplifiedPcbTraces({
        connections: originalSrj.connections,
        originalConnections: originalSrj.connections,
        hdRoutes: selected,
        layerCount: originalSrj.layerCount,
        obstacles: originalSrj.obstacles,
        defaultViaHoleDiameter: 0.15,
        connMap: getConnectivityMapFromSimpleRouteJson(originalSrj),
      }),
    }) as unknown as ReturnType<DrcEvaluator>
  }
  return fixture
}
