import type { GraphicsObject } from "graphics-debug";

const getNetColorForLabel = (
  label: string | undefined,
  colorMap: Record<string, string>,
): string | undefined => {
  if (!label) return undefined;

  return Object.entries(colorMap)
    .sort(([firstName], [secondName]) => secondName.length - firstName.length)
    .find(([connectionName]) => label.includes(connectionName))?.[1];
};

export const applyNetColorsToGraphicsObject = (
  graphics: GraphicsObject,
  colorMap: Record<string, string>,
): GraphicsObject => ({
  ...graphics,
  points: graphics.points?.map((point) => ({
    ...point,
    color: getNetColorForLabel(point.label, colorMap) ?? point.color,
  })),
  lines: graphics.lines?.map((line) => ({
    ...line,
    strokeColor: getNetColorForLabel(line.label, colorMap) ?? line.strokeColor,
  })),
  circles: graphics.circles?.map((circle) => {
    const color = getNetColorForLabel(circle.label, colorMap);
    return color ? { ...circle, fill: color, stroke: color } : circle;
  }),
});
