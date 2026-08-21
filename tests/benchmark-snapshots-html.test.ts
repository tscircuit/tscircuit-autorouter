import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "bun:test";
import { createBenchmarkSnapshotWriter } from "../scripts/benchmark/index";

test("benchmark snapshot HTML shows counts and keeps the SVG background aligned", async () => {
  const directory = await mkdtemp(join(tmpdir(), "benchmark-snapshots-"));
  const htmlPath = join(directory, "benchmark-snapshots.html");

  try {
    const writer = await createBenchmarkSnapshotWriter(htmlPath);
    await writer.writeSnapshot({
      datasetName: "dataset-srj23",
      solverName: "TestSolver",
      scenarioName: "circuit42",
      sampleNumber: 42,
      label: "dataset-srj23 sample 42 - TestSolver",
      elapsedTimeMs: 1250,
      traceCount: 17,
      viaCount: 3,
      relaxedDrcPassed: false,
      drcErrorCount: 2,
      imageSvg:
        '<svg width="640" height="640" viewBox="-10 -20 640 320"><rect width="100%" height="100%" fill="white"/><g><circle data-type="point" data-label="source_trace_0 (top)" cx="10" cy="10" r="3" /></g><g><polyline data-type="line" points="0,0 10,10" /></g></svg>',
    });
    await writer.finish();

    const html = await readFile(htmlPath, "utf8");
    expect(html).toContain("<dt>Trace Count</dt><dd>17</dd>");
    expect(html).toContain("<dt>DRC Issue Count</dt><dd>2</dd>");
    expect(html).toContain('<polyline data-type="line"');
    expect(html).not.toContain('data-type="point"');
    expect(html).toContain(
      '<rect x="-10" y="-20" width="640" height="320" fill="white"/>',
    );
    expect(html).not.toContain('<rect width="100%" height="100%"');
    expect(html).toContain("state.svg.setAttribute(");
    expect(html).toContain('"viewBox"');
    expect(html).toContain(".snapshot-viewer.is-full-size");
    expect(html).not.toContain("requestFullscreen");
    expect(html).not.toContain("document.fullscreen");
    expect(html).not.toContain("<img");
    const script = html.match(/<script>([\s\S]*?)<\/script>/)?.[1];
    expect(script).toBeDefined();
    expect(() => new Function(script!)).not.toThrow();
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
