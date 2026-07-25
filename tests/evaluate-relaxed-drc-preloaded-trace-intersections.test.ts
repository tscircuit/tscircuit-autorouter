import { expect, test } from "bun:test"
import { RELAXED_DRC_OPTIONS } from "lib/testing/drcPresets"
import { evaluateRelaxedDrc } from "lib/testing/evaluate-relaxed-drc"
import {
  VIA_OUTER_CLEARANCE_ERROR_PREFIX,
  getDrcErrors,
} from "lib/testing/getDrcErrors"
import type { SimpleRouteJson, SimplifiedPcbTrace } from "lib/types"
import preexistingConnectedTraceScenario from "./features/preexisting-connected-traces/srj/preexisting-connected-traces06.srj.json" with {
  type: "json",
}

test("relaxed DRC checks preloaded-to-routed crossings with root connectivity", () => {
  const preloadedTrace: SimplifiedPcbTrace = {
    type: "pcb_trace",
    pcb_trace_id: "shared_trace_id",
    connection_name: "fixed_net",
    route: [
      { route_type: "wire", x: -1, y: 0, width: 0.1, layer: "top" },
      { route_type: "wire", x: 1, y: 0, width: 0.1, layer: "top" },
    ],
  }
  const routedTrace: SimplifiedPcbTrace = {
    type: "pcb_trace",
    pcb_trace_id: "shared_trace_id",
    connection_name: "new_net_mst0",
    route: [
      { route_type: "wire", x: 0, y: -1, width: 0.1, layer: "top" },
      { route_type: "wire", x: 0, y: 1, width: 0.1, layer: "top" },
    ],
  }
  const inputSrj: SimpleRouteJson = {
    layerCount: 2,
    minTraceWidth: 0.1,
    bounds: { minX: -2, minY: -2, maxX: 2, maxY: 2 },
    obstacles: [],
    connections: [
      {
        name: "fixed_net",
        pointsToConnect: [
          { x: -1, y: 0, layer: "top" },
          { x: 1, y: 0, layer: "top" },
        ],
      },
      {
        name: "new_net",
        pointsToConnect: [
          { x: 0, y: -1, layer: "top" },
          { x: 0, y: 1, layer: "top" },
        ],
      },
    ],
    traces: [preloadedTrace],
  }
  const srjWithPointPairs: SimpleRouteJson = {
    ...inputSrj,
    connections: [
      {
        name: "new_net_mst0",
        __rootConnectionNames: ["new_net"],
        pointsToConnect: [
          { x: 0, y: -1, layer: "top" },
          { x: 0, y: 1, layer: "top" },
        ],
      },
    ],
  }

  const differentNetResult = evaluateRelaxedDrc({
    inputSrj,
    srjWithPointPairs,
    traces: [routedTrace],
  })
  const pcbTraces = differentNetResult.circuitJson.filter(
    (element) => element.type === "pcb_trace",
  )
  const overlapErrorIds = differentNetResult.errors.flatMap((error) =>
    "pcb_trace_error_id" in error &&
    error.pcb_trace_error_id.startsWith("overlap_")
      ? [error.pcb_trace_error_id]
      : [],
  )

  expect(pcbTraces.map((trace) => trace.pcb_trace_id)).toEqual([
    "preloaded_0_shared_trace_id",
    "shared_trace_id",
  ])
  expect(overlapErrorIds).toHaveLength(1)
  expect(overlapErrorIds[0]).toContain("shared_trace_id")
  expect(overlapErrorIds[0]).toContain("preloaded_0_shared_trace_id")
  const crossingError = differentNetResult.errors.find(
    (error) =>
      "pcb_trace_error_id" in error &&
      error.pcb_trace_error_id === overlapErrorIds[0],
  )
  expect(
    (
      crossingError as typeof crossingError & {
        candidate_pcb_trace_ids?: string[]
      }
    )?.candidate_pcb_trace_ids,
  ).toEqual(["shared_trace_id"])

  const sameNetResult = evaluateRelaxedDrc({
    inputSrj: {
      ...inputSrj,
      connections: [
        {
          name: "shared_net",
          pointsToConnect: [
            { x: -1, y: 0, layer: "top" },
            { x: 1, y: 0, layer: "top" },
            { x: 0, y: -1, layer: "top" },
            { x: 0, y: 1, layer: "top" },
          ],
        },
      ],
      traces: [{ ...preloadedTrace, connection_name: "shared_net" }],
    },
    srjWithPointPairs: {
      ...srjWithPointPairs,
      connections: [
        {
          name: "shared_net_mst0",
          __rootConnectionNames: ["shared_net"],
          pointsToConnect: [
            { x: 0, y: -1, layer: "top" },
            { x: 0, y: 1, layer: "top" },
          ],
        },
      ],
    },
    traces: [{ ...routedTrace, connection_name: "shared_net_mst0" }],
  })
  const sameNetPcbTraces = sameNetResult.circuitJson.filter(
    (element) => element.type === "pcb_trace",
  )

  expect(sameNetPcbTraces.map((trace) => trace.source_trace_id)).toEqual([
    "shared_net",
    "shared_net",
  ])
  expect(
    sameNetResult.errors.filter(
      (error) =>
        "pcb_trace_error_id" in error &&
        error.pcb_trace_error_id.startsWith("overlap_"),
    ),
  ).toHaveLength(0)
})

