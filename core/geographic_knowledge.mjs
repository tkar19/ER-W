import { sha256 } from './util.mjs';

export const GEOGRAPHIC_KNOWLEDGE=Object.freeze({
  packageContract:'ER_GEOGRAPHIC_KNOWLEDGE_PACKAGE_V1',
  recordContract:'ER_GEOGRAPHIC_KNOWLEDGE_V1',
});

const PACKAGE_KEYS='contract_id,package_id,provenance,records,viewpoint_id,world_genesis_plan_id';
const RECORD_KEYS='approximate_area,canonical_subject_id,confidence,contract_id,epistemic_status,knowledge_id,last_confirmed_generation,learned_at_generation,precision,provenance,reported_subject_label,source_id,source_type,subject_kind';
const AREA_KEYS='center_subject_id,direction_band,distance_band';
const PROVENANCE_KEYS='authority,source';
const TRAVEL_FACT_KEYS='fact_id,geographic_route_id,geographic_subject_ids,known_by,learned_at_generation,source_event_ids,summary';
const PRECISION=['exact','approximate','known_to_exist','reported_unverified'];
const EPISTEMIC=['confirmed','inferred','reported','disputed','outdated'];
const SOURCE_TYPES=['personal_experience','upbringing','education','profession','social_position','travel','observation','npc_information','institutional_instruction','physical_map','document','rumour','historical_knowledge'];
const SUBJECT_KINDS=['location','world_entity','route','institution','reported_claim'];
const exact=(value,keys)=>value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).sort().join(',')===keys;
const systemProvenance=()=>({authority:'system',source:'geographic_knowledge_resolver'});

function canonicalLocationSubject(state,locationId){
  let location=state.world.locations?.[locationId];
  while(location&&!location.world_genesis_entity_id&&location.parent_location_id)location=state.world.locations[location.parent_location_id];
  return location?.world_genesis_entity_id||null;
}

function routeEvidenceSubjects(state,routeId){
  const route=state.world_genesis.graph.routes[routeId];
  if(route)return [routeId,route.from_entity_id,route.to_entity_id].sort();
  const connection=state.world.local_connections?.[routeId];
  if(connection)return [routeId,connection.from_location_id,connection.to_location_id].sort();
  return null;
}

function travelEvidenceFact(state,factId){
  const fact=state.world.known_facts.find(item=>item.fact_id===factId);
  if(!exact(fact,TRAVEL_FACT_KEYS)||!fact.known_by.includes('pc_1')||fact.known_by.length!==1||!Array.isArray(fact.source_event_ids)||fact.source_event_ids.length!==1||!Number.isInteger(fact.learned_at_generation)||fact.learned_at_generation<=0||fact.learned_at_generation>state.meta.generation)return null;
  const subjects=routeEvidenceSubjects(state,fact.geographic_route_id);
  if(!subjects||JSON.stringify(fact.geographic_subject_ids)!==JSON.stringify(subjects))return null;
  return fact;
}

