import { expect, test } from "bun:test"
import type { AnyCircuitElement } from "circuit-json"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import {
  PostPowerDrcRepairSolver,
  getCheckedViaInPadIdentities,
  getSrjConnectedObstacleBoardEdgeErrors,
  getSrjObstacleClearanceErrors,
  getTraceBoardEdgeErrors,
  getTraceGeometryRuleErrors,
  getViaPadClearanceErrors,
  hasPreservedConnectionPointContacts,
  hasPreservedSameNetJunctions,
  relocateViaVertex,
  translateLocalTraceVertices,
} from "lib/autorouter-pipelines/AutoroutingPipeline7_MultiGraph/post-power-drc-repair-solver"
import { getDrcErrors } from "lib/testing/getDrcErrors"
import { convertToCircuitJson } from "lib/testing/utils/convertToCircuitJson"
import type { SimpleRouteJson, SimplifiedPcbTrace } from "lib/types"

const makeTrace = ({
  id,
  connectionName,
  route,
}: {
  id: string
  connectionName: string
  route: SimplifiedPcbTrace["route"]
}): SimplifiedPcbTrace => ({
  type: "pcb_trace",
  pcb_trace_id: id,
  connection_name: connectionName,
  connectsTo: [],
  route,
})

const makeBoard = (
  overrides: Partial<SimpleRouteJson> = {},
): SimpleRouteJson => ({
  layerCount: 4,
  minTraceWidth: 0.1,
  minViaPadDiameter: 0.4,
  minViaHoleDiameter: 0.2,
  bounds: { minX: -5, minY: -5, maxX: 5, maxY: 5 },
  connections: [],
  obstacles: [],
  ...overrides,
})

