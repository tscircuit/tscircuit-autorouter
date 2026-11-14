import { expect, test } from "bun:test"
import { doBoundsOverlap, getBoundingBox } from "@tscircuit/math-utils"
import {
  createComponentObstacleSrj,
  createReplacementObstacleForComponent,
  isObstacleInDetectedComponent,
} from "lib/solvers/ComponentTopologyGeneratorSolver/ComponentTopologyGeneratorSolver"
import type { DetectedComponent } from "lib/solvers/ComponentDetectionSolver/ComponentDetectionSolver"
import type { SerializedTopologyComponentInput } from "lib/solvers/TopologyPlanningSolver/MultiGraphTopologyPlannerSolver"
import { createComponentSrj } from "lib/solvers/TopologyPlanningSolver/topologyPlanningShared"
import type { SimpleRouteJson } from "lib/types"
import { getBoundsForObstacles } from "lib/utils/getBoundsForObstacles"

// Independent reference to the full-clone implementation from main prior to
// this optimization. Deliberately retain the old flatMap and clone semantics.
function oldCreateComponentSrj(
  inputSrj: SimpleRouteJson,
  component: SerializedTopologyComponentInput,
): SimpleRouteJson {
  const obstacleBounds = getBoundsForObstacles(component.memberObstacles)
  const localPointMargin = Math.max(
    inputSrj.minViaPadDiameter ??
      inputSrj.min_via_pad_diameter ??
      inputSrj.minViaDiameter ??
      0.3,
    inputSrj.defaultObstacleMargin ?? 0.15,
    inputSrj.minTraceWidth * 2,
  )
  const memberConnectionIds = new Set(
    component.memberObstacles.flatMap((obstacle) => obstacle.connectedTo),
  )
  const connectedPoints = inputSrj.connections.flatMap((connection) =>
    connection.pointsToConnect.filter((point) => {
      const pointIds = [point.pointId, point.pcb_port_id].filter(
        (pointId): pointId is string => typeof pointId === "string",
      )
      return (
        pointIds.some((pointId) => memberConnectionIds.has(pointId)) &&
        point.x >= obstacleBounds.minX - localPointMargin &&
        point.x <= obstacleBounds.maxX + localPointMargin &&
        point.y >= obstacleBounds.minY - localPointMargin &&
        point.y <= obstacleBounds.maxY + localPointMargin
      )
    }),
  )
  const componentBounds = connectedPoints.reduce(
    (bounds, point) => ({
      minX: Math.min(bounds.minX, point.x),
      maxX: Math.max(bounds.maxX, point.x),
      minY: Math.min(bounds.minY, point.y),
      maxY: Math.max(bounds.maxY, point.y),
    }),
    obstacleBounds,
  )
  const componentObstacles = inputSrj.obstacles
    .filter((obstacle) =>
      doBoundsOverlap(getBoundingBox(obstacle), componentBounds),
    )
    .map((obstacle) => ({ ...obstacle }))
  return {
    ...structuredClone(inputSrj),
    bounds: componentBounds,
    obstacles: componentObstacles,
  }
}

function oldCreateComponentObstacleSrj(
  inputSrj: SimpleRouteJson,
  components: DetectedComponent[],
): SimpleRouteJson {
  return {
    ...structuredClone(inputSrj),
    obstacles: [
      ...inputSrj.obstacles.filter(
        (obstacle) =>
          !components.some((component) =>
            isObstacleInDetectedComponent(obstacle, component),
          ),
      ),
      ...components.map((component) =>
        createReplacementObstacleForComponent({
          detectedComponent: component,
          inputSrj,
        }),
      ),
    ],
  }
}

function seededRandom(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (Math.imul(1664525, state) + 1013904223) >>> 0
    return state / 0x100000000
  }
}