test("relaxed DRC retains coincident vias from different nets", () => {
  const createViaTrace = (
    pcbTraceId: string,
    connectionName: string,
    viaX = 0,
  ): SimplifiedPcbTrace => ({
    type: "pcb_trace",
    pcb_trace_id: pcbTraceId,
    connection_name: connectionName,
    route: [
      { route_type: "wire", x: -1, y: 0, width: 0.1, layer: "top" },
      { route_type: "wire", x: viaX, y: 0, width: 0.1, layer: "top" },
      {
        route_type: "via",
        x: viaX,
        y: 0,
        from_layer: "top",
        to_layer: "bottom",
        via_diameter: 0.3,
        via_hole_diameter: 0.15,
      },
      {
        route_type: "wire",
        x: viaX,
        y: 0,
        width: 0.1,
        layer: "bottom",
      },
      { route_type: "wire", x: 1, y: 0, width: 0.1, layer: "bottom" },
    ],
  })
  const fixedTrace = createViaTrace("fixed_trace", "fixed_net")
  const routedTrace = createViaTrace("routed_trace", "new_net_mst0", 0.05)
  const inputSrj: SimpleRouteJson = {
    layerCount: 2,
    minTraceWidth: 0.1,
    minViaPadDiameter: 0.3,
    minViaHoleDiameter: 0.15,
    bounds: { minX: -2, minY: -2, maxX: 2, maxY: 2 },
    obstacles: [],
    connections: [
      {
        name: "fixed_net",
        pointsToConnect: [
          { x: -1, y: 0, layer: "top" },
          { x: 1, y: 0, layer: "bottom" },
        ],
      },
      {
        name: "new_net",
        pointsToConnect: [
          { x: -1, y: 0, layer: "top" },
          { x: 1, y: 0, layer: "bottom" },
        ],
      },
    ],
    traces: [fixedTrace],
  }
  const srjWithPointPairs: SimpleRouteJson = {
    ...inputSrj,
    connections: [
      {
        name: "new_net_mst0",
        __rootConnectionNames: ["new_net"],
        pointsToConnect: [
          { x: -1, y: 0, layer: "top" },
          { x: 1, y: 0, layer: "bottom" },
        ],
      },
    ],
  }

  const differentNetResult = evaluateRelaxedDrc({
    inputSrj,
    srjWithPointPairs,
    traces: [routedTrace],
  })
  expect(
    differentNetResult.circuitJson.filter(
      (element) => element.type === "pcb_via",
    ),
  ).toHaveLength(2)
  const viaClearanceError = differentNetResult.errors.find(
    (error) => error.type === "pcb_via_clearance_error",
  )
  expect(viaClearanceError).toBeDefined()
  expect(
    (
      viaClearanceError as typeof viaClearanceError & {
        candidate_pcb_trace_ids?: string[]
      }
    )?.candidate_pcb_trace_ids,
  ).toEqual(["routed_trace"])
  const fixedTraceToCandidateViaError = differentNetResult.errors.find(
    (error) =>
      "pcb_trace_error_id" in error &&
      error.pcb_trace_error_id.startsWith(
        "overlap_preloaded_0_fixed_trace_via_",
      ),
  )
  expect(
    (
      fixedTraceToCandidateViaError as typeof fixedTraceToCandidateViaError & {
        candidate_pcb_trace_ids?: string[]
      }
    )?.candidate_pcb_trace_ids,
  ).toEqual(["routed_trace"])

  const sameNetResult = evaluateRelaxedDrc({
    inputSrj: {
      ...inputSrj,
      connections: [
        {
          name: "shared_net",
          pointsToConnect: [
            { x: -1, y: 0, layer: "top" },
            { x: 1, y: 0, layer: "bottom" },
          ],
        },
      ],
      traces: [
        {
          ...fixedTrace,
          connection_name: "shared_net",
          route: fixedTrace.route.map((point) =>
            point.route_type === "via"
              ? {
                  ...point,
                  from_layer: "bottom",
                  to_layer: "top",
                  via_diameter: 0.4,
                }
              : point,
          ),
        },
      ],
    },
    srjWithPointPairs: {
      ...srjWithPointPairs,
      connections: [
        {
          name: "shared_net_mst0",
          __rootConnectionNames: ["shared_net"],
          pointsToConnect: [
            { x: -1, y: 0, layer: "top" },
            { x: 1, y: 0, layer: "bottom" },
          ],
        },
      ],
    },
    traces: [createViaTrace("routed_trace", "shared_net_mst0")],
  })
  const sameNetVias = sameNetResult.circuitJson.filter(
    (element) => element.type === "pcb_via",
  )
  expect(sameNetVias).toHaveLength(1)
  expect(sameNetVias[0]?.outer_diameter).toBe(0.4)
  expect(sameNetVias[0]?.pcb_trace_id).toBe("preloaded_0_fixed_trace")
  expect(
    sameNetResult.errors.filter(
      (error) => error.type === "pcb_via_clearance_error",
    ),
  ).toHaveLength(0)
})

