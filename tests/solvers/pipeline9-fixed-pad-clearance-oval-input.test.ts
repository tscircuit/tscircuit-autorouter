import { expect, test } from "bun:test"
import { createPipeline9FixedPadClearance } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/createPipeline9FixedPadClearance"
import type { Obstacle, SimpleRouteJson } from "lib/types/srj-types"
import { addApproximatingRectsToSrj } from "lib/utils/addApproximatingRectsToSrj"
import { createSrjWithBoardValidObstacleLayers } from "lib/utils/create-srj-with-board-valid-obstacle-layers"
import { getConnectivityMapFromSimpleRouteJson } from "lib/utils/getConnectivityMapFromSimpleRouteJson"

type RuntimeOvalObstacle = Omit<Obstacle, "type"> & { type: "oval" }
type OvalFixture = {
  layerCount: number
  zLayers: number[]
  obstacle: RuntimeOvalObstacle
}

test("fixed oval inputs retain the existing rectangular routing envelope without changing source geometry", (): void => {
  const fixtures: OvalFixture[] = [
    {
      // SRJ18/10, artifact 10046369452, pr/scenario.json obstacle 29.
      layerCount: 4,
      zLayers: [0],
      obstacle: {
        componentId: "pcb_component_7",
        type: "oval",
        layers: ["top"],
        center: { x: -16, y: 5.5 },
        width: 1.5,
        height: 1.5,
        connectedTo: [
          "pcb_smtpad_29",
          "connectivity_net1762",
          "pcb_trace_355",
          "source_trace_15",
          "pcb_smtpad_29",
          "pcb_component_7_port_1",
          "pcb_port_33",
          "pcb_smtpad_290",
          "pcb_component_84_port_13",
          "pcb_port_314",
          "source_net_15",
        ],
        circuitJsonMetadata: {
          pcb_smtpad_id: "pcb_smtpad_29",
          pcb_port_id: "pcb_component_7_port_1",
        },
      },
    },
    {
      // SRJ23/72, artifact 10046343474, pr/scenario.json obstacle 39.
      layerCount: 2,
      zLayers: [0, 1],
      obstacle: {
        componentId: "pcb_component_13",
        type: "oval",
        layers: ["top", "bottom"],
        center: { x: -19.81, y: -12.73 },
        width: 1.6,
        height: 1.6,
        connectedTo: [
          "pcb_plated_hole_1",
          "connectivity_net109",
          "source_trace_45",
          "source_port_57",
          "source_trace_43",
          "source_port_53",
          "source_trace_31",
          "source_port_39",
          "source_net_16",
          "pcb_plated_hole_1",
          "pcb_port_39",
          "pcb_plated_hole_15",
          "pcb_port_53",
          "pcb_plated_hole_19",
          "pcb_port_57",
        ],
        zLayers: [0, 1],
        circuitJsonMetadata: {
          pcb_plated_hole_id: "pcb_plated_hole_1",
          pcb_port_id: "pcb_port_39",
        },
      },
    },
    {
      layerCount: 2,
      zLayers: [1],
      obstacle: {
        type: "oval",
        layers: ["bottom"],
        center: { x: 3, y: -2 },
        width: 2,
        height: 0.5,
        ccwRotationDegrees: 45,
        connectedTo: ["rotated-pad-owner"],
        offBoardConnectsTo: ["rotated-pad-offboard-owner"],
        circuitJsonMetadata: { pcb_port_id: "metadata-is-not-an-owner" },
      },
    },
  ]
  const originalFixtures = structuredClone(fixtures)

  for (const { layerCount, zLayers, obstacle } of fixtures) {
    // Legacy SRJ typing declares only rect, but preprocessing accepts runtime
    // oval records. Keep this explicit cast at the same external input boundary.
    const runtimeObstacle = obstacle as unknown as Obstacle
    const srj: SimpleRouteJson = {
      layerCount,
      minTraceWidth: 0.1,
      bounds: { minX: -30, maxX: 30, minY: -30, maxY: 30 },
      connections: [
        {
          name: "foreign",
          pointsToConnect: [{ x: 25, y: 25, layer: "top" }],
        },
      ],
      obstacles: [runtimeObstacle],
    }
    const preprocessed = addApproximatingRectsToSrj(
      createSrjWithBoardValidObstacleLayers(srj),
    )
    expect(preprocessed.obstacles.length).toBeGreaterThan(0)
    expect(
      preprocessed.obstacles.every((pad): boolean => pad.type === "rect"),
    ).toBe(true)
    const connMap = getConnectivityMapFromSimpleRouteJson(preprocessed)
    const owner = connMap.getNetConnectedToId(obstacle.connectedTo[0]!)
    const foreign = connMap.getNetConnectedToId("foreign")
    if (!owner || !foreign) throw new Error("Expected fixture canonical nets")
    const params = {
      connMap,
      layerCount,
      traceToPadClearance: 0.1,
      viaToPadClearance: 0.15,
    }
    const context = createPipeline9FixedPadClearance({
      ...params,
      obstacles: srj.obstacles,
    })
    expect(context.rectangles).toEqual([
      {
        kind: "fixed-rectangle",
        center: obstacle.center,
        width: obstacle.width,
        height: obstacle.height,
        ccwRotationDegrees: obstacle.ccwRotationDegrees,
        zLayers,
        ownerNetIds: new Set([owner]),
      },
    ])
    const rectangleContext = createPipeline9FixedPadClearance({
      ...params,
      obstacles: [{ ...obstacle, type: "rect" }],
    })
    expect(context.traceClearanceIndex.cacheFingerprint).toBe(
      rectangleContext.traceClearanceIndex.cacheFingerprint,
    )
    expect(context.viaClearanceIndex.cacheFingerprint).toBe(
      rectangleContext.viaClearanceIndex.cacheFingerprint,
    )
    for (let z = 0; z < layerCount; z++) {
      for (const index of [
        context.traceClearanceIndex,
        context.viaClearanceIndex,
      ]) {
        expect(
          index.isPointClear({
            point: { ...obstacle.center, z },
            copperDiameter: 0.1,
            canonicalNetId: owner,
          }),
        ).toBe(true)
        expect(
          index.isPointClear({
            point: { ...obstacle.center, z },
            copperDiameter: 0.1,
            canonicalNetId: foreign,
          }),
        ).toBe(!zLayers.includes(z))
      }
      for (const offset of [
        { x: 0.7, y: 0.7 },
        { x: 0.5, y: 0.5 },
        { x: 0.5, y: -0.5 },
        { x: 3, y: 3 },
      ]) {
        const query = {
          point: {
            x: obstacle.center.x + offset.x,
            y: obstacle.center.y + offset.y,
            z,
          },
          copperDiameter: 0.1,
          canonicalNetId: foreign,
        }
        expect(context.traceClearanceIndex.isPointClear(query)).toBe(
          rectangleContext.traceClearanceIndex.isPointClear(query),
        )
        expect(context.viaClearanceIndex.isPointClear(query)).toBe(
          rectangleContext.viaClearanceIndex.isPointClear(query),
        )
      }
    }
    expect(() =>
      createPipeline9FixedPadClearance({
        ...params,
        obstacles: [{ ...obstacle, type: "triangle" } as unknown as Obstacle],
      }),
    ).toThrow('unsupported shape "triangle"')
  }

  expect(fixtures).toEqual(originalFixtures)
})
