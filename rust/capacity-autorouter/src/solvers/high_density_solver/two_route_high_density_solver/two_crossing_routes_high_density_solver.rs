use serde::{Serialize,Deserialize};
use serde_json::{Value,json};
use indexmap::IndexMap;
use crate::bindings::high_density::specialized_base_solver::{BaseSolverState,SpecializedSolver};
use crate::bindings::high_density::specialized_utils::math::{Point,Bounds,SpecializedMath,distance,do_segments_intersect,min};
use super::compute_dumbbell_paths::compute_dumbbell_paths;
use super::find_circle_line_intersections::find_circle_line_intersections;

#[derive(Clone,Debug,Serialize,Deserialize)]
#[serde(rename_all="camelCase")]
pub struct Route{pub start_port:Value,pub end_port:Value,pub connection_name:String}
#[derive(Clone,Copy,Debug,Serialize,Deserialize)]
pub struct ViaPositions{pub via1:Point,pub via2:Point}
#[derive(Serialize,Deserialize)]
#[serde(rename_all="camelCase")]
pub struct TwoCrossingRoutesHighDensitySolver{
    #[serde(flatten)]pub base:BaseSolverState,
    pub node_with_port_points:Value,pub routes:Vec<Route>,pub via_diameter:f64,pub trace_thickness:f64,
    pub obstacle_margin:f64,pub layer_count:f64,pub debug_via_positions:Vec<ViaPositions>,pub escape_layer:f64,
    pub solved_routes:Vec<Value>,pub bounds:Bounds,#[serde(skip)]pub math:SpecializedMath,
}
impl TwoCrossingRoutesHighDensitySolver{
    pub fn new(params:Value)->Result<Self,String>{Self::new_with_math(params,SpecializedMath::default())}
    pub fn new_with_math(params:Value,math:SpecializedMath)->Result<Self,String>{
        let mut s=Self{base:BaseSolverState::default(),node_with_port_points:params["nodeWithPortPoints"].clone(),routes:vec![],via_diameter:params["viaDiameter"].as_f64().unwrap_or(0.3),trace_thickness:params["traceThickness"].as_f64().unwrap_or(0.15),obstacle_margin:params["obstacleMargin"].as_f64().unwrap_or(0.1),layer_count:params["layerCount"].as_f64().unwrap_or(2.0),debug_via_positions:vec![],escape_layer:1.0,solved_routes:vec![],bounds:Bounds::default(),math};
        s.routes=s.extract_routes_from_node()?;s.bounds=s.calculate_bounds();
        if s.routes.len()!=2{s.base.failed=true;s.base.error=Some(format!("Expected 2 routes, but got {}",s.routes.len()));return Ok(s);}
        if s.routes[0].start_port["z"]!=s.routes[0].end_port["z"]{s.base.failed=true;s.base.error=Some("Route A must start and end on the same layer".into());return Ok(s);}
        if s.routes[1].start_port["z"]!=s.routes[1].end_port["z"]{s.base.failed=true;s.base.error=Some("Route B must start and end on the same layer".into());return Ok(s);}
        if s.routes[0].start_port["z"]!=s.routes[1].start_port["z"]{s.base.failed=true;s.base.error=Some("Both routes must be on the same layer".into());return Ok(s);}
        s.escape_layer=if s.routes[0].start_port["z"].as_f64()==Some(0.0){1.0}else{0.0};Ok(s)
    }
    pub fn extract_routes_from_node(&self)->Result<Vec<Route>,String>{
        let mut groups:IndexMap<String,Vec<&Value>>=IndexMap::new();
        for p in self.node_with_port_points["portPoints"].as_array().ok_or("portPoints is required")?{groups.entry(p["connectionName"].as_str().ok_or("connectionName is required")?.to_owned()).or_default().push(p);}
        let mut routes=vec![];
        for (connection_name,points) in groups{if points.len()==2{let mut start_port=points[0].clone();let mut end_port=points[1].clone();start_port["z"]=json!(start_port["z"].as_f64().unwrap_or(0.0));end_port["z"]=json!(end_port["z"].as_f64().unwrap_or(0.0));routes.push(Route{start_port,end_port,connection_name});}}
        Ok(routes)
    }
    pub fn calculate_bounds(&self)->Bounds{
        let n=&self.node_with_port_points;let c=Point::from_value(&n["center"]);let w=n["width"].as_f64().unwrap_or(f64::NAN);let h=n["height"].as_f64().unwrap_or(f64::NAN);
        Bounds{min_x:c.x-w/2.0,max_x:c.x+w/2.0,min_y:c.y-h/2.0,max_y:c.y+h/2.0}
    }
    pub fn do_routes_cross(&self,a:&Route,b:&Route)->bool{do_segments_intersect(Point::from_value(&a.start_port),Point::from_value(&a.end_port),Point::from_value(&b.start_port),Point::from_value(&b.end_port))}
    pub fn calculate_via_positions(&self,route_a:&Route,route_b:&Route)->Option<ViaPositions>{
        let width=self.bounds.max_x-self.bounds.min_x-2.0*self.obstacle_margin-self.via_diameter;
        let height=self.bounds.max_y-self.bounds.min_y-2.0*self.obstacle_margin-self.via_diameter;
        let x=self.bounds.min_x+self.obstacle_margin+self.via_diameter/2.0;let y=self.bounds.min_y+self.obstacle_margin+self.via_diameter/2.0;
        let k=self.via_diameter+self.obstacle_margin;let a=Point::from_value(&route_b.start_port);let b=Point::from_value(&route_b.end_port);
        let corners=[Point{x,y},Point{x:x+width,y},Point{x:x+width,y:y+height},Point{x,y:y+height}];let mut candidates=vec![];
        for corner in corners{if distance(corner,a)>=k&&distance(corner,b)>=k{candidates.push(corner);}}
        for (ci,center) in [a,b].into_iter().enumerate(){for ei in 0..4{for p in find_circle_line_intersections(center,k,corners[ei],corners[(ei+1)%4]){if distance(p,if ci==0{b}else{a})>=k{candidates.push(p);}}}}
        if candidates.len()<2{
            let relaxed=k*0.8;
            for corner in corners{if distance(corner,a)>=relaxed&&distance(corner,b)>=relaxed&&!candidates.iter().any(|p|p.x==corner.x&&p.y==corner.y){candidates.push(corner);}}
            if candidates.len()<2{
                let mut sorted=corners.to_vec();sorted.sort_by(|a0,b0|{let ad=min(distance(*a0,a),distance(*a0,b));let bd=min(distance(*b0,a),distance(*b0,b));(bd-ad).partial_cmp(&0.0).unwrap_or(std::cmp::Ordering::Equal)});
                for corner in sorted{if !candidates.iter().any(|p|p.x==corner.x&&p.y==corner.y){candidates.push(corner);if candidates.len()>=2{break;}}}
            }
        }
        if candidates.len()<2{return None;}
        let mut max_dist=0.0;let mut pair=(candidates[0],candidates[1]);
        for i in 0..candidates.len(){for j in i+1..candidates.len(){let d=distance(candidates[i],candidates[j]);if d>max_dist{max_dist=d;pair=(candidates[i],candidates[j]);}}}
        if distance(pair.1,Point::from_value(&route_a.start_port))<distance(pair.0,Point::from_value(&route_a.start_port)){pair=(pair.1,pair.0);}
        Some(ViaPositions{via1:pair.0,via2:pair.1})
    }
    pub fn get_min_distance_between_via_centers(&self)->f64{self.via_diameter+self.trace_thickness+self.obstacle_margin*2.0}
    pub fn move_vias_as_close_as_possible(&self,v:ViaPositions)->ViaPositions{
        let required=self.get_min_distance_between_via_centers();let current=distance(v.via1,v.via2);if current<=required{return v;}
        let dx=v.via2.x-v.via1.x;let dy=v.via2.y-v.via1.y;let len=(dx*dx+dy*dy).sqrt();let nx=dx/len;let ny=dy/len;let move_distance=(current-required)/2.0;
        ViaPositions{via1:Point{x:v.via1.x+nx*move_distance,y:v.via1.y+ny*move_distance},via2:Point{x:v.via2.x-nx*move_distance,y:v.via2.y-ny*move_distance}}
    }
    pub fn push_vias_from_endpoints(&self,mut v:ViaPositions)->ViaPositions{
        let endpoints=[Point::from_value(&self.routes[0].start_port),Point::from_value(&self.routes[0].end_port),Point::from_value(&self.routes[1].start_port),Point::from_value(&self.routes[1].end_port)];
        let required=self.get_min_distance_between_via_centers();let endpoint_distance=self.via_diameter/2.0+self.trace_thickness*2.0+self.obstacle_margin*2.0;
        for iter in 0..10{
            let mut moved1=false;let mut moved2=false;let decay=(self.math.pow)(0.9,iter as f64);
            for p in endpoints{
                let d=distance(v.via1,p);if d<endpoint_distance{let push=(endpoint_distance-d)*decay;let dx=v.via1.x-p.x;let dy=v.via1.y-p.y;let norm=(dx*dx+dy*dy).sqrt();if norm>1e-6{v.via1.x+=(dx/norm)*push;v.via1.y+=(dy/norm)*push;moved1=true;}}
                let d=distance(v.via2,p);if d<endpoint_distance{let push=(endpoint_distance-d)*decay;let dx=v.via2.x-p.x;let dy=v.via2.y-p.y;let norm=(dx*dx+dy*dy).sqrt();if norm>1e-6{v.via2.x+=(dx/norm)*push;v.via2.y+=(dy/norm)*push;moved2=true;}}
            }
            let d=distance(v.via1,v.via2);if d<required{let push=(required-d)/2.0;let dx=v.via2.x-v.via1.x;let dy=v.via2.y-v.via1.y;let norm=(dx*dx+dy*dy).sqrt();if norm>1e-6{v.via1.x-=(dx/norm)*push;v.via1.y-=(dy/norm)*push;v.via2.x+=(dx/norm)*push;v.via2.y+=(dy/norm)*push;}else{v.via1.x-=push;v.via2.x+=push;}moved1=true;moved2=true;}
            if !moved1&&!moved2{break;}
        }
        let d=distance(v.via1,v.via2);if d<required{let push=(required-d)/2.0;let dx=v.via2.x-v.via1.x;let dy=v.via2.y-v.via1.y;let norm=(dx*dx+dy*dy).sqrt();if norm>1e-6{v.via1.x-=(dx/norm)*push;v.via1.y-=(dy/norm)*push;v.via2.x+=(dx/norm)*push;v.via2.y+=(dy/norm)*push;}else{v.via1.x-=push;v.via2.x+=push;}}
        v
    }
    fn solution(&self,route:&Route,points:Vec<Value>,vias:Vec<Value>)->Value{
        let mut out=json!({"connectionName":route.connection_name});if let Some(id)=self.node_with_port_points.get("capacityMeshNodeId"){out["regionId"]=id.clone();}
        out["route"]=json!(points);out["traceThickness"]=json!(self.trace_thickness);out["viaDiameter"]=json!(self.via_diameter);out["vias"]=json!(vias);out
    }
    pub fn try_solve_a_over_b(&mut self,a:&Route,b:&Route,swap_vias:bool)->bool{
        let Some(v)= (if swap_vias{self.calculate_via_positions(a,b)}else{self.calculate_via_positions(b,a)})else{return false;};
        self.debug_via_positions.push(v);let v=self.push_vias_from_endpoints(self.move_vias_as_close_as_possible(v));self.debug_via_positions.push(v);
        let paths=compute_dumbbell_paths(v.via1,v.via2,Point::from_value(&a.start_port),Point::from_value(&a.end_port),Point::from_value(&b.start_port),Point::from_value(&b.end_port),self.via_diameter/2.0+self.obstacle_margin+(self.trace_thickness/2.0)*1.5,self.obstacle_margin*2.0+(self.trace_thickness/2.0)*1.5,1.0);
        let Some(mut pair)=paths.j_pair else{return false;};
        let az=a.start_port["z"].as_f64().unwrap_or(0.0);let bz=b.start_port["z"].as_f64().unwrap_or(0.0);
        let a_points=paths.optimal_path.points.iter().map(|p|json!({"x":p.point.x,"y":p.point.y,"z":az})).collect();
        let a_solution=self.solution(a,a_points,vec![]);pair.line2.points.reverse();
        let mut b_points:Vec<Value>=pair.line1.points.iter().map(|p|json!({"x":p.point.x,"y":p.point.y,"z":bz})).collect();
        let mut p=serde_json::to_value(pair.line1.points.last().unwrap()).unwrap();p["z"]=json!(self.escape_layer);b_points.push(p);
        let mut p=serde_json::to_value(pair.line2.points[0]).unwrap();p["z"]=json!(self.escape_layer);b_points.push(p);
        b_points.extend(pair.line2.points.iter().map(|p|json!({"x":p.point.x,"y":p.point.y,"z":bz})));
        let b_solution=self.solution(b,b_points,vec![v.via1.to_value(),v.via2.to_value()]);self.solved_routes.push(a_solution);self.solved_routes.push(b_solution);true
    }
    pub fn handle_routes_dont_cross(&mut self){
        for r in &self.routes{let points=[&r.start_port,&r.end_port].into_iter().map(|p|json!({"x":p["x"],"y":p["y"],"z":p["z"].as_f64().unwrap_or(0.0)})).collect();self.solved_routes.push(self.solution(r,points,vec![]));}self.base.solved=true;
    }
    pub fn get_solved_routes(&self)->&[Value]{&self.solved_routes}
    pub fn visualize(&self)->Value{
        let mut lines=vec![];let mut points=vec![];let mut circles=vec![];
        let rects=vec![json!({"center":{"x":(self.bounds.min_x+self.bounds.max_x)/2.0,"y":(self.bounds.min_y+self.bounds.max_y)/2.0},"width":self.bounds.max_x-self.bounds.min_x,"height":self.bounds.max_y-self.bounds.min_y,"stroke":"rgba(0, 0, 0, 0.5)","fill":"rgba(240, 240, 240, 0.1)"})];
        for (name,r) in [("Route A",&self.routes[0]),("Route B",&self.routes[1])]{
            points.push(json!({"x":r.start_port["x"],"y":r.start_port["y"],"label":format!("{}\n{} start",name,r.connection_name),"color":"orange"}));
            points.push(json!({"x":r.end_port["x"],"y":r.end_port["y"],"label":format!("{}\n{} end",name,r.connection_name),"color":"orange"}));
            lines.push(json!({"points":[r.start_port,r.end_port],"strokeColor":"rgba(255, 0, 0, 0.5)","label":format!("{}\n{} direct",name,r.connection_name)}));
        }
        for (i,v) in self.debug_via_positions.iter().enumerate(){
            let color=["rgba(255, 165, 0, 0.3)","rgba(128, 0, 128, 0.3)"][i%2];
            circles.push(json!({"center":v.via1,"radius":self.via_diameter/2.0,"fill":color,"stroke":"rgba(0, 0, 0, 0.3)","label":format!("Computed Via A (attempt {})",i+1)}));
            circles.push(json!({"center":v.via2,"radius":self.via_diameter/2.0,"fill":color,"stroke":"rgba(0, 0, 0, 0.3)","label":format!("Computed Via B (attempt {})",i+1)}));
            for (number,via) in [(1,v.via1),(2,v.via2)]{circles.push(json!({"center":via,"radius":self.via_diameter/2.0+self.obstacle_margin,"stroke":color,"fill":"rgba(0, 0, 0, 0)","label":format!("Debug Via {} Safety Margin (attempt {})",number,i+1)}));}
            lines.push(json!({"points":[self.routes[i%2].start_port,v.via1.to_value(),v.via2.to_value(),self.routes[i%2].end_port],"strokeColor":color,"strokeDash":[5,5],"label":format!("Potential Route (attempt {})",i+1)}));
        }
        for (si,r) in self.solved_routes.iter().enumerate(){
            let color=if si%2==0{"rgba(0, 255, 0, 0.75)"}else{"rgba(255, 0, 255, 0.75)"};let route=r["route"].as_array().unwrap();
            for pair in route.windows(2){
                let mut line=json!({"points":pair,"strokeColor":color});if pair[0]["z"].as_f64()==Some(1.0){line["strokeDash"]=json!([0.2,0.2]);}line["strokeWidth"]=r["traceThickness"].clone();line["label"]=json!(format!("{} z={}",r["connectionName"].as_str().unwrap(),pair[0]["z"].as_f64().unwrap()));lines.push(line);
                if let Some(label)=pair[0].get("_label").filter(|v|!v.is_null()&&**v!=json!(false)&&**v!=json!("")){points.push(json!({"x":pair[0]["x"],"y":pair[0]["y"],"label":label}));}
            }
            for via in r["vias"].as_array().unwrap(){
                circles.push(json!({"center":via,"radius":self.via_diameter/2.0,"fill":"rgba(0, 0, 255, 0.8)","stroke":"black","label":"Solved Via"}));
                circles.push(json!({"center":via,"radius":self.via_diameter/2.0+self.obstacle_margin,"fill":"rgba(0, 0, 255, 0.3)","stroke":"black","label":"Solved Via Margin"}));
            }
        }
        json!({"lines":lines,"points":points,"rects":rects,"circles":circles})
    }
}
impl SpecializedSolver for TwoCrossingRoutesHighDensitySolver{
    fn base(&self)->&BaseSolverState{&self.base}
    fn base_mut(&mut self)->&mut BaseSolverState{&mut self.base}
    fn get_solver_name(&self)->&'static str{"TwoCrossingRoutesHighDensitySolver"}
    fn _step(&mut self)->Result<(),String>{
        if self.routes.len()!=2{self.base.failed=true;return Ok(());}
        let a=self.routes[0].clone();let b=self.routes[1].clone();
        if !self.do_routes_cross(&a,&b){self.handle_routes_dont_cross();return Ok(());}
        if self.try_solve_a_over_b(&a,&b,false)||self.try_solve_a_over_b(&b,&a,false)||self.try_solve_a_over_b(&a,&b,true)||self.try_solve_a_over_b(&b,&a,true){self.base.solved=true;return Ok(());}
        self.base.failed=true;self.base.error=Some("All crossover strategies failed".into());Ok(())
    }
}