test("relaxed DRC attributes enlarged merged via copper to the candidate", () => {
  const createSharedViaTrace = (
    pcbTraceId: string,
    connectionName: string,
    viaDiameter: number,
  ): SimplifiedPcbTrace => ({
    type: "pcb_trace",
    pcb_trace_id: pcbTraceId,
    connection_name: connectionName,
    route: [
      { route_type: "wire", x: -1, y: 0, width: 0.1, layer: "top" },
      { route_type: "wire", x: 0, y: 0, width: 0.1, layer: "top" },
      {
        route_type: "via",
        x: 0,
        y: 0,
        from_layer: "top",
        to_layer: "bottom",
        via_diameter: viaDiameter,
        via_hole_diameter: viaDiameter / 2,
      },
      {
        route_type: "wire",
        x: 0,
        y: 0,
        width: 0.1,
        layer: "bottom",
      },
      { route_type: "wire", x: -1, y: 0, width: 0.1, layer: "bottom" },
    ],
  })
  const fixedSharedTrace = createSharedViaTrace("fixed_shared", "shared", 0.3)
  const fixedForeignTrace: SimplifiedPcbTrace = {
    type: "pcb_trace",
    pcb_trace_id: "fixed_foreign",
    connection_name: "foreign",
    route: [
      {
        route_type: "wire",
        x: 0.34,
        y: -0.7,
        width: 0.1,
        layer: "top",
      },
      {
        route_type: "wire",
        x: 0.34,
        y: 0.7,
        width: 0.1,
        layer: "top",
      },
    ],
  }
  const inputSrj: SimpleRouteJson = {
    layerCount: 2,
    minTraceWidth: 0.1,
    bounds: { minX: -2, minY: -2, maxX: 2, maxY: 2 },
    obstacles: [],
    connections: [
      {
        name: "shared",
        pointsToConnect: [
          { x: -1, y: 0, layer: "top" },
          { x: -1, y: 0, layer: "bottom" },
        ],
      },
      {
        name: "foreign",
        pointsToConnect: [
          { x: 0.34, y: -0.7, layer: "top" },
          { x: 0.34, y: 0.7, layer: "top" },
        ],
      },
    ],
    traces: [fixedSharedTrace, fixedForeignTrace],
  }
  const srjWithPointPairs: SimpleRouteJson = {
    ...inputSrj,
    connections: [
      {
        name: "shared_mst0",
        __rootConnectionNames: ["shared"],
        pointsToConnect: [
          { x: -1, y: 0, layer: "top" },
          { x: -1, y: 0, layer: "bottom" },
        ],
      },
    ],
  }
  const evaluateCandidateVia = (viaDiameter: number) =>
    evaluateRelaxedDrc({
      inputSrj,
      srjWithPointPairs,
      traces: [
        createSharedViaTrace("candidate_shared", "shared_mst0", viaDiameter),
      ],
    })
  const getFixedTraceToMergedViaError = (
    result: ReturnType<typeof evaluateCandidateVia>,
  ) =>
    result.errors.find(
      (error) =>
        "pcb_trace_error_id" in error &&
        error.pcb_trace_error_id.startsWith(
          "overlap_preloaded_1_fixed_foreign_via_",
        ),
    )

  expect(getFixedTraceToMergedViaError(evaluateCandidateVia(0.3))).toBe(
    undefined,
  )

  const enlargedResult = evaluateCandidateVia(0.6)
  const mergedVia = enlargedResult.circuitJson.find(
    (element) => element.type === "pcb_via",
  ) as
    | (Extract<
        (typeof enlargedResult.circuitJson)[number],
        { type: "pcb_via" }
      > & {
        contributing_pcb_trace_ids?: string[]
      })
    | undefined
  expect(mergedVia?.outer_diameter).toBe(0.6)
  expect(mergedVia?.pcb_trace_id).toBe("preloaded_0_fixed_shared")
  expect(mergedVia?.contributing_pcb_trace_ids).toEqual([
    "preloaded_0_fixed_shared",
    "candidate_shared",
  ])

  const enlargedViaError = getFixedTraceToMergedViaError(enlargedResult)
  expect(enlargedViaError).toBeDefined()
  expect(
    (
      enlargedViaError as typeof enlargedViaError & {
        candidate_pcb_trace_ids?: string[]
      }
    )?.candidate_pcb_trace_ids,
  ).toEqual(["candidate_shared"])
})

test("relaxed DRC keeps colliding original and point-pair names on their own nets", () => {
  const preloadedTrace: SimplifiedPcbTrace = {
    type: "pcb_trace",
    pcb_trace_id: "fixed_trace",
    connection_name: "route_mst0",
    route: [
      { route_type: "wire", x: -1, y: 0, width: 0.1, layer: "top" },
      { route_type: "wire", x: 1, y: 0, width: 0.1, layer: "top" },
    ],
  }
  const candidateTrace: SimplifiedPcbTrace = {
    type: "pcb_trace",
    pcb_trace_id: "candidate_trace",
    connection_name: "route_mst0",
    route: [
      { route_type: "wire", x: 0, y: -1, width: 0.1, layer: "top" },
      { route_type: "wire", x: 0, y: 1, width: 0.1, layer: "top" },
    ],
  }
  const inputSrj: SimpleRouteJson = {
    layerCount: 2,
    minTraceWidth: 0.1,
    bounds: { minX: -2, minY: -2, maxX: 2, maxY: 2 },
    obstacles: [
      {
        type: "rect",
        layers: ["top"],
        center: { x: -1, y: 0 },
        width: 0.3,
        height: 0.3,
        connectedTo: [
          "pcb_smtpad_fixed_start",
          "pcb_port_fixed_start",
          "route_mst0",
        ],
      },
      {
        type: "rect",
        layers: ["top"],
        center: { x: 1, y: 0 },
        width: 0.3,
        height: 0.3,
        connectedTo: [
          "pcb_smtpad_fixed_end",
          "pcb_port_fixed_end",
          "route_mst0",
        ],
      },
      {
        type: "rect",
        layers: ["top"],
        center: { x: 0, y: -1 },
        width: 0.3,
        height: 0.3,
        connectedTo: [
          "pcb_smtpad_candidate_start",
          "pcb_port_candidate_start",
          "route",
        ],
      },
      {
        type: "rect",
        layers: ["top"],
        center: { x: 0, y: 1 },
        width: 0.3,
        height: 0.3,
        connectedTo: [
          "pcb_smtpad_candidate_end",
          "pcb_port_candidate_end",
          "route",
        ],
      },
    ],
    connections: [
      {
        name: "route_mst0",
        pointsToConnect: [
          {
            x: -1,
            y: 0,
            layer: "top",
            pcb_port_id: "pcb_port_fixed_start",
          },
          {
            x: 1,
            y: 0,
            layer: "top",
            pcb_port_id: "pcb_port_fixed_end",
          },
        ],
      },
      {
        name: "route",
        pointsToConnect: [
          {
            x: 0,
            y: -1,
            layer: "top",
            pcb_port_id: "pcb_port_candidate_start",
          },
          {
            x: 0,
            y: 1,
            layer: "top",
            pcb_port_id: "pcb_port_candidate_end",
          },
        ],
      },
    ],
    traces: [preloadedTrace],
  }
  const srjWithPointPairs: SimpleRouteJson = {
    ...inputSrj,
    connections: [
      {
        name: "route_mst0",
        __rootConnectionNames: ["route"],
        pointsToConnect: [
          {
            x: 0,
            y: -1,
            layer: "top",
            pcb_port_id: "pcb_port_candidate_start",
          },
          {
            x: 0,
            y: 1,
            layer: "top",
            pcb_port_id: "pcb_port_candidate_end",
          },
        ],
      },
    ],
  }

  const result = evaluateRelaxedDrc({
    inputSrj,
    srjWithPointPairs,
    traces: [candidateTrace],
  })
  expect(
    result.circuitJson
      .filter((element) => element.type === "pcb_trace")
      .map((trace) => trace.source_trace_id),
  ).toEqual(["route_mst0", "route"])
  const sourceTraceById = new Map(
    result.circuitJson
      .filter((element) => element.type === "source_trace")
      .map((sourceTrace) => [sourceTrace.source_trace_id, sourceTrace]),
  )
  expect(
    sourceTraceById
      .get("route_mst0")
      ?.connected_source_net_ids?.includes("pcb_smtpad_fixed_start"),
  ).toBe(true)
  expect(
    sourceTraceById
      .get("route_mst0")
      ?.connected_source_net_ids?.includes("pcb_smtpad_candidate_start"),
  ).toBe(false)
  expect(
    sourceTraceById
      .get("route")
      ?.connected_source_net_ids?.includes("pcb_smtpad_candidate_start"),
  ).toBe(true)
  expect(
    sourceTraceById
      .get("route")
      ?.connected_source_net_ids?.includes("pcb_smtpad_fixed_start"),
  ).toBe(false)

  const crossingError = result.errors.find(
    (error) =>
      "pcb_trace_error_id" in error &&
      error.pcb_trace_error_id ===
        "overlap_preloaded_0_fixed_trace_candidate_trace",
  )
  expect(crossingError).toBeDefined()
  expect(
    (
      crossingError as typeof crossingError & {
        candidate_pcb_trace_ids?: string[]
      }
    )?.candidate_pcb_trace_ids,
  ).toEqual(["candidate_trace"])
})

