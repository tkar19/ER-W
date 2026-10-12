import { sha256 } from './util.mjs';
import { commitStartingRegionLocation } from './starting_region.mjs';
import { localServiceAvailability, rebindStartingRegionSystems } from './starting_region_systems.mjs';

export const STARTING_SITUATION=Object.freeze({contract:'ER_STARTING_SITUATION_V1',resolver:'ER_STARTING_SITUATION_RESOLVER_V1'});

const RECORD_KEYS='active_service_ids,committed_absolute_minute,contract_id,environment_id,input_digest,input_snapshot,institution_id,known_fact_ids,local_situation_ids,location_id,opening_summary,provenance,resolver_version,scenario_id,selection_reasons,selection_scores,starting_region_package_id,starting_situation_id,visible_npc_ids';
const INPUT_KEYS='current_circumstances,identity,obligations,rng_seed,social_positions,world_genesis_snapshot_id';
const PROVENANCE_KEYS='authority,source';
const SCENARIOS=['academy_threshold','civic_obligation','development_arrival_fixture','wayfarer_departure'];
const exact=(value,keys)=>value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).sort().join(',')===keys;
const sortedUnique=value=>Array.isArray(value)&&JSON.stringify(value)===JSON.stringify([...new Set(value)].sort());
const locationByLabel=(state,label)=>Object.values(state.world.locations).find(location=>location.label===label)?.location_id;

function snapshotInputs(state){return {identity:structuredClone(state.pc.identity),current_circumstances:structuredClone(state.pc.current_circumstances||[]),obligations:structuredClone(state.pc.obligations||[]),social_positions:structuredClone(state.pc.social_positions||[]),rng_seed:state.rng.seed,world_genesis_snapshot_id:state.world_genesis.snapshot_id};}
function corpus(input){return `${input.identity.name} ${input.identity.class} ${input.identity.background} ${input.identity.starting_goal} ${JSON.stringify(input.current_circumstances)} ${JSON.stringify(input.obligations)} ${JSON.stringify(input.social_positions)}`.toLowerCase();}
const matches=(text,pattern)=>pattern.test(text)?1:0;

function scoreScenarios(input){
  const text=corpus(input),fixture=matches(text,/\b(test|tester|testing|fixture)\b/);
  return {
    development_arrival_fixture:fixture*100,
    academy_threshold:matches(String(input.identity.starting_goal).toLowerCase(),/(academy|study|learn|mentor|school)/)*7+matches(String(input.identity.class).toLowerCase(),/(scholar|mage|student|apprentice)/)*3+matches(String(input.identity.background).toLowerCase(),/(academy|tutor|educated|scholar)/)*4,
    civic_obligation:matches(String(input.identity.background).toLowerCase(),/(noble|heir|house|politic|official|court)/)*7+(input.social_positions.length?4:0)+(input.obligations.length?4:0),
    wayfarer_departure:matches(String(input.identity.starting_goal).toLowerCase(),/(travel|explore|map|road|journey)/)*6+matches(String(input.identity.class).toLowerCase(),/(scout|ranger|surveyor)/)*3+matches(String(input.identity.background).toLowerCase(),/(travell|surveyor|caravan|wander)/)*4+1,
  };
}

function selectScenario(input){
  const scores=scoreScenarios(input),scenario_id=Object.entries(scores).sort((a,b)=>b[1]-a[1]||a[0].localeCompare(b[0]))[0][0];
  const reasons=[];
  if(scenario_id==='development_arrival_fixture')reasons.push('explicit_test_fixture_identity');
  if(scenario_id==='academy_threshold')reasons.push('character_education_or_academy_goal');
  if(scenario_id==='civic_obligation')reasons.push('character_social_position_or_obligation');
  if(scenario_id==='wayfarer_departure')reasons.push('character_travel_or_exploration_context');
  return {scenario_id,scores,reasons};
}

function scenarioDetails(state,scenarioId){
  const arrival=Object.values(state.world.locations).find(location=>location.world_genesis_entity_id==='location_arrival_point')?.location_id;
  const concourse=locationByLabel(state,'Arrival Concourse'),civic=locationByLabel(state,'Rivergate Civic Way');
  const institution=Object.values(state.starting_region_systems.institutions)[0],service=Object.values(state.starting_region_systems.services)[0],localSituationIds=Object.keys(state.starting_region_systems.situations).sort();
  if(scenarioId==='development_arrival_fixture')return {location_id:arrival,institution_id:institution.institution_id,active_service_ids:localServiceAvailability(state,service.service_id,state.campaign_clock.start_absolute_minute)==='open'?[service.service_id]:[],local_situation_ids:[],visible_npc_ids:['npc_arrival_clerk'],opening_summary:'You have arrived at a public arrival point. A clerk is currently on duty nearby; what you do next is yours to decide.'};
  if(scenarioId==='academy_threshold')return {location_id:concourse,institution_id:null,active_service_ids:[],local_situation_ids:[],visible_npc_ids:[],opening_summary:'You begin in the Arrival Concourse, positioned to pursue your established educational goal.'};
  if(scenarioId==='civic_obligation')return {location_id:civic,institution_id:null,active_service_ids:[],local_situation_ids:localSituationIds,visible_npc_ids:[],opening_summary:'You begin on Rivergate Civic Way, where your established social position or obligations connect you to the living settlement.'};
  return {location_id:concourse,institution_id:null,active_service_ids:[],local_situation_ids:[],visible_npc_ids:[],opening_summary:'You begin in the Arrival Concourse with the local roads ahead and your established journey still yours to direct.'};
}

