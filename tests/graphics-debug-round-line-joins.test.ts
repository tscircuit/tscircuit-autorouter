import { expect, test } from "bun:test"
import type { GraphicsObject } from "graphics-debug"

test("renders autorouter visualization lines with round joins", async () => {
  const visualization: GraphicsObject = {
    lines: [
      {
        points: [
          { x: -1.5, y: 2 },
          { x: 0, y: -2 },
          { x: 1.5, y: 2 },
        ],
        strokeColor: "#2563eb",
        strokeWidth: 0.8,
      },
    ],
  }

  await expect(visualization).toMatchGraphicsSvg(import.meta.path)
})