function sourceExistsForRecord(state,item){
  if(typeof item.source_id!=='string'||!item.source_id)return false;
  if(item.learned_at_generation===0){
    if(item.source_id==='starting_situation_commit')return item.source_type==='personal_experience'&&item.canonical_subject_id===state.starting_situation.location_id;
    if(item.source_id==='genesis_character_history')return ['upbringing','education','profession','social_position','travel','historical_knowledge'].includes(item.source_type);
  }
  if(['personal_experience','observation'].includes(item.source_type)){
    const current=state.pc.location_id,canonical=canonicalLocationSubject(state,current);
    return item.source_id===current&&(item.canonical_subject_id===current||item.canonical_subject_id===canonical);
  }
  if(item.source_type==='travel'){
    const fact=travelEvidenceFact(state,item.source_id);
    return Boolean(fact&&fact.geographic_subject_ids.includes(item.canonical_subject_id));
  }
  const isUnresolvedReport=item.subject_kind==='reported_claim'&&item.canonical_subject_id===null&&item.precision==='reported_unverified';
  if(item.source_type==='npc_information')return isUnresolvedReport&&Boolean(state.npcs[item.source_id]&&(state.npcs[item.source_id].known_to_pc||state.npcs[item.source_id].location_id===state.pc.location_id));
  if(item.source_type==='institutional_instruction')return isUnresolvedReport&&Boolean(state.world_genesis.institutions[item.source_id]||state.starting_region_systems?.institutions?.[item.source_id]||state.starting_region_systems?.services?.[item.source_id]);
  if(['physical_map','document'].includes(item.source_type)){const source=state.inventory.items[item.source_id];return isUnresolvedReport&&Boolean(source&&(source.holder_id==='pc_1'||source.custodian_id==='pc_1'||source.owner_id==='pc_1')&&source.tags?.some(tag=>item.source_type==='physical_map'?tag==='map':['document','book','letter','record'].includes(tag)));}
  if(['rumour','historical_knowledge'].includes(item.source_type))return isUnresolvedReport&&Boolean(state.world.known_facts.some(fact=>fact.fact_id===item.source_id&&fact.known_by?.some(id=>id==='pc_1'||id==='public')));
  return false;
}

function subjectExists(state,id,kind){
  if(id===null)return kind==='reported_claim';
  if(kind==='location')return Boolean(state.world.locations[id]);
  if(kind==='world_entity')return Boolean(state.world_genesis.graph.entities[id]);
  if(kind==='route')return Boolean(state.world_genesis.graph.routes[id]||state.world.local_connections?.[id]);
  if(kind==='institution')return Boolean(state.world_genesis.institutions[id]||state.starting_region_systems?.institutions?.[id]);
  return false;
}

function subjectLabel(state,id,kind){
  if(kind==='location')return state.world.locations[id]?.label;
  if(kind==='institution')return (state.world_genesis.institutions[id]?.catalog_id||id).replace(/^institution\./,'').replaceAll('_',' ');
  return String(id||'').replace(/^(geo|polity|settlement|site|location|route)_/,'').replaceAll('_',' ');
}

function record(state,{canonical_subject_id=null,reported_subject_label,subject_kind,precision,confidence,epistemic_status,approximate_area=null,source_type,source_id,learned_at_generation=0,last_confirmed_generation=null}){
  const core={contract_id:GEOGRAPHIC_KNOWLEDGE.recordContract,canonical_subject_id,reported_subject_label,subject_kind,precision,confidence,epistemic_status,approximate_area,source_type,source_id,learned_at_generation,last_confirmed_generation,provenance:systemProvenance()};
  return {...core,knowledge_id:`geok_${sha256(core).slice(0,24)}`};
}

function initialRecords(state){
  const records=[],scenario=state.starting_situation.scenario_id,start=state.starting_situation.location_id;
  const add=(spec)=>records.push(record(state,{learned_at_generation:0,...spec}));
  add({canonical_subject_id:start,reported_subject_label:subjectLabel(state,start,'location'),subject_kind:'location',precision:'exact',confidence:1,epistemic_status:'confirmed',source_type:'personal_experience',source_id:'starting_situation_commit',last_confirmed_generation:0});
  if(scenario==='academy_threshold'){
    add({canonical_subject_id:'settlement_rivergate',reported_subject_label:'Rivergate',subject_kind:'world_entity',precision:'known_to_exist',confidence:.9,epistemic_status:'confirmed',source_type:'education',source_id:'genesis_character_history'});
    add({canonical_subject_id:'institution_river_academy',reported_subject_label:'river academy',subject_kind:'institution',precision:'known_to_exist',confidence:.95,epistemic_status:'confirmed',source_type:'education',source_id:'genesis_character_history'});
  }else if(scenario==='civic_obligation'){
    add({canonical_subject_id:'settlement_rivergate',reported_subject_label:'Rivergate',subject_kind:'world_entity',precision:'exact',confidence:.95,epistemic_status:'confirmed',source_type:'social_position',source_id:'genesis_character_history',last_confirmed_generation:0});
    add({canonical_subject_id:'polity_river_realm',reported_subject_label:'River Realm',subject_kind:'world_entity',precision:'known_to_exist',confidence:.95,epistemic_status:'confirmed',source_type:'social_position',source_id:'genesis_character_history'});
  }else if(scenario==='wayfarer_departure'){
    add({canonical_subject_id:'geo_hinterland',reported_subject_label:'Hinterland',subject_kind:'world_entity',precision:'approximate',confidence:.75,epistemic_status:'inferred',approximate_area:{center_subject_id:'settlement_rivergate',direction_band:'outward',distance_band:'regional'},source_type:'profession',source_id:'genesis_character_history'});
    add({canonical_subject_id:'route_rivergate_hinterland',reported_subject_label:'Rivergate hinterland road',subject_kind:'route',precision:'approximate',confidence:.8,epistemic_status:'confirmed',approximate_area:{center_subject_id:'settlement_rivergate',direction_band:'outward',distance_band:'regional'},source_type:'travel',source_id:'genesis_character_history'});
  }
  return Object.fromEntries(records.sort((a,b)=>a.knowledge_id.localeCompare(b.knowledge_id)).map(item=>[item.knowledge_id,item]));
}

