import { expect, test } from "bun:test";
import { lockHdRouteTerminals } from "lib/autorouter-pipelines/AutoroutingPipeline7_MultiGraph/lock-hd-route-terminals";
import type { SimpleRouteConnection } from "lib/types";
import type { HighDensityRoute } from "lib/types/high-density-types";

test("Pipeline7 locks direct and reversed PCB terminal endpoints", () => {
  const connections: SimpleRouteConnection[] = [
    {
      name: "direct",
      pointsToConnect: [
        { x: 0, y: 0, layer: "top", pcb_port_id: "pcb_port_a" },
        { x: 2, y: 0, layer: "top", pcb_port_id: "pcb_port_b" },
      ],
    },
    {
      name: "reversed",
      pointsToConnect: [
        { x: 10, y: 0, layer: "top", pcb_port_id: "pcb_port_c" },
        { x: 12, y: 0, layer: "top", pcb_port_id: "pcb_port_d" },
      ],
    },
  ];
  const makeRoute = (
    connectionName: string,
    startX: number,
    endX: number,
    startPcbPortId: string,
    endPcbPortId: string,
  ): HighDensityRoute => ({
    connectionName,
    startPcbPortId,
    endPcbPortId,
    traceThickness: 0.15,
    viaDiameter: 0.3,
    route: [
      { x: startX, y: 0, z: 0 },
      { x: endX, y: 0, z: 0 },
    ],
    vias: [],
  });

  const identityRoutes = [
    makeRoute("direct", 0.03, 1.96, "pcb_port_a", "pcb_port_b"),
    makeRoute("reversed", 11.97, 10.04, "pcb_port_d", "pcb_port_c"),
  ];
  const routesAfterSimplification = identityRoutes.map(
    ({ startPcbPortId: _start, endPcbPortId: _end, ...route }) => route,
  );
  const [direct, reversed] = lockHdRouteTerminals(
    routesAfterSimplification,
    connections,
    new Map(identityRoutes.map((route) => [route.connectionName, route])),
  );

  expect(direct?.route).toEqual([
    { x: 0, y: 0, z: 0, pcb_port_id: "pcb_port_a" },
    { x: 2, y: 0, z: 0, pcb_port_id: "pcb_port_b" },
  ]);
  expect(reversed?.route).toEqual([
    { x: 12, y: 0, z: 0, pcb_port_id: "pcb_port_d" },
    { x: 10, y: 0, z: 0, pcb_port_id: "pcb_port_c" },
  ]);

  const [identitySwapped] = lockHdRouteTerminals(
    [makeRoute("direct", 0.03, 1.96, "pcb_port_b", "pcb_port_a")],
    connections,
  );
  expect(identitySwapped!.route).toEqual([
    { x: 2, y: 0, z: 0, pcb_port_id: "pcb_port_b" },
    { x: 0, y: 0, z: 0, pcb_port_id: "pcb_port_a" },
  ]);

  expect(() =>
    lockHdRouteTerminals(
      [makeRoute("direct", 0.03, 1.96, "unknown", "pcb_port_b")],
      connections,
    ),
  ).toThrow("route endpoint IDs do not match connection terminal IDs");
  expect(() =>
    lockHdRouteTerminals(
      [makeRoute("missing", 0.03, 1.96, "pcb_port_a", "pcb_port_b")],
      connections,
    ),
  ).toThrow('connection "missing" was not found');
});
