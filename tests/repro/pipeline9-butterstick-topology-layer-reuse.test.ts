import { expect, spyOn, test } from "bun:test"
import type { GraphicsObject, Rect, Text } from "graphics-debug"
import { TopologyMergingSolver } from "lib/solvers/TopologyMergingSolver/TopologyMergingSolver"
import * as topologyRegions from "lib/solvers/TopologyMergingSolver/topology-merging-regions"
import type { CapacityMeshNode } from "lib/types"
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
  const graphics: GraphicsObject = {
    coordinateSystem: "cartesian",
    rects: cellSlabs.map(
      ({ minX, maxX, calculations }): Rect => ({
        ...createRectFromCapacityNode(
          {
            ...freeCell,
            center: { x: (minX + maxX) / 2, y: freeCell.center.y },
            width: maxX - minX,
          },
          { rectMargin: 0.001, zOffset: 0 },
        ),
        fill: calculations > 0 ? "#ffedd5" : "#dcfce7",
        stroke: calculations > 0 ? "#c2410c" : "#15803d",
      }),
    ),
    lines: [
      {
        points: [
          { x: padEdgeX, y: 4.18 },
          { x: padEdgeX, y: 4.72 },
        ],
        strokeColor: "#475569",
        strokeDash: "4 3",
        strokeWidth: 0.002,
      },
    ],
    texts: [
      {
        x: 5.1,
        y: 5.02,
        text: "ButterStick: repeated layer selection",
        fontSize: 0.032,
      },
      {
        x: 5.1,
        y: 4.92,
        text: `Cell layer calculations: ${cellCalculations}`,
        fontSize: 0.042,
      },
      {
        x: 5.1,
        y: 4.76,
        text: `Distant pad edge: X = ${padEdgeX.toFixed(3)} mm`,
        fontSize: 0.026,
      },
      ...cellSlabs.map(
        ({ minX, maxX, calculations }, index): Text => ({
          x: (minX + maxX) / 2,
          y: 4.4,
          text: calculations > 0 ? "CALCULATE" : "REUSE",
          rotation: index === 0 ? 0 : 90,
          fontSize: 0.025,
          color: calculations > 0 ? "#9a3412" : "#166534",
        }),
      ),
      {
        x: 5.1,
        y: 4.08,
        text: "Native cell: 0.40 x 0.40 mm; layers 0-7 preserved",
        fontSize: 0.026,
      },
      {
        x: 5.1,
        y: 3.99,
        text: `Full 12-node repro: ${totalCalculations} layer calculations`,
        fontSize: 0.026,
      },
    ],
  }
  await expect(graphics).toMatchGraphicsSvg(import.meta.path)
})
