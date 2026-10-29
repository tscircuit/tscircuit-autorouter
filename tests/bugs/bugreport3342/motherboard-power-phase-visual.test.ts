import { expect, test } from "bun:test"
import { getSvgFromGraphicsObject } from "graphics-debug"
import { convertSrjToGraphicsObject } from "lib/utils/convertSrjToGraphicsObject"
import { loadMotherboardPowerPhase } from "./repro"

test("shows the captured motherboard power-phase input and output", async (): Promise<void> => {
  for (const name of ["input", "captured-output"] as const) {
    const srj = loadMotherboardPowerPhase(name)
    const graphics = convertSrjToGraphicsObject(srj)
    graphics.points = []
    graphics.rects.push({
      center: {
        x: (srj.bounds.minX + srj.bounds.maxX) / 2,
        y: (srj.bounds.minY + srj.bounds.maxY) / 2,
      },
      width: srj.bounds.maxX - srj.bounds.minX,
      height: srj.bounds.maxY - srj.bounds.minY,
      fill: "none",
      stroke: "#888888",
    })
    const svg: string = getSvgFromGraphicsObject(graphics, {
      backgroundColor: "white",
      svgWidth: 1200,
      svgHeight: 960,
    })
    await expect(svg).toMatchSvgSnapshot(import.meta.path, {
      svgName: name,
      scale: 1,
      tolerance: 0,
    })
  }
})