function refreshPackage(state){
  const knowledge=state.geographic_knowledge,{package_id,...core}=knowledge;
  knowledge.package_id=`geographic_knowledge_${sha256(core).slice(0,24)}`;
  return knowledge;
}

export function constructGeographicKnowledge(state){
  if(!state?.starting_situation?.starting_situation_id)throw new Error('Geographic Knowledge requires a committed Starting Situation.');
  const core={contract_id:GEOGRAPHIC_KNOWLEDGE.packageContract,viewpoint_id:'pc_1',world_genesis_plan_id:state.world_genesis.plan.plan_id,records:initialRecords(state),provenance:systemProvenance()};
  state.geographic_knowledge={...core,package_id:`geographic_knowledge_${sha256(core).slice(0,24)}`};
  return state.geographic_knowledge;
}

export function recordGeographicKnowledge(state,spec){
  validateGeographicKnowledge(state);
  if(!spec||typeof spec!=='object')throw new Error('Geographic Knowledge update requires a structured system input.');
  const item=record(state,{...spec,learned_at_generation:state.meta.generation,last_confirmed_generation:spec.epistemic_status==='confirmed'?state.meta.generation:null});
  if(state.geographic_knowledge.records[item.knowledge_id])return item;
  const candidate=structuredClone(state.geographic_knowledge);
  candidate.records[item.knowledge_id]=item;
  const trial={...state,geographic_knowledge:candidate};refreshPackage(trial);validateGeographicKnowledge(trial);
  state.geographic_knowledge=candidate;
  return item;
}

export function recordTravelGeographicKnowledge(state,{event,route_id}){
  if(!event||!['local_movement_completed','travel_completed'].includes(event.type)||!event.known_by?.includes('pc_1')||event.generation!==state.meta.generation)throw new Error('Travel Geographic Knowledge requires a committed player-known movement event.');
  const subjects=routeEvidenceSubjects(state,route_id);if(!subjects)throw new Error('Travel Geographic Knowledge requires an authoritative route.');
  const eventRoute=event.data?.connection_id||event.data?.route_id;if(eventRoute!==route_id)throw new Error('Travel Geographic Knowledge event/route mismatch.');
  const factCore={geographic_route_id:route_id,geographic_subject_ids:subjects,known_by:['pc_1'],learned_at_generation:state.meta.generation,source_event_ids:[event.id],summary:'Completed travel established direct geographic knowledge.'};
  const fact={fact_id:`fact_geographic_travel_${sha256(factCore).slice(0,24)}`,...factCore};
  const trial=structuredClone(state);trial.world.known_facts.push(fact);
  const route=trial.world_genesis.graph.routes[route_id]||trial.world.local_connections[route_id];
  const destination=route.to_entity_id||route.to_location_id;
  recordGeographicKnowledge(trial,{canonical_subject_id:destination,reported_subject_label:subjectLabel(trial,destination,route.to_entity_id?'world_entity':'location'),subject_kind:route.to_entity_id?'world_entity':'location',precision:'exact',confidence:1,epistemic_status:'confirmed',approximate_area:null,source_type:'travel',source_id:fact.fact_id});
  recordGeographicKnowledge(trial,{canonical_subject_id:route_id,reported_subject_label:subjectLabel(trial,route_id,'route'),subject_kind:'route',precision:'exact',confidence:1,epistemic_status:'confirmed',approximate_area:null,source_type:'travel',source_id:fact.fact_id});
  state.world.known_facts=trial.world.known_facts;state.geographic_knowledge=trial.geographic_knowledge;
  return fact;
}

