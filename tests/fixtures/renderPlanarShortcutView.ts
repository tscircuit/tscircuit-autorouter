import {
  getSvgFromGraphicsObject,
  type GraphicsObject,
  type Viewbox,
} from "graphics-debug"

/** Keep the crop in one SVG viewport so browser and raster snapshots agree. */
export function renderPlanarShortcutView(
  graphics: GraphicsObject,
  viewbox: Viewbox,
): string {
  const svg = getSvgFromGraphicsObject(
    {
      ...graphics,
      rects: [
        ...(graphics.rects ?? []),
        {
          center: {
            x: (viewbox.minX + viewbox.maxX) / 2,
            y: (viewbox.minY + viewbox.maxY) / 2,
          },
          width: viewbox.maxX - viewbox.minX,
          height: viewbox.maxY - viewbox.minY,
          stroke: "none",
          fill: "none",
          label: "shortcut-viewport",
        },
      ],
    },
    {
      backgroundColor: "white",
      includeTextLabels: false,
      svgWidth: 1000,
      svgHeight: 600,
    },
  )
  const frame = svg.match(/<rect\b[^>]*data-label="shortcut-viewport"[^>]*\/>/)
  if (!frame) throw new Error("Missing shortcut viewport")
  const coordinates = ["x", "y", "width", "height"].map((attribute) => {
    const value = frame[0].match(new RegExp(`\\s${attribute}="([^"]+)"`))
    if (!value) throw new Error(`Missing viewport ${attribute}`)
    return Number(value[1])
  })
  const height = Math.round((800 * coordinates[3]!) / coordinates[2]!)
  return svg
    .replace(
      '<rect width="100%" height="100%" fill="white"/>',
      `<rect x="${coordinates[0]}" y="${coordinates[1]}" width="${coordinates[2]}" height="${coordinates[3]}" fill="white"/>`,
    )
    .replace(
      /<svg\b[^>]*>/,
      `<svg width="800" height="${height}" viewBox="${coordinates.join(" ")}" xmlns="http://www.w3.org/2000/svg">`,
    )
}
