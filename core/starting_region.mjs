import { sha256 } from './util.mjs';
import { createLocationEntity } from './world_foundation.mjs';

export const STARTING_REGION=Object.freeze({
  packageContract:'ER_STARTING_REGION_PACKAGE_V1',
  connectionContract:'ER_LOCAL_CONNECTION_V1',
  spatialContract:'ER_STARTING_REGION_SPATIAL_MODEL_V1',
});

const ID=/^[a-z][a-z0-9_:-]{0,127}$/;
const PACKAGE_KEYS='connection_ids,contract_id,location_ids,package_id,provenance,spatial_model,starting_location_id,world_genesis_plan_id';
const CONNECTION_KEYS='access_rules,condition,connection_id,connection_type,contract_id,distance_scale,from_location_id,hazard_links,provenance,restrictions,to_location_id,travel_minutes,visibility_rules';
const SPATIAL_KEYS='contract_id,model_id,points,provenance,route_geometries,world_genesis_plan_id';

const systemProvenance=()=>({authority:'system',source:'starting_region_construction'});
const stableId=(prefix,campaignId,label)=>`${prefix}_${sha256(`${campaignId}|${prefix}|${label}`).slice(0,24)}`;
const round=value=>Number(value.toFixed(3));
const offset=(id,magnitude)=>{const hash=sha256(id),unit=part=>(parseInt(part,16)/0xffffffff)*2-1;return{x:round(unit(hash.slice(0,8))*magnitude),y:round(unit(hash.slice(8,16))*magnitude)}};

function entityPoint(state,entityId,memo=new Map()){
  if(memo.has(entityId))return memo.get(entityId);
  const entity=state.world_genesis.graph.entities[entityId];if(!entity)return null;
  if(entity.entity_type==='world'){const point={x:0,y:0};memo.set(entityId,point);return point;}
  const anchorId=entity.entity_type==='political_territory'&&entity.geographic_region_ids?.[0]?entity.geographic_region_ids[0]:entity.parent_entity_id;
  const anchor=entityPoint(state,anchorId,memo)||{x:0,y:0};
  const magnitude={geographic_region:320,political_territory:55,settlement:28,site:8,immediate_location:2}[entity.entity_type]??20;
  const delta=offset(`world-entity:${entityId}`,magnitude),point={x:round(anchor.x+delta.x),y:round(anchor.y+delta.y)};memo.set(entityId,point);return point;
}

function runtimePoint(state,locationId,points){
  let location=state.world.locations[locationId],depth=0;
  while(location&&!location.world_genesis_entity_id&&location.parent_location_id){location=state.world.locations[location.parent_location_id];depth+=1;}
  const anchor=location?.world_genesis_entity_id?points[location.world_genesis_entity_id]:null;if(!anchor)return null;
  const delta=offset(`runtime-location:${location.world_genesis_entity_id}:${state.world.locations[locationId].label}`,Math.max(.25,1/(depth+1)));
  return{x:round(anchor.x+delta.x),y:round(anchor.y+delta.y)};
}

function buildSpatialModel(state,locationIds,connections){
  const points={};
  for(const id of Object.keys(state.world_genesis.graph.entities).sort()){const point=entityPoint(state,id);if(point)points[id]=point;}
  for(const id of [...locationIds].sort()){const point=runtimePoint(state,id,points);if(point)points[id]=point;}
  const routeGeometries={};
  for(const [id,route] of Object.entries(state.world_genesis.graph.routes).sort(([a],[b])=>a.localeCompare(b))){const from=points[route.from_entity_id],to=points[route.to_entity_id];if(from&&to)routeGeometries[id]={kind:'polyline',from_subject_id:route.from_entity_id,to_subject_id:route.to_entity_id,points:[from,to],distance_km:route.distance,travel_minutes:route.travel_time_model.minutes,travel_mode:route.travel_time_model.mode};}
  for(const [id,connection] of Object.entries(connections).sort(([a],[b])=>a.localeCompare(b))){const from=points[connection.from_location_id],to=points[connection.to_location_id];if(from&&to)routeGeometries[id]={kind:'polyline',from_subject_id:connection.from_location_id,to_subject_id:connection.to_location_id,points:[from,to],distance_km:null,travel_minutes:connection.travel_minutes,travel_mode:connection.connection_type};}
  const core={contract_id:STARTING_REGION.spatialContract,world_genesis_plan_id:state.world_genesis.plan.plan_id,points,route_geometries:routeGeometries,provenance:{authority:'system',source:'starting_region_spatial_construction'}};
  return{...core,model_id:`spatial_model_${sha256(core).slice(0,24)}`};
}

