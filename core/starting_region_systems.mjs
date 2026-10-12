import { calendarMetrics } from './calendar.mjs';
import { createHazardExposure } from './exploration.mjs';
import { scheduleProcess } from './scheduler.mjs';
import { sha256 } from './util.mjs';

export const STARTING_REGION_SYSTEMS=Object.freeze({
  packageContract:'ER_STARTING_REGION_SYSTEMS_V1',
  institutionContract:'ER_LOCAL_INSTITUTION_V1',
  serviceContract:'ER_LOCAL_SERVICE_V1',
  cohortContract:'ER_LOCAL_COHORT_V1',
  situationContract:'ER_LOCAL_SITUATION_V1',
  environmentContract:'ER_LOCAL_ENVIRONMENT_V1',
  hazardContract:'ER_LOCAL_HAZARD_V1',
});

const PACKAGE_KEYS='cohorts,contract_id,environment,hazards,institutions,package_id,provenance,services,situations,starting_region_package_id';
const INSTITUTION_KEYS='access_rules,contract_id,disruption,institution_id,inventory_item_ids,location_id,obligation_links,operating_schedule,policies,project_ids,provenance,resource_position,service_ids,staff_npc_ids';
const SERVICE_KEYS='access_rules,availability,contract_id,disruption,institution_id,location_id,obligation_links,operating_schedule,provenance,service_id,staff_npc_ids';
const COHORT_KEYS='cohort_id,contract_id,count,location_id,materialized_npc_ids,population_id,profession_id,provenance';
const SITUATION_KEYS='cause_links,contract_id,current_state,involved_entity_ids,location_ids,pressure_type,provenance,schedule_process_id,situation_id,update_count,visibility';
const ENVIRONMENT_KEYS='contract_id,environment_id,hazard_ids,location_id,provenance,weather_state';
const HAZARD_KEYS='active,consequence,contract_id,exposure_interval_minutes,hazard_id,kind,location_id,protection_tags,provenance,severity';
const SCHEDULE_KEYS='end_minute_of_day,start_minute_of_day,weekday_indices';
const PROVENANCE_KEYS='authority,source';
const systemProvenance=()=>({authority:'system',source:'starting_region_systems'});
const stableId=(prefix,campaignId,label)=>`${prefix}_${sha256(`${campaignId}|${prefix}|${label}`).slice(0,24)}`;
const exact=(value,keys)=>value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).sort().join(',')===keys;
const sortedUnique=value=>Array.isArray(value)&&JSON.stringify(value)===JSON.stringify([...new Set(value)].sort());

function locationByLabel(state,label){
  const location=Object.values(state.world.locations).find(candidate=>candidate.label===label);
  if(!location)throw new Error(`Starting Region systems require location ${label}.`);
  return location.location_id;
}

