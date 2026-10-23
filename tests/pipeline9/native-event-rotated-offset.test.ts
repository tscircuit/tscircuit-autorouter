import { test, expect } from "bun:test"
import { segmentToBoundsMinDistance } from "@tscircuit/math-utils"
import { nativeOffsetOutline, firstNativeContact } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/clearanceExperimental/createNativeObstacleEventSearch"
test("rotated rectangle uses rounded native offset with outward safe chords", () => {
 const angle=Math.PI/4,cos=Math.cos(angle),sin=Math.sin(angle)
 const barrier={a:{x:0,y:0,z:0},b:{x:0,y:0,z:0},radius:0,minZ:0,maxZ:0,rect:{width:1,height:1,rotation:angle},rectCos:cos,rectSin:sin}
 const stats={experimentalEventHullTests:0,experimentalEventOutlineVertices:0,experimentalEventMaximumOffsetError:0}
 const points=nativeOffsetOutline(barrier,0.15,0.001,stats)
 const local=(p:{x:number;y:number}):{x:number;y:number}=>({x:p.x*cos+p.y*sin,y:-p.x*sin+p.y*cos})
 for(let i=0;i<points.length;i++)expect(segmentToBoundsMinDistance(local(points[i]!),local(points[(i+1)%points.length]!),{minX:-0.5,maxX:0.5,minY:-0.5,maxY:0.5})).toBeGreaterThanOrEqual(0.15-1e-8)
 expect(firstNativeContact({x:-2,y:0},{x:2,y:0},barrier,0.15)).toBeCloseTo((2-Math.SQRT1_2-0.15)/4,10)
})
