import { expect, test } from "bun:test"
import { routeGeneratedSignalSites } from "../lib/route-generated-signal-sites"
import type { SimpleRouteJson } from "../lib/types"

test("only a completed unsuccessful site search marks its choices exhausted", () => {
  const input: SimpleRouteJson = {
    layerCount: 2,
    allowedLayers: ["top"],
    minTraceWidth: 0.2,
    bounds: { minX: -2, maxX: 2, minY: -2, maxY: 2 },
    obstacles: [],
    connections: [
      {
        name: "signal",
        pointsToConnect: [
          { x: -1, y: 0, layer: "top" },
          { x: 1, y: 0, layer: "top" },
        ],
      },
    ],
  }
  let exhausted = 0
  const request = {
    input,
    options: {},
    maxSteps: 100,
    onSiteSearchExhausted: () => {
      exhausted++
    },
  }
  const successful = routeGeneratedSignalSites(request)
  let successfulResult = successful.next()
  while (!successfulResult.done) successfulResult = successful.next()
  expect(successfulResult.value?.traces).toHaveLength(1)
  expect(exhausted).toBe(0)

  const blockedInput: SimpleRouteJson = {
    ...input,
    obstacles: [
      {
        type: "rect",
        center: { x: 0, y: 0 },
        width: 4,
        height: 4,
        layers: ["top", "bottom"],
        connectedTo: ["other_signal"],
      },
    ],
  }
  const cancelled = routeGeneratedSignalSites({
    ...request,
    input: blockedInput,
  })
  expect(cancelled.next().done).toBeFalse()
  cancelled.return(null)
  expect(exhausted).toBe(0)

  const blocked = routeGeneratedSignalSites({ ...request, input: blockedInput })
  let blockedResult = blocked.next()
  while (!blockedResult.done) blockedResult = blocked.next()
  expect(blockedResult.value).toBeNull()
  expect(exhausted).toBe(1)
})
