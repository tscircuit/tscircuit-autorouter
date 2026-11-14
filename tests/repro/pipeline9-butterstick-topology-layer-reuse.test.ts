import { expect, spyOn, test } from "bun:test"
import { readFileSync } from "node:fs"
import { gunzipSync } from "node:zlib"
import {
  type Circle,
  type GraphicsObject,
  getSvgFromGraphicsObject,
  type Line,
  type Rect,
  type Text,
} from "graphics-debug"
import { TopologyMergingSolver } from "lib/solvers/TopologyMergingSolver/TopologyMergingSolver"
import * as topologyRegions from "lib/solvers/TopologyMergingSolver/topology-merging-regions"
import type {
  CapacityMeshNode,
  SimpleRouteJson,
  SimplifiedPcbTrace,
} from "lib/types"
import { convertSrjToGraphicsObject } from "lib/utils/convertSrjToGraphicsObject"
import { createRectFromCapacityNode } from "lib/utils/createRectFromCapacityNode"

// Native board: https://github.com/butterstick-fpga/butterstick-hardware/blob/0694ddfa9824a07f0c6c6981186e45f80187659c/hardware/ButterStick_r1.0/ButterStick.kicad_pcb
// These nodes retain the published Pipeline9 topology's bounds and metadata.
// The bottom pad's X boundary also cuts an unrelated eight-layer BGA cell.
test("ButterStick keeps native layers while reusing repeated slab coverage", async (): Promise<void> => {
  const globalPad: CapacityMeshNode = {
    capacityMeshNodeId: "cmn_171",
    center: { x: 5.574999999999989, y: 6.414999999999991 },
    width: 0.6399999999999997,
    height: 0.5899999999999999,
    layer: "top",
    availableZ: [7],
    _containsObstacle: true,
    _containsTarget: true,
    _connectedTo: [
      "pcb_smtpad_575",
      "connectivity_net1954",
      "source_port_575",
      "pcb_port_575",
    ],
  }
  const freeCell: CapacityMeshNode = {
    capacityMeshNodeId:
      "cmn_d_pcb_component_0_8_11_5.1_4.4_0.3999999999999989_0.40000000000000513_all",
    center: { x: 5.1, y: 4.4 },
    width: 0.3999999999999989,
    height: 0.40000000000000513,
    availableZ: [0, 1, 2, 3, 4, 5, 6, 7],
    layer: "",
  }
  const layerGaps = Array.from(
    { length: 7 },
    (_, z): CapacityMeshNode => ({
      capacityMeshNodeId: `cmn_missing_pcb_component_0_11_12_5.500000000000011_6.4_0.4_0.4_${z}`,
      center: { x: 5.500000000000011, y: 6.4 },
      width: 0.4,
      height: 0.4,
      availableZ: [z],
      layer: "",
    }),
  )
  const componentPad: CapacityMeshNode = {
    capacityMeshNodeId:
      "obstacle-pcb_component_0-pcb_component_4:5.574999999999989:6.414999999999991:0.64:0.59:bottom-7-5.574999999999989-6.414999999999991",
    _containsObstacle: true,
    center: { x: 5.574999999999989, y: 6.414999999999991 },
    width: 0.64,
    height: 0.59,
    layer: "z7",
    availableZ: [7],
  }
  const lowerGap: CapacityMeshNode = {
    capacityMeshNodeId:
      "bga-gapfill-2-no-obstacle-cmn_missing_pcb_component_0_10_13_5.5000000000000115_5.6_0.4_0.4_7",
    center: { x: 5.5000000000000115, y: 5.9599999999999955 },
    width: 0.40000000000000036,
    height: 0.3199999999999914,
    layer: "z7",
    availableZ: [7],
  }
  const cornerGap: CapacityMeshNode = {
    capacityMeshNodeId:
      "bga-gapfill-1-no-obstacle-cmn_v_pcb_component_0_11_14_6.300000000000011_6.8_0.4_0.3999999999999936_7",
    center: { x: 5.9975000000000005, y: 6.654999999999998 },
    width: 0.20500000000002228,
    height: 0.10999999999998789,
    layer: "z7",
    availableZ: [7],
  }
  const solver = new TopologyMergingSolver({
    layerCount: 8,
    allowBlindAndBuriedVias: false,
    nodeGroups: [
      { groupId: "global", nodes: [globalPad], isComponent: false },
      {
        groupId: "component-0",
        nodes: [freeCell, ...layerGaps, componentPad, cornerGap, lowerGap],
        isComponent: true,
      },
    ],
  })
  const padEdgeX = globalPad.center.x - globalPad.width / 2
  const cellMinX = freeCell.center.x - freeCell.width / 2
  const cellMaxX = freeCell.center.x + freeCell.width / 2
  const xCoordinates = topologyRegions.getCanonicalCoordinates(
    solver.inputProblem.nodeGroups.flatMap(({ nodes }): number[] =>
      nodes.flatMap(({ center, width }): number[] => [
        center.x - width / 2,
        center.x + width / 2,
      ]),
    ),
  )
  const cellSlabs: { minX: number; maxX: number; calculations: number }[] = []
  // Observe actual work per slab so the same repro shows the fix automatically.
  const layerSelections = spyOn(
    topologyRegions,
    "getLayerTopologiesForCoveredNodes",
  )
  let totalCalculations: number
  try {
    for (let xIndex = 0; xIndex < xCoordinates.length - 1; xIndex++) {
      const callStart = layerSelections.mock.calls.length
      solver.step()
      const minX = xCoordinates[xIndex]!
      const maxX = xCoordinates[xIndex + 1]!
      const x = (minX + maxX) / 2
      if (x < cellMinX || x > cellMaxX) continue
      const calculations = layerSelections.mock.calls
        .slice(callStart)
        .filter(([{ coveringNodes }]): boolean =>
          coveringNodes.some(({ node }): boolean => node === freeCell),
        ).length
      cellSlabs.push({ minX, maxX, calculations })
    }
    solver.solve()
    totalCalculations = layerSelections.mock.calls.length
  } finally {
    layerSelections.mockRestore()
  }
  expect(cellSlabs).toHaveLength(2)
  expect(solver.solved).toBeTrue()
  expect(solver.failed).toBeFalse()
  const output = solver.getOutput()
  const retainedNodes = [globalPad, freeCell, ...layerGaps, cornerGap, lowerGap]
  expect(
    output.map(({ capacityMeshNodeId }): string => capacityMeshNodeId).sort(),
  ).toEqual(
    retainedNodes
      .map(({ capacityMeshNodeId }): string => capacityMeshNodeId)
      .sort(),
  )
  expect(
    output.find(
      ({ capacityMeshNodeId }): boolean =>
        capacityMeshNodeId === globalPad.capacityMeshNodeId,
    ),
  ).toMatchObject({
    availableZ: [7],
    _containsObstacle: true,
    _containsTarget: true,
    _connectedTo: globalPad._connectedTo,
  })
  expect(
    output.find(
      ({ capacityMeshNodeId }): boolean =>
        capacityMeshNodeId === freeCell.capacityMeshNodeId,
    ),
  ).toMatchObject({ availableZ: [0, 1, 2, 3, 4, 5, 6, 7] })
  for (const [z, layerGap] of layerGaps.entries()) {
    expect(
      output.find(
        ({ capacityMeshNodeId }): boolean =>
          capacityMeshNodeId === layerGap.capacityMeshNodeId,
      ),
    ).toMatchObject({ availableZ: [z] })
  }
  const cellCalculations = cellSlabs.reduce(
    (total, { calculations }): number => total + calculations,
    0,
  )
  // Reuse the existing native circuit fixture for physical context only.
  // The focused solver still receives exactly the same twelve mesh regions.
  const fixtureUrl = new URL(
    "../fixtures/assets/butterstick-ddr-fixed-copper.srj.json.gz",
    import.meta.url,
  )
  const { inputSrj, preloadedTraces } = JSON.parse(
    gunzipSync(new Uint8Array(readFileSync(fixtureUrl))).toString("utf8"),
  ) as { inputSrj: SimpleRouteJson; preloadedTraces: SimplifiedPcbTrace[] }
  const inNativeView = ({ x, y }: { x: number; y: number }): boolean => {
    const minX = 3.3
    const maxX = 6.7
    const minY = 3.5
    const maxY = 7.7
    return x >= minX && x <= maxX && y >= minY && y <= maxY
  }
  const nativePads = inputSrj.obstacles.filter(
    (obstacle): boolean =>
      Boolean(obstacle.circuitJsonMetadata?.pcb_smtpad_id) &&
      inNativeView(obstacle.center),
  )
  expect(
    nativePads.find(
      ({ circuitJsonMetadata }): boolean =>
        circuitJsonMetadata?.pcb_smtpad_id === "pcb_smtpad_575",
    ),
  ).toMatchObject({ center: globalPad.center, layers: ["bottom"] })
  const copper = convertSrjToGraphicsObject({
    ...inputSrj,
    obstacles: nativePads.filter(({ shape }): boolean => shape !== "circle"),
    connections: [],
    traces: preloadedTraces,
  })
  const graphics: GraphicsObject = {
    coordinateSystem: "cartesian",
    circles: [
      ...copper.circles.filter(({ center }): boolean => inNativeView(center)),
      ...nativePads
        .filter(({ shape }): boolean => shape === "circle")
        .map(
          ({ center, width }): Circle => ({
            center,
            radius: width / 2,
            fill: "rgba(255,0,0,0.5)",
            layer: "z0",
          }),
        ),
    ],
    rects: [
      ...copper.rects,
      ...output
        .filter(({ _containsObstacle }): boolean => !_containsObstacle)
        .map(
          (node): Rect => ({
            ...createRectFromCapacityNode(node, {
              rectMargin: 0.01,
              zOffset: 0,
            }),
            stroke: "rgba(0,140,170,0.5)",
          }),
        ),
      ...cellSlabs.map(
        ({ minX, maxX, calculations }): Rect => ({
          ...createRectFromCapacityNode(
            {
              ...freeCell,
              center: { x: (minX + maxX) / 2, y: freeCell.center.y },
              width: maxX - minX,
            },
            { rectMargin: 0.001, zOffset: 0 },
          ),
          fill: calculations > 0 ? "#ea580c26" : "#16a34a4d",
          stroke: calculations > 0 ? "#c2410c" : "#15803d",
        }),
      ),
    ],
    lines: [
      ...copper.lines.flatMap(({ points, ...line }): Line[] => {
        const segments: Line[] = []
        for (let index = 1; index < points.length; index++) {
          const start = points[index - 1]!
          const end = points[index]!
          if (inNativeView(start) && inNativeView(end)) {
            segments.push({ ...line, points: [start, end] })
          }
        }
        return segments
      }),
      {
        points: [
          { x: padEdgeX, y: 4.2 },
          { x: padEdgeX, y: 6.71 },
        ],
        strokeColor: "#475569",
        strokeDash: "4 3",
        strokeWidth: 0.012,
      },
      ...cellSlabs.map(
        ({ minX, maxX }, index): Line => ({
          points: [
            { x: (minX + maxX) / 2, y: freeCell.center.y },
            { x: index === 0 ? 4.5 : 6.0, y: 4.8 },
          ],
          strokeColor: "#64748b",
          strokeWidth: 0.006,
        }),
      ),
      {
        points: [
          {
            x: globalPad.center.x + globalPad.width / 2,
            y: globalPad.center.y,
          },
          { x: 6.4, y: 6.75 },
        ],
        strokeColor: "#475569",
        strokeWidth: 0.007,
      },
    ],
    texts: [
      {
        x: 5.1,
        y: 8.4,
        text: "ButterStick native DDR region",
        fontSize: 0.18,
      },
      {
        x: 5.1,
        y: 8.05,
        text: "Top pads red / bottom pads blue / native copper",
        fontSize: 0.11,
      },
      ...nativePads
        .filter(({ shape }): boolean => shape === "circle")
        .map(
          ({ center, circuitJsonMetadata }): Text => ({
            x: center.x,
            y: center.y,
            text: circuitJsonMetadata!.source_port_name!.replace("BALL_", ""),
            fontSize: 0.09,
          }),
        ),
      {
        x: 6.4,
        y: 6.9,
        text: "Bottom pad 575",
        fontSize: 0.11,
      },
      {
        x: 5.85,
        y: 5.85,
        text: "Pad edge",
        fontSize: 0.12,
      },
      {
        x: 5.85,
        y: 5.6,
        text: `X = ${padEdgeX.toFixed(3)} mm`,
        fontSize: 0.11,
      },
      {
        x: 4.35,
        y: 5.85,
        text: `Cell calculations: ${cellCalculations}`,
        fontSize: 0.13,
      },
      {
        x: 4.35,
        y: 5.6,
        text: `12 regions: ${totalCalculations} calculations`,
        fontSize: 0.11,
      },
      ...cellSlabs.map(
        ({ calculations }, index): Text => ({
          x: index === 0 ? 4.5 : 6.0,
          y: 4.95,
          text: calculations > 0 ? "Calculate layers" : "Reuse layers",
          fontSize: 0.12,
          color: calculations > 0 ? "#9a3412" : "#166534",
        }),
      ),
      {
        x: 5.1,
        y: 3.1,
        text: "Native cell: 0.40 x 0.40 mm / layers 0-7",
        fontSize: 0.11,
      },
      {
        x: 5.1,
        y: 2.8,
        text: "Copper and merged mesh stay identical.",
        fontSize: 0.11,
      },
    ],
  }
  await expect(
    getSvgFromGraphicsObject(graphics, {
      backgroundColor: "white",
      svgWidth: 800,
      svgHeight: 900,
    }),
  ).toMatchSvgSnapshot(import.meta.path)
})