function accessTokens(value,out=new Set()){
  if(typeof value==='string'&&value)out.add(value);
  else if(Array.isArray(value))for(const item of value)accessTokens(item,out);
  else if(value&&typeof value==='object')for(const item of Object.values(value))accessTokens(item,out);
  return out;
}

export function resolveLocalConnection(state,targetLocationId,{actorId='pc_1'}={}){
  if(actorId!=='pc_1')return{feasible:false,connection:null,reason:'Only the authoritative PC movement boundary is implemented.'};
  const connection=Object.values(state.world?.local_connections||{}).find(item=>item.from_location_id===state.pc.location_id&&item.to_location_id===targetLocationId)||null;
  if(!connection)return{feasible:false,connection:null,reason:'No authoritative directed local connection reaches that destination.'};
  if(connection.condition!=='open')return{feasible:false,connection,reason:`The local connection is ${connection.condition}.`};
  const tokens=accessTokens(state.pc.access_rights||[]);
  const missingAccess=connection.access_rules.filter(rule=>!tokens.has(rule));if(missingAccess.length)return{feasible:false,connection,reason:'The character lacks the required local access.'};
  const hidden=connection.visibility_rules.filter(rule=>!tokens.has(rule));if(hidden.length)return{feasible:false,connection,reason:'No known or perceived local connection reaches that destination.'};
  const blocked=connection.restrictions.filter(rule=>!tokens.has(rule)&&!tokens.has(`override:${rule}`));if(blocked.length)return{feasible:false,connection,reason:'The local connection is restricted.'};
  return{feasible:true,connection,reason:null};
}

function localConnection(state,label,from,to,{type='passage',minutes=2,scale='immediate',access=[],visibility=[],restrictions=[],hazards=[]}={}){
  return {
    contract_id:STARTING_REGION.connectionContract,
    connection_id:stableId('connection',state.meta.campaign_id,label),
    from_location_id:from,
    to_location_id:to,
    connection_type:type,
    distance_scale:scale,
    travel_minutes:minutes,
    access_rules:[...access],
    visibility_rules:[...visibility],
    condition:'open',
    restrictions:[...restrictions],
    hazard_links:[...hazards],
    provenance:systemProvenance(),
  };
}

export function constructStartingRegion(state){
  if(!state?.world_genesis?.snapshot_id)throw new Error('Starting Region construction requires committed World Genesis.');
  const startId=state.pc?.location_id,start=state.world?.locations?.[startId];
  if(!start)throw new Error('Starting Region construction requires a persistent PC starting location.');
  const concourse=createLocationEntity(state.meta.campaign_id,'Arrival Concourse',{parent_location_id:startId,source:'world_generation'});
  const civicWay=createLocationEntity(state.meta.campaign_id,'Rivergate Civic Way',{parent_location_id:startId,source:'world_generation'});
  for(const location of [concourse,civicWay]){
    state.world.locations[location.location_id]=location;
    state.world.fidelity.detail_by_location[location.location_id]=location.detail_fidelity;
  }
  const connections=[
    localConnection(state,'arrival-to-concourse',startId,concourse.location_id,{type:'doorway',minutes:1}),
    localConnection(state,'concourse-to-arrival',concourse.location_id,startId,{type:'doorway',minutes:1}),
    localConnection(state,'concourse-to-civic-way',concourse.location_id,civicWay.location_id,{type:'road',minutes:4,scale:'local'}),
    localConnection(state,'civic-way-to-concourse',civicWay.location_id,concourse.location_id,{type:'road',minutes:4,scale:'local'}),
  ];
  const core={
    contract_id:STARTING_REGION.packageContract,
    world_genesis_plan_id:state.world_genesis.plan.plan_id,
    starting_location_id:startId,
    location_ids:[startId,concourse.location_id,civicWay.location_id].sort(),
    connection_ids:connections.map(connection=>connection.connection_id).sort(),
    spatial_model:buildSpatialModel(state,[startId,concourse.location_id,civicWay.location_id],Object.fromEntries(connections.map(connection=>[connection.connection_id,connection]))),
    provenance:systemProvenance(),
  };
  state.starting_region={...core,package_id:stableId('starting_region',state.meta.campaign_id,sha256(core))};
  state.world.local_connections=Object.fromEntries(connections.map(connection=>[connection.connection_id,connection]));
  return state.starting_region;
}