test("relaxed DRC does not claim an unknown preloaded name as a point-pair alias", () => {
  const preloadedTrace: SimplifiedPcbTrace = {
    type: "pcb_trace",
    pcb_trace_id: "fixed_trace",
    connection_name: "route_mst0",
    route: [
      { route_type: "wire", x: -1, y: 0, width: 0.1, layer: "top" },
      { route_type: "wire", x: 1, y: 0, width: 0.1, layer: "top" },
    ],
  }
  const candidateTrace: SimplifiedPcbTrace = {
    type: "pcb_trace",
    pcb_trace_id: "candidate_trace",
    connection_name: "route_mst0",
    route: [
      { route_type: "wire", x: 0, y: -1, width: 0.1, layer: "top" },
      { route_type: "wire", x: 0, y: 1, width: 0.1, layer: "top" },
    ],
  }
  const inputSrj: SimpleRouteJson = {
    layerCount: 2,
    minTraceWidth: 0.1,
    bounds: { minX: -2, minY: -2, maxX: 2, maxY: 2 },
    obstacles: [],
    connections: [
      {
        name: "route",
        pointsToConnect: [
          { x: 0, y: -1, layer: "top" },
          { x: 0, y: 1, layer: "top" },
        ],
      },
    ],
    traces: [preloadedTrace],
  }
  const srjWithPointPairs: SimpleRouteJson = {
    ...inputSrj,
    connections: [
      {
        name: "route_mst0",
        __rootConnectionNames: ["route"],
        pointsToConnect: [
          { x: 0, y: -1, layer: "top" },
          { x: 0, y: 1, layer: "top" },
        ],
      },
    ],
  }

  const result = evaluateRelaxedDrc({
    inputSrj,
    srjWithPointPairs,
    traces: [candidateTrace],
  })
  expect(
    result.circuitJson
      .filter((element) => element.type === "pcb_trace")
      .map((trace) => trace.source_trace_id),
  ).toEqual(["route_mst0", "route"])
  expect(
    result.errors.some(
      (error) =>
        "pcb_trace_error_id" in error &&
        error.pcb_trace_error_id ===
          "overlap_preloaded_0_fixed_trace_candidate_trace",
    ),
  ).toBe(true)
})

test("relaxed DRC makes combined physical continuity authoritative", () => {
  const fixedTrace: SimplifiedPcbTrace = {
    type: "pcb_trace",
    pcb_trace_id: "fixed",
    connection_name: "shared",
    route: [
      { route_type: "wire", x: -1, y: 0, width: 0.1, layer: "top" },
      { route_type: "wire", x: 0, y: 0, width: 0.1, layer: "top" },
    ],
  }
  const candidateTrace: SimplifiedPcbTrace = {
    type: "pcb_trace",
    pcb_trace_id: "candidate",
    connection_name: "shared_mst0",
    route: [
      { route_type: "wire", x: -1, y: 0, width: 0.1, layer: "top" },
      { route_type: "wire", x: 0.5, y: 0, width: 0.1, layer: "top" },
    ],
  }
  const inputSrj: SimpleRouteJson = {
    layerCount: 2,
    minTraceWidth: 0.1,
    bounds: { minX: -2, minY: -1, maxX: 2, maxY: 1 },
    obstacles: [
      {
        type: "rect",
        layers: ["top"],
        center: { x: -1, y: 0 },
        width: 0.2,
        height: 0.2,
        connectedTo: ["shared", "pcb_port_a", "pcb_smtpad_a"],
      },
      {
        type: "rect",
        layers: ["top"],
        center: { x: 1, y: 0 },
        width: 0.2,
        height: 0.2,
        connectedTo: ["shared", "pcb_port_b", "pcb_smtpad_b"],
      },
    ],
    connections: [
      {
        name: "shared",
        pointsToConnect: [
          { x: -1, y: 0, layer: "top", pcb_port_id: "pcb_port_a" },
          { x: 1, y: 0, layer: "top", pcb_port_id: "pcb_port_b" },
        ],
      },
    ],
    traces: [fixedTrace],
  }
  const srjWithPointPairs: SimpleRouteJson = {
    ...inputSrj,
    connections: [
      {
        name: "shared_mst0",
        __rootConnectionNames: ["shared"],
        pointsToConnect: inputSrj.connections[0]!.pointsToConnect,
      },
    ],
  }
  const getMissingConnectionErrors = (
    errors: ReturnType<typeof getDrcErrors>["errors"],
  ) =>
    errors.filter(
      (error) =>
        "pcb_trace_error_id" in error &&
        error.pcb_trace_error_id.startsWith("missing_connection_"),
    )

  const fixedOnlyResult = evaluateRelaxedDrc({
    inputSrj,
    srjWithPointPairs,
    traces: [],
  })
  expect(
    getMissingConnectionErrors(
      getDrcErrors(fixedOnlyResult.circuitJson, RELAXED_DRC_OPTIONS).errors,
    ),
  ).toHaveLength(1)
  const [fixedOnlyContinuityError] = getMissingConnectionErrors(
    fixedOnlyResult.errors,
  )
  expect(
    fixedOnlyContinuityError && "pcb_trace_error_id" in fixedOnlyContinuityError
      ? fixedOnlyContinuityError.pcb_trace_error_id
      : undefined,
  ).toBe("missing_connection_combined_shared")
  expect(
    (
      fixedOnlyContinuityError as typeof fixedOnlyContinuityError & {
        candidate_pcb_trace_ids?: string[]
      }
    )?.candidate_pcb_trace_ids,
  ).toEqual([])

  const candidateResult = evaluateRelaxedDrc({
    inputSrj,
    srjWithPointPairs,
    traces: [candidateTrace],
  })
  const [continuityError] = getMissingConnectionErrors(candidateResult.errors)
  expect(
    continuityError && "pcb_trace_id" in continuityError
      ? continuityError.pcb_trace_id
      : undefined,
  ).toBe("candidate")
  expect(
    (
      continuityError as typeof continuityError & {
        candidate_pcb_trace_ids?: string[]
      }
    )?.candidate_pcb_trace_ids,
  ).toEqual(["candidate"])
})

