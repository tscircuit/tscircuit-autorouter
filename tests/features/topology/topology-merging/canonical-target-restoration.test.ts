import { createRectFromCapacityNode } from "lib/utils/createRectFromCapacityNode"
import { expect, test } from "bun:test"
import { createTopologyMergingTestNode, solveTopologyMergingTestGroups } from "../../../fixtures/topology-merging-test-utils"
test("canonical coordinate rounding does not fragment a fully covered authoritative target", () => {
  const target={...createTopologyMergingTestNode({id:"target",bounds:{minX:0,maxX:2,minY:0,maxY:2},availableZ:[0,1,2,3]}),_containsTarget:true,_containsObstacle:true,_targetConnectionName:"power"}
  const nodes=solveTopologyMergingTestGroups([
    {groupId:"global",isComponent:false,nodes:[target]},
    {groupId:"component",isComponent:true,nodes:[createTopologyMergingTestNode({id:"unrelated",bounds:{minX:2-5e-6,maxX:3,minY:10,maxY:12},availableZ:[0]})]},
  ])
  expect({title:"Canonical rounding preserves a full four-layer target",rects:nodes.map(node=>createRectFromCapacityNode(node))}).toMatchGraphicsSvg(import.meta.path)
  expect(nodes.find(node=>node.capacityMeshNodeId==="target")).toMatchObject({...target,layer:"z0,1,2,3"})
})
