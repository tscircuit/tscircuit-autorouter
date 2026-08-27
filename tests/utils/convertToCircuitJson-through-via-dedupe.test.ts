import { expect, test } from "bun:test"
import { getDrcErrors } from "lib/testing/getDrcErrors"
import { convertToCircuitJson } from "lib/testing/utils/convertToCircuitJson"
import type { SimpleRouteJson, SimplifiedPcbTrace } from "lib/types"

test("through-via conversion deduplicates stacked logical transitions", () => {
  const createSrj = (allowBlindAndBuriedVias?: boolean): SimpleRouteJson => ({
    layerCount: 4,
    ...(allowBlindAndBuriedVias === undefined
      ? {}
      : { allowBlindAndBuriedVias }),
    minTraceWidth: 0.1,
    bounds: { minX: -1, minY: -1, maxX: 1, maxY: 1 },
    obstacles: [],
    connections: [],
  })
  const traces: SimplifiedPcbTrace[] = [
    {
      type: "pcb_trace",
      pcb_trace_id: "stacked_transition",
      connection_name: "stacked_transition",
      route: [
        { route_type: "wire", x: -1, y: 0, width: 0.1, layer: "top" },
        { route_type: "wire", x: 0, y: 0, width: 0.1, layer: "top" },
        {
          route_type: "via",
          x: 0,
          y: 0,
          from_layer: "top",
          to_layer: "inner1",
          via_diameter: 0.4,
          via_hole_diameter: 0.3,
        },
        { route_type: "wire", x: 0, y: 0, width: 0.1, layer: "inner1" },
        {
          route_type: "via",
          x: 0,
          y: 0,
          from_layer: "inner1",
          to_layer: "inner2",
          via_diameter: 0.7,
          via_hole_diameter: 0.2,
        },
        { route_type: "wire", x: 0, y: 0, width: 0.1, layer: "inner2" },
        { route_type: "wire", x: 1, y: 0, width: 0.1, layer: "inner2" },
      ],
    },
  ]
  const defaultVias = convertToCircuitJson(createSrj(), traces).filter(
    (element) => element.type === "pcb_via",
  )
  const roleAwareDefaultVias = convertToCircuitJson(
    {
      ...createSrj(),
      obstacles: [
        {
          type: "rect",
          obstacleId: "authoritative_pad",
          obstacleRole: "pad",
          center: { x: 0.8, y: 0.8 },
          width: 0.1,
          height: 0.1,
          layers: ["top"],
          connectedTo: ["authoritative_pad"],
        },
      ],
    },
    traces,
  ).filter((element) => element.type === "pcb_via")
  const throughVias = convertToCircuitJson(createSrj(false), traces).filter(
    (element) => element.type === "pcb_via",
  )
  const blindVias = convertToCircuitJson(createSrj(true), traces).filter(
    (element) => element.type === "pcb_via",
  )

  expect(defaultVias).toEqual([
    expect.objectContaining({
      layers: ["top", "inner1"],
      outer_diameter: 0.4,
      hole_diameter: 0.3,
    }),
    expect.objectContaining({
      layers: ["inner1", "inner2"],
      outer_diameter: 0.7,
      hole_diameter: 0.2,
    }),
  ])
  expect(throughVias).toEqual([
    expect.objectContaining({
      outer_diameter: 0.7,
      hole_diameter: 0.3,
    }),
  ])
  expect(roleAwareDefaultVias).toEqual(throughVias)
  expect(blindVias).toEqual([
    expect.objectContaining({
      layers: ["top", "inner1"],
      outer_diameter: 0.4,
      hole_diameter: 0.3,
    }),
    expect.objectContaining({
      layers: ["inner1", "inner2"],
      outer_diameter: 0.7,
      hole_diameter: 0.2,
    }),
  ])

  const invalidAnnulusTraces: SimplifiedPcbTrace[] = [
    {
      ...traces[0],
      pcb_trace_id: "invalid_annulus",
      route: traces[0].route.map((segment) =>
        segment.route_type === "via" && segment.from_layer === "top"
          ? { ...segment, via_diameter: 0.25, via_hole_diameter: 0.3 }
          : segment,
      ),
    },
  ]
  expect(() =>
    convertToCircuitJson(createSrj(false), invalidAnnulusTraces),
  ).toThrow("Invalid via annulus")

  const foreignNetSrj: SimpleRouteJson = {
    ...createSrj(false),
    connections: [
      {
        name: "foreign_top",
        pointsToConnect: [
          { x: -1, y: 0, layer: "top", pcb_port_id: "top_start" },
          { x: 0, y: 1, layer: "inner1", pcb_port_id: "top_end" },
        ],
      },
      {
        name: "foreign_bottom",
        pointsToConnect: [
          { x: 1, y: 0, layer: "bottom", pcb_port_id: "bottom_start" },
          { x: 0, y: -1, layer: "inner2", pcb_port_id: "bottom_end" },
        ],
      },
    ],
  }
  const foreignNetTraces: SimplifiedPcbTrace[] = [
    {
      type: "pcb_trace",
      pcb_trace_id: "foreign_top",
      connection_name: "foreign_top",
      route: [
        {
          route_type: "wire",
          x: -1,
          y: 0,
          width: 0.1,
          layer: "top",
          start_pcb_port_id: "top_start",
        },
        { route_type: "wire", x: 0, y: 0, width: 0.1, layer: "top" },
        {
          route_type: "via",
          x: 0,
          y: 0,
          from_layer: "top",
          to_layer: "inner1",
        },
        { route_type: "wire", x: 0, y: 0, width: 0.1, layer: "inner1" },
        {
          route_type: "wire",
          x: 0,
          y: 1,
          width: 0.1,
          layer: "inner1",
          end_pcb_port_id: "top_end",
        },
      ],
    },
    {
      type: "pcb_trace",
      pcb_trace_id: "foreign_bottom",
      connection_name: "foreign_bottom",
      route: [
        {
          route_type: "wire",
          x: 1,
          y: 0,
          width: 0.1,
          layer: "bottom",
          start_pcb_port_id: "bottom_start",
        },
        { route_type: "wire", x: 0, y: 0, width: 0.1, layer: "bottom" },
        {
          route_type: "via",
          x: 0,
          y: 0,
          from_layer: "bottom",
          to_layer: "inner2",
        },
        { route_type: "wire", x: 0, y: 0, width: 0.1, layer: "inner2" },
        {
          route_type: "wire",
          x: 0,
          y: -1,
          width: 0.1,
          layer: "inner2",
          end_pcb_port_id: "bottom_end",
        },
      ],
    },
  ]
  const foreignNetCircuitJson = convertToCircuitJson(
    foreignNetSrj,
    foreignNetTraces,
  )
  const foreignNetVias = foreignNetCircuitJson.filter(
    (element) => element.type === "pcb_via",
  )
  const foreignNetErrors = getDrcErrors(foreignNetCircuitJson, {
    includeBoardEdge: false,
    includeTraceContinuity: false,
  }).errors

  expect(foreignNetVias).toHaveLength(1)
  expect(foreignNetErrors).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        type: "pcb_trace_error",
        pcb_trace_error_id: "overlap_foreign_bottom_via_0",
      }),
    ]),
  )
})