export function constructStartingRegionSystems(state){
  if(!state?.starting_region?.package_id)throw new Error('Starting Region systems require a committed Starting Region Package.');
  const clerk=state.npcs?.npc_arrival_clerk;
  if(!clerk?.world_genesis_population_id)throw new Error('Starting Region systems require the persistent arrival clerk.');
  const arrival=state.starting_region.starting_location_id,civicWay=locationByLabel(state,'Rivergate Civic Way');
  const minutesPerHour=calendarMetrics(state.world.calendar).minutes_per_hour;
  const institutionId=stableId('institution',state.meta.campaign_id,'rivergate-arrival-office');
  const serviceId=stableId('service',state.meta.campaign_id,'arrival-guidance');
  const cohortId=stableId('cohort',state.meta.campaign_id,'civic-way-clerks');
  const situationId=stableId('situation',state.meta.campaign_id,'flood-recovery-pressure');
  const environmentId=stableId('environment',state.meta.campaign_id,'civic-way-weather');
  const hazardId=stableId('hazard',state.meta.campaign_id,'civic-way-runoff');
  const schedule={weekday_indices:[0,1,2,3,4,5,6],start_minute_of_day:8*minutesPerHour,end_minute_of_day:17*minutesPerHour};
  const processId=stableId('process',state.meta.campaign_id,'flood-recovery-pressure-update');
  const institutions={
    [institutionId]:{contract_id:STARTING_REGION_SYSTEMS.institutionContract,institution_id:institutionId,location_id:arrival,staff_npc_ids:[clerk.id],service_ids:[serviceId],operating_schedule:structuredClone(schedule),access_rules:['public_entry'],resource_position:{coin_reserve:120,supply_level:'adequate'},inventory_item_ids:[],project_ids:[],policies:['record_arrivals'],obligation_links:[],disruption:null,provenance:systemProvenance()},
  };
  const services={
    [serviceId]:{contract_id:STARTING_REGION_SYSTEMS.serviceContract,service_id:serviceId,institution_id:institutionId,location_id:arrival,staff_npc_ids:[clerk.id],operating_schedule:structuredClone(schedule),availability:'scheduled',access_rules:['public_entry'],disruption:null,obligation_links:[],provenance:systemProvenance()},
  };
  const cohorts={
    [cohortId]:{contract_id:STARTING_REGION_SYSTEMS.cohortContract,cohort_id:cohortId,population_id:clerk.world_genesis_population_id,profession_id:clerk.world_genesis_role_catalog_id,location_id:civicWay,count:48,materialized_npc_ids:[clerk.id],provenance:systemProvenance()},
  };
  const situations={
    [situationId]:{contract_id:STARTING_REGION_SYSTEMS.situationContract,situation_id:situationId,pressure_type:'infrastructure_recovery',location_ids:[civicWay],involved_entity_ids:[institutionId],cause_links:['history_river_compact'],current_state:'strained',update_count:0,visibility:'undiscovered',schedule_process_id:processId,provenance:systemProvenance()},
  };
  const hazards={
    [hazardId]:{contract_id:STARTING_REGION_SYSTEMS.hazardContract,hazard_id:hazardId,location_id:civicWay,kind:'flood_runoff',severity:'minor',active:true,exposure_interval_minutes:minutesPerHour,protection_tags:['weatherproof'],consequence:'fatigue',provenance:systemProvenance()},
  };
  const environment={contract_id:STARTING_REGION_SYSTEMS.environmentContract,environment_id:environmentId,location_id:civicWay,weather_state:'recent_rain',hazard_ids:[hazardId],provenance:systemProvenance()};
  const core={contract_id:STARTING_REGION_SYSTEMS.packageContract,starting_region_package_id:state.starting_region.package_id,institutions,services,cohorts,situations,environment,hazards,provenance:systemProvenance()};
  state.starting_region_systems={...core,package_id:stableId('starting_region_systems',state.meta.campaign_id,sha256(core))};
  scheduleProcess(state,{process_id:processId,due_absolute_minute:state.world.absolute_minute+minutesPerHour,owner_id:situationId,kind:'local_situation_update',priority:45,fidelity:'local',payload:{situation_id:situationId,interval_minutes:minutesPerHour,player_relevance:1,consequence:2}});
  return state.starting_region_systems;
}

export function rebindStartingRegionSystems(state){
  const systems=state?.starting_region_systems;
  if(!systems||!state.starting_region?.package_id)throw new Error('Cannot rebind missing Starting Region systems.');
  systems.starting_region_package_id=state.starting_region.package_id;
  const {package_id,...core}=systems;
  systems.package_id=stableId('starting_region_systems',state.meta.campaign_id,sha256(core));
  return systems;
}

export function localServiceAvailability(state,serviceId,absoluteMinute=state.world.absolute_minute){
  const service=state.starting_region_systems?.services?.[serviceId];
  if(!service)throw new Error(`Unknown local service ${serviceId}.`);
  if(service.disruption||service.availability==='suspended'||service.availability==='unavailable')return 'closed';
  const calendar=state.world.calendar,metrics=calendarMetrics(calendar),minute=((absoluteMinute%metrics.minutes_per_day)+metrics.minutes_per_day)%metrics.minutes_per_day;
  const day=Math.floor(absoluteMinute/metrics.minutes_per_day)%calendar.weekdays.length;
  return service.operating_schedule.weekday_indices.includes(day)&&minute>=service.operating_schedule.start_minute_of_day&&minute<service.operating_schedule.end_minute_of_day?'open':'closed';
}

