import { expect, test } from "bun:test"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { assessComputeSelectionOutcome } from "lib/solvers/HyperHighDensitySolver/validateComputeSelectionOutcome"
import type { HighDensityRoute, NodeWithPortPoints } from "lib/types/high-density-types"

type ValidationParams = Parameters<typeof assessComputeSelectionOutcome>[0]

const crossingCase = (
  secondName: string,
  secondRoot: string,
  connMap: ConnectivityMap,
): ValidationParams => {
  const routes: HighDensityRoute[] = [
    {
      connectionName: "left-net", rootConnectionName: "connectivity_net0",
      traceThickness: 0.15, viaDiameter: 0.3, vias: [],
      route: [{ x: -1, y: 0, z: 0 }, { x: 1, y: 0, z: 0 }],
    },
    {
      connectionName: secondName, rootConnectionName: secondRoot,
      traceThickness: 0.15, viaDiameter: 0.3, vias: [],
      route: [{ x: 0, y: -1, z: 0 }, { x: 0, y: 1, z: 0 }],
    },
  ]
  const node: NodeWithPortPoints = {
    capacityMeshNodeId: "private-owners", center: { x: 0, y: 0 },
    width: 4, height: 4, availableZ: [0, 1],
    portPoints: routes.flatMap((route, routeIndex) => route.route.map((point, index) => ({
      ...point, portPointId: `port_${routeIndex}_${index}`,
      connectionName: route.connectionName, rootConnectionName: route.rootConnectionName,
    }))),
  }
  return { routes, node, connMap, obstacles: [], layerCount: 2,
    traceWidth: 0.15, viaDiameter: 0.3, obstacleMargin: 0.15 }
}

test("physical labels preserve authoritative same-net aliases in a private diagnostic namespace", (): void => {
  const connMap = new ConnectivityMap({
    connectivity_net0: ["left-net", "own-pad", "learning_identity_2", "physical-pad-a"],
    connectivity_net1: ["connectivity_net0", "right-net", "foreign-pad", "learning_identity_0"],
  })
  for (const name of ["left-net", "own-pad", "learning_identity_2"]) {
    const params = crossingCase(name, "connectivity_net0", connMap)
    const before = structuredClone({ routes: params.routes, node: params.node, obstacles: params.obstacles })
    expect(assessComputeSelectionOutcome(params)).toEqual({ structurallyValid: true, physicallyClean: true })
    expect({ routes: params.routes, node: params.node, obstacles: params.obstacles }).toEqual(before)
  }
  for (const name of ["connectivity_net0", "right-net", "learning_identity_0"]) {
    expect(assessComputeSelectionOutcome(crossingCase(name, "connectivity_net1", connMap))).toEqual({
      structurallyValid: true, physicallyClean: false,
    })
  }
  const ownPad = crossingCase("own-pad", "connectivity_net0", connMap)
  ownPad.node.portPoints[0]!.pcb_port_id = "physical-pad-a"
  ownPad.obstacles = [{
    type: "rect", center: { x: -1, y: 0 }, width: 0.3, height: 0.3,
    layers: ["top"], connectedTo: ["left-net", "physical-pad-a"],
    circuitJsonMetadata: { pcb_smtpad_id: "connectivity_net0", pcb_port_id: "physical-pad-a" },
  }]
  const before = structuredClone({ routes: ownPad.routes, node: ownPad.node, obstacles: ownPad.obstacles })
  expect(assessComputeSelectionOutcome(ownPad)).toEqual({ structurallyValid: true, physicallyClean: true })
  expect({ routes: ownPad.routes, node: ownPad.node, obstacles: ownPad.obstacles }).toEqual(before)
  const foreignPad = { ...ownPad.obstacles[0]!, center: { x: 0, y: 0 },
    connectedTo: ["right-net", "foreign-pad"], circuitJsonMetadata: undefined }
  expect(assessComputeSelectionOutcome({ ...ownPad, obstacles: [foreignPad] })).toEqual({
    structurallyValid: true, physicallyClean: false,
  })
  expect(assessComputeSelectionOutcome({ ...ownPad, obstacles: [{
    ...foreignPad, isNonPlatedHole: true, connectedTo: [],
  }] })).toEqual({ structurallyValid: true, physicallyClean: false })
})