test("post-power final invariants reject every reviewed false-clean state", (): void => {
  {
    const srj = makeBoard({ minBoardEdgeClearance: 0.2 })
    const outside = makeTrace({
      id: "outside",
      connectionName: "outside_net",
      route: [
        { route_type: "wire", x: 7, y: 0, width: 0.2, layer: "top" },
        { route_type: "wire", x: 8, y: 0, width: 0.2, layer: "top" },
      ],
    })
    expect(getTraceBoardEdgeErrors({ traces: [outside], srj })).toHaveLength(1)

    const concaveSrj = makeBoard({
      minBoardEdgeClearance: 0.05,
      bounds: { minX: 0, minY: 0, maxX: 4, maxY: 4 },
      outline: [
        { x: 0, y: 0 },
        { x: 4, y: 0 },
        { x: 4, y: 1 },
        { x: 1, y: 1 },
        { x: 1, y: 4 },
        { x: 0, y: 4 },
      ],
    })
    const crossesConcavity = makeTrace({
      id: "concave_crossing",
      connectionName: "concave_net",
      route: [
        { route_type: "wire", x: 0.5, y: 3, width: 0.1, layer: "top" },
        { route_type: "wire", x: 3, y: 0.5, width: 0.1, layer: "top" },
      ],
    })
    expect(
      getTraceBoardEdgeErrors({ traces: [crossesConcavity], srj: concaveSrj }),
    ).toHaveLength(1)
  }

  {
    const connectivityMap = new ConnectivityMap({
      same_net: ["trace_parallel", "parallel_branch"],
    })
    const before = makeTrace({
      id: "trace_parallel",
      connectionName: "same_net",
      route: [
        { route_type: "wire", x: -1, y: 0, width: 0.2, layer: "top" },
        { route_type: "wire", x: 1, y: 0, width: 0.2, layer: "top" },
      ],
    })
    const branch = makeTrace({
      id: "parallel_branch",
      connectionName: "same_net",
      route: [
        { route_type: "wire", x: -1, y: 0.15, width: 0.2, layer: "top" },
        { route_type: "wire", x: 1, y: 0.15, width: 0.2, layer: "top" },
      ],
    })
    const disconnected = makeTrace({
      id: "trace_parallel",
      connectionName: "same_net",
      route: [
        { route_type: "wire", x: -1, y: -0.3, width: 0.2, layer: "top" },
        { route_type: "wire", x: 1, y: -0.3, width: 0.2, layer: "top" },
      ],
    })
    expect(
      hasPreservedSameNetJunctions({
        before,
        candidate: disconnected,
        otherTraces: [branch],
        connectivityMap,
        layerCount: 4,
        defaultViaDiameter: 0.4,
      }),
    ).toBe(false)

    const viaTrace = makeTrace({
      id: "trace_parallel",
      connectionName: "same_net",
      route: [
        { route_type: "wire", x: -1, y: 0, width: 0.1, layer: "top" },
        { route_type: "wire", x: 0, y: 0, width: 0.1, layer: "top" },
        {
          route_type: "via",
          x: 0,
          y: 0,
          from_layer: "top",
          to_layer: "bottom",
          via_diameter: 0.4,
          via_hole_diameter: 0.2,
        },
        { route_type: "wire", x: 0, y: 0, width: 0.1, layer: "bottom" },
        { route_type: "wire", x: 1, y: 0, width: 0.1, layer: "bottom" },
      ],
    })
    const innerBranch = makeTrace({
      id: "parallel_branch",
      connectionName: "same_net",
      route: [
        {
          route_type: "wire",
          x: -1,
          y: 0.24,
          width: 0.1,
          layer: "inner1",
        },
        {
          route_type: "wire",
          x: 1,
          y: 0.24,
          width: 0.1,
          layer: "inner1",
        },
      ],
    })
    expect(
      hasPreservedSameNetJunctions({
        before: viaTrace,
        candidate: relocateViaVertex(viaTrace, 2, { dx: 0, dy: -0.3 })!,
        otherTraces: [innerBranch],
        connectivityMap,
        layerCount: 4,
        defaultViaDiameter: 0.4,
      }),
    ).toBe(false)
  }

  {
    const srj = makeBoard({
      connections: [
        {
          name: "terminal_net",
          pointsToConnect: [
            { x: -1, y: 0, layer: "top" },
            { x: 0, y: 0, layer: "top" },
            { x: 1, y: 0, layer: "top" },
          ],
        },
      ],
    })
    const connectivityMap = new ConnectivityMap({})
    const before = makeTrace({
      id: "terminal_trace",
      connectionName: "terminal_net",
      route: [
        { route_type: "wire", x: -1, y: 0, width: 0.1, layer: "top" },
        { route_type: "wire", x: 0, y: 0, width: 0.1, layer: "top" },
        { route_type: "wire", x: 1, y: 0, width: 0.1, layer: "top" },
      ],
    })
    const candidate = translateLocalTraceVertices({
      trace: before,
      center: { x: 0, y: 0 },
      selectionRadius: 0.01,
      dx: 0,
      dy: 0.3,
    })!
    expect(
      hasPreservedConnectionPointContacts({
        before,
        candidate,
        srj,
        connectivityMap,
        defaultViaDiameter: 0.4,
      }),
    ).toBe(false)
  }

  {
    const srj = makeBoard({
      allowViaInPad: false,
      connections: [
        {
          name: "pad_net",
          pointsToConnect: [
            { x: 0, y: 0, layer: "top", pcb_port_id: "pad_port_a" },
            { x: 0.1, y: 0, layer: "top", pcb_port_id: "pad_port_alias" },
          ],
        },
      ],
      obstacles: [
        {
          type: "rect",
          layers: ["top"],
          center: { x: 0, y: 0 },
          width: 0.8,
          height: 0.8,
          connectedTo: ["pad_net", "pad_port_a", "pad_port_alias"],
        },
        {
          type: "rect",
          layers: ["inner1"],
          center: { x: 0, y: 0 },
          width: 4,
          height: 4,
          connectedTo: ["pad_net", "pad_port_a", "pad_port_alias"],
          isCopperPour: true,
        },
      ],
    })
    const circuitJson = [
      {
        type: "pcb_via",
        pcb_via_id: "via_actual",
        pcb_trace_id: "via_trace",
        x: 0,
        y: 0,
        outer_diameter: 0.4,
        hole_diameter: 0.2,
        layers: ["top", "inner1", "inner2", "bottom"],
      },
      {
        type: "pcb_smtpad",
        pcb_smtpad_id: "metadata_free_pad",
        pcb_port_id: "pad_port_a",
        shape: "rect",
        width: 0.8,
        height: 0.8,
        x: 0,
        y: 0,
        layer: "top",
      },
      {
        type: "pcb_smtpad",
        pcb_smtpad_id: "pour_artifact",
        pcb_port_id: "pad_port_a",
        shape: "rect",
        width: 4,
        height: 4,
        x: 0,
        y: 0,
        layer: "inner1",
      },
    ] as AnyCircuitElement[]
    expect(getCheckedViaInPadIdentities({ circuitJson, srj })).toEqual([
      "via_trace:0.000000:0.000000:top-inner1-inner2-bottom:metadata_free_pad",
    ])
    expect(
      getViaPadClearanceErrors({
        circuitJson,
        srj,
        supplementalConnMap: new ConnectivityMap({}),
      }),
    ).toHaveLength(1)
  }

  {
    const srj = makeBoard({
      allowViaInPad: false,
      connections: [
        {
          name: "corner_via_net",
          pointsToConnect: [
            { x: -1, y: 0.35, layer: "top" },
            { x: 1, y: 0.35, layer: "bottom" },
          ],
        },
        {
          name: "square_pad_net",
          pointsToConnect: [
            {
              x: 0,
              y: 0,
              layers: ["top", "bottom"],
              pcb_port_id: "square_pad",
            },
          ],
        },
      ],
      obstacles: [
        {
          type: "rect",
          layers: ["top", "bottom"],
          center: { x: 0, y: 0 },
          width: 0.8,
          height: 0.8,
          connectedTo: ["square_pad_net", "square_pad"],
        },
      ],
    })
    const cornerVia = makeTrace({
      id: "corner_via_trace",
      connectionName: "corner_via_net",
      route: [
        { route_type: "wire", x: -1, y: 0.35, width: 0.1, layer: "top" },
        { route_type: "wire", x: 0.35, y: 0.35, width: 0.1, layer: "top" },
        {
          route_type: "via",
          x: 0.35,
          y: 0.35,
          from_layer: "top",
          to_layer: "bottom",
          via_diameter: 0.2,
          via_hole_diameter: 0.1,
        },
        {
          route_type: "wire",
          x: 0.35,
          y: 0.35,
          width: 0.1,
          layer: "bottom",
        },
        { route_type: "wire", x: 1, y: 0.35, width: 0.1, layer: "bottom" },
      ],
    })
    const circuitJson = convertToCircuitJson(srj, [cornerVia], {
      originalSrj: srj,
      includeOriginalConnections: true,
    })
    expect(
      circuitJson.find((element) => element.type === "pcb_plated_hole"),
    ).toMatchObject({ shape: "circular_hole_with_rect_pad" })
    expect(getCheckedViaInPadIdentities({ circuitJson, srj })).toHaveLength(1)
  }

  {
    const circularObstacle = {
      type: "oval",
      layers: ["top", "bottom"],
      center: { x: 0, y: 0 },
      width: 0.8,
      height: 0.8,
      ccwRotationDegrees: 0,
      connectedTo: ["circle_net", "circle_pad"],
    } as unknown as SimpleRouteJson["obstacles"][number]
    const srj = makeBoard({
      allowViaInPad: false,
      connections: [
        {
          name: "circle_net",
          pointsToConnect: [
            { x: -1, y: 0.35, layer: "top" },
            {
              x: 0,
              y: 0,
              layers: ["top", "bottom"],
              pcb_port_id: "circle_pad",
            },
            { x: 1, y: 0.35, layer: "bottom" },
          ],
        },
      ],
      obstacles: [circularObstacle],
    })
    const cornerVia = makeTrace({
      id: "circle_corner_trace",
      connectionName: "circle_net",
      route: [
        { route_type: "wire", x: -1, y: 0.35, width: 0.1, layer: "top" },
        { route_type: "wire", x: 0.35, y: 0.35, width: 0.1, layer: "top" },
        {
          route_type: "via",
          x: 0.35,
          y: 0.35,
          from_layer: "top",
          to_layer: "bottom",
          via_diameter: 0.4,
          via_hole_diameter: 0.2,
        },
        {
          route_type: "wire",
          x: 0.35,
          y: 0.35,
          width: 0.1,
          layer: "bottom",
        },
        { route_type: "wire", x: 1, y: 0.35, width: 0.1, layer: "bottom" },
      ],
    })
    const circuitJson = convertToCircuitJson(srj, [cornerVia], {
      originalSrj: srj,
      includeOriginalConnections: true,
    })
    expect(
      circuitJson.find((element) => element.type === "pcb_plated_hole"),
    ).toMatchObject({ shape: "circle" })
    expect(getCheckedViaInPadIdentities({ circuitJson, srj })).toHaveLength(0)

    const solver = new PostPowerDrcRepairSolver({
      originalSrj: srj,
      srjWithPointPairs: srj,
      traces: [cornerVia],
      maxCandidateEvaluations: 0,
    })
    solver.solve()
    expect(solver.stats.initialViaInPadCount).toBe(0)
  }

  {
    const srj = makeBoard({
      allowViaInPad: false,
      connections: [
        {
          name: "via_net",
          pointsToConnect: [
            { x: -1, y: 0, layer: "top" },
            { x: 1, y: 0, layer: "bottom" },
          ],
        },
        {
          name: "foreign_net",
          pointsToConnect: [
            { x: -1, y: 0.3, layer: "inner1" },
            { x: 1, y: 0.3, layer: "inner1" },
          ],
        },
        {
          name: "pad_net",
          pointsToConnect: [
            { x: 0, y: 0, layer: "inner1", pcb_port_id: "inner_pad" },
          ],
        },
      ],
      obstacles: [
        {
          type: "rect",
          layers: ["inner1"],
          center: { x: 0, y: 0 },
          width: 0.2,
          height: 0.2,
          connectedTo: ["pad_net", "inner_pad"],
        },
      ],
    })
    const viaTrace = makeTrace({
      id: "via_trace",
      connectionName: "via_net",
      route: [
        { route_type: "wire", x: -1, y: 0, width: 0.1, layer: "top" },
        { route_type: "wire", x: 0, y: 0, width: 0.1, layer: "top" },
        {
          route_type: "via",
          x: 0,
          y: 0,
          from_layer: "top",
          to_layer: "bottom",
          via_diameter: 0.4,
          via_hole_diameter: 0.2,
        },
        { route_type: "wire", x: 0, y: 0, width: 0.1, layer: "bottom" },
        { route_type: "wire", x: 1, y: 0, width: 0.1, layer: "bottom" },
      ],
    })
    const foreignTrace = makeTrace({
      id: "foreign_trace",
      connectionName: "foreign_net",
      route: [
        {
          route_type: "wire",
          x: -1,
          y: 0.3,
          width: 0.1,
          layer: "inner1",
        },
        {
          route_type: "wire",
          x: 1,
          y: 0.3,
          width: 0.1,
          layer: "inner1",
        },
      ],
    })
    const circuitJson = convertToCircuitJson(srj, [viaTrace, foreignTrace], {
      originalSrj: srj,
      includeOriginalConnections: true,
    })
    const convertedVia = circuitJson.find(
      (element) => element.type === "pcb_via",
    )
    expect(convertedVia).toMatchObject({
      layers: ["top", "inner1", "inner2", "bottom"],
    })
    expect(
      getDrcErrors(circuitJson, {
        traceClearance: 0.1,
        includeTraceContinuity: false,
      }).errors.some((error) => error.type === "pcb_via_trace_clearance_error"),
    ).toBe(true)
    expect(
      getViaPadClearanceErrors({
        circuitJson,
        srj,
        supplementalConnMap: new ConnectivityMap({}),
      }),
    ).toHaveLength(1)
    expect(getCheckedViaInPadIdentities({ circuitJson, srj })).toHaveLength(1)
  }

  {
    const fixedViaObstacle = {
      type: "rect" as const,
      layers: ["top", "inner1", "inner2", "bottom"],
      center: { x: 0, y: 0 },
      width: 0.4,
      height: 0.4,
      connectedTo: ["fixed_net"],
      circuitJsonMetadata: { pcb_via_id: "fixed_via" },
    }
    const srj = makeBoard({
      defaultObstacleMargin: 0.1,
      obstacles: [fixedViaObstacle],
    })
    const foreignWire = makeTrace({
      id: "foreign_wire",
      connectionName: "foreign_net",
      route: [
        { route_type: "wire", x: -1, y: 0.3, width: 0.1, layer: "top" },
        { route_type: "wire", x: 1, y: 0.3, width: 0.1, layer: "top" },
      ],
    })
    const foreignVia = makeTrace({
      id: "foreign_via",
      connectionName: "foreign_net",
      route: [
        { route_type: "wire", x: -1, y: 0, width: 0.1, layer: "top" },
        { route_type: "wire", x: 0.45, y: 0, width: 0.1, layer: "top" },
        {
          route_type: "via",
          x: 0.45,
          y: 0,
          from_layer: "top",
          to_layer: "bottom",
          via_diameter: 0.4,
          via_hole_diameter: 0.2,
        },
        {
          route_type: "wire",
          x: 0.45,
          y: 0,
          width: 0.1,
          layer: "bottom",
        },
        { route_type: "wire", x: 1, y: 0, width: 0.1, layer: "bottom" },
      ],
    })
    const fixedErrors = getSrjObstacleClearanceErrors({
      traces: [foreignWire, foreignVia],
      srj,
      connectivityMap: new ConnectivityMap({}),
    })
    expect(
      fixedErrors.some(
        (error) => error.type === "pcb_trace_srj_obstacle_clearance_error",
      ),
    ).toBe(true)
    expect(
      fixedErrors.some(
        (error) => error.type === "pcb_via_srj_obstacle_clearance_error",
      ),
    ).toBe(true)
    expect(
      getSrjConnectedObstacleBoardEdgeErrors({
        srj: makeBoard({
          minBoardEdgeClearance: 0.2,
          bounds: { minX: -2, minY: -2, maxX: 2, maxY: 2 },
          obstacles: [{ ...fixedViaObstacle, center: { x: 1.85, y: 0 } }],
        }),
      }),
    ).toHaveLength(1)
  }

  {
    const invalidTrace = makeTrace({
      id: "invalid_geometry",
      connectionName: "invalid_net",
      route: [
        { route_type: "wire", x: 0, y: 0, width: 0.05, layer: "top" },
        { route_type: "wire", x: Number.NaN, y: 0, width: 0.05, layer: "top" },
      ],
    })
    const geometryErrors = getTraceGeometryRuleErrors({
      traces: [invalidTrace],
      srj: makeBoard(),
    })
    expect(geometryErrors.map((error) => error.type)).toEqual([
      "pcb_trace_geometry_rule_error",
      "pcb_trace_geometry_rule_error",
    ])
  }

  {
    const strictSrj = makeBoard({
      layerCount: 2,
      minTraceToPadEdgeClearance: 0.25,
      connections: [
        {
          name: "strict_a",
          pointsToConnect: [
            { x: -1, y: 0, layer: "top" },
            { x: 1, y: 0, layer: "top" },
          ],
        },
        {
          name: "strict_b",
          pointsToConnect: [
            { x: -1, y: 0.3, layer: "top" },
            { x: 1, y: 0.3, layer: "top" },
          ],
        },
      ],
    })
    const traces = [
      makeTrace({
        id: "strict_a_trace",
        connectionName: "strict_a",
        route: [
          { route_type: "wire", x: -1, y: 0, width: 0.1, layer: "top" },
          { route_type: "wire", x: 1, y: 0, width: 0.1, layer: "top" },
        ],
      }),
      makeTrace({
        id: "strict_b_trace",
        connectionName: "strict_b",
        route: [
          { route_type: "wire", x: -1, y: 0.3, width: 0.1, layer: "top" },
          { route_type: "wire", x: 1, y: 0.3, width: 0.1, layer: "top" },
        ],
      }),
    ]
    const solver = new PostPowerDrcRepairSolver({
      originalSrj: strictSrj,
      srjWithPointPairs: strictSrj,
      traces,
      maxCandidateEvaluations: 0,
    })
    solver.solve()
    expect(solver.failed).toBe(true)
    expect(solver.stats.initialDrcErrorCount).toBeGreaterThan(0)
  }

  {
    const srj = makeBoard({
      layerCount: 2,
      minTraceToPadEdgeClearance: 0.05,
      minViaEdgeToPadEdgeClearance: 0.3,
      defaultObstacleMargin: 0.05,
      connections: [
        {
          name: "via_net",
          pointsToConnect: [
            { x: 0.55, y: -1, layer: "top" },
            { x: 0.55, y: 1, layer: "bottom" },
          ],
        },
        {
          name: "metadata_free_pad_net",
          pointsToConnect: [{ x: 0, y: 0, layer: "top" }],
        },
      ],
      obstacles: [
        {
          type: "rect",
          layers: ["top"],
          center: { x: 0, y: 0 },
          width: 0.2,
          height: 0.2,
          connectedTo: ["metadata_free_pad_net"],
        },
      ],
    })
    const viaTrace = makeTrace({
      id: "strict_via_trace",
      connectionName: "via_net",
      route: [
        { route_type: "wire", x: 0.55, y: -1, width: 0.1, layer: "top" },
        { route_type: "wire", x: 0.55, y: 0, width: 0.1, layer: "top" },
        {
          route_type: "via",
          x: 0.55,
          y: 0,
          from_layer: "top",
          to_layer: "bottom",
          via_diameter: 0.4,
          via_hole_diameter: 0.2,
        },
        { route_type: "wire", x: 0.55, y: 0, width: 0.1, layer: "bottom" },
        { route_type: "wire", x: 0.55, y: 1, width: 0.1, layer: "bottom" },
      ],
    })
    const solver = new PostPowerDrcRepairSolver({
      originalSrj: srj,
      srjWithPointPairs: srj,
      traces: [viaTrace],
      maxCandidateEvaluations: 0,
    })
    solver.solve()
    expect(solver.failed).toBe(true)
    expect(
      solver.stats.remainingDrcErrorIds.some((id) =>
        id.includes("via_obstacle:strict_via_trace"),
      ),
    ).toBe(true)
  }

  {
    const preloaded = makeTrace({
      id: "duplicate_id",
      connectionName: "fixed_signal",
      route: [
        { route_type: "wire", x: -1, y: 0, width: 0.1, layer: "top" },
        { route_type: "wire", x: 1, y: 0, width: 0.1, layer: "top" },
      ],
    })
    const routed = makeTrace({
      id: "duplicate_id",
      connectionName: "__post_power_fixed_0_0",
      route: [
        { route_type: "wire", x: 0, y: -1, width: 0.1, layer: "top" },
        { route_type: "wire", x: 0, y: 1, width: 0.1, layer: "top" },
      ],
    })
    const srj = makeBoard({
      traces: [preloaded],
      connections: [
        {
          name: "fixed_signal",
          pointsToConnect: [
            { x: -1, y: 0, layer: "top" },
            { x: 1, y: 0, layer: "top" },
          ],
        },
        {
          name: "__post_power_fixed_0_0",
          pointsToConnect: [
            { x: 0, y: -1, layer: "top" },
            { x: 0, y: 1, layer: "top" },
          ],
        },
      ],
    })
    const solver = new PostPowerDrcRepairSolver({
      originalSrj: srj,
      srjWithPointPairs: srj,
      traces: [routed],
      maxCandidateEvaluations: 0,
    })
    solver.solve()
    expect(solver.failed).toBe(true)
    expect(solver.stats.initialDrcErrorCount).toBeGreaterThan(0)
    expect(
      solver.stats.remainingDrcErrorIds.some(
        (id) =>
          id.includes("__post_power_fixed_0_1") && id.includes("duplicate_id"),
      ),
    ).toBe(true)
  }

  {
    const preloaded = makeTrace({
      id: "ambiguous_id",
      connectionName: "ambiguous_id",
      route: [
        { route_type: "wire", x: -1, y: 0, width: 0.1, layer: "top" },
        { route_type: "wire", x: 1, y: 0, width: 0.1, layer: "top" },
      ],
    })
    preloaded.connectsTo = ["fixed_port_a", "fixed_port_b"]
    const routed = makeTrace({
      id: "ambiguous_id",
      connectionName: "routed_net",
      route: [
        { route_type: "wire", x: 0, y: -1, width: 0.1, layer: "top" },
        { route_type: "wire", x: 0, y: 1, width: 0.1, layer: "top" },
      ],
    })
    const srj = makeBoard({ traces: [preloaded] })
    const solver = new PostPowerDrcRepairSolver({
      originalSrj: srj,
      srjWithPointPairs: srj,
      traces: [routed],
    })
    solver.solve()
    expect(solver.failed).toBe(true)
    expect(solver.error).toContain(
      "physical trace identifier(s) used by foreign logical nets: ambiguous_id",
    )
  }

  {
    const preloaded = makeTrace({
      id: "fixed_physical",
      connectionName: "mutable_physical",
      route: [
        { route_type: "wire", x: -1, y: 0, width: 0.1, layer: "top" },
        { route_type: "wire", x: 1, y: 0, width: 0.1, layer: "top" },
      ],
    })
    const routed = makeTrace({
      id: "mutable_physical",
      connectionName: "actual_mutable_net",
      route: [
        { route_type: "wire", x: 0, y: -1, width: 0.1, layer: "top" },
        { route_type: "wire", x: 0, y: 1, width: 0.1, layer: "top" },
      ],
    })
    const srj = makeBoard({ traces: [preloaded] })
    const solver = new PostPowerDrcRepairSolver({
      originalSrj: srj,
      srjWithPointPairs: srj,
      traces: [routed],
    })
    solver.solve()
    expect(solver.failed).toBe(true)
    expect(solver.error).toContain(
      "physical trace identifier(s) used by foreign logical nets: mutable_physical",
    )
  }

  {
    const preloaded = makeTrace({
      id: "fixed",
      connectionName: "mst0",
      route: [
        { route_type: "wire", x: -1, y: 0, width: 0.1, layer: "top" },
        { route_type: "wire", x: 0, y: 0, width: 0.1, layer: "top" },
      ],
    })
    preloaded.connectsTo = ["alias_id"]
    const routed = makeTrace({
      id: "alias_id",
      connectionName: "mst1",
      route: [
        { route_type: "wire", x: 0, y: 0, width: 0.1, layer: "top" },
        { route_type: "wire", x: 1, y: 0, width: 0.1, layer: "top" },
      ],
    })
    const srj = makeBoard({
      traces: [preloaded],
      connections: [
        {
          name: "mst0",
          __rootConnectionNames: ["root"],
          pointsToConnect: [
            { x: -1, y: 0, layer: "top" },
            { x: 0, y: 0, layer: "top", pointId: "alias_id" },
          ],
        },
        {
          name: "mst1",
          __rootConnectionNames: ["root"],
          pointsToConnect: [
            { x: 0, y: 0, layer: "top" },
            { x: 1, y: 0, layer: "top" },
          ],
        },
      ],
    })
    const solver = new PostPowerDrcRepairSolver({
      originalSrj: srj,
      srjWithPointPairs: srj,
      traces: [routed],
      maxCandidateEvaluations: 0,
    })
    solver.solve()
    expect(solver.failed).toBe(false)
    expect(solver.solved).toBe(true)
    expect(solver.stats.initialDrcErrorCount).toBe(0)
    expect(solver.getOutput()).toEqual([routed])
  }

  {
    const preloaded = makeTrace({
      id: "same",
      connectionName: "same",
      route: [
        { route_type: "wire", x: -1, y: 0, width: 0.1, layer: "top" },
        { route_type: "wire", x: 1, y: 0, width: 0.1, layer: "top" },
      ],
    })
    const routed = makeTrace({
      id: "same",
      connectionName: "same",
      route: [
        { route_type: "wire", x: 0, y: -1, width: 0.1, layer: "top" },
        { route_type: "wire", x: 0, y: 1, width: 0.1, layer: "top" },
      ],
    })
    const srj = makeBoard({
      traces: [preloaded],
      connections: [
        {
          name: "same",
          pointsToConnect: [
            { x: -1, y: 0, layer: "top" },
            { x: 1, y: 0, layer: "top" },
            { x: 0, y: -1, layer: "top" },
            { x: 0, y: 1, layer: "top" },
          ],
        },
      ],
    })
    const solver = new PostPowerDrcRepairSolver({
      originalSrj: srj,
      srjWithPointPairs: srj,
      traces: [routed],
      maxCandidateEvaluations: 0,
    })
    solver.solve()
    expect(solver.failed).toBe(false)
    expect(solver.solved).toBe(true)
    expect(solver.stats.initialDrcErrorCount).toBe(0)
    expect(solver.getOutput()).toEqual([routed])
  }

  {
    const routed = makeTrace({
      id: "pad_net",
      connectionName: "wire_net",
      route: [
        { route_type: "wire", x: -1, y: 0, width: 0.1, layer: "top" },
        { route_type: "wire", x: 1, y: 0, width: 0.1, layer: "top" },
      ],
    })
    const srj = makeBoard({
      connections: [
        {
          name: "wire_net",
          pointsToConnect: [
            { x: -1, y: 0, layer: "top" },
            { x: 1, y: 0, layer: "top" },
          ],
        },
        {
          name: "pad_net",
          pointsToConnect: [{ x: 0, y: 0, layer: "top" }],
        },
      ],
      obstacles: [
        {
          type: "rect",
          layers: ["top"],
          center: { x: 0, y: 0 },
          width: 0.4,
          height: 0.4,
          connectedTo: ["pad_net"],
        },
      ],
    })
    const solver = new PostPowerDrcRepairSolver({
      originalSrj: srj,
      srjWithPointPairs: srj,
      traces: [routed],
    })
    solver.solve()
    expect(solver.failed).toBe(true)
    expect(solver.error).toContain(
      "physical trace identifier(s) used by foreign logical nets: pad_net",
    )
  }

  {
    const jumperTrace = makeTrace({
      id: "jumper_trace",
      connectionName: "jumper_net",
      route: [
        { route_type: "wire", x: -1, y: 0, width: 0.1, layer: "top" },
        {
          route_type: "jumper",
          start: { x: -0.5, y: 0 },
          end: { x: 0.5, y: 0 },
          footprint: "0603",
          layer: "top",
        },
        { route_type: "wire", x: 1, y: 0, width: 0.1, layer: "top" },
      ],
    })
    const foreignTrace = makeTrace({
      id: "foreign_trace",
      connectionName: "foreign_net",
      route: [
        { route_type: "wire", x: 0, y: -1, width: 0.1, layer: "top" },
        { route_type: "wire", x: 0, y: 1, width: 0.1, layer: "top" },
      ],
    })
    const srj = makeBoard({ allowJumpers: true })
    const solver = new PostPowerDrcRepairSolver({
      originalSrj: srj,
      srjWithPointPairs: srj,
      traces: [jumperTrace, foreignTrace],
    })
    solver.solve()
    expect(solver.solved).toBe(true)
    expect(solver.failed).toBe(false)
    expect(solver.stats.initialDrcErrorCount).toBe(0)
    expect(solver.stats.initialGuardErrorCount).toBeGreaterThan(0)
    expect(solver.stats.remainingGuardErrorIds).toContain(
      "overlap_jumper_trace_foreign_trace",
    )
    expect(solver.getOutput()).toEqual([jumperTrace, foreignTrace])
    expect(solver.stats.unsupportedRouteTypes).toEqual(["jumper"])
  }

  {
    const farJumper = makeTrace({
      id: "far_jumper",
      connectionName: "far_jumper_net",
      route: [
        { route_type: "wire", x: -1.5, y: 3, width: 0.1, layer: "top" },
        {
          route_type: "jumper",
          start: { x: -0.825, y: 3 },
          end: { x: 0.825, y: 3 },
          footprint: "0603",
          layer: "top",
        },
        { route_type: "wire", x: 1.5, y: 3, width: 0.1, layer: "top" },
      ],
    })
    const movable = makeTrace({
      id: "movable",
      connectionName: "movable_net",
      route: [
        { route_type: "wire", x: -1, y: -0.5, width: 0.1, layer: "top" },
        { route_type: "wire", x: 0, y: 0, width: 0.1, layer: "top" },
        { route_type: "wire", x: -1, y: 0.5, width: 0.1, layer: "top" },
      ],
    })
    const blocker = makeTrace({
      id: "blocker",
      connectionName: "blocker_net",
      route: [
        { route_type: "wire", x: 0, y: -1, width: 0.1, layer: "top" },
        { route_type: "wire", x: 0, y: 1, width: 0.1, layer: "top" },
      ],
    })
    const srj = makeBoard({ allowJumpers: true })
    const solver = new PostPowerDrcRepairSolver({
      originalSrj: srj,
      srjWithPointPairs: srj,
      traces: [farJumper, movable, blocker],
      maxCandidateEvaluations: 80,
    })
    solver.solve()
    expect(solver.stats.initialDrcErrorCount).toBeGreaterThan(0)
    expect(solver.stats.candidateEvaluationCount).toBeGreaterThan(0)
    expect(solver.solved).toBe(true)
    expect(solver.failed).toBe(false)
    expect(solver.stats.finalDrcErrorCount).toBe(0)
    expect(
      solver.getOutput().find((trace) => trace.pcb_trace_id === "far_jumper"),
    ).toEqual(farJumper)
  }

  {
    const nonCircularOval = {
      type: "oval",
      layers: ["top", "bottom"],
      center: { x: 0, y: 0 },
      width: 0.8,
      height: 0.4,
      ccwRotationDegrees: 0,
      connectedTo: ["oval_net", "oval_pad"],
    } as unknown as SimpleRouteJson["obstacles"][number]
    const srj = makeBoard({
      allowViaInPad: false,
      obstacles: [nonCircularOval],
      connections: [
        {
          name: "oval_net",
          pointsToConnect: [
            { x: -1, y: 0.12, layer: "top" },
            {
              x: 0,
              y: 0,
              layers: ["top", "bottom"],
              pcb_port_id: "oval_pad",
            },
            { x: 1, y: 0.12, layer: "bottom" },
          ],
        },
      ],
    })
    const ovalCornerVia = makeTrace({
      id: "oval_corner_trace",
      connectionName: "oval_net",
      route: [
        { route_type: "wire", x: -1, y: 0.12, width: 0.1, layer: "top" },
        { route_type: "wire", x: 0.35, y: 0.12, width: 0.1, layer: "top" },
        {
          route_type: "via",
          x: 0.35,
          y: 0.12,
          from_layer: "top",
          to_layer: "bottom",
          via_diameter: 0.4,
          via_hole_diameter: 0.2,
        },
        {
          route_type: "wire",
          x: 0.35,
          y: 0.12,
          width: 0.1,
          layer: "bottom",
        },
        { route_type: "wire", x: 1, y: 0.12, width: 0.1, layer: "bottom" },
      ],
    })
    const circuitJson = convertToCircuitJson(srj, [ovalCornerVia], {
      originalSrj: srj,
      includeOriginalConnections: true,
    })
    expect(
      circuitJson.find((element) => element.type === "pcb_plated_hole"),
    ).toMatchObject({ shape: "oval", ccw_rotation: 0 })
    expect(getCheckedViaInPadIdentities({ circuitJson, srj })).toHaveLength(0)
    const solver = new PostPowerDrcRepairSolver({
      originalSrj: srj,
      srjWithPointPairs: srj,
      traces: [ovalCornerVia],
      maxCandidateEvaluations: 0,
    })
    solver.solve()
    expect(solver.stats.initialViaInPadCount).toBe(0)
  }

  {
    const internalPad = {
      obstacleId: "internal_pad_obstacle",
      type: "rect" as const,
      layers: ["top", "inner1", "inner2", "bottom"],
      center: { x: -0.2, y: 0 },
      width: 0.1,
      height: 0.1,
      connectedTo: ["pad_net", "internal_pad"],
      circuitJsonMetadata: {
        pcb_plated_hole_id: "internal_pad",
        pcb_port_id: "internal_pad",
      },
    }
    const srj = makeBoard({
      allowViaInPad: false,
      minTraceWidth: 0.05,
      minViaPadDiameter: 0.2,
      minViaHoleDiameter: 0.1,
      minTraceToPadEdgeClearance: 0,
      minViaEdgeToPadEdgeClearance: 0,
      obstacles: [internalPad],
      connections: [
        {
          name: "pad_net",
          pointsToConnect: [
            { x: -1, y: -0.5, layer: "top" },
            { x: -1, y: 0.5, layer: "bottom" },
          ],
        },
        {
          name: "foreign_net",
          pointsToConnect: [
            { x: 0, y: -1, layer: "top" },
            { x: 0, y: 1, layer: "top" },
          ],
        },
      ],
    })
    const owner = makeTrace({
      id: "owner",
      connectionName: "pad_net",
      route: [
        { route_type: "wire", x: -1, y: -0.5, width: 0.05, layer: "top" },
        { route_type: "wire", x: 0, y: 0, width: 0.05, layer: "top" },
        {
          route_type: "via",
          x: 0,
          y: 0,
          from_layer: "top",
          to_layer: "bottom",
          via_diameter: 0.2,
          via_hole_diameter: 0.1,
        },
        { route_type: "wire", x: 0, y: 0, width: 0.05, layer: "bottom" },
        { route_type: "wire", x: -1, y: 0.5, width: 0.05, layer: "bottom" },
      ],
    })
    const foreign = makeTrace({
      id: "foreign",
      connectionName: "foreign_net",
      route: [
        { route_type: "wire", x: 0, y: -1, width: 0.05, layer: "top" },
        { route_type: "wire", x: 0, y: 1, width: 0.05, layer: "top" },
      ],
    })
    const solver = new PostPowerDrcRepairSolver({
      originalSrj: srj,
      srjWithPointPairs: srj,
      traces: [owner, foreign],
      maxCandidateEvaluations: 8,
    })
    solver.solve()
    const finalVia = solver
      .getOutput()
      .find((trace) => trace.pcb_trace_id === "owner")
      ?.route.find((point) => point.route_type === "via")
    expect(finalVia).toBeDefined()
    expect(
      finalVia!.x >= -0.25 &&
        finalVia!.x <= -0.15 &&
        finalVia!.y >= -0.05 &&
        finalVia!.y <= 0.05,
    ).toBe(false)
    expect(
      solver.failed ||
        solver.stats.finalDrcErrorCount > 0 ||
        solver.stats.finalViaInPadCount > 0 ||
        solver.stats.acceptedContactSpanRepairCount > 0,
    ).toBe(true)
  }

  {
    const ellipse = {
      type: "oval",
      layers: ["top"],
      center: { x: 0, y: 0 },
      width: 4,
      height: 1,
      connectedTo: ["ellipse_pad_net", "ellipse_pad"],
    } as unknown as SimpleRouteJson["obstacles"][number]
    const srj = makeBoard({
      minTraceToPadEdgeClearance: 0.1,
      connections: [
        {
          name: "ellipse_pad_net",
          pointsToConnect: [
            { x: 0, y: 0, layer: "top", pcb_port_id: "ellipse_pad" },
          ],
        },
        {
          name: "ellipse_wire_net",
          pointsToConnect: [
            { x: 1.8, y: 0.4, layer: "top" },
            { x: 2.5, y: 0.4, layer: "top" },
          ],
        },
      ],
      obstacles: [ellipse],
    })
    const wire = makeTrace({
      id: "ellipse_wire_trace",
      connectionName: "ellipse_wire_net",
      route: [
        { route_type: "wire", x: 1.8, y: 0.4, width: 0.05, layer: "top" },
        { route_type: "wire", x: 2.5, y: 0.4, width: 0.05, layer: "top" },
      ],
    })
    expect(
      getSrjObstacleClearanceErrors({
        traces: [wire],
        srj,
        connectivityMap: new ConnectivityMap({}),
      }),
    ).toHaveLength(0)
    const solver = new PostPowerDrcRepairSolver({
      originalSrj: srj,
      srjWithPointPairs: srj,
      traces: [wire],
      maxCandidateEvaluations: 0,
    })
    solver.solve()
    expect(solver.solved).toBe(true)
    expect(solver.stats.initialDrcErrorCount).toBe(0)
  }
})