export function applyLocalHazardExposure(state,hazardId){
  validateStartingRegionSystems(state);
  const hazard=state.starting_region_systems.hazards[hazardId];
  if(!hazard)throw new Error(`Unknown local hazard ${hazardId}.`);
  if(!hazard.active||state.pc.location_id!==hazard.location_id)return null;
  const existing=state.environment.exposures.find(exposure=>exposure.hazard_id===hazardId&&exposure.status==='active');
  if(existing)return existing;
  return createHazardExposure(state,{hazard_id:hazard.hazard_id,kind:hazard.kind,interval_minutes:hazard.exposure_interval_minutes,automatic:false,protection_tags:hazard.protection_tags,severity:hazard.severity,consequence:hazard.consequence});
}

function validateSchedule(schedule,calendar){
  const metrics=calendarMetrics(calendar);
  if(!exact(schedule,SCHEDULE_KEYS)||!sortedUnique(schedule.weekday_indices)||schedule.weekday_indices.some(day=>!Number.isInteger(day)||day<0||day>=calendar.weekdays.length)||!Number.isFinite(schedule.start_minute_of_day)||!Number.isFinite(schedule.end_minute_of_day)||schedule.start_minute_of_day<0||schedule.end_minute_of_day<=schedule.start_minute_of_day||schedule.end_minute_of_day>metrics.minutes_per_day)throw new Error('Invalid local operating schedule.');
}
function validateProvenance(value,label){if(!exact(value,PROVENANCE_KEYS)||value.authority!=='system'||value.source!=='starting_region_systems')throw new Error(`${label} must be system-owned.`);}

