export function doRectsOverlap(
  rect1: { center: { x: number; y: number }; width: number; height: number },
  rect2: { center: { x: number; y: number }; width: number; height: number },
) {
  const rect1Left = rect1.center.x - rect1.width / 2;
  const rect1Right = rect1.center.x + rect1.width / 2;
  const rect1Top = rect1.center.y - rect1.height / 2;
  const rect1Bottom = rect1.center.y + rect1.height / 2;

  const rect2Left = rect2.center.x - rect2.width / 2;
  const rect2Right = rect2.center.x + rect2.width / 2;
  const rect2Top = rect2.center.y - rect2.height / 2;
  const rect2Bottom = rect2.center.y + rect2.height / 2;

  return (
    rect1Left <= rect2Right &&
    rect1Right >= rect2Left &&
    rect1Top <= rect2Bottom &&
    rect1Bottom >= rect2Top
  );
}