test("relaxed DRC does not transfer fixed-only via errors to a contained candidate via", () => {
  const makeViaTrace = (
    pcbTraceId: string,
    connectionName: string,
    x: number,
    viaDiameter: number,
  ): SimplifiedPcbTrace => ({
    type: "pcb_trace",
    pcb_trace_id: pcbTraceId,
    connection_name: connectionName,
    route: [
      { route_type: "wire", x, y: -1, width: 0.1, layer: "top" },
      { route_type: "wire", x, y: 0, width: 0.1, layer: "top" },
      {
        route_type: "via",
        x,
        y: 0,
        from_layer: "top",
        to_layer: "bottom",
        via_diameter: viaDiameter,
        via_hole_diameter: viaDiameter / 2,
      },
      { route_type: "wire", x, y: 0, width: 0.1, layer: "bottom" },
      { route_type: "wire", x, y: 1, width: 0.1, layer: "bottom" },
    ],
  })
  const fixedShared = makeViaTrace("fixed_shared", "shared", 0, 0.4)
  const fixedForeign = makeViaTrace("fixed_foreign", "foreign", 0.25, 0.3)
  const candidate = makeViaTrace("candidate", "shared_mst0", 0, 0.1)
  const makeTerminalObstacle = (
    net: string,
    portId: string,
    x: number,
    y: number,
    layer: "top" | "bottom",
  ) => ({
    type: "rect" as const,
    layers: [layer],
    center: { x, y },
    width: 0.2,
    height: 0.2,
    connectedTo: [net, portId, `pcb_smtpad_${portId}`],
  })
  const inputSrj: SimpleRouteJson = {
    layerCount: 2,
    minTraceWidth: 0.1,
    minViaPadDiameter: 0.3,
    minViaHoleDiameter: 0.15,
    bounds: { minX: -1, minY: -2, maxX: 1.4, maxY: 2 },
    obstacles: [
      makeTerminalObstacle("shared", "pcb_port_shared_top", 0, -1, "top"),
      makeTerminalObstacle("shared", "pcb_port_shared_bottom", 0, 1, "bottom"),
      makeTerminalObstacle("foreign", "pcb_port_foreign_top", 0.25, -1, "top"),
      makeTerminalObstacle(
        "foreign",
        "pcb_port_foreign_bottom",
        0.25,
        1,
        "bottom",
      ),
    ],
    connections: [
      {
        name: "shared",
        pointsToConnect: [
          {
            x: 0,
            y: -1,
            layer: "top",
            pcb_port_id: "pcb_port_shared_top",
          },
          {
            x: 0,
            y: 1,
            layer: "bottom",
            pcb_port_id: "pcb_port_shared_bottom",
          },
        ],
      },
      {
        name: "foreign",
        pointsToConnect: [
          {
            x: 0.25,
            y: -1,
            layer: "top",
            pcb_port_id: "pcb_port_foreign_top",
          },
          {
            x: 0.25,
            y: 1,
            layer: "bottom",
            pcb_port_id: "pcb_port_foreign_bottom",
          },
        ],
      },
    ],
    traces: [fixedShared, fixedForeign],
  }
  const srjWithPointPairs: SimpleRouteJson = {
    ...inputSrj,
    connections: [
      {
        name: "shared_mst0",
        __rootConnectionNames: ["shared"],
        pointsToConnect: inputSrj.connections[0]!.pointsToConnect,
      },
    ],
  }
  const result = evaluateRelaxedDrc({
    inputSrj,
    srjWithPointPairs,
    traces: [candidate],
  })
  const rawViaErrors = getDrcErrors(
    result.circuitJson,
    RELAXED_DRC_OPTIONS,
  ).errors.filter((error) => error.type === "pcb_via_clearance_error")

  expect(rawViaErrors).toHaveLength(2)
  expect(
    result.errors.filter((error) => error.type === "pcb_via_clearance_error"),
  ).toHaveLength(0)
})