export function validateStartingRegionSystems(state){
  const systems=state?.starting_region_systems;
  if(!systems||systems.contract_id!==STARTING_REGION_SYSTEMS.packageContract||!exact(systems,PACKAGE_KEYS))throw new Error('Invalid Starting Region systems package.');
  if(systems.starting_region_package_id!==state.starting_region?.package_id)throw new Error('Starting Region systems authority binding mismatch.');
  validateProvenance(systems.provenance,'Starting Region systems package');
  for(const [id,institution] of Object.entries(systems.institutions||{})){
    if(!exact(institution,INSTITUTION_KEYS)||institution.contract_id!==STARTING_REGION_SYSTEMS.institutionContract||institution.institution_id!==id||!state.world.locations[institution.location_id]||!sortedUnique(institution.staff_npc_ids)||!sortedUnique(institution.service_ids)||!institution.staff_npc_ids.every(npc=>state.npcs[npc])||!institution.service_ids.every(service=>systems.services[service])||!Array.isArray(institution.access_rules)||!sortedUnique(institution.inventory_item_ids)||!institution.inventory_item_ids.every(item=>state.inventory.items[item])||!Array.isArray(institution.project_ids)||!Array.isArray(institution.policies)||!Array.isArray(institution.obligation_links)||!exact(institution.resource_position,'coin_reserve,supply_level')||!Number.isFinite(institution.resource_position.coin_reserve)||institution.resource_position.coin_reserve<0||!['adequate','strained','scarce'].includes(institution.resource_position.supply_level)||(institution.disruption!==null&&typeof institution.disruption!=='string'))throw new Error(`Invalid local institution ${id}.`);
    validateSchedule(institution.operating_schedule,state.world.calendar);validateProvenance(institution.provenance,`Local institution ${id}`);
  }
  for(const [id,service] of Object.entries(systems.services||{})){
    const institution=systems.institutions[service?.institution_id];
    if(!exact(service,SERVICE_KEYS)||service.contract_id!==STARTING_REGION_SYSTEMS.serviceContract||service.service_id!==id||!institution||service.location_id!==institution.location_id||!state.world.locations[service.location_id]||!sortedUnique(service.staff_npc_ids)||!service.staff_npc_ids.every(npc=>institution.staff_npc_ids.includes(npc))||!['scheduled','suspended','unavailable'].includes(service.availability)||!Array.isArray(service.access_rules)||!Array.isArray(service.obligation_links)||(service.disruption!==null&&typeof service.disruption!=='string'))throw new Error(`Invalid local service ${id}.`);
    validateSchedule(service.operating_schedule,state.world.calendar);validateProvenance(service.provenance,`Local service ${id}`);
  }
  for(const [id,cohort] of Object.entries(systems.cohorts||{})){
    const population=state.world_genesis.populations[cohort?.population_id],canonicalCohort=population?.cohorts?.find(candidate=>candidate.profession_id===cohort?.profession_id);
    if(!exact(cohort,COHORT_KEYS)||cohort.contract_id!==STARTING_REGION_SYSTEMS.cohortContract||cohort.cohort_id!==id||!population||!canonicalCohort||!state.world.locations[cohort.location_id]||!Number.isInteger(cohort.count)||cohort.count!==canonicalCohort.count||!sortedUnique(cohort.materialized_npc_ids)||cohort.materialized_npc_ids.some(npc=>!state.npcs[npc]||state.npcs[npc].world_genesis_population_id!==cohort.population_id||state.npcs[npc].world_genesis_role_catalog_id!==cohort.profession_id)||cohort.materialized_npc_ids.length>=cohort.count)throw new Error(`Invalid aggregate local cohort ${id}.`);
    validateProvenance(cohort.provenance,`Local cohort ${id}`);
  }
  for(const [id,situation] of Object.entries(systems.situations||{})){
    const process=state.scheduler.pending.find(candidate=>candidate.process_id===situation?.schedule_process_id);
    const historyIds=new Set((state.world_genesis.history||[]).map(entry=>entry.history_id));
    if(!exact(situation,SITUATION_KEYS)||situation.contract_id!==STARTING_REGION_SYSTEMS.situationContract||situation.situation_id!==id||!sortedUnique(situation.location_ids)||!situation.location_ids.every(location=>state.world.locations[location])||!sortedUnique(situation.involved_entity_ids)||!situation.involved_entity_ids.every(entity=>systems.institutions[entity])||!sortedUnique(situation.cause_links)||!situation.cause_links.every(cause=>historyIds.has(cause))||!['strained','mounting','recovering'].includes(situation.current_state)||!Number.isInteger(situation.update_count)||situation.update_count<0||!['undiscovered','known'].includes(situation.visibility)||(process&&(process.kind!=='local_situation_update'||process.owner_id!==id||process.payload?.situation_id!==id)))throw new Error(`Invalid local situation ${id}.`);
    validateProvenance(situation.provenance,`Local situation ${id}`);
  }
  const environment=systems.environment;
  if(!exact(environment,ENVIRONMENT_KEYS)||environment.contract_id!==STARTING_REGION_SYSTEMS.environmentContract||!state.world.locations[environment.location_id]||!sortedUnique(environment.hazard_ids)||!environment.hazard_ids.every(hazard=>systems.hazards[hazard]))throw new Error('Invalid local environment source.');
  validateProvenance(environment.provenance,'Local environment source');
  for(const [id,hazard] of Object.entries(systems.hazards||{})){
    if(!exact(hazard,HAZARD_KEYS)||hazard.contract_id!==STARTING_REGION_SYSTEMS.hazardContract||hazard.hazard_id!==id||!state.world.locations[hazard.location_id]||hazard.location_id!==environment.location_id||typeof hazard.active!=='boolean'||!['minor','moderate','severe','critical'].includes(hazard.severity)||!Number.isFinite(hazard.exposure_interval_minutes)||hazard.exposure_interval_minutes<=0||!Array.isArray(hazard.protection_tags)||typeof hazard.consequence!=='string'||!hazard.consequence)throw new Error(`Invalid local hazard ${id}.`);
    validateProvenance(hazard.provenance,`Local hazard ${id}`);
  }
  const {package_id,...core}=systems;
  if(package_id!==stableId('starting_region_systems',state.meta.campaign_id,sha256(core)))throw new Error('Starting Region systems integrity mismatch.');
  return true;
}

export function advanceLocalSituation(state,situationId){
  const situation=state.starting_region_systems?.situations?.[situationId];
  if(!situation)throw new Error(`Unknown local situation ${situationId}.`);
  situation.update_count+=1;
  situation.current_state=situation.update_count%3===1?'mounting':situation.update_count%3===2?'recovering':'strained';
  const {package_id,...core}=state.starting_region_systems;
  state.starting_region_systems.package_id=stableId('starting_region_systems',state.meta.campaign_id,sha256(core));
  return situation;
}
