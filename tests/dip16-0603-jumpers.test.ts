import { expect, test } from "bun:test";
import { AssignableAutoroutingPipeline3 } from "../lib";
import { SimpleRouteJson } from "lib/types";
import { convertSrjToGraphicsObject } from "../lib";
import dip16CrossingTraces from "./repro/dip16-crossing-traces.json" with { type: "json" };

test.skip("dip16 single-layer with 0603 jumpers", async () => {
  const simpleSrj: SimpleRouteJson = {
    ...(dip16CrossingTraces as SimpleRouteJson),
    layerCount: 1,
    availableJumperTypes: ["0603"],
  };

  const solver = new AssignableAutoroutingPipeline3(simpleSrj);
  solver.solve();

  expect(solver.solved).toBe(true);

  // Check that nodes with crossings were detected
  const hdSolver = solver.highDensitySolver;
  const nodesWithCrossings = hdSolver?.nodesWithCrossings?.length ?? 0;
  console.log("Nodes with crossings:", nodesWithCrossings);
  expect(nodesWithCrossings).toBeGreaterThan(0);

  const result = solver.getOutputSimpleRouteJson();

  // Check that traces have proper route points
  let totalRoutePoints = 0;
  for (const trace of result.traces ?? []) {
    totalRoutePoints += trace.route?.length ?? 0;
  }
  console.log("Total route points:", totalRoutePoints);
  // With proper 0603 routing, we should have many route points (not just a few)
  expect(totalRoutePoints).toBeGreaterThan(500);

  // Check jumpers
  const jumpers = result.jumpers ?? [];
  console.log("Output jumpers:", jumpers.length);
  expect(jumpers.length).toBeGreaterThan(0);

  // Verify jumper structure
  for (const jumper of jumpers) {
    expect(jumper.jumper_footprint).toBe("0603");
    expect(jumper.center).toBeDefined();
    expect(jumper.pads).toBeDefined();
  }

  expect(convertSrjToGraphicsObject(result)).toMatchGraphicsSvg(
    import.meta.path,
  );
}, 120_000);