test("relaxed DRC attributes candidate-to-candidate crossings to both traces", () => {
  const inputSrj: SimpleRouteJson = {
    layerCount: 2,
    minTraceWidth: 0.1,
    bounds: { minX: -2, minY: -2, maxX: 2, maxY: 2 },
    obstacles: [],
    connections: [
      {
        name: "horizontal",
        pointsToConnect: [
          { x: -1, y: 0, layer: "top" },
          { x: 1, y: 0, layer: "top" },
        ],
      },
      {
        name: "vertical",
        pointsToConnect: [
          { x: 0, y: -1, layer: "top" },
          { x: 0, y: 1, layer: "top" },
        ],
      },
    ],
  }
  const traces: SimplifiedPcbTrace[] = [
    {
      type: "pcb_trace",
      pcb_trace_id: "candidate_horizontal",
      connection_name: "horizontal",
      route: [
        { route_type: "wire", x: -1, y: 0, width: 0.1, layer: "top" },
        { route_type: "wire", x: 1, y: 0, width: 0.1, layer: "top" },
      ],
    },
    {
      type: "pcb_trace",
      pcb_trace_id: "candidate_vertical",
      connection_name: "vertical",
      route: [
        { route_type: "wire", x: 0, y: -1, width: 0.1, layer: "top" },
        { route_type: "wire", x: 0, y: 1, width: 0.1, layer: "top" },
      ],
    },
  ]
  const result = evaluateRelaxedDrc({
    inputSrj,
    srjWithPointPairs: inputSrj,
    traces,
  })
  const crossingError = result.errors.find(
    (error) =>
      "pcb_trace_error_id" in error &&
      error.pcb_trace_error_id.startsWith("overlap_"),
  ) as
    | (ReturnType<typeof evaluateRelaxedDrc>["errors"][number] & {
        candidate_pcb_trace_ids?: string[]
      })
    | undefined

  expect(crossingError?.candidate_pcb_trace_ids?.toSorted()).toEqual([
    "candidate_horizontal",
    "candidate_vertical",
  ])
})

test("relaxed DRC canonicalizes explicit preloaded trace connectivity without claiming raw aliases", () => {
  for (const retainConnectsTo of [true, false]) {
    const inputSrj = structuredClone(
      preexistingConnectedTraceScenario,
    ) as SimpleRouteJson
    const fixedTrace = inputSrj.traces?.[0]
    if (!retainConnectsTo && fixedTrace) {
      inputSrj.traces = [
        { ...fixedTrace, connectsTo: undefined },
        ...(inputSrj.traces?.slice(1) ?? []),
      ]
    }
    const mainConnection = inputSrj.connections[0]!
    const srjWithPointPairs: SimpleRouteJson = {
      ...inputSrj,
      connections: [
        {
          name: `${mainConnection.name}_mst0`,
          __rootConnectionNames: [mainConnection.name],
          pointsToConnect: mainConnection.pointsToConnect.slice(1),
        },
      ],
    }
    const candidateTrace: SimplifiedPcbTrace = {
      type: "pcb_trace",
      pcb_trace_id: "candidate",
      connection_name: `${mainConnection.name}_mst0`,
      route: [
        { route_type: "wire", x: -2.75, y: 0.635, width: 0.1, layer: "top" },
        { route_type: "wire", x: 2.175, y: 1.4, width: 0.1, layer: "top" },
      ],
    }

    const result = evaluateRelaxedDrc({
      inputSrj,
      srjWithPointPairs,
      traces: [candidateTrace],
    })
    expect(
      result.circuitJson
        .filter((element) => element.type === "pcb_trace")
        .map((trace) => trace.source_trace_id),
    ).toEqual([mainConnection.name, mainConnection.name])
    expect(
      result.errors.filter(
        (error) =>
          "pcb_trace_error_id" in error &&
          error.pcb_trace_error_id.startsWith("overlap_"),
      ),
    ).toHaveLength(0)
  }
})

test("relaxed DRC rejects disjoint same-net fragments that separately reach the terminals", () => {
  const makeScenario = (): SimpleRouteJson => ({
    layerCount: 2,
    minTraceWidth: 0.1,
    bounds: { minX: -2, minY: -1, maxX: 2, maxY: 1 },
    obstacles: [
      {
        type: "rect",
        layers: ["top"],
        center: { x: -1, y: 0 },
        width: 0.2,
        height: 0.2,
        connectedTo: ["shared", "pcb_port_a", "pcb_smtpad_a"],
      },
      {
        type: "rect",
        layers: ["top"],
        center: { x: 1, y: 0 },
        width: 0.2,
        height: 0.2,
        connectedTo: ["shared", "pcb_port_b", "pcb_smtpad_b"],
      },
    ],
    connections: [
      {
        name: "shared",
        pointsToConnect: [
          { x: -1, y: 0, layer: "top", pcb_port_id: "pcb_port_a" },
          { x: 1, y: 0, layer: "top", pcb_port_id: "pcb_port_b" },
        ],
      },
    ],
    traces: [
      {
        type: "pcb_trace",
        pcb_trace_id: "fixed",
        connection_name: "shared",
        route: [
          { route_type: "wire", x: -1, y: 0, width: 0.1, layer: "top" },
          { route_type: "wire", x: 0, y: 0, width: 0.1, layer: "top" },
        ],
      },
    ],
  })
  const inputSrj = makeScenario()
  const srjWithPointPairs: SimpleRouteJson = {
    ...inputSrj,
    connections: [
      {
        name: "shared_mst0",
        __rootConnectionNames: ["shared"],
        pointsToConnect: inputSrj.connections[0]!.pointsToConnect,
      },
    ],
  }
  const evaluateCandidate = (startX: number, layer: "top" | "bottom" = "top") =>
    evaluateRelaxedDrc({
      inputSrj,
      srjWithPointPairs,
      traces: [
        {
          type: "pcb_trace",
          pcb_trace_id: "candidate",
          connection_name: "shared_mst0",
          route: [
            {
              route_type: "wire",
              x: startX,
              y: 0,
              width: 0.1,
              layer,
            },
            {
              route_type: "wire",
              x: 1,
              y: 0,
              width: 0.1,
              layer,
            },
          ],
        },
      ],
    })
  const getCombinedContinuityErrors = (
    result: ReturnType<typeof evaluateCandidate>,
  ) =>
    result.errors.filter(
      (error) =>
        "pcb_trace_error_id" in error &&
        error.pcb_trace_error_id.startsWith("missing_connection_combined_"),
    )

  const disjointResult = evaluateCandidate(0.5)
  expect(getCombinedContinuityErrors(disjointResult)).toHaveLength(1)
  expect(
    (
      getCombinedContinuityErrors(disjointResult)[0] as
        | (ReturnType<typeof evaluateCandidate>["errors"][number] & {
            candidate_pcb_trace_ids?: string[]
          })
        | undefined
    )?.candidate_pcb_trace_ids,
  ).toEqual(["candidate"])

  expect(getCombinedContinuityErrors(evaluateCandidate(0))).toHaveLength(0)
  expect(
    getCombinedContinuityErrors(evaluateCandidate(0, "bottom")),
  ).toHaveLength(1)

  const brokenSingleTraceResult = evaluateRelaxedDrc({
    inputSrj: { ...inputSrj, traces: [] },
    srjWithPointPairs,
    traces: [
      {
        type: "pcb_trace",
        pcb_trace_id: "candidate",
        connection_name: "shared_mst0",
        route: [
          { route_type: "wire", x: -1, y: 0, width: 0.1, layer: "top" },
          { route_type: "wire", x: 0, y: 0, width: 0.1, layer: "top" },
          { route_type: "wire", x: 0.5, y: 0, width: 0.1, layer: "bottom" },
          { route_type: "wire", x: 0.5, y: 0, width: 0.1, layer: "top" },
          { route_type: "wire", x: 1, y: 0, width: 0.1, layer: "top" },
        ],
      },
    ],
  })
  expect(getCombinedContinuityErrors(brokenSingleTraceResult)).toHaveLength(1)
})

