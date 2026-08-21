import { describe, expect, test } from "bun:test";
import { SCALE } from "lib/testing/capacity-node-editor/constants";
import {
  CAPACITY_NODE_EDITOR_VIEW_PADDING_PX,
  getInitialCapacityNodeEditorView,
} from "lib/testing/capacity-node-editor/getInitialCapacityNodeEditorView";

describe("getInitialCapacityNodeEditorView", () => {
  test("centers a node at the default editor scale when the viewport is large enough", () => {
    const result = getInitialCapacityNodeEditorView({
      nodeWithPortPoints: {
        width: 2,
        height: 3,
      },
      viewportWidth: 1200,
      viewportHeight: 1000,
    });

    expect(result.pixelsPerMm).toBe(SCALE);
    expect(result.rect.width).toBe(300);
    expect(result.rect.height).toBe(450);
    expect(result.rect.x + result.rect.width / 2).toBe(600);
    expect(result.rect.y + result.rect.height / 2).toBe(500);
  });

  test("scales the node down to fit inside the viewport padding while keeping it centered", () => {
    const result = getInitialCapacityNodeEditorView({
      nodeWithPortPoints: {
        width: 1.65001,
        height: 6.568796,
      },
      viewportWidth: 800,
      viewportHeight: 600,
    });

    expect(result.pixelsPerMm).toBeLessThan(SCALE);
    expect(result.rect.x).toBeGreaterThanOrEqual(
      CAPACITY_NODE_EDITOR_VIEW_PADDING_PX,
    );
    expect(result.rect.y).toBeGreaterThanOrEqual(
      CAPACITY_NODE_EDITOR_VIEW_PADDING_PX,
    );
    expect(result.rect.x + result.rect.width / 2).toBeCloseTo(400, 6);
    expect(result.rect.y + result.rect.height / 2).toBeCloseTo(300, 6);
    expect(result.rect.height).toBeLessThanOrEqual(
      600 - CAPACITY_NODE_EDITOR_VIEW_PADDING_PX * 2,
    );
  });
});
