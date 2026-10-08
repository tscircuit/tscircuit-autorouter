import { expect, test } from "bun:test"
import { dataset as datasetSrj24 } from "@tscircuit/dataset-srj24"
import { getSvgFromGraphicsObject } from "graphics-debug"
import { stackSvgsHorizontally } from "stack-svgs"
import type { SimpleRouteJson } from "../../lib/types"
import { convertSrjToGraphicsObject } from "../../lib/utils/convertSrjToGraphicsObject"

const createRoutingMetadataSvg = ({
  allowBlindAndBuriedVias,
  allowViaInPad,
  minTraceWidth,
  minViaPadDiameter,
  minViaHoleDiameter,
}: {
  allowBlindAndBuriedVias: boolean | undefined
  allowViaInPad: boolean | undefined
  minTraceWidth: number | undefined
  minViaPadDiameter: number | undefined
  minViaHoleDiameter: number | undefined
}) => {
  const values = [
    ["allowBlindAndBuriedVias", String(allowBlindAndBuriedVias ?? false)],
    [
      "allowViaInPad",
      allowViaInPad === undefined ? "not emitted" : String(allowViaInPad),
    ],
    [
      "minTraceWidth",
      minTraceWidth === undefined ? "not emitted" : `${minTraceWidth} mm`,
    ],
    [
      "minViaPadDiameter",
      minViaPadDiameter === undefined
        ? "not emitted"
        : `${minViaPadDiameter} mm`,
    ],
    [
      "minViaHoleDiameter",
      minViaHoleDiameter === undefined
        ? "not emitted"
        : `${minViaHoleDiameter} mm`,
    ],
  ]

  const rows = values
    .map(([label, value], index) => {
      const y = 155 + index * 62
      const isPreserved =
        value !== "not emitted" && value !== "false" && value !== "0.1 mm"
      const color = isPreserved ? "#22c55e" : "#ef4444"
      return `<text x="36" y="${y}" fill="#e2e8f0" font-family="monospace" font-size="18">${label}</text><text x="400" y="${y}" fill="${color}" font-family="monospace" font-size="18" font-weight="700">${value}</text>`
    })
    .join("")

  return `<svg xmlns="http://www.w3.org/2000/svg" width="650" height="600" viewBox="0 0 650 600"><rect width="650" height="600" fill="#0f1720"/><text x="36" y="58" fill="#f8fafc" font-family="Arial, sans-serif" font-size="26" font-weight="700">PMP22650 routing metadata</text><text x="36" y="96" fill="#94a3b8" font-family="Arial, sans-serif" font-size="17">Simple Route JSON consumed by Pipeline 9</text>${rows}<text x="36" y="516" fill="#cbd5e1" font-family="Arial, sans-serif" font-size="16">409 connections · 2,343 endpoints · 8 layers</text></svg>`
}

test("PMP22650 exposes its manufacturing routing constraints", () => {
  const simpleRouteJson = structuredClone(
    datasetSrj24.sample024,
  ) as unknown as SimpleRouteJson

  expect(simpleRouteJson.connections).toHaveLength(409)
  expect(simpleRouteJson.allowBlindAndBuriedVias).toBe(false)
  expect(simpleRouteJson.allowViaInPad).toBeUndefined()
  expect(simpleRouteJson.minTraceWidth).toBe(0.1)
  expect(simpleRouteJson.minViaPadDiameter).toBeUndefined()
  expect(simpleRouteJson.minViaHoleDiameter).toBeUndefined()

  const boardSvg = getSvgFromGraphicsObject(
    convertSrjToGraphicsObject(simpleRouteJson),
    {
      backgroundColor: "#0d1117",
      svgWidth: 1000,
      svgHeight: 600,
      hideInlineLabels: true,
    },
  )
  const comparisonSvg = stackSvgsHorizontally(
    [
      boardSvg,
      createRoutingMetadataSvg({
        allowBlindAndBuriedVias: simpleRouteJson.allowBlindAndBuriedVias,
        allowViaInPad: simpleRouteJson.allowViaInPad,
        minTraceWidth: simpleRouteJson.minTraceWidth,
        minViaPadDiameter: simpleRouteJson.minViaPadDiameter,
        minViaHoleDiameter: simpleRouteJson.minViaHoleDiameter,
      }),
    ],
    { gap: 24, normalizeSize: false },
  )

  expect(comparisonSvg).toMatchSvgSnapshot(import.meta.path, {
    tolerance: 0,
  })
})
