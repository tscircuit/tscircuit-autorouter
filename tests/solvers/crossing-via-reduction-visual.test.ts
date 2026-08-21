import { expect, test } from "bun:test";
import { ConnectivityMap } from "circuit-json-to-connectivity-map";
import { getSvgFromGraphicsObject, type GraphicsObject } from "graphics-debug";
import { CrossingViaReductionSolver } from "lib/solvers/CrossingViaReductionSolver/crossing-via-reduction-solver";
import { stackSvgsHorizontally } from "stack-svgs";
import { createCrossingViaReductionRoutes } from "tests/fixtures/crossing-via-reduction-routes";

const addPanelHeader = ({
  svg,
  title,
  details,
}: {
  svg: string;
  title: string;
  details: [string, string];
}): string => {
  const headerHeight = 76;
  const bodyStart = svg.indexOf(">") + 1;
  const bodyEnd = svg.lastIndexOf("</svg>");
  const width = Number(svg.match(/\bwidth="([^"]+)"/)?.[1] ?? 500);
  const height = Number(svg.match(/\bheight="([^"]+)"/)?.[1] ?? 620);
  return `<svg width="${width}" height="${
    height + headerHeight
  }" viewBox="0 0 ${width} ${
    height + headerHeight
  }" xmlns="http://www.w3.org/2000/svg"><rect width="100%" height="100%" fill="white"/><text x="16" y="22" font-family="monospace" font-size="15" font-weight="700" fill="#111">${title}</text><text x="16" y="43" font-family="monospace" font-size="12" fill="#444">${details[0]}</text><text x="16" y="61" font-family="monospace" font-size="12" fill="#444">${details[1]}</text><g transform="translate(0 ${headerHeight})">${svg.slice(
    bodyStart,
    bodyEnd,
  )}</g></svg>`;
};

test("visualizes the Pipeline7 crossing via reduction", () => {
  const solver = new CrossingViaReductionSolver({
    inputHdRoutes: createCrossingViaReductionRoutes(),
    obstacles: [],
    connMap: new ConnectivityMap({
      detour_net: ["detour"],
      transition_net: ["transition"],
    }),
    layerCount: 2,
  });
  const beforeGraphics = solver.visualize();

  solver.solve();

  const renderFrame = (graphics: GraphicsObject): string => {
    return getSvgFromGraphicsObject(graphics, {
      backgroundColor: "#0d1b2a",
      svgWidth: 500,
      svgHeight: 620,
      hideInlineLabels: true,
    });
  };
  expect(
    stackSvgsHorizontally(
      [
        addPanelHeader({
          svg: renderFrame(beforeGraphics),
          title: "BEFORE • 3 VIAS",
          details: [
            "The vertical trace changes layers twice to cross.",
            "The horizontal trace already has one transition via.",
          ],
        }),
        addPanelHeader({
          svg: renderFrame(solver.visualize()),
          title: "AFTER • 1 VIA",
          details: [
            "The vertical trace stays on its terminal layer.",
            "The existing via moves beyond the crossing clearance.",
          ],
        }),
      ],
      { gap: 12, normalizeSize: false },
    ),
  ).toMatchSvgSnapshot(import.meta.path);
});
