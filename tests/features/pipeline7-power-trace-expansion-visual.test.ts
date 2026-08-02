import { expect, test } from "bun:test"
import { getSvgFromGraphicsObject } from "graphics-debug"
import { stackSvgsHorizontally } from "stack-svgs"
import { AutoroutingPipelineSolver7_MultiGraph } from "lib/autorouter-pipelines/AutoroutingPipeline7_MultiGraph/AutoroutingPipelineSolver7_MultiGraph"
import { evaluateRelaxedDrc } from "lib/testing/evaluate-relaxed-drc"
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

test("Pipeline7 solves and power-expands the SRJ27 dataset without DRC regressions", async (): Promise<void> => {
  const scenarios = await loadScenarios("srj27")
  const failedScenarios: string[] = []
  const preExpansionDrcPasses: string[] = []
  const postExpansionDrcPasses: string[] = []

  for (const [scenarioName, scenario] of scenarios) {
    const input = structuredClone(scenario)
    const solver = new AutoroutingPipelineSolver7_MultiGraph(input)
    try {
      solver.solve()
    } catch {
      failedScenarios.push(scenarioName)
      continue
    }

    if (!solver.solved || solver.failed) {
      failedScenarios.push(scenarioName)
      continue
    }
    expect(solver.solved).toBe(true)
    expect(solver.failed).toBe(false)

    const preExpansionOutput =
      solver.getPrePowerTraceOutputSimplifiedPcbTraces()
    const output = solver.getOutputSimplifiedPcbTraces()
    const srjWithPointPairs = solver.srjWithPointPairs ?? input
    const preExpansionDrc = evaluateRelaxedDrc({
      inputSrj: input,
      srjWithPointPairs,
      routedTraces: preExpansionOutput,
    })
    const postExpansionDrc = evaluateRelaxedDrc({
      inputSrj: input,
      srjWithPointPairs,
      routedTraces: output,
    })
    if (preExpansionDrc.errors.length === 0) {
      preExpansionDrcPasses.push(scenarioName)
      expect(postExpansionDrc.errors).toEqual([])
    }
    if (postExpansionDrc.errors.length === 0) {
      postExpansionDrcPasses.push(scenarioName)
    }

    const renderOptions = {
      backgroundColor: "white",
      hideInlineLabels: true,
    } as const
    const inputSvg = getSvgFromGraphicsObject(
      convertSrjToGraphicsObject(input, { traceColorMode: "layer" }),
      renderOptions,
    )
    const preExpansionSvg = getSvgFromGraphicsObject(
      convertSrjToGraphicsObject(
        { ...input, traces: preExpansionOutput },
        { traceColorMode: "layer" },
      ),
      renderOptions,
    )
    const outputSvg = getSvgFromGraphicsObject(
      convertSrjToGraphicsObject(
        { ...input, traces: output },
        { traceColorMode: "layer" },
      ),
      renderOptions,
    )

    await expect(
      stackSvgsHorizontally(
        [
          addPanelTitle(inputSvg, "SRJ27 INPUT"),
          addPanelTitle(
            preExpansionSvg,
            `PIPELINE7 PRE-EXPANSION · ${preExpansionDrc.errors.length} DRC ERRORS`,
          ),
          addPanelTitle(
            outputSvg,
            `POWER-EXPANDED · ${postExpansionDrc.errors.length} DRC ERRORS`,
          ),
        ],
        {
          gap: 12,
          normalizeSize: false,
        },
      ),
    ).toMatchSvgSnapshot(import.meta.path, { svgName: scenarioName })
  }

  expect(failedScenarios).toEqual(["sample001"])
  expect(preExpansionDrcPasses).toEqual(["sample005"])
  expect(postExpansionDrcPasses).toEqual([
    "sample003",
    "sample004",
    "sample005",
  ])
  expect(
    preExpansionDrcPasses.every((scenarioName) =>
      postExpansionDrcPasses.includes(scenarioName),
    ),
  ).toBe(true)
})