function expectedRecord(state,input){
  const selected=selectScenario(input),details=scenarioDetails(state,selected.scenario_id),environment=state.starting_region_systems.environment;
  const factId=`fact_starting_situation_${selected.scenario_id}`;
  return {contract_id:STARTING_SITUATION.contract,resolver_version:STARTING_SITUATION.resolver,scenario_id:selected.scenario_id,location_id:details.location_id,institution_id:details.institution_id,active_service_ids:details.active_service_ids,local_situation_ids:details.local_situation_ids,environment_id:environment.environment_id,visible_npc_ids:details.visible_npc_ids,known_fact_ids:[factId],opening_summary:details.opening_summary,committed_absolute_minute:state.campaign_clock.start_absolute_minute,selection_scores:selected.scores,selection_reasons:selected.reasons,input_snapshot:input,input_digest:sha256(input),provenance:{authority:'system',source:'starting_situation_resolver'}};
}

export function resolveStartingSituation(state){
  if(state.starting_situation)throw new Error('Starting Situation is already committed.');
  const input=snapshotInputs(state),candidate=expectedRecord(state,input);
  commitStartingRegionLocation(state,candidate.location_id);rebindStartingRegionSystems(state);
  candidate.starting_region_package_id=state.starting_region.package_id;
  candidate.starting_situation_id=`starting_situation_${sha256(candidate).slice(0,24)}`;
  state.starting_situation=candidate;
  state.world.weather=state.starting_region_systems.environment.weather_state.replaceAll('_',' ');
  state.scene.summary=candidate.opening_summary;
  const fact={fact_id:candidate.known_fact_ids[0],summary:candidate.opening_summary,known_by:['pc_1'],source_event_ids:['evt_gen0']};
  state.world.known_facts.push(fact);
  if(candidate.scenario_id==='development_arrival_fixture')state.world.known_facts.push({fact_id:'fact_arrival_clerk_present',summary:'An arrival clerk is present and on duty.',known_by:['pc_1'],source_event_ids:['evt_gen0']});
  return candidate;
}

export function validateStartingSituation(state){
  const record=state?.starting_situation;
  if(!record||record.contract_id!==STARTING_SITUATION.contract||record.resolver_version!==STARTING_SITUATION.resolver||!exact(record,RECORD_KEYS))throw new Error('Invalid Starting Situation record.');
  if(!SCENARIOS.includes(record.scenario_id)||!state.world.locations[record.location_id]||record.location_id!==state.starting_region.starting_location_id||record.starting_region_package_id!==state.starting_region.package_id)throw new Error('Starting Situation authority binding mismatch.');
  if(!exact(record.input_snapshot,INPUT_KEYS)||record.input_digest!==sha256(record.input_snapshot))throw new Error('Starting Situation input integrity mismatch.');
  if(state.meta.generation===0&&JSON.stringify(record.input_snapshot)!==JSON.stringify(snapshotInputs(state)))throw new Error('Starting Situation inputs diverge from committed Generation-zero character circumstances.');
  const expected=expectedRecord(state,record.input_snapshot);
  for(const key of ['scenario_id','location_id','institution_id','active_service_ids','local_situation_ids','environment_id','visible_npc_ids','known_fact_ids','opening_summary','committed_absolute_minute','selection_scores','selection_reasons'])if(JSON.stringify(record[key])!==JSON.stringify(expected[key]))throw new Error(`Starting Situation ${key} diverges from deterministic resolution.`);
  if(!sortedUnique(record.active_service_ids)||record.active_service_ids.some(id=>!state.starting_region_systems.services[id])||!sortedUnique(record.local_situation_ids)||record.local_situation_ids.some(id=>!state.starting_region_systems.situations[id])||!sortedUnique(record.visible_npc_ids)||record.visible_npc_ids.some(id=>!state.npcs[id])||!sortedUnique(record.known_fact_ids)||record.known_fact_ids.some(id=>!state.world.known_facts.some(fact=>fact.fact_id===id&&fact.known_by?.includes('pc_1'))))throw new Error('Starting Situation contains invalid player-safe references.');
  if(!exact(record.provenance,PROVENANCE_KEYS)||record.provenance.authority!=='system'||record.provenance.source!=='starting_situation_resolver')throw new Error('Starting Situation must be system-owned.');
  const {starting_situation_id,...core}=record;if(starting_situation_id!==`starting_situation_${sha256(core).slice(0,24)}`)throw new Error('Starting Situation integrity mismatch.');
  return true;
}

export function projectStartingSituation(state){
  validateStartingSituation(state);const record=state.starting_situation;
  return {scenario_id:record.scenario_id,location_id:record.location_id,opening_summary:record.opening_summary,visible_npc_ids:[...record.visible_npc_ids],known_fact_ids:[...record.known_fact_ids],provenance:{authority:'derived_projection',source:'committed_starting_situation'}};
}
