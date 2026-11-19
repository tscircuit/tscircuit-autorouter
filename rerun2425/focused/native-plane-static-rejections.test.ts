import { expect, test } from "bun:test"
import { getSvgFromGraphicsObject } from "graphics-debug"
import { buildOutputSimpleRouteJson } from "lib/build-output"
import { routeBus, type RouteBusStaticClearanceCache } from "lib/route-bus"
import { validateRoutedCopperDrc } from "lib/validate-routed-copper-drc"
import { visualizeSimpleRouteJson } from "lib/visualize-simple-route-json"
import { createIcepiPlaneDrop } from "./fixtures/icepi-plane-drop"

test("warm native plane routing retains geometry and live copper checks", async (): Promise<void> => {
  const params = createIcepiPlaneDrop()
  const inputBefore = JSON.stringify(params.srj)
  const staticClearanceCache: RouteBusStaticClearanceCache = new Map()
  const connection = params.bus.connections[0]!
  const sourcePortId = connection.sourcePoint.pcb_port_id
  const sourcePoint = { ...connection.sourcePoint }
  let sourcePortReads = 0
  Object.defineProperty(sourcePoint, "pcb_port_id", {
    get(): typeof sourcePortId {
      sourcePortReads++
      return sourcePortId
    },
  })
  const routeParams = {
    ...params,
    staticClearanceCache,
    bus: {
      ...params.bus,
      connections: [{ ...connection, sourcePoint }],
    },
  }
  const coldPlans = routeBus(routeParams)
  sourcePortReads = 0
  const warmPlans = routeBus(routeParams)
  const warmSourcePortReads = sourcePortReads
  expect(warmPlans).toHaveLength(1)
  expect(warmPlans).toEqual(coldPlans)
  if (!warmPlans) throw new Error("Native plane escape was rejected")

  const routedSrj = buildOutputSimpleRouteJson({
    inputSrj: params.srj,
    plans: warmPlans,
    layerNames: params.layerNames,
  })
  expect(
    validateRoutedCopperDrc({
      inputSrj: params.srj,
      routedSrj,
      clearance: params.clearance,
      allowBlindAndBuriedVias: false,
    }),
  ).toMatchObject({ valid: true, issues: [] })

  const blocker = {
    ...warmPlans[0]!,
    busId: "blocker",
    connectionIndex: -1,
    connectionName: "blocker",
    sourcePoint: {
      ...warmPlans[0]!.sourcePoint,
      pointId: "blocker-source",
      pcb_port_id: "blocker-source",
    },
  }
  expect(routeBus({ ...routeParams, acceptedPlans: [blocker] })).not.toEqual(
    warmPlans,
  )
  expect(routeBus(routeParams)).toEqual(coldPlans)
  expect(JSON.stringify(params.srj)).toBe(inputBefore)

  const boundary = params.bus.sharedBoundary
  const viewport = {
    minX: boundary.minX - 1.5,
    maxX: boundary.maxX + 1.5,
    minY: boundary.minY - 1.5,
    maxY: boundary.maxY + 1.5,
  }
  const graphics = visualizeSimpleRouteJson({
    ...params.srj,
    bounds: viewport,
    connections: [connection.connection],
    traces: warmPlans.map((plan) => plan.trace),
  })
  graphics.texts = [
    {
      x: viewport.minX,
      y: viewport.maxY + 0.8,
      text: `U22 warm escape: ${warmPlans.length} route; ${warmPlans.filter((plan) => plan.via).length} through-via`,
      fontSize: 0.3,
      color: "#0f172a",
      anchorSide: "center_left",
    },
    {
      x: viewport.minX,
      y: viewport.maxY + 0.3,
      text: `Warm source-port metadata reads: ${warmSourcePortReads}`,
      fontSize: 0.25,
      color: "#475569",
      anchorSide: "center_left",
    },
  ]
  await expect(
    getSvgFromGraphicsObject(graphics, {
      backgroundColor: "white",
      svgWidth: 1000,
      svgHeight: 1000,
    }),
  ).toMatchSvgSnapshot(import.meta.path)
})
