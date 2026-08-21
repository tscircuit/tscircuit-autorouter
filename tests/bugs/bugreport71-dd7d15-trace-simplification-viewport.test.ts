import { expect, test } from "bun:test";
import { getSvgFromGraphicsObject } from "graphics-debug";
import { AutoroutingPipelineSolver } from "lib";
import type { SimpleRouteJson } from "lib/types";
import bugReport from "../../fixtures/bug-reports/bugreport71-dd7d15/bugreport71-dd7d15.json" with { type: "json" };

type Point = {
  x: number;
  y: number;
};

type DataPixelPair = {
  data: Point;
  pixel: Point;
};

type SectionView = {
  center: Point;
  size: number;
};

const srj = bugReport.simple_route_json as SimpleRouteJson;
const traceSimplificationViaView: SectionView = {
  center: { x: 4.46, y: 25.5 },
  size: 10,
};

function cropSvgToSectionView(svg: string, sectionView: SectionView): string {
  const pairs: DataPixelPair[] = [];
  const polylinePattern =
    /<polyline\b[^>]*\bdata-points="([^"]+)"[^>]*\bpoints="([^"]+)"/g;

  for (const match of svg.matchAll(polylinePattern)) {
    const dataPoints = match[1]!.split(" ");
    const pixelPoints = match[2]!.split(" ");
    const pairCount = Math.min(dataPoints.length, pixelPoints.length);
    for (let pointIndex = 0; pointIndex < pairCount; pointIndex++) {
      const [dataX, dataY] = dataPoints[pointIndex]!.split(",").map(Number);
      const [pixelX, pixelY] = pixelPoints[pointIndex]!.split(",").map(Number);
      if (
        Number.isFinite(dataX) &&
        Number.isFinite(dataY) &&
        Number.isFinite(pixelX) &&
        Number.isFinite(pixelY)
      ) {
        pairs.push({
          data: { x: dataX!, y: dataY! },
          pixel: { x: pixelX!, y: pixelY! },
        });
      }
    }
  }

  if (pairs.length === 0) {
    throw new Error("Unable to infer SVG data-to-pixel transform");
  }

  const xPairA = pairs[0]!;
  const xPairB = pairs.find(
    (pair) => Math.abs(pair.data.x - xPairA.data.x) > 1e-9,
  );
  const yPairA = pairs[0]!;
  const yPairB = pairs.find(
    (pair) => Math.abs(pair.data.y - yPairA.data.y) > 1e-9,
  );

  if (!xPairB || !yPairB) {
    throw new Error("Unable to infer SVG data-to-pixel transform");
  }

  const scaleX =
    (xPairB.pixel.x - xPairA.pixel.x) / (xPairB.data.x - xPairA.data.x);
  const scaleY =
    (yPairB.pixel.y - yPairA.pixel.y) / (yPairB.data.y - yPairA.data.y);
  const offsetX = xPairA.pixel.x - scaleX * xPairA.data.x;
  const offsetY = yPairA.pixel.y - scaleY * yPairA.data.y;
  const halfSize = sectionView.size / 2;
  const sectionLeft = sectionView.center.x - halfSize;
  const sectionRight = sectionView.center.x + halfSize;
  const sectionBottom = sectionView.center.y - halfSize;
  const sectionTop = sectionView.center.y + halfSize;
  const pixelLeft = scaleX * sectionLeft + offsetX;
  const pixelRight = scaleX * sectionRight + offsetX;
  const pixelBottom = scaleY * sectionBottom + offsetY;
  const pixelTop = scaleY * sectionTop + offsetY;
  const viewBoxX = Math.min(pixelLeft, pixelRight);
  const viewBoxY = Math.min(pixelBottom, pixelTop);
  const viewBoxWidth = Math.abs(pixelRight - pixelLeft);
  const viewBoxHeight = Math.abs(pixelTop - pixelBottom);

  return svg.replace(
    /viewBox="[^"]+"/,
    `viewBox="${viewBoxX} ${viewBoxY} ${viewBoxWidth} ${viewBoxHeight}"`,
  );
}

test("bugreport71 trace simplification shows nearby vias around 4.46,25.50", () => {
  const solver = new AutoroutingPipelineSolver(structuredClone(srj));
  solver.solveUntilPhase("traceSimplificationSolver");

  while (solver.getCurrentPhase() === "traceSimplificationSolver") {
    solver.step();
    if (solver.failed) {
      throw new Error(solver.error ?? "Trace simplification pipeline failed");
    }
  }

  const traceSimplificationSolver = solver.traceSimplificationSolver;
  if (!traceSimplificationSolver) {
    throw new Error("Trace simplification solver did not run");
  }

  const traceSimplificationGraphics = traceSimplificationSolver.visualize();
  const nearbyVias = (traceSimplificationGraphics.circles ?? []).filter(
    (circle) =>
      Math.abs(circle.center.x - traceSimplificationViaView.center.x) <=
        traceSimplificationViaView.size / 2 &&
      Math.abs(circle.center.y - traceSimplificationViaView.center.y) <=
        traceSimplificationViaView.size / 2,
  );
  expect(nearbyVias.length).toBeGreaterThanOrEqual(2);

  const traceSimplificationSvg = getSvgFromGraphicsObject(
    traceSimplificationGraphics,
    { backgroundColor: "white" },
  );
  expect(
    cropSvgToSectionView(traceSimplificationSvg, traceSimplificationViaView),
  ).toMatchSvgSnapshot(import.meta.path);
});