test("relaxed DRC reserves candidate trace ids when allocating via ids", () => {
  const fixedTrace: SimplifiedPcbTrace = {
    type: "pcb_trace",
    pcb_trace_id: "fixed",
    connection_name: "fixed_net",
    route: [
      { route_type: "wire", x: 0, y: 0, width: 0.1, layer: "top" },
      {
        route_type: "via",
        x: 0,
        y: 0,
        from_layer: "top",
        to_layer: "bottom",
        via_diameter: 0.3,
        via_hole_diameter: 0.15,
      },
      { route_type: "wire", x: 0, y: 0, width: 0.1, layer: "bottom" },
      { route_type: "wire", x: 1, y: 0, width: 0.1, layer: "bottom" },
    ],
  }
  const candidateTrace: SimplifiedPcbTrace = {
    type: "pcb_trace",
    pcb_trace_id: "via_0",
    connection_name: "candidate_net",
    route: [
      { route_type: "wire", x: -1, y: 0, width: 0.1, layer: "top" },
      { route_type: "wire", x: 1, y: 0, width: 0.1, layer: "top" },
    ],
  }
  const inputSrj: SimpleRouteJson = {
    layerCount: 2,
    minTraceWidth: 0.1,
    bounds: { minX: -2, minY: -1, maxX: 2, maxY: 1 },
    obstacles: [],
    connections: [
      {
        name: "fixed_net",
        pointsToConnect: [
          { x: 0, y: 0, layer: "top" },
          { x: 1, y: 0, layer: "bottom" },
        ],
      },
      {
        name: "candidate_net",
        pointsToConnect: [
          { x: -1, y: 0, layer: "top" },
          { x: 1, y: 0, layer: "top" },
        ],
      },
    ],
    traces: [fixedTrace],
  }

  const result = evaluateRelaxedDrc({
    inputSrj,
    srjWithPointPairs: inputSrj,
    traces: [candidateTrace],
  })
  const via = result.circuitJson.find((element) => element.type === "pcb_via")
  expect(via?.pcb_via_id).not.toBe("via_0")
  expect(
    result.errors.some(
      (error) =>
        "pcb_trace_error_id" in error &&
        error.pcb_trace_error_id ===
          `overlap_via_0_${via?.pcb_via_id ?? "missing_via"}`,
    ),
  ).toBe(true)
})

test("relaxed DRC preserves preloaded through-obstacle copper and checks clearance", () => {
  const fixedTrace: SimplifiedPcbTrace = {
    type: "pcb_trace",
    pcb_trace_id: "fixed_through",
    connection_name: "fixed_net",
    route: [
      {
        route_type: "through_obstacle",
        start: { x: -1, y: 0 },
        end: { x: 1, y: 0 },
        from_layer: "top",
        to_layer: "bottom",
        width: 0.1,
      },
    ],
  }
  const candidateTrace: SimplifiedPcbTrace = {
    type: "pcb_trace",
    pcb_trace_id: "candidate",
    connection_name: "candidate_net_mst0",
    route: [
      { route_type: "wire", x: 0, y: 0.15, width: 0.1, layer: "top" },
      { route_type: "wire", x: 0, y: 1, width: 0.1, layer: "top" },
    ],
  }
  const inputSrj: SimpleRouteJson = {
    layerCount: 2,
    minTraceWidth: 0.1,
    bounds: { minX: -2, minY: -2, maxX: 2, maxY: 2 },
    obstacles: [],
    connections: [
      {
        name: "fixed_net",
        pointsToConnect: [
          { x: -1, y: 0, layer: "top" },
          { x: 1, y: 0, layer: "bottom" },
        ],
      },
      {
        name: "candidate_net",
        pointsToConnect: [
          { x: 0, y: 0.15, layer: "top" },
          { x: 0, y: 1, layer: "top" },
        ],
      },
    ],
    traces: [fixedTrace],
  }
  const result = evaluateRelaxedDrc({
    inputSrj,
    srjWithPointPairs: {
      ...inputSrj,
      connections: [
        {
          name: "candidate_net_mst0",
          __rootConnectionNames: ["candidate_net"],
          pointsToConnect: inputSrj.connections[1]!.pointsToConnect,
        },
      ],
    },
    traces: [candidateTrace],
  })
  const convertedFixedTrace = result.circuitJson.find(
    (element) =>
      element.type === "pcb_trace" &&
      element.pcb_trace_id === "preloaded_0_fixed_through",
  )
  expect(
    convertedFixedTrace?.type === "pcb_trace"
      ? convertedFixedTrace.route
      : undefined,
  ).toEqual([
    {
      route_type: "through_pad",
      start: { x: -1, y: 0 },
      end: { x: 1, y: 0 },
      width: 0.1,
      start_layer: "top",
      end_layer: "bottom",
    },
  ])

  const overlapError = result.errors.find(
    (error) =>
      "pcb_trace_error_id" in error &&
      error.pcb_trace_error_id ===
        "overlap_preloaded_0_fixed_through_candidate",
  )
  expect(overlapError).toBeDefined()
  expect(
    (
      overlapError as
        | (typeof overlapError & { candidate_pcb_trace_ids?: string[] })
        | undefined
    )?.candidate_pcb_trace_ids,
  ).toEqual(["candidate"])
})

