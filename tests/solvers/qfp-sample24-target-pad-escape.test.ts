import { expect, test } from "bun:test"
import { AvailableSegmentPointSolver } from "lib/solvers/AvailableSegmentPointSolver/AvailableSegmentPointSolver"
import type { DetectedComponent } from "lib/solvers/ComponentDetectionSolver/ComponentDetectionSolver"
import { QfpThermalPadTopologyGeneratorSolver } from "lib/solvers/QfpThermalPadTopologyGeneratorSolver/QfpThermalPadTopologyGeneratorSolver"
import { QfpTopologyGeneratorSolver } from "lib/solvers/QfpTopologyGeneratorSolver/QfpTopologyGeneratorSolver"
import type { Obstacle, SimpleRouteJson } from "lib/types"

function createSample24U32Input(thermalPad: boolean, thermalTarget: boolean): SimpleRouteJson {
  const obstacles: Obstacle[] = []
  for (let index = 0; index < 4; index++) {
    const pads = [
      { pin: index + 1, x: 149.94659876 + index * 0.3999992, y: index === 0 ? 77.21608382 : 77.26608372, width: 0.1999996, height: index === 0 ? 0.70000114 : 0.5999988 },
      { pin: 12 - index, x: 149.94659876 + index * 0.3999992, y: 75.66608184, width: 0.1999996, height: 0.5999988 },
      { pin: 13 + index, x: 149.34659742, y: 75.86608398 + index * 0.3999992, width: 0.5999988, height: 0.1999996 },
      { pin: 8 - index, x: 151.7465977, y: 75.86608398 + index * 0.3999992, width: 0.5999988, height: 0.1999996 },
    ]
    obstacles.push(...pads.map((pad): Obstacle => ({
      type: "rect",
      obstacleId: `U32.${pad.pin}`,
      componentId: "U32",
      center: { x: pad.x, y: pad.y },
      width: pad.width,
      height: pad.height,
      layers: ["bottom"],
      connectedTo: pad.pin === 16 || pad.pin === 11 ? [`U32.${pad.pin}`] : [],
    })))
  }
  if (thermalPad) obstacles.push({
    type: "rect",
    obstacleId: "U32.17",
    componentId: "U32",
    center: { x: 150.54659756, y: 76.46608278 },
    width: 0.8,
    height: 0.6,
    layers: ["bottom"],
    connectedTo: ["U32.17"],
  })
  const srj: SimpleRouteJson = {
    layerCount: 8,
    minTraceWidth: 0.1,
    minViaPadDiameter: 0.3,
    defaultObstacleMargin: 0.15,
    bounds: { minX: 146, maxX: 155, minY: 72, maxY: 80 },
    obstacles,
    connections: [{
      name: "ground_mst24",
      __rootConnectionNames: ["ground"],
      pointsToConnect: [
        { x: 149.34659742, y: 77.06608158, layer: "bottom", pcb_port_id: "U32.16" },
        { x: 150.34659796, y: 75.66608184, layer: "bottom", pcb_port_id: "U32.11" },
      ],
    }],
  }
  if (thermalTarget) srj.connections.push({
    name: "thermal",
    pointsToConnect: [
      { x: 150.54659756, y: 76.46608278, layer: "bottom", pcb_port_id: "U32.17" },
      { x: 154, y: 78, layer: "bottom", pcb_port_id: "outside" },
    ],
  })
  return srj
}

test("QFP target pads retain ordinary center escapes and preserve narrow-gap penalties", (): void => {
  for (const variant of ["qfp", "thermal-inactive", "thermal-active"] as const) {
    const thermalPad = variant !== "qfp"
    const thermalTarget = variant === "thermal-active"
    const inputSrj = createSample24U32Input(thermalPad, thermalTarget)
    const detectedComponent: DetectedComponent = {
      componentId: "U32",
      componentKind: thermalPad ? "qfp_thermalpad" : "qfp",
      bounds: { __type: "rect", minX: 149.04659802, maxX: 152.0465971, minY: 75.36608244, maxY: 77.56608312 },
    }
    const solver = thermalPad
      ? new QfpThermalPadTopologyGeneratorSolver({ inputSrj, detectedComponent })
      : new QfpTopologyGeneratorSolver({ inputSrj, detectedComponent })
    solver.solve()
    const nodes = solver.getOutput().routingRegions
    const target = nodes.find((node) => node._containsObstacle && node._connectedTo?.includes("U32.11"))!
    expect(target._containsTarget).toBe(true)
    expect(target._targetConnectionName).toBe("ground")
    expect(nodes.filter((node) => node._containsTarget)).toHaveLength(thermalTarget ? 3 : 2)
    expect(nodes.filter((node) => !node._containsObstacle).every((node) => !node._containsTarget)).toBe(true)
    if (thermalPad) {
      const thermalCopper = nodes.find((node) => node._containsObstacle && node._connectedTo?.includes("U32.17"))!
      expect(Boolean(thermalCopper._containsTarget)).toBe(thermalTarget)
      expect(thermalCopper._targetConnectionName).toBe(thermalTarget ? "thermal" : undefined)
      continue
    }
    const center = nodes.find((node) => node._qfpRegionType === "center")!
    const narrowGap = nodes.find((node) => node._isNarrowQfpPadGap && node.availableZ.includes(7) && Math.abs(node.center.x - (target.center.x - 0.2)) < 1e-5 && Math.abs(node.center.y - target.center.y) < 1e-5)!
    const ports = new AvailableSegmentPointSolver({
      nodes: [target, center, narrowGap],
      edges: [
        { capacityMeshEdgeId: "center-escape", nodeIds: [target.capacityMeshNodeId, center.capacityMeshNodeId] },
        { capacityMeshEdgeId: "narrow-gap", nodeIds: [target.capacityMeshNodeId, narrowGap.capacityMeshNodeId] },
      ],
      traceWidth: inputSrj.minTraceWidth,
      obstacleMargin: inputSrj.defaultObstacleMargin,
      shouldReturnCrampedPortPoints: true,
    })
    ports.solve()
    const segments = ports.getOutput()
    const escape = segments.find((segment) => segment.edgeId === "center-escape")!
    const cramped = segments.find((segment) => segment.edgeId === "narrow-gap")!
    expect(escape.portPoints).toHaveLength(1)
    expect(escape.portPoints[0]!.cramped).toBe(false)
    expect(cramped.portPoints.length).toBeGreaterThan(0)
    expect(cramped.portPoints.every((port) => port.cramped)).toBe(true)
  }
})