export function commitStartingRegionLocation(state,locationId){
  const region=state?.starting_region;
  if(!region?.location_ids?.includes(locationId)||!state.world?.locations?.[locationId])throw new Error('Starting Situation selected a location outside the committed Starting Region.');
  region.starting_location_id=locationId;
  const {package_id,...core}=region;
  region.package_id=stableId('starting_region',state.meta.campaign_id,sha256(core));
  state.pc.location_id=locationId;
  return region;
}

export function validateStartingRegion(state){
  const region=state?.starting_region,connections=state?.world?.local_connections;
  if(!region||region.contract_id!==STARTING_REGION.packageContract)throw new Error('Unsupported Starting Region Package revision.');
  if(Object.keys(region).sort().join(',')!==PACKAGE_KEYS)throw new Error('Invalid Starting Region Package shape.');
  if(region.world_genesis_plan_id!==state.world_genesis?.plan?.plan_id)throw new Error('Starting Region Package authority binding mismatch.');
  if(!region.provenance||Object.keys(region.provenance).sort().join(',')!=='authority,source'||region.provenance.authority!=='system'||region.provenance.source!=='starting_region_construction')throw new Error('Starting Region Package must be system-owned.');
  if(!Array.isArray(region.location_ids)||!Array.isArray(region.connection_ids)||!connections||typeof connections!=='object')throw new Error('Starting Region topology is invalid.');
  const locationIds=[...region.location_ids];
  if(JSON.stringify(locationIds)!==JSON.stringify([...new Set(locationIds)].sort())||!locationIds.includes(region.starting_location_id))throw new Error('Starting Region locations must be unique, sorted, and contain the PC start.');
  for(const id of locationIds)if(!state.world.locations[id])throw new Error(`Starting Region references unknown location ${id}.`);
  const connectionIds=Object.keys(connections).sort();
  if(JSON.stringify(region.connection_ids)!==JSON.stringify(connectionIds))throw new Error('Starting Region connection index diverges from authoritative topology.');
  for(const [id,connection] of Object.entries(connections)){
    if(!connection||connection.contract_id!==STARTING_REGION.connectionContract||connection.connection_id!==id||!ID.test(id)||Object.keys(connection).sort().join(',')!==CONNECTION_KEYS)throw new Error(`Invalid local connection ${id}.`);
    if(!locationIds.includes(connection.from_location_id)||!locationIds.includes(connection.to_location_id)||connection.from_location_id===connection.to_location_id)throw new Error(`Local connection ${id} has invalid endpoints.`);
    if(!Number.isFinite(connection.travel_minutes)||connection.travel_minutes<=0||typeof connection.distance_scale!=='string'||!connection.distance_scale||typeof connection.connection_type!=='string'||!connection.connection_type)throw new Error(`Local connection ${id} has invalid movement metrics.`);
    for(const key of ['access_rules','visibility_rules','restrictions','hazard_links'])if(!Array.isArray(connection[key]))throw new Error(`Local connection ${id} has invalid ${key}.`);
    if(!connection.provenance||Object.keys(connection.provenance).sort().join(',')!=='authority,source'||connection.provenance.authority!=='system'||connection.provenance.source!=='starting_region_construction')throw new Error(`Local connection ${id} must be system-owned.`);
  }
  const spatial=region.spatial_model;
  if(!spatial||Object.keys(spatial).sort().join(',')!==SPATIAL_KEYS||spatial.contract_id!==STARTING_REGION.spatialContract||spatial.world_genesis_plan_id!==state.world_genesis.plan.plan_id||spatial.provenance?.authority!=='system'||spatial.provenance?.source!=='starting_region_spatial_construction')throw new Error('Invalid authoritative Starting Region spatial model.');
  const expectedSpatial=buildSpatialModel(state,locationIds,connections);
  if(JSON.stringify(spatial)!==JSON.stringify(expectedSpatial))throw new Error('Starting Region spatial model diverges from deterministic authoritative geometry.');
  const {package_id,...core}=region;
  if(package_id!==stableId('starting_region',state.meta.campaign_id,sha256(core)))throw new Error('Starting Region Package integrity mismatch.');
  return true;
}
