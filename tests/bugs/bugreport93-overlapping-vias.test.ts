import { expect, test } from "bun:test";
import {
  type Circle,
  getSvgFromGraphicsObject,
  mergeGraphics,
  type Point,
} from "graphics-debug";
import { AutoroutingPipelineSolver } from "lib";
import type { SimpleRouteJson } from "lib/types";
import { convertSrjToGraphicsObject } from "lib/utils/convertSrjToGraphicsObject";
import reportedRoutingJson from "../../fixtures/bug-reports/bugreport93-overlapping-vias/bugreport93-overlapping-vias.output.json" with { type: "json" };
import srjJson from "../../fixtures/bug-reports/bugreport93-overlapping-vias/bugreport93-overlapping-vias.srj.json" with { type: "json" };

type DataPixelPair = {
  data: Point;
  pixel: Point;
};

type SectionView = {
  center: Point;
  size: number;
};

type ReportedVia = Point & {
  route_type: "via";
  via_diameter: number;
};

type ReportedRouting = {
  traces: Array<{
    route: Array<ReportedVia | (Point & { route_type: string })>;
  }>;
};

const srj = srjJson as SimpleRouteJson;
const reportedRouting = reportedRoutingJson as ReportedRouting;
const reportedViaCenters: [Point, Point] = [
  { x: 6.539759205507837, y: 4.785714942455886 },
  { x: 6.19058496529081, y: 4.298298490400989 },
];
const badViaClearanceView: SectionView = {
  center: { x: 6.365172085399324, y: 4.542006716428438 },
  size: 3.2,
};
const reportedOutputSrj = {
  ...structuredClone(srj),
  traces: reportedRouting.traces,
} as SimpleRouteJson;

function getReportedVia(center: Point): ReportedVia {
  const reportedVia = reportedRouting.traces
    .flatMap((trace) => trace.route)
    .find(
      (routePoint): routePoint is ReportedVia =>
        routePoint.route_type === "via" &&
        Math.abs(routePoint.x - center.x) < 1e-9 &&
        Math.abs(routePoint.y - center.y) < 1e-9,
    );

  if (!reportedVia) {
    throw new Error(`Unable to find reported via at ${center.x},${center.y}`);
  }
  return reportedVia;
}

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

test.skip("bugreport93 reproduces overlapping vias near the reported DRC location", () => {
  const solver = new AutoroutingPipelineSolver(structuredClone(srj));
  solver.solve();

  expect(solver.failed).toBe(false);
  expect(solver.solved).toBe(true);
  const [viaA, viaB] = reportedViaCenters.map(getReportedVia);
  const centerDistance = Math.hypot(viaA.x - viaB.x, viaA.y - viaB.y);
  const requiredCenterSpacing =
    (viaA.via_diameter + viaB.via_diameter) / 2 +
    srjJson.minPadEdgeToPadEdgeClearance;
  const errorCircles: Circle[] = [
    {
      center: badViaClearanceView.center,
      radius: 0.75,
      stroke: "red",
      fill: "rgba(255, 0, 0, 0.25)",
      label: `Via centers are ${centerDistance.toFixed(3)}mm apart; ${requiredCenterSpacing.toFixed(3)}mm required`,
    },
  ];
  const annotatedOutput = mergeGraphics(
    convertSrjToGraphicsObject(reportedOutputSrj),
    { circles: errorCircles },
  );
  const annotatedSvg = getSvgFromGraphicsObject(annotatedOutput, {
    backgroundColor: "white",
  });

  expect(centerDistance).toBeLessThan(requiredCenterSpacing);
  expect(
    cropSvgToSectionView(annotatedSvg, badViaClearanceView),
  ).toMatchSvgSnapshot(import.meta.path);
});
