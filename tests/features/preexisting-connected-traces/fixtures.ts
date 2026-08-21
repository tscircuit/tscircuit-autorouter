import { expect } from "bun:test";
import { getSvgFromGraphicsObject } from "graphics-debug";
import { stackSvgsVertically } from "stack-svgs";
import { AutoroutingPipelineSolver7_MultiGraph } from "lib/autorouter-pipelines/AutoroutingPipeline7_MultiGraph/AutoroutingPipelineSolver7_MultiGraph";
import type { SimpleRouteJson } from "lib/types";
import { convertSrjToGraphicsObject } from "lib/utils/convertSrjToGraphicsObject";

type SnapshotDescription = {
  problem: string;
  expected: string;
};

const escapeXmlText = (text: string): string => {
  const escapedText = text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");

  return escapedText;
};

const getSvgDimensions = (svg: string): { width: number; height: number } => {
  const widthMatch = svg.match(/\bwidth="([^"]+)"/);
  const heightMatch = svg.match(/\bheight="([^"]+)"/);
  const width = Number(widthMatch?.[1] ?? 640);
  const height = Number(heightMatch?.[1] ?? 640);

  if (!Number.isFinite(width) || !Number.isFinite(height)) {
    throw new Error("Expected SVG width and height to be finite numbers");
  }

  return { width, height };
};

const getSvgBody = (svg: string): string => {
  const openTagEndIndex = svg.indexOf(">");
  const closeTagStartIndex = svg.lastIndexOf("</svg>");
  if (openTagEndIndex === -1 || closeTagStartIndex === -1) {
    throw new Error("Expected complete SVG markup");
  }

  return svg.slice(openTagEndIndex + 1, closeTagStartIndex);
};

const addTitleToSvg = ({
  svg,
  title,
  subtitle,
}: {
  svg: string;
  title: string;
  subtitle: string;
}): string => {
  const { width, height } = getSvgDimensions(svg);
  const titleHeight = 52;
  const body = getSvgBody(svg);

  return `<svg width="${width}" height="${
    height + titleHeight
  }" viewBox="0 0 ${width} ${
    height + titleHeight
  }" xmlns="http://www.w3.org/2000/svg"><rect width="100%" height="100%" fill="white"/><text x="12" y="21" font-family="monospace" font-size="15" font-weight="700" fill="#111">${escapeXmlText(
    title,
  )}</text><text x="12" y="41" font-family="monospace" font-size="12" fill="#333">${escapeXmlText(
    subtitle,
  )}</text><g transform="translate(0 ${titleHeight})">${body}</g></svg>`;
};

const getCombinedOutputSrj = (
  inputSrj: SimpleRouteJson,
  outputSrj: SimpleRouteJson,
): SimpleRouteJson => {
  const preexistingTraces = inputSrj.traces ?? [];
  const solverTraces = outputSrj.traces ?? [];
  const combinedSrj: SimpleRouteJson = {
    ...outputSrj,
    traces: [...preexistingTraces, ...solverTraces],
  };

  return combinedSrj;
};

export const solveAndSnapshot = (
  srj: SimpleRouteJson,
  testPath: string,
  description: SnapshotDescription,
): {
  solver: AutoroutingPipelineSolver7_MultiGraph;
  outputSrj: SimpleRouteJson;
} => {
  const solver = new AutoroutingPipelineSolver7_MultiGraph(
    structuredClone(srj),
    { targetMinCapacity: 0.75, maxNodeDimension: 3, effort: 0.5 },
  );
  solver.solve();
  const outputSrj = solver.getOutputSimpleRouteJson();
  const inputSvg = getSvgFromGraphicsObject(convertSrjToGraphicsObject(srj), {
    backgroundColor: "white",
  });
  const outputSvg = getSvgFromGraphicsObject(
    convertSrjToGraphicsObject(outputSrj),
    { backgroundColor: "white" },
  );
  const combinedOutputSvg = getSvgFromGraphicsObject(
    convertSrjToGraphicsObject(getCombinedOutputSrj(srj, outputSrj)),
    { backgroundColor: "white" },
  );
  expect(
    stackSvgsVertically(
      [
        addTitleToSvg({
          svg: inputSvg,
          title: "Input: stored SRJ with preexisting traces",
          subtitle: description.problem,
        }),
        addTitleToSvg({
          svg: outputSvg,
          title: "Pipeline7 output: newly routed traces only",
          subtitle: description.expected,
        }),
        addTitleToSvg({
          svg: combinedOutputSvg,
          title: "Combined output: Pipeline7 output plus preexisting traces",
          subtitle: "This panel should show the full routed board state.",
        }),
      ],
      { normalizeSize: false },
    ),
  ).toMatchSvgSnapshot(testPath);

  return { solver, outputSrj };
};
