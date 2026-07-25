import { expect, test } from "bun:test"
import {
  Pipeline9IjumpRerouter,
  type Pipeline9TerminalViaEscapeCandidate,
} from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/pipeline9-ijump-rerouter"
import type { Obstacle, SimpleRouteJson } from "lib/types"
import type { HighDensityRoute } from "lib/types/high-density-types"

const startPad: Obstacle = {
  type: "rect",
  layers: ["top"],
  center: { x: -2, y: 0 },
  width: 0.8,
  height: 0.28,
  connectedTo: ["pcb_smtpad_start", "pcb_port_start", "test_net"],
}

const endPad: Obstacle = {
  type: "rect",
  layers: ["top"],
  center: { x: 2, y: 0 },
  width: 0.8,
  height: 0.28,
  connectedTo: ["pcb_smtpad_end", "pcb_port_end", "test_net"],
}

const blockingTopCopper: Obstacle = {
  type: "rect",
  layers: ["top"],
  center: { x: 0, y: 0 },
  width: 2,
  height: 0.5,
  connectedTo: ["fixed_net"],
}

const srj: SimpleRouteJson = {
  layerCount: 2,
  minTraceWidth: 0.1,
  minViaDiameter: 0.3,
  bounds: { minX: -3, minY: -2, maxX: 3, maxY: 2 },
  obstacles: [startPad, endPad, blockingTopCopper],
  connections: [],
}

const route: HighDensityRoute = {
  connectionName: "test_net",
  traceThickness: 0.1,
  viaDiameter: 0.3,
  vias: [],
  route: [
    { x: -2, y: 0, z: 0, pcb_port_id: "pcb_port_start" },
    { x: 2, y: 0, z: 0, pcb_port_id: "pcb_port_end" },
  ],
}

const getLayerTransitions = (candidateRoute: HighDensityRoute) =>
  candidateRoute.route.flatMap((point, pointIndex) => {
    const nextPoint = candidateRoute.route[pointIndex + 1]
    return nextPoint && nextPoint.z !== point.z
      ? [{ x: point.x, y: point.y, fromZ: point.z, toZ: nextPoint.z }]
      : []
  })

test("Pipeline9 escapes a blocked terminal pad with bounded generated vias", () => {
  const rerouter = new Pipeline9IjumpRerouter({
    srj,
    baseObstacles: srj.obstacles,
  })
  const routes = [route]
  const candidates = rerouter.getTerminalViaEscapeCandidates(routes, 0)

  expect(candidates.length).toBeGreaterThan(0)
  expect(candidates.length).toBeLessThanOrEqual(64)
  expect(
    candidates.every(
      (candidate) =>
        candidate.startVia.x >= srj.bounds.minX + route.viaDiameter / 2 &&
        candidate.startVia.x <= srj.bounds.maxX - route.viaDiameter / 2 &&
        candidate.endVia.x >= srj.bounds.minX + route.viaDiameter / 2 &&
        candidate.endVia.x <= srj.bounds.maxX - route.viaDiameter / 2,
    ),
  ).toBe(true)

  const endViaXs = candidates.map((candidate) => candidate.endVia.x)
  expect(endViaXs).toContain(1.75)
  expect(endViaXs).toContain(2.25)

  const escapeCandidate = candidates.find(
    (candidate) =>
      candidate.alternateZ === 1 &&
      candidate.startVia.x === route.route[0]!.x &&
      candidate.startVia.y === route.route[0]!.y &&
      candidate.endVia.x === 1.75 &&
      candidate.endVia.y === 0,
  )
  expect(escapeCandidate).toBeDefined()
  if (!escapeCandidate) throw new Error("Expected a generated pad escape")

  const result = rerouter.tryRerouteWithTerminalViaEscape(routes, {
    routeIndex: 0,
    candidate: escapeCandidate,
    includeCandidateCopper: false,
    reverse: true,
    shortenPath: false,
    maxIterations: 50_000,
  })

  expect(result?.route).toBeDefined()
  if (!result?.route) throw new Error("Expected terminal via escape to route")
  expect(result.route.route[0]).toEqual(route.route[0])
  expect(result.route.route.at(-1)).toEqual(route.route.at(-1))
  expect(getLayerTransitions(result.route)).toEqual(
    expect.arrayContaining([
      { x: -2, y: 0, fromZ: 0, toZ: 1 },
      { x: 1.75, y: 0, fromZ: 1, toZ: 0 },
    ]),
  )
  expect(
    result.route.route.some((point, pointIndex) => {
      const nextPoint = result.route?.route[pointIndex + 1]
      return (
        nextPoint?.z === 1 &&
        point.z === 1 &&
        Math.min(point.x, nextPoint.x) < -1 &&
        Math.max(point.x, nextPoint.x) > 1
      )
    }),
  ).toBe(true)
})

test("Pipeline9 rejects a terminal escape access point outside its pad", () => {
  const rerouter = new Pipeline9IjumpRerouter({
    srj,
    baseObstacles: srj.obstacles,
  })
  const invalidCandidate: Pipeline9TerminalViaEscapeCandidate = {
    alternateZ: 1,
    startVia: { x: -2, y: 0 },
    endVia: { x: 0, y: 0 },
  }

  expect(
    rerouter.tryRerouteWithTerminalViaEscape([route], {
      routeIndex: 0,
      candidate: invalidCandidate,
      includeCandidateCopper: false,
      reverse: true,
      shortenPath: false,
      maxIterations: 50_000,
    }),
  ).toBeUndefined()
})

test("Pipeline9 interleaves terminal escape layers within the bounded prefix", () => {
  const multilayerSrj: SimpleRouteJson = {
    ...srj,
    layerCount: 4,
  }
  const rerouter = new Pipeline9IjumpRerouter({
    srj: multilayerSrj,
    baseObstacles: multilayerSrj.obstacles,
  })

  const candidates = rerouter.getTerminalViaEscapeCandidates([route], 0)

  expect(candidates.slice(0, 3).map(({ alternateZ }) => alternateZ)).toEqual([
    1, 2, 3,
  ])
  expect(
    new Set(candidates.slice(0, 4).map(({ alternateZ }) => alternateZ)),
  ).toEqual(new Set([1, 2, 3]))
})
