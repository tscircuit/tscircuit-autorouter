import { expect, test } from "bun:test"
import { getSvgFromGraphicsObject } from "graphics-debug"
import { stackSvgsHorizontally } from "stack-svgs"
import { PowerTraceExpansionSolver } from "lib/autorouter-pipelines/AutoroutingPipeline7_MultiGraph/PowerTraceExpansionSolver"
import { getDrcErrors } from "lib/testing/getDrcErrors"
import { convertToCircuitJson } from "lib/testing/utils/convertToCircuitJson"
import { convertSrjToGraphicsObject } from "lib/utils/convertSrjToGraphicsObject"
import { loadScenarios } from "../../scripts/benchmark/scenarios"

const addPanelTitle = (svg: string, title: string): string => {
  const bodyStart = svg.indexOf(">") + 1
  const bodyEnd = svg.lastIndexOf("</svg>")
  const width = Number(svg.match(/\bwidth="([^"]+)"/)?.[1])
  const height = Number(svg.match(/\bheight="([^"]+)"/)?.[1])
  if (bodyStart === 0 || bodyEnd === -1 || !width || !height) {
    throw new Error("Expected complete SVG dimensions and markup")
  }

  const headerHeight = 42
  return `<svg width="${width}" height="${
    height + headerHeight
  }" viewBox="0 0 ${width} ${
    height + headerHeight
  }" xmlns="http://www.w3.org/2000/svg"><rect width="100%" height="100%" fill="white"/><text x="12" y="25" font-family="monospace" font-size="15" font-weight="700" fill="#111">${title}</text><g transform="translate(0 ${headerHeight})">${svg.slice(
    bodyStart,
    bodyEnd,
  )}</g></svg>`
}

test("power expansion visually solves the SRJ27 dataset without DRC errors", async (): Promise<void> => {
  const scenarios = await loadScenarios("srj27")

  for (const [scenarioName, scenario] of scenarios) {
    const input = structuredClone(scenario)
    const solver = new PowerTraceExpansionSolver(input)
    solver.solve()

    expect(solver.solved).toBe(true)
    expect(solver.failed).toBe(false)

    const output = solver.getOutput()
    const circuitJson = convertToCircuitJson(
      { ...input, traces: output },
      output,
      {
        minTraceWidth: input.minTraceWidth,
        originalSrj: input,
        includeOriginalConnections: true,
      },
    )
    expect(getDrcErrors(circuitJson).errors).toEqual([])

    const renderOptions = {
      backgroundColor: "white",
      hideInlineLabels: true,
    } as const
    const inputSvg = getSvgFromGraphicsObject(
      convertSrjToGraphicsObject(input, { traceColorMode: "layer" }),
      renderOptions,
    )
    const outputSvg = getSvgFromGraphicsObject(
      solver.visualize(),
      renderOptions,
    )

    await expect(
      stackSvgsHorizontally(
        [
          addPanelTitle(inputSvg, "ROUTED SRJ INPUT"),
          addPanelTitle(outputSvg, "POWER-EXPANDED OUTPUT · 0 DRC ERRORS"),
        ],
        {
          gap: 12,
          normalizeSize: false,
        },
      ),
    ).toMatchSvgSnapshot(import.meta.path, { svgName: scenarioName })
  }
})
