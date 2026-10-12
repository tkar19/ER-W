import { sha256 } from './util.mjs';
import { validateGeographicKnowledge } from './geographic_knowledge.mjs';
import { validateStartingRegion } from './starting_region.mjs';

export const PLAYER_MAP=Object.freeze({projectionContract:'ER_PLAYER_MAP_PROJECTION_V1'});

const authoritativePoint=(state,subjectId)=>state.starting_region?.spatial_model?.points?.[subjectId]||null;

function subjectPoint(state,record){
  if(record.subject_kind==='location'||record.subject_kind==='world_entity')return authoritativePoint(state,record.canonical_subject_id);
  return null;
}

function scaleFor(state,record){
  if(record.subject_kind==='location')return 'interior';
  if(record.subject_kind==='institution')return 'site';
  if(record.subject_kind==='route'){
    const connection=state.world.local_connections?.[record.canonical_subject_id];
    if(connection)return connection.distance_scale==='immediate'?'interior':'site';
    return 'regional';
  }
  if(record.subject_kind==='reported_claim')return 'regional';
  const type=state.world_genesis.graph.entities[record.canonical_subject_id]?.entity_type;
  return {world:'regional',geographic_region:'regional',political_territory:'regional',settlement:'settlement',site:'site',immediate_location:'interior'}[type]||'regional';
}

function exactKnownSubjects(records){
  return new Set(records.filter(record=>record.precision==='exact'&&record.canonical_subject_id!==null).map(record=>record.canonical_subject_id));
}

function exactRouteGeometry(state,record,exactSubjects){
  const geometry=state.starting_region?.spatial_model?.route_geometries?.[record.canonical_subject_id];
  if(!geometry||!exactSubjects.has(geometry.from_subject_id)||!exactSubjects.has(geometry.to_subject_id))return null;
  return {kind:geometry.kind,points:structuredClone(geometry.points),distance_km:geometry.distance_km,travel_minutes:geometry.travel_minutes,travel_mode:geometry.travel_mode};
}

function geometryFor(state,record,exactSubjects){
  if(record.precision==='exact'){
    if(record.subject_kind==='route')return exactRouteGeometry(state,record,exactSubjects);
    const point=subjectPoint(state,record);return point?{kind:'point',point:structuredClone(point)}:null;
  }
  if(record.precision==='approximate')return {kind:'approximate_area',direction_band:record.approximate_area.direction_band,distance_band:record.approximate_area.distance_band};
  return null;
}

export function projectPlayerMap(state){
  validateStartingRegion(state);
  validateGeographicKnowledge(state);
  const records=Object.values(state.geographic_knowledge.records).sort((a,b)=>a.knowledge_id.localeCompare(b.knowledge_id));
  const exactSubjects=exactKnownSubjects(records);
  const features=records.map(record=>({
    feature_id:`map_${record.knowledge_id}`,
    knowledge_id:record.knowledge_id,
    canonical_subject_id:record.canonical_subject_id,
    label:record.reported_subject_label,
    subject_kind:record.subject_kind,
    scale:scaleFor(state,record),
    precision:record.precision,
    confidence:record.confidence,
    epistemic_status:record.epistemic_status,
    source_type:record.source_type,
    geometry:geometryFor(state,record,exactSubjects),
    provenance:{authority:'derived_projection',source:'player_geographic_knowledge'},
  }));
  const current=records.find(record=>record.subject_kind==='location'&&record.canonical_subject_id===state.pc.location_id&&record.precision==='exact');
  const core={contract_id:PLAYER_MAP.projectionContract,viewpoint_id:'pc_1',knowledge_package_id:state.geographic_knowledge.package_id,current_position_feature_id:current?`map_${current.knowledge_id}`:null,features,available_scales:['regional','settlement','site','interior'],provenance:{authority:'derived_projection',source:'player_map_renderer'}};
  return {...core,projection_id:`player_map_${sha256(core).slice(0,24)}`};
}