export function validateGeographicKnowledgeTransition(before,after){
  for(const [id,item] of Object.entries(after.geographic_knowledge.records)){
    if(before.geographic_knowledge.records[id])continue;
    if(item.learned_at_generation!==after.meta.generation)throw new Error(`New Geographic Knowledge ${id} must be learned in the committing generation.`);
  }
  const priorFacts=new Map(before.world.known_facts.filter(fact=>fact.geographic_route_id).map(fact=>[fact.fact_id,fact]));
  const nextFacts=after.world.known_facts.filter(fact=>fact.geographic_route_id);
  for(const [id,fact] of priorFacts)if(JSON.stringify(nextFacts.find(item=>item.fact_id===id))!==JSON.stringify(fact))throw new Error(`Ordinary transition cannot rewrite Geographic Knowledge evidence ${id}.`);
  for(const fact of nextFacts){
    if(priorFacts.has(fact.fact_id))continue;
    if(!travelEvidenceFact(after,fact.fact_id)||fact.learned_at_generation!==after.meta.generation)throw new Error(`Invalid new Geographic Knowledge evidence ${fact.fact_id}.`);
    const route=after.world_genesis.graph.routes[fact.geographic_route_id]||after.world.local_connections?.[fact.geographic_route_id];
    const worldRoute=Boolean(route.from_entity_id);
    const beforeSubject=worldRoute?canonicalLocationSubject(before,before.pc.location_id):before.pc.location_id;
    const afterSubject=worldRoute?canonicalLocationSubject(after,after.pc.location_id):after.pc.location_id;
    const from=route.from_entity_id||route.from_location_id,to=route.to_entity_id||route.to_location_id;
    const minimumMinutes=worldRoute?route.travel_time_model.minutes:route.travel_minutes;
    if(beforeSubject!==from||afterSubject!==to||after.world.absolute_minute-before.world.absolute_minute+1e-9<minimumMinutes)throw new Error(`Geographic Knowledge evidence ${fact.fact_id} is not backed by authoritative completed travel.`);
  }
  return true;
}

export function validateGeographicKnowledgeEvents(before,after,events){
  const priorIds=new Set(before.world.known_facts.filter(fact=>fact.geographic_route_id).map(fact=>fact.fact_id));
  for(const fact of after.world.known_facts.filter(item=>item.geographic_route_id&&!priorIds.has(item.fact_id))){
    const event=(events||[]).find(item=>item.id===fact.source_event_ids?.[0]);
    const eventRoute=event?.data?.connection_id||event?.data?.route_id;
    if(!event||event.generation!==after.meta.generation||!event.known_by?.includes('pc_1')||!['local_movement_completed','travel_completed'].includes(event.type)||eventRoute!==fact.geographic_route_id)throw new Error(`Geographic Knowledge evidence ${fact.fact_id} does not resolve to its player-known committed movement event.`);
  }
  return true;
}

