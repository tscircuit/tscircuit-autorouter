declare module "cdt2d" {
  function cdt2d(
    points: [number, number][],
    edges?: [number, number][],
    options?: {
      delaunay?: boolean;
      interior?: boolean;
      exterior?: boolean;
      infinity?: boolean;
    },
  ): [number, number, number][];
  export = cdt2d;
}

declare module "react-konva" {
  import type * as React from "react";

  export const Stage: React.ComponentType<any>;
  export const Layer: React.ComponentType<any>;
  export const Circle: React.ComponentType<any>;
  export const Line: React.ComponentType<any>;
  export const Text: React.ComponentType<any>;
}
