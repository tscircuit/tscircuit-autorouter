import {
  getSvgFromGraphicsObject,
  type GraphicsObject,
  type Viewbox,
} from "graphics-debug"

export function renderRvboyRoutingView(
  graphics: GraphicsObject,
  viewbox: Viewbox,
  title: string,
  subtitle: string,
): string {
  const frame = {
    center: {
      x: (viewbox.minX + viewbox.maxX) / 2,
      y: (viewbox.minY + viewbox.maxY) / 2,
    },
    width: viewbox.maxX - viewbox.minX,
    height: viewbox.maxY - viewbox.minY,
    fill: "none",
    stroke: "none",
    label: "rvboy-viewport",
  }
  const svg = getSvgFromGraphicsObject(
    { ...graphics, rects: [...(graphics.rects ?? []), frame] },
    {
      backgroundColor: "white",
      svgWidth: 1000,
      svgHeight: 600,
      includeTextLabels: false,
    },
  )
  const frameTag = svg.match(/<rect\b[^>]*data-label="rvboy-viewport"[^>]*\/>/)
  if (!frameTag) throw new Error("Missing viewport in RVboy routing drawing")
  const coordinates = ["x", "y", "width", "height"].map((attribute) => {
    const match = frameTag[0].match(new RegExp(`\\s${attribute}="([^"]+)"`))
    if (!match) throw new Error(`Missing viewport ${attribute}`)
    return Number(match[1])
  })
  const cropped = svg.replace(
    /<svg\b[^>]*>/,
    `<svg x="0" y="80" width="1000" height="600" viewBox="${coordinates.join(" ")}" overflow="hidden" xmlns="http://www.w3.org/2000/svg">`,
  )
  return `<svg width="1000" height="680" viewBox="0 0 1000 680" xmlns="http://www.w3.org/2000/svg"><rect width="100%" height="100%" fill="white"/><text x="24" y="30" font-family="sans-serif" font-size="22">${title}</text><text x="24" y="59" font-family="sans-serif" font-size="16">${subtitle}</text>${cropped}</svg>`
}
