import { expect, test } from "bun:test"
import { getSvgFromGraphicsObject, type GraphicsObject } from "graphics-debug"
import { stackSvgsHorizontally } from "stack-svgs"
import { createForceImproveThroughObstacleRoundingRepro } from "tests/fixtures/force-improve-through-obstacle-rounding"

const addPanelHeader = ({
  svg,
  title,
  details,
}: {
  svg: string
  title: string
  details: [string, string]
}): string => {
  const headerHeight = 76
  const bodyStart = svg.indexOf(">") + 1
  const bodyEnd = svg.lastIndexOf("</svg>")
  const width = Number(svg.match(/\bwidth="([^"]+)"/)?.[1] ?? 480)
  const height = Number(svg.match(/\bheight="([^"]+)"/)?.[1] ?? 420)
  return `<svg width="${width}" height="${
    height + headerHeight
  }" viewBox="0 0 ${width} ${
    height + headerHeight
  }" xmlns="http://www.w3.org/2000/svg"><rect width="100%" height="100%" fill="white"/><text x="16" y="22" font-family="monospace" font-size="15" font-weight="700" fill="#111">${title}</text><text x="16" y="43" font-family="monospace" font-size="12" fill="#444">${details[0]}</text><text x="16" y="61" font-family="monospace" font-size="12" fill="#444">${details[1]}</text><g transform="translate(0 ${headerHeight})">${svg.slice(
    bodyStart,
    bodyEnd,
  )}</g></svg>`
}

test("visualizes force-improvement rounding a valid transition outside its obstacle", () => {
  const { inputRoute, obstacle, outputRoute } =
    createForceImproveThroughObstacleRoundingRepro()
  const obstacleMinX = obstacle.center.x - obstacle.width / 2
  const inputPoint = inputRoute.route[0]!
  const outputPoint = outputRoute.route[0]!

  const renderBoundary = (
    point: { x: number; y: number },
    pointColor: string,
  ): string => {
    const graphics: GraphicsObject = {
      coordinateSystem: "cartesian",
      rects: [
        {
          center: { x: obstacleMinX + 0.0015, y: 0 },
          width: 0.003,
          height: 0.004,
          fill: "rgba(34, 197, 94, 0.18)",
          label: "inside plated obstacle",
        },
      ],
      lines: [
        {
          points: [
            { x: obstacleMinX, y: -0.002 },
            { x: obstacleMinX, y: 0.002 },
          ],
          strokeColor: "#111827",
          strokeWidth: 0.00004,
          label: `obstacle boundary x=${obstacleMinX}`,
        },
        {
          points: [point, { x: obstacleMinX + 0.0025, y: 0 }],
          strokeColor: pointColor,
          strokeWidth: 0.00012,
          label: "through-obstacle transition",
        },
      ],
      circles: [
        {
          center: point,
          radius: 0.00014,
          fill: pointColor,
          stroke: "#111827",
          label: `endpoint x=${point.x}`,
        },
      ],
    }
    return getSvgFromGraphicsObject(graphics, {
      backgroundColor: "white",
      svgWidth: 480,
      svgHeight: 420,
      hideInlineLabels: true,
    })
  }

  expect(
    stackSvgsHorizontally(
      [
        addPanelHeader({
          svg: renderBoundary(inputPoint, "#16a34a"),
          title: "INPUT • VALID EDGE TRANSITION",
          details: [
            `endpoint x=${inputPoint.x}`,
            "The generated endpoint lies exactly on the obstacle boundary.",
          ],
        }),
        addPanelHeader({
          svg: renderBoundary(outputPoint, "#dc2626"),
          title: "OUTPUT • ROUNDED OUTSIDE",
          details: [
            `endpoint x=${outputPoint.x}`,
            `Force improvement moves it ${(
              obstacleMinX - outputPoint.x
            ).toFixed(7)} mm outside.`,
          ],
        }),
      ],
      { gap: 12, normalizeSize: false },
    ),
  ).toMatchSvgSnapshot(import.meta.path)
})
