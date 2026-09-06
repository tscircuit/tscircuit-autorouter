import { convertRepairRoutesToTraces } from "@tscircuit/repair04"
import { AutoroutingDrcEngine, type DrcError } from "high-density-repair03/lib"
import type { HighDensityRoute } from "lib/types/high-density-types"
import { getConnectivityMapFromSimpleRouteJson } from "lib/utils/getConnectivityMapFromSimpleRouteJson"
import { createPipeline9Repair04Fixture } from "./pipeline9-repair04-fixture"

export function createTotalBudgetFixture(): ReturnType<
  typeof createPipeline9Repair04Fixture
> {
  const fixture = createPipeline9Repair04Fixture()
  const original = fixture.hdRoutes[0]!
  fixture.hdRoutes = [0, 12, -12].map(
    (offset, index): HighDensityRoute => ({
      ...structuredClone(original),
      connectionName: `signal_${index}`,
      rootConnectionName: `signal_${index}`,
      route: original.route.map((point) => ({
        ...point,
        y: point.y + offset,
        ...(point.pcb_port_id
          ? { pcb_port_id: `${point.pcb_port_id}_${index}` }
          : {}),
      })),
    }),
  )
  fixture.srj.traces = []
  fixture.srj.obstacles = [0, 12, -12].map((offset, index) => ({
    type: "rect",
    center: { x: 0, y: offset },
    width: 1,
    height: 1,
    layers: ["top"],
    connectedTo: [`pcb_smtpad_foreign_${index}`, `foreign_${index}`],
    circuitJsonMetadata: { pcb_smtpad_id: `pcb_smtpad_foreign_${index}` },
  }))
  fixture.srj.connections = fixture.hdRoutes.map((route) => ({
    name: route.connectionName,
    pointsToConnect: [route.route[0]!, route.route.at(-1)!].map((point) => ({
      x: point.x,
      y: point.y,
      layer: "top",
      pointId: point.pcb_port_id!,
      pcb_port_id: point.pcb_port_id!,
    })),
  }))
  fixture.connMap = getConnectivityMapFromSimpleRouteJson(fixture.srj)
  const engine = new AutoroutingDrcEngine(fixture.srj)
  fixture.referenceDrcEvaluator = ({ routes }): DrcError[] => {
    if (!routes) throw new Error("Expected complete candidate routes")
    return engine.evaluate(
      convertRepairRoutesToTraces(routes, fixture.srj.layerCount),
    ).errors as DrcError[]
  }
  return fixture
}
