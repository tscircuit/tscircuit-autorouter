import { expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { gunzipSync } from "node:zlib"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import {
  type Circle,
  type GraphicsObject,
  getSvgFromGraphicsObject,
  type Line,
  type Rect,
} from "graphics-debug"
import { createPipeline9RegularNodeSolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9HighDensitySolver"
import { getGlobalInMemoryCache } from "lib/cache/setupGlobalCaches"
import type {
  CapacityMeshNode,
  SimpleRouteJson,
  SimplifiedPcbTrace,
} from "lib/types"
import type { NodeWithPortPoints } from "lib/types/high-density-types"
import { convertSrjToGraphicsObject } from "lib/utils/convertSrjToGraphicsObject"
import { createRectFromCapacityNode } from "lib/utils/createRectFromCapacityNode"

// Native ButterStick U4 cell from the published 3169 remaining-signal phase.
// Keep three actual mesh pressure entries to expose copying unrelated nodes.
test("ButterStick routes one native cell with its pressure context", async (): Promise<void> => {
  const node: NodeWithPortPoints = {
    capacityMeshNodeId: "topology_merge_5251",
    center: { x: -11.600000000000005, y: -4.000000000000005 },
    width: 0.40000000000000036,
    height: 0.39999999999999947,
    availableZ: [0, 1, 2, 3, 4, 5, 6, 7],
    portPoints: [
      {
        x: -11.400000000000006,
        y: -4.000000000000005,
        z: 0,
        connectionName: "source_net_27",
        rootConnectionName: "source_net_27",
        portPointId: "ce14031_pp0_z0::0",
        nextPortPointId: "ce14023_pp0_z0::0",
      },
      {
        x: -11.600000000000005,
        y: -3.800000000000006,
        z: 0,
        connectionName: "source_net_27",
        rootConnectionName: "source_net_27",
        portPointId: "ce14023_pp0_z0::0",
        prevPortPointId: "ce14031_pp0_z0::0",
      },
    ],
  }
  node.portPointsInPairs = [[node.portPoints[0]!, node.portPoints[1]!]]
  const originalNode = structuredClone(node)
  const pressures = new Map<string, number | null>([
    ["topology_merge_4752", null],
    ["topology_merge_4753", null],
    [node.capacityMeshNodeId, 0],
  ])
  getGlobalInMemoryCache().clearCache()
  const solver = createPipeline9RegularNodeSolver({
    nodeWithPortPoints: node,
    connMap: new ConnectivityMap({}),
    colorMap: {},
    viaDiameter: 0.3,
    traceWidth: 0.12,
    obstacleMargin: 0.15,
    effort: 1,
    nodePfById: pressures,
    obstacles: [],
    layerCount: 8,
  })
  solver.solve()
  expect(solver.solved).toBeTrue()
  expect(solver.failed).toBeFalse()
  expect(solver.routes).toHaveLength(1)
  expect(
    solver.nodeSolveMetadataById.get(node.capacityMeshNodeId)?.nodePf,
  ).toBe(0)
  expect(pressures.size).toBe(3)
  expect(node).toEqual(originalNode)

  // Reuse the existing full native fixture for the surrounding pads and copper.
  const { inputSrj, preloadedTraces } = JSON.parse(
    gunzipSync(
      new Uint8Array(
        readFileSync(
          new URL(
            "../fixtures/assets/butterstick-ddr-fixed-copper.srj.json.gz",
            import.meta.url,
          ),
        ),
      ),
    ).toString("utf8"),
  ) as { inputSrj: SimpleRouteJson; preloadedTraces: SimplifiedPcbTrace[] }
  const inView = ({ x, y }: { x: number; y: number }): boolean => {
    const minX = -13.2
    const maxX = -10.4
    const minY = -5.6
    const maxY = -2.8
    return x >= minX && x <= maxX && y >= minY && y <= maxY
  }
  const pads = inputSrj.obstacles.filter(
    (obstacle): boolean =>
      Boolean(obstacle.circuitJsonMetadata?.pcb_smtpad_id) &&
      inView(obstacle.center),
  )
  const copper = convertSrjToGraphicsObject({
    ...inputSrj,
    obstacles: pads.filter(({ shape }): boolean => shape !== "circle"),
    connections: [],
    traces: preloadedTraces,
  })
  const cell: CapacityMeshNode = {
    ...node,
    layer: "",
    availableZ: node.availableZ!,
  }
  const foreignCells: CapacityMeshNode[] = [0, 1].map(
    (z): CapacityMeshNode => ({
      capacityMeshNodeId: `topology_merge_${4752 + z}`,
      center: { x: -12.400000000000006, y: -4.400000000000006 },
      width: 0.40000000000000213,
      height: 0.40000000000000036,
      availableZ: [z],
      layer: `z${z}`,
    }),
  )
  const graphics: GraphicsObject = {
    coordinateSystem: "cartesian",
    rects: [
      ...copper.rects,
      {
        ...createRectFromCapacityNode(cell, { rectMargin: 0.001, zOffset: 0 }),
        fill: "#16a34a26",
        stroke: "#15803d",
      },
      ...foreignCells.map(
        (foreignCell): Rect => ({
          ...createRectFromCapacityNode(foreignCell, {
            rectMargin: 0.001,
            zOffset: 0,
          }),
          fill: solver.nodePfById.has(foreignCell.capacityMeshNodeId)
            ? "#ea580c40"
            : "transparent",
          stroke: solver.nodePfById.has(foreignCell.capacityMeshNodeId)
            ? "#c2410c"
            : "#94a3b8",
        }),
      ),
    ],
    circles: [
      ...copper.circles.filter(({ center }): boolean => inView(center)),
      ...pads
        .filter(({ shape }): boolean => shape === "circle")
        .map(
          ({ center, width }): Circle => ({
            center,
            radius: width / 2,
            fill: "#ef444480",
          }),
        ),
    ],
    lines: [
      ...copper.lines.filter(({ points }): boolean => points.every(inView)),
      ...solver.routes.map(
        (route): Line => ({
          points: route.route,
          strokeColor: "#166534",
          strokeWidth: route.traceThickness,
        }),
      ),
    ],
    texts: [
      {
        x: -11.8,
        y: -2.25,
        text: "ButterStick U4 native routing cell",
        fontSize: 0.16,
      },
      {
        x: -11.8,
        y: -2.55,
        text: "Native BGA pads and the source_net_27 route",
        fontSize: 0.11,
      },
      {
        x: -11.8,
        y: -5.95,
        text: `Pressure entries copied: ${solver.nodePfById.size} / entries used: 1`,
        fontSize: 0.13,
      },
      {
        x: -11.8,
        y: -6.2,
        text: "Orange: copied foreign pressure / gray: omitted",
        fontSize: 0.11,
      },
      {
        x: -11.8,
        y: -6.45,
        text: "Three actual native pressure entries in this focused repro",
        fontSize: 0.1,
      },
    ],
  }
  await expect(
    getSvgFromGraphicsObject(graphics, {
      backgroundColor: "white",
      svgWidth: 800,
      svgHeight: 1000,
    }),
  ).toMatchSvgSnapshot(import.meta.path)
})