for (const seed of [1, 17, 37, 211, 12345, 982451653]) {
  test(`component-local and global SRJ projections preserve full-clone baseline across seeded layout ${seed}`, () => {
    const rand = seededRandom(seed)
    const obstacles = Array.from({ length: 64 }, (_, i) => ({
      obstacleId: `obs-${i}`,
      type: "rect" as const,
      componentId: i % 5 === 0 ? "U1" : i % 7 === 0 ? "U2" : `R${i}`,
      center: {
        x: Math.round(rand() * 30 - 15),
        y: Math.round(rand() * 30 - 15),
      },
      width: 0.2 + Math.round(rand() * 25) / 10,
      height: 0.2 + Math.round(rand() * 25) / 10,
      layers: i % 2 === 0 ? ["top"] : ["bottom"],
      // Large repeated net reference lists mirror the shape of the full-board
      // attachment without including its 46.7 MB payload in the repository.
      connectedTo: Array.from(
        { length: i % 5 === 0 ? 384 : 3 },
        (_, j) => `port-${(i + (j % 3 === 0 ? 0 : 3)) % 11}`,
      ),
      circuitJsonMetadata: { pcb_smtpad_id: `pad-${i}` },
    }))
    const connections = Array.from({ length: 11 }, (_, i) => ({
      name: `net-${i}`,
      pointsToConnect: Array.from({ length: 4 }, (_, n) => ({
        x: Math.round(rand() * 30 - 15),
        y: Math.round(rand() * 30 - 15),
        layer: "top",
        pointId: n % 2 === 0 ? `port-${i}` : undefined,
        pcb_port_id: n % 2 === 1 ? `port-${i}` : undefined,
      })),
    }))
    const input = {
      bounds: { minX: -20, maxX: 20, minY: -20, maxY: 20 },
      obstacles,
      connections,
      layerCount: seed % 2 === 0 ? 6 : 4,
      minTraceWidth: 0.15,
      minViaPadDiameter: seed % 2 ? 0.4 : undefined,
      min_via_pad_diameter: seed % 2 ? undefined : 0.35,
      defaultObstacleMargin: seed % 3 ? 0.18 : undefined,
      differentialPairs: [],
    } as SimpleRouteJson
    const members = input.obstacles.filter(
      (obstacle) => obstacle.componentId === "U1",
    )
    const localComponent = {
      componentId: "U1",
      componentKind: "bga",
      memberObstacleIds: members.map((obstacle) => obstacle.obstacleId!),
      memberObstacles: members,
      replacementObstacle: members[0]!,
    } as SerializedTopologyComponentInput
    const componentBounds = getBoundsForObstacles(members)
    const detected = {
      componentId: "U1",
      componentKind: "bga",
      bounds: componentBounds,
    } as DetectedComponent
    const beforeLocal = oldCreateComponentSrj(input, localComponent)
    const afterLocal = createComponentSrj({
      inputSrj: input,
      component: localComponent,
    })
    expect(afterLocal).toEqual(beforeLocal)
    expect(Object.keys(afterLocal)).toEqual(Object.keys(beforeLocal))
    expect(JSON.stringify(afterLocal)).toBe(JSON.stringify(beforeLocal))
    for (let i = 0; i < afterLocal.obstacles.length; i++) {
      const original = input.obstacles.find(
        (obstacle) =>
          obstacle.obstacleId === afterLocal.obstacles[i]?.obstacleId,
      )
      expect(afterLocal.obstacles[i]?.connectedTo).toBe(original!.connectedTo)
    }
    const beforeGlobal = oldCreateComponentObstacleSrj(input, [detected])
    const afterGlobal = createComponentObstacleSrj({
      inputSrj: input,
      detectedComponents: [detected],
    })
    expect(afterGlobal).toEqual(beforeGlobal)
    expect(Object.keys(afterGlobal)).toEqual(Object.keys(beforeGlobal))
    expect(JSON.stringify(afterGlobal)).toBe(JSON.stringify(beforeGlobal))
    // Additional component-count cases: no replacements and two independent
    // detected component groups. These preserve source obstacle aliasing.
    const secondMembers = input.obstacles.filter((o) => o.componentId === "U2")
    const second = {
      componentId: "U2",
      componentKind: "bga",
      bounds: getBoundsForObstacles(secondMembers),
    } as DetectedComponent
    for (const componentSet of [[], [detected, second]]) {
      const before = oldCreateComponentObstacleSrj(input, componentSet)
      const after = createComponentObstacleSrj({
        inputSrj: input,
        detectedComponents: componentSet,
      })
      expect(after).toEqual(before)
      expect(JSON.stringify(after)).toBe(JSON.stringify(before))
      expect(Object.keys(after)).toEqual(Object.keys(before))
    }
    // Preserve reference behavior of surviving source obstacles, too.
    for (const obstacle of afterGlobal.obstacles.slice(0, -1)) {
      expect(input.obstacles.includes(obstacle)).toBe(true)
    }
  })
}