test("relaxed DRC rejects different-net via outer-copper overlap", () => {
  const makeViaTrace = (
    pcbTraceId: string,
    connectionName: string,
    viaX: number,
    terminalDirection: -1 | 1,
  ): SimplifiedPcbTrace => ({
    type: "pcb_trace",
    pcb_trace_id: pcbTraceId,
    connection_name: connectionName,
    route: [
      {
        route_type: "wire",
        x: viaX + terminalDirection,
        y: 0,
        width: 0.1,
        layer: "top",
      },
      { route_type: "wire", x: viaX, y: 0, width: 0.1, layer: "top" },
      {
        route_type: "via",
        x: viaX,
        y: 0,
        from_layer: "top",
        to_layer: "bottom",
        via_diameter: 0.4,
        via_hole_diameter: 0.1,
      },
      { route_type: "wire", x: viaX, y: 0, width: 0.1, layer: "bottom" },
      {
        route_type: "wire",
        x: viaX + terminalDirection,
        y: 0,
        width: 0.1,
        layer: "bottom",
      },
    ],
  })
  const fixedTrace = makeViaTrace("fixed", "fixed_net", 0, -1)
  const candidateTrace = makeViaTrace(
    "candidate",
    "candidate_net_mst0",
    0.37,
    1,
  )
  const inputSrj: SimpleRouteJson = {
    layerCount: 2,
    minTraceWidth: 0.1,
    minViaDiameter: 0.4,
    bounds: { minX: -2, minY: -1, maxX: 2, maxY: 1 },
    obstacles: [],
    connections: [
      {
        name: "fixed_net",
        pointsToConnect: [
          { x: -1, y: 0, layer: "top" },
          { x: -1, y: 0, layer: "bottom" },
        ],
      },
      {
        name: "candidate_net",
        pointsToConnect: [
          { x: 1.37, y: 0, layer: "top" },
          { x: 1.37, y: 0, layer: "bottom" },
        ],
      },
    ],
    traces: [fixedTrace],
  }
  const result = evaluateRelaxedDrc({
    inputSrj,
    srjWithPointPairs: {
      ...inputSrj,
      connections: [
        {
          name: "candidate_net_mst0",
          __rootConnectionNames: ["candidate_net"],
          pointsToConnect: inputSrj.connections[1]!.pointsToConnect,
        },
      ],
    },
    traces: [candidateTrace],
  })
  const outerClearanceError = result.errors.find(
    (error) =>
      error.type === "pcb_via_clearance_error" &&
      error.pcb_error_id.startsWith(VIA_OUTER_CLEARANCE_ERROR_PREFIX),
  )

  expect(outerClearanceError).toBeDefined()
  expect(
    outerClearanceError?.type === "pcb_via_clearance_error"
      ? outerClearanceError.actual_clearance
      : undefined,
  ).toBeCloseTo(-0.03)
  expect(
    outerClearanceError?.type === "pcb_via_clearance_error"
      ? outerClearanceError.minimum_clearance
      : undefined,
  ).toBe(0.1)
  expect(
    (
      outerClearanceError as
        | (typeof outerClearanceError & {
            candidate_pcb_trace_ids?: string[]
          })
        | undefined
    )?.candidate_pcb_trace_ids,
  ).toEqual(["candidate"])
})

test("relaxed DRC expands through-vias onto intermediate layers", () => {
  const fixedTrace: SimplifiedPcbTrace = {
    type: "pcb_trace",
    pcb_trace_id: "fixed",
    connection_name: "fixed_net",
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
        via_hole_diameter: 0.1,
      },
      { route_type: "wire", x: 0, y: 0, width: 0.1, layer: "bottom" },
      { route_type: "wire", x: -1, y: 0, width: 0.1, layer: "bottom" },
    ],
  }
  const candidateTrace: SimplifiedPcbTrace = {
    type: "pcb_trace",
    pcb_trace_id: "candidate",
    connection_name: "candidate_net_mst0",
    route: [
      { route_type: "wire", x: 0, y: -1, width: 0.1, layer: "inner1" },
      { route_type: "wire", x: 0, y: 1, width: 0.1, layer: "inner1" },
    ],
  }
  const inputSrj: SimpleRouteJson = {
    layerCount: 4,
    minTraceWidth: 0.1,
    minViaDiameter: 0.4,
    bounds: { minX: -2, minY: -2, maxX: 2, maxY: 2 },
    obstacles: [],
    connections: [
      {
        name: "fixed_net",
        pointsToConnect: [
          { x: -1, y: 0, layer: "top" },
          { x: -1, y: 0, layer: "bottom" },
        ],
      },
      {
        name: "candidate_net",
        pointsToConnect: [
          { x: 0, y: -1, layer: "inner1" },
          { x: 0, y: 1, layer: "inner1" },
        ],
      },
    ],
    traces: [fixedTrace],
  }
  const result = evaluateRelaxedDrc({
    inputSrj,
    srjWithPointPairs: {
      ...inputSrj,
      connections: [
        {
          name: "candidate_net_mst0",
          __rootConnectionNames: ["candidate_net"],
          pointsToConnect: inputSrj.connections[1]!.pointsToConnect,
        },
      ],
    },
    traces: [candidateTrace],
  })
  const via = result.circuitJson.find((element) => element.type === "pcb_via")
  expect(via?.type === "pcb_via" ? via.layers : undefined).toEqual([
    "top",
    "inner1",
    "inner2",
    "bottom",
  ])

  const overlapError = result.errors.find(
    (error) =>
      "pcb_trace_error_id" in error &&
      error.pcb_trace_error_id ===
        `overlap_candidate_${via?.type === "pcb_via" ? via.pcb_via_id : "missing"}`,
  )
  expect(overlapError).toBeDefined()
  expect(
    (
      overlapError as
        | (typeof overlapError & { candidate_pcb_trace_ids?: string[] })
        | undefined
    )?.candidate_pcb_trace_ids,
  ).toEqual(["candidate"])
})
