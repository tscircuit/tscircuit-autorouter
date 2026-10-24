declare module "cdt2d" {
  type Options = { delaunay?: boolean; interior?: boolean; exterior?: boolean; infinity?: boolean }
  const cdt2d: (points: Array<[number, number]>, edges: Array<[number, number]>, options: Options) => Array<[number, number, number]>
  export default cdt2d
}