export function validateGeographicKnowledge(state){
  const knowledge=state?.geographic_knowledge;
  if(!knowledge||knowledge.contract_id!==GEOGRAPHIC_KNOWLEDGE.packageContract||!exact(knowledge,PACKAGE_KEYS)||knowledge.viewpoint_id!=='pc_1'||knowledge.world_genesis_plan_id!==state.world_genesis?.plan?.plan_id||!exact(knowledge.provenance,PROVENANCE_KEYS)||knowledge.provenance.authority!=='system'||knowledge.provenance.source!=='geographic_knowledge_resolver')throw new Error('Invalid system-owned Geographic Knowledge package.');
  if(!knowledge.records||typeof knowledge.records!=='object'||Array.isArray(knowledge.records))throw new Error('Invalid Geographic Knowledge record index.');
  for(const [id,item] of Object.entries(knowledge.records)){
    if(!exact(item,RECORD_KEYS)||item.contract_id!==GEOGRAPHIC_KNOWLEDGE.recordContract||item.knowledge_id!==id||!PRECISION.includes(item.precision)||!EPISTEMIC.includes(item.epistemic_status)||!SOURCE_TYPES.includes(item.source_type)||!SUBJECT_KINDS.includes(item.subject_kind)||typeof item.reported_subject_label!=='string'||!item.reported_subject_label.trim()||!Number.isFinite(item.confidence)||item.confidence<0||item.confidence>1||!Number.isInteger(item.learned_at_generation)||item.learned_at_generation<0||item.learned_at_generation>state.meta.generation||(item.last_confirmed_generation!==null&&(!Number.isInteger(item.last_confirmed_generation)||item.last_confirmed_generation<item.learned_at_generation||item.last_confirmed_generation>state.meta.generation)))throw new Error(`Invalid Geographic Knowledge record ${id}.`);
    if(!subjectExists(state,item.canonical_subject_id,item.subject_kind))throw new Error(`Geographic Knowledge ${id} references unknown canonical geography.`);
    if(item.precision==='exact'&&item.approximate_area!==null)throw new Error(`Exact Geographic Knowledge ${id} cannot carry an approximate area.`);
    if(item.precision==='approximate'&&(!exact(item.approximate_area,AREA_KEYS)||!subjectExists(state,item.approximate_area.center_subject_id,'world_entity')||typeof item.approximate_area.direction_band!=='string'||!item.approximate_area.direction_band||typeof item.approximate_area.distance_band!=='string'||!item.approximate_area.distance_band))throw new Error(`Approximate Geographic Knowledge ${id} requires a valid bounded area.`);
    if(!sourceExistsForRecord(state,item))throw new Error(`Geographic Knowledge ${id} has no authoritative evidence source.`);
    if(!exact(item.provenance,PROVENANCE_KEYS)||item.provenance.authority!=='system'||item.provenance.source!=='geographic_knowledge_resolver')throw new Error(`Geographic Knowledge ${id} must be system-owned.`);
    const {knowledge_id,...recordCore}=item;if(knowledge_id!==`geok_${sha256(recordCore).slice(0,24)}`)throw new Error(`Geographic Knowledge ${id} integrity mismatch.`);
  }
  const expectedInitial=initialRecords(state),retainedInitial=Object.values(knowledge.records).filter(item=>item.learned_at_generation===0);
  if(retainedInitial.length!==Object.keys(expectedInitial).length||retainedInitial.some(item=>JSON.stringify(item)!==JSON.stringify(expectedInitial[item.knowledge_id])))throw new Error('Generation-zero Geographic Knowledge diverges from character history and committed opening.');
  const {package_id,...core}=knowledge;if(package_id!==`geographic_knowledge_${sha256(core).slice(0,24)}`)throw new Error('Geographic Knowledge package integrity mismatch.');
  return true;
}

export function projectGeographicKnowledge(state){
  validateGeographicKnowledge(state);
  return Object.values(state.geographic_knowledge.records).sort((a,b)=>a.knowledge_id.localeCompare(b.knowledge_id)).map(item=>({knowledge_id:item.knowledge_id,canonical_subject_id:item.canonical_subject_id,reported_subject_label:item.reported_subject_label,subject_kind:item.subject_kind,precision:item.precision,confidence:item.confidence,epistemic_status:item.epistemic_status,approximate_area:structuredClone(item.approximate_area),source_type:item.source_type,learned_at_generation:item.learned_at_generation,last_confirmed_generation:item.last_confirmed_generation,provenance:{authority:'derived_projection',source:'player_geographic_knowledge'}}));
}
