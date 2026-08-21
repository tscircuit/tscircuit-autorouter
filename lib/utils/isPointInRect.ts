export function isPointInRect(
  point: { x: number; y: number },
  rect: { center: { x: number; y: number }; width: number; height: number },
) {
  return (
    point.x >= rect.center.x - rect.width / 2 &&
    point.x <= rect.center.x + rect.width / 2 &&
    point.y >= rect.center.y - rect.height / 2 &&
    point.y <= rect.center.y + rect.height / 2
  );
}
