import { CORE } from './core_constants.mjs';
import { clamp, nowIso, sha256 } from './util.mjs';
import { cloneDefaultCalendar, DEFAULT_WORLD_START, dateToAbsoluteMinute, refreshTimeViews, formatWorldTime, minuteOfWorldDay, calendarMetrics } from './calendar.mjs';
import { addNpcRoutine, synchronizeNpcRoutine, scheduleNextNpcRoutineBoundary, applyNpcRoutineBoundary, refreshScheduledNpcPresence } from './routines.mjs';
import { createEventEmitter } from './events.mjs';
import {
  defaultAttributes, defaultSkills, buildResolutionPlan, resolvePlan, situationFromHealth,
  DC, outcomeForTotal
} from './action_resolution.mjs';
import { createHealthState, changeFatigue, addInjury, addThreat, stabilizeThreat, advanceRecovery } from './health.mjs';
import { createSchedulerState, planAdvance, scheduleProcess, nextInterruptMinute } from './scheduler.mjs';
import { createNpc, proposeNpcDecision } from './cognition.mjs';
import { socialResistance, applySocialAftermath, resolveNpcSocialChoice, applyDeceptionBelief, createAgreement } from './social.mjs';
import { ensureNpcHealth, startCombat, defenceThreshold, pcDefenceThreshold, harmPotential, applyNpcHarm, applyPcHarm, npcMoraleChoice, requestRetreat, completeRetreat, offerSurrender, respondToSurrender, initiativePosition, beginExchange, recordExchangeContribution, finishExchange } from './combat.mjs';
import { defaultMagicState, blueprintFromIntent, validateCast, payCastCost, formationFromOutcome, applyMagicEffect } from './magic.mjs';
import { ensureObserverState, applyPerceptionCue, resolveStealthForObserver, searchEvidence } from './perception.mjs';
import {
  normalizeItem, carriedItemIds, carriedLoad, loadBand, itemAccessMinutes, travelRateKmh, startTravel, advanceTravel,
  minutesToCompleteTravel, startCraftProject, addCraftWorkTime, workCraftInterval, finishCraft,
  repairItem, dueHazardCheckpoints, consumeResource, ensureHazardProcesses, scheduleHazardCheckpoint
} from './exploration.mjs';
import { validateState, validateTransition } from './state_validator.mjs';
import { migrateState } from './state_migration.mjs';
import { WORLD_FOUNDATION, createLocationEntity, createWorldGenerationManifest, currentLocationId, currentLocationLabel, resolveLocationId, setPcLocation } from './world_foundation.mjs';
import { GENESIS, MANDATORY_IDENTITY_FIELDS, validateGenesisResult } from './genesis.mjs';
import { createCoreReferencePack, contentPackPins, createWorldGenesisSnapshot, generationZeroLiveNpcProjection, generationZeroRuntimeLocationProjection } from './world_genesis.mjs';
import { constructStartingRegion, resolveLocalConnection } from './starting_region.mjs';
import { derivePlayerScene } from './scene_builder.mjs';
import { constructStartingRegionSystems, advanceLocalSituation } from './starting_region_systems.mjs';
import { resolveStartingSituation, projectStartingSituation } from './starting_situation.mjs';
import { constructGeographicKnowledge, projectGeographicKnowledge, recordTravelGeographicKnowledge } from './geographic_knowledge.mjs';
import { projectPlayerMap } from './player_map.mjs';

const REQUIRED_IDENTITY = MANDATORY_IDENTITY_FIELDS;

export function createInitialState(input, campaignId, seed, { worldPacks=null } = {}) {
  const genesis=input?.contract_id===GENESIS.resultContract?input:null;
  if(genesis)validateGenesisResult(genesis);
  const identity=genesis?.identity||input;
  for (const key of REQUIRED_IDENTITY) if (identity[key]===undefined || String(identity[key]).trim()==='') throw new Error(`Missing character field: ${key}`);
  const age=Number(identity.age); if(!Number.isFinite(age)||age<=0||age>10000) throw new Error('Age must be a positive number.');
  const genesisMagic=defaultMagicState();
  if(genesis){
    genesisMagic.resource_model=genesis.magic_profile.resource_model;
    genesisMagic.law_profile.resource_model=genesis.magic_profile.resource_model;
    genesisMagic.mana=genesis.magic_profile.mana;
    genesisMagic.max_mana=genesis.magic_profile.max_mana;
    genesisMagic.known_operations=[...genesis.magic_profile.known_operations];
    genesisMagic.known_techniques=[...genesis.magic_profile.known_techniques];
  }
  const calendar=cloneDefaultCalendar();
  const startAbsolute=dateToAbsoluteMinute(DEFAULT_WORLD_START,calendar);
  const selectedWorldPacks=structuredClone(worldPacks??[createCoreReferencePack()]).sort((a,b)=>a.manifest.pack_id.localeCompare(b.manifest.pack_id)||a.manifest.pack_version.localeCompare(b.manifest.pack_version));
  const worldContentPins=contentPackPins(selectedWorldPacks);
  const magicEnabled=Boolean(genesis&&(genesis.magic_profile.known_operations.length||genesis.magic_profile.known_techniques.length));
  const arrivalProjection=generationZeroRuntimeLocationProjection(campaignId,'location_arrival_point');
  const arrival=createLocationEntity(campaignId,arrivalProjection.label,{location_id:arrivalProjection.location_id,source:arrivalProjection.provenance.source,world_genesis_entity_id:arrivalProjection.world_genesis_entity_id});
  const offDuty=createLocationEntity(campaignId,'Off Duty',{source:'world_generation'});
  const state={
    meta:{schema_version:CORE.schemaVersion,branch_id:CORE.branchId,namespace:CORE.namespace,campaign_id:campaignId,generation:0,created_at:nowIso(),rules_version:CORE.rulesVersion},
    world:{calendar,absolute_minute:startAbsolute,world_time:formatWorldTime(startAbsolute,calendar),time_label:formatWorldTime(startAbsolute,calendar).label,weather:'Unresolved',known_facts:[],hazards:[],routes:{},regions:{},settlements:{},locations:{[arrival.location_id]:arrival,[offDuty.location_id]:offDuty},fidelity:{contract_id:WORLD_FOUNDATION.fidelityContract,detail_by_location:{[arrival.location_id]:'local',[offDuty.location_id]:'local'},process_by_owner:{world:'strategic'}}},
    campaign_clock:{start_absolute_minute:startAbsolute,elapsed_minute:0,elapsed:{day:1,elapsed_minute:0,clock:'00:00',label:'Campaign Day 1 · +00:00'}},
    pc:{
      id:'pc_1',identity:{name:String(identity.name).trim(),age,race:String(identity.race).trim(),class:String(identity.class).trim(),gender:String(identity.gender).trim(),appearance:String(identity.appearance).trim(),background:String(identity.background).trim(),starting_goal:String(identity.starting_goal).trim()},
      location_id:arrival.location_id,attributes:genesis?structuredClone(genesis.attributes):defaultAttributes(),skills:genesis?structuredClone(genesis.skills):defaultSkills(),health:createHealthState(),carry_capacity:genesis?genesis.carry_capacity:12,magic:genesis?genesisMagic:defaultMagicState(),knowledge:genesis?structuredClone(genesis.knowledge):[],capabilities:genesis?structuredClone(genesis.capabilities):[],social_positions:genesis?structuredClone(genesis.social_positions):[],relationships:genesis?structuredClone(genesis.relationships):[],obligations:genesis?structuredClone(genesis.obligations):[],reputations:genesis?structuredClone(genesis.reputations):[],access_rights:genesis?structuredClone(genesis.access_rights):[],current_circumstances:genesis?structuredClone(genesis.current_circumstances):[],resource_positions:genesis?structuredClone(genesis.resource_positions):[],equipment_access:genesis?structuredClone(genesis.equipment):[],world_requirements:genesis?structuredClone(genesis.world_requirements):[],standing_instructions:{},
    },
    scene:{id:'scene_start',summary:'A new campaign has begun. The world is waiting for the first committed action.',present_npc_ids:[],evidence:[],unresolved_threads:[{id:'thread_goal',label:String(identity.starting_goal).trim(),status:'open'}]},
    npcs:{},
    inventory:{items:{
      starter_pack:normalizeItem({id:'starter_pack',name:'Travel Pack',quantity:1,load:2,tags:['container'],condition:'sound',owner_id:'pc_1',holder_id:'pc_1',custodian_id:'pc_1',access:'stowed'},'evt_gen0'),
      starter_materials:normalizeItem({id:'starter_materials',name:'Basic Materials',quantity:3,load:1,tags:['material'],condition:'sound',owner_id:'pc_1',container_id:'starter_pack',custodian_id:'pc_1',access:'packed'},'evt_gen0'),
    }},
    resources:genesis?structuredClone(genesis.starting_resources):{coin:20,rations:3,water:3,materials:3},
    scheduler:createSchedulerState(), projects:{travel:null,crafts:{},repairs:{}}, environment:{exposures:[]},
    perception:{observers:{},search_history:{},interpretations:{}}, resolution:{attempts:{}}, combat:null, agreements:{},
    rng:{seed,roll_index:0,contract_version:WORLD_FOUNDATION.randomnessContract},
    world_content_packs:selectedWorldPacks,
    world_content_pins:worldContentPins,
  };
  if(genesis){
    state.genesis=structuredClone(genesis);
    state.inventory.items=Object.fromEntries(genesis.equipment.filter(item=>item.carried).map(item=>[item.item_id,normalizeItem({id:item.item_id,name:item.name,quantity:item.quantity,load:item.load,tags:item.tags,condition:'sound',owner_id:item.owner_ref,holder_id:item.holder_ref,custodian_id:item.custodian_ref,access:item.access},'evt_gen0')]));
    state.pc.health.fatigue.level=genesis.health_profile.fatigue_level;
    state.pc.health.fatigue.label=['fresh','taxed','fatigued','exhausted','collapse'][genesis.health_profile.fatigue_level];
    state.pc.health.fatigue.sources=genesis.health_profile.fatigue_level?[{key:'genesis',source:'Genesis current circumstances'}]:[];
    state.pc.health.injuries=genesis.health_profile.injuries.map(injury=>({injury_id:injury.injury_id,body_location:'unspecified',harm_type:'physical',severity:injury.severity,source_event_id:'evt_gen0',healing_stage:'acute',active_threats:[],functional_effects:[],treatment_refs:[]}));
  }
  state.world_generation_manifest=createWorldGenerationManifest(state);
  state.world_genesis=createWorldGenesisSnapshot(state,{creation_requirements:genesis?.world_requirements||[],packs:state.world_content_packs,magic_enabled:magicEnabled});
  constructStartingRegion(state);
  state.scheduler.absolute_minute=startAbsolute;

  // Generation 0 contains a minimal campaign-local starting situation. The calendar and routine are generated external canon,
  // not imported lore from ERGP, ERGPT Ordinary Chat, ERGPT Work, or another campaign.
  const clerk=createNpc({
    id:'npc_arrival_clerk', name:'Arrival Clerk', role:'Clerk', location_id:arrival.location_id,
    traits:['professional','observant'],
    goals:[{goal_id:'npc_arrival_clerk_goal_duty',label:'Handle arrivals and routine questions',source_category:'role',source_ids:['evt_gen0'],priority:2}],
  });
  clerk.known_to_pc=false;
  clerk.attributes={Might:0,Agility:0,Endurance:0,Awareness:1,Intellect:1,Will:1,Presence:1};
  clerk.skills={Defence:0,Melee:0,Ranged:0,Perception:1,Persuasion:1,Insight:1};
  const clerkGenesis=state.world_genesis.materialized_npcs[clerk.id];
  Object.assign(clerk,{world_genesis_requirement_id:clerkGenesis.requirement_id,world_genesis_role_catalog_id:clerkGenesis.role_catalog_id,world_genesis_location_id:clerkGenesis.location_entity_id,world_genesis_population_id:clerkGenesis.population_id,world_genesis_institution_id:clerkGenesis.institution_id});
  state.npcs[clerk.id]=clerk;
  addNpcRoutine(clerk,{routine_id:'arrival_desk_shift',label:'Arrival desk shift',weekday_indices:[0,1,2,3,4,5,6],start_minute_of_day:minuteOfWorldDay(8,0,calendar),end_minute_of_day:minuteOfWorldDay(17,0,calendar),active_location_id:arrival.location_id,inactive_location_id:offDuty.location_id,activity:'staff_arrival_desk'},calendar);
  synchronizeNpcRoutine(state,clerk.id,'arrival_desk_shift',startAbsolute);
  constructStartingRegionSystems(state);
  const opening=resolveStartingSituation(state);
  constructGeographicKnowledge(state);
  if(opening.visible_npc_ids.includes(clerk.id)){clerk.known_to_pc=true;applyPerceptionCue(state,{observerId:'pc_1',subjectId:clerk.id,level:'observed',channel:'sight',identityKnown:true,location:arrival.location_id,sourceEventId:'evt_gen0',confidence:1});}
  scheduleNextNpcRoutineBoundary(state,clerk.id,'arrival_desk_shift',startAbsolute);
  scheduleProcess(state,{due_absolute_minute:startAbsolute+30,owner_id:clerk.id,kind:'npc_decision_checkpoint',priority:50,fidelity:'local',payload:{options:[
    {option_id:'continue_duty',action:'continue_duty',base:3,goal_id:'npc_arrival_clerk_goal_duty',plan_duration_minutes:30},
    {option_id:'review_queue',action:'review_queue',base:2,goal_id:'npc_arrival_clerk_goal_duty',plan_duration_minutes:20},
  ],player_relevance:1,consequence:1}});
  const creationSupport=Object.values(state.world_genesis.materialized_npcs).filter(npc=>npc.npc_id!==clerk.id);
  if(creationSupport.length){
    const rivergateProjection=generationZeroRuntimeLocationProjection(campaignId,'settlement_rivergate'),rivergate=createLocationEntity(campaignId,rivergateProjection.label,{location_id:rivergateProjection.location_id,source:rivergateProjection.provenance.source,world_genesis_entity_id:rivergateProjection.world_genesis_entity_id});state.world.locations[rivergate.location_id]=rivergate;state.world.fidelity.detail_by_location[rivergate.location_id]=rivergate.detail_fidelity;
    for(const canonical of creationSupport){const projection=generationZeroLiveNpcProjection(canonical),live=createNpc({id:canonical.npc_id,name:projection.name,role:projection.role,location_id:rivergate.location_id,traits:['established','professional'],goals:[{goal_id:`${canonical.npc_id}_goal_role`,label:'Fulfil established institutional responsibilities',source_category:'role',source_ids:['evt_gen0'],priority:2}]});Object.assign(live,{known_to_pc:false,world_genesis_requirement_id:canonical.requirement_id,world_genesis_role_catalog_id:canonical.role_catalog_id,world_genesis_location_id:canonical.location_entity_id,world_genesis_population_id:canonical.population_id,world_genesis_institution_id:canonical.institution_id});state.npcs[live.id]=live;}
  }
  validateState(state); return state;
}

export { carriedItemIds };
export function carriedMass(state,holderId) { return carriedLoad(state,holderId); }

function difficultyFor(intent, fallback='standard') {
  const d=String(intent.difficulty||'auto');
  return d!=='auto' && DC[d]!=null ? DC[d] : DC[fallback];
}
function healthSituation(state,tags=[]) { const h=situationFromHealth(state,tags); return h; }
function targetNpc(state,intent,playerInput='') {
  if(intent.target && state.npcs[intent.target]) return state.npcs[intent.target];
  const target=String(intent.target||'').toLowerCase();
  if(target) { const found=Object.values(state.npcs).find(n=>String(n.name).toLowerCase()===target || String(n.name).toLowerCase().includes(target)); if(found)return found; }
  const text=String(playerInput).toLowerCase();
  return Object.values(state.npcs).find(n=>text.includes(String(n.name).toLowerCase())) || (state.scene.present_npc_ids.length===1 ? state.npcs[state.scene.present_npc_ids[0]] : null);
}
function activeWeapon(state) {
  return carriedItemIds(state,'pc_1').map(id=>state.inventory.items[id]).find(i=>i.tags?.includes('weapon') && ['held','readied','worn'].includes(i.access)) || null;
}

function schedulerResolver(state, emit) {
  return (process,fidelity) => {
    const out={events:[],followups:[]};
    const event=(type,summary,data={},meta={})=>out.events.push({type,summary,data,meta:{...meta,world_absolute_minute:process.due_absolute_minute}});
    if(process.kind==='npc_decision_checkpoint') {
      const npc=state.npcs[process.owner_id]; if(!npc) return out;
      const decisionState={...state,world:{...state.world,absolute_minute:process.due_absolute_minute}};
      const proposal=proposeNpcDecision(npc,decisionState,process.payload?.options||[]);
      if(proposal.option_id) { npc.adaptive.intention={option_id:proposal.option_id,action:proposal.action,target_id:proposal.target_id||null,source:'decision_checkpoint',set_generation:state.meta.generation+1}; }
      npc.scheduler.next_decision_absolute_minute=proposal.next_review_absolute_minute;
      if(Number.isFinite(proposal.next_review_absolute_minute)&&proposal.next_review_absolute_minute>process.due_absolute_minute){
        out.followups.push({due_absolute_minute:proposal.next_review_absolute_minute,owner_id:npc.id,kind:'npc_decision_checkpoint',priority:process.priority,fidelity:process.fidelity,payload:structuredClone(process.payload||{})});
      }
      event('npc_decision_checkpoint','An NPC reached a decision checkpoint.',{npc_id:npc.id,proposal,fidelity},{known_by:[npc.id],entity_ids:[npc.id]});
    } else if(process.kind==='npc_routine_boundary') {
      const applied=applyNpcRoutineBoundary(state,process);
      if(applied.applied) {
        out.followups.push(applied.next_followup);
        event('npc_routine_changed',applied.is_present?`${state.npcs[applied.npc_id].name} arrived according to their world schedule.`:`${state.npcs[applied.npc_id].name} left according to their world schedule.`,{npc_id:applied.npc_id,routine_id:applied.routine_id,active:applied.active,previous_location_id:applied.previous_location_id,location_id:applied.location_id,activity:applied.activity,at_world_time:formatWorldTime(process.due_absolute_minute,state.world.calendar).label},{known_by:applied.witnessed_by_pc?['pc_1',applied.npc_id]:[applied.npc_id],entity_ids:[applied.npc_id],location_id:applied.location_id,world_absolute_minute:process.due_absolute_minute});
      }
    } else if(process.kind==='hazard_checkpoint') {
      const exposure=(state.environment.exposures||[]).find(e=>e.exposure_id===process.payload?.exposure_id);
      if(!exposure||exposure.status!=='active') return out;
      const checkpoint=Number(process.payload?.checkpoint||0);
      if(checkpoint<=Number(exposure.checkpoints_resolved||0)) return out;
      exposure.checkpoints_resolved=checkpoint;
      const carriedTags=new Set(carriedItemIds(state,'pc_1').flatMap(id=>state.inventory.items[id].tags||[]));
      const protectedFully=exposure.protection_tags.length>0 && exposure.protection_tags.every(t=>carriedTags.has(t));
      if(protectedFully) event('hazard_checkpoint_mitigated',`Protection prevented a ${exposure.kind} exposure consequence.`,{exposure_id:exposure.exposure_id,checkpoint},{known_by:['pc_1']});
      else if(exposure.automatic){
        if(exposure.consequence==='fatigue') changeFatigue(state,1,`hazard:${exposure.hazard_id}`);
        event('hazard_checkpoint_applied',`The ${exposure.kind} exposure reached an automatic consequence checkpoint.`,{exposure_id:exposure.exposure_id,checkpoint,severity:exposure.severity,consequence:exposure.consequence},{known_by:['pc_1']});
      } else {
        const hazardDc={minor:8,moderate:12,severe:16,critical:20}[exposure.severity] ?? 12;
        const hazardIntent={action_type:'HAZARD_RESIST',target:exposure.exposure_id,method:`resist ${exposure.kind}`,is_pc_voluntary:false};
        const resist=planAndResolve(state,hazardIntent,`hazard:${exposure.exposure_id}:${checkpoint}`,{attribute:'Endurance',skill:'Survival',dc:hazardDc,risk:exposure.severity==='critical'?'lethal':'dangerous',effect:'full',method:`resist ${exposure.kind}`,stakes:['survival','fatigue'],problem_state:{exposure_id:exposure.exposure_id,checkpoint,severity:exposure.severity}});
        event('hazard_resistance_resolved',`The ${exposure.kind} exposure reaches a resistance checkpoint.`,{exposure_id:exposure.exposure_id,checkpoint,severity:exposure.severity,outcome:resist.outcome,check:resist.check},{known_by:['pc_1']});
        if(['mixed','failure','severe_failure'].includes(resist.outcome)){
          if(exposure.consequence==='fatigue') changeFatigue(state,1,`hazard:${exposure.hazard_id}`);
          event('hazard_checkpoint_applied',`The ${exposure.kind} exposure creates a committed consequence after resistance resolves.`,{exposure_id:exposure.exposure_id,checkpoint,severity:exposure.severity,consequence:exposure.consequence,outcome:resist.outcome},{known_by:['pc_1']});
        }
      }
      const next=checkpoint+1;
      const due=exposure.onset_absolute_minute+next*exposure.interval_minutes;
      out.followups.push({process_id:`hazard_${sha256({exposureId:exposure.exposure_id,checkpoint:next}).slice(0,20)}`,due_absolute_minute:due,owner_id:'world',kind:'hazard_checkpoint',priority:30,fidelity:'local',payload:{exposure_id:exposure.exposure_id,checkpoint:next,original_due_absolute_minute:due,player_relevance:3,consequence:3}});
    } else if(process.kind==='local_situation_update') {
      const situation=advanceLocalSituation(state,process.payload?.situation_id);
      const interval=Number(process.payload?.interval_minutes||calendarMetrics(state.world.calendar).minutes_per_hour);
      out.followups.push({...process,due_absolute_minute:process.due_absolute_minute+interval,payload:{...process.payload,interval_minutes:interval}});
      event('local_situation_updated','A local pressure changed through its own world process.',{situation_id:situation.situation_id,current_state:situation.current_state,update_count:situation.update_count},{known_by:situation.visibility==='known'?['pc_1']:['internal'],entity_ids:situation.involved_entity_ids,location_id:situation.location_ids[0]});
    } else if(process.kind==='resource_demand') {
      const result=consumeResource(state,process.payload.resource,Number(process.payload.amount||0));
      event('resource_demand_resolved',result.shortfall?`${result.resource} ran short during a scheduled demand.`:`Scheduled ${result.resource} demand was met.`,result,{known_by:process.payload.known_by||['pc_1'],entity_ids:[process.owner_id]});
      if(process.payload.interval_minutes>0) out.followups.push({...process,due_absolute_minute:process.due_absolute_minute+Number(process.payload.interval_minutes),process_id:null});
    } else if(process.kind==='health_threat') {
      const payload=process.payload||{};
      if(payload.effect==='fatigue') changeFatigue(state,Number(payload.delta||1),`scheduled:${process.process_id}`);
      if(payload.effect==='injury' && payload.injury) addInjury(state,payload.injury);
      event('health_threat_resolved','A scheduled health threat reached its checkpoint.',{process_id:process.process_id,effect:payload.effect||null},{known_by:payload.known_by||['pc_1'],entity_ids:[process.owner_id]});
    } else if(process.kind==='world_notice') {
      event('world_notice',String(process.payload?.summary||'A scheduled world process occurred.'),process.payload||{},{known_by:process.payload?.known_by||['internal'],entity_ids:process.payload?.entity_ids||[]});
    } else {
      event('scheduled_process_due','A scheduled process reached its due time.',{process_id:process.process_id,kind:process.kind,fidelity},{known_by:process.payload?.known_by||['internal'],entity_ids:[process.owner_id]});
    }
    return out;
  };
}

function advanceWorldTime(state,events,emit,minutes,reason) {
  const amount=Math.max(0,Number(minutes||0)); if(amount<=0)return {minutes:0,scheduled:[]};
  const start=state.world.absolute_minute; const target=Number((start+amount).toFixed(6));
  // Legacy/migrated active exposures are reconciled into the same deterministic scheduler queue.
  ensureHazardProcesses(state);
  const planned=planAdvance(state,target,schedulerResolver(state,emit));
  state.scheduler=planned.scheduler;
  for(const r of planned.resolved) for(const e of r.events) emit(events,e.type,e.summary,e.data,e.meta);
  state.world.absolute_minute=target;
  state.campaign_clock.elapsed_minute=Number((target-state.campaign_clock.start_absolute_minute).toFixed(6));
  state.scheduler.absolute_minute=target; refreshTimeViews(state);
  emit(events,'time_advanced',`${Number(amount.toFixed(3))} world minute${Math.abs(amount-1)<1e-9?'':'s'} passed.`,{minutes:amount,reason,start_absolute_minute:start,end_absolute_minute:target,start_world_time:formatWorldTime(start,state.world.calendar).label,end_world_time:state.world.time_label,campaign_day:state.campaign_clock.elapsed.day},{known_by:['pc_1']});
  return {minutes:amount,scheduled:planned.resolved};
}

function canonicalEntityForLocation(state,locationId){
  let location=state.world.locations?.[locationId];
  while(location&&!location.world_genesis_entity_id&&location.parent_location_id)location=state.world.locations[location.parent_location_id];
  return location?.world_genesis_entity_id||null;
}

function authoritativeWorldRoute(state,fromLocationId,toLocationId){
  const from=canonicalEntityForLocation(state,fromLocationId),to=canonicalEntityForLocation(state,toLocationId);if(!from||!to||from===to)return null;
  return Object.values(state.world_genesis.graph.routes).find(route=>route.from_entity_id===from&&route.to_entity_id===to)||null;
}

function planAndResolve(state,intent,playerInput,opts) {
  const health=healthSituation(state,opts.health_tags||[]);
  if(health.infeasible) return {outcome:'infeasible',feasible:false,check:null,reason:health.reason,plan:null};
  const plan=buildResolutionPlan(state,intent,playerInput,{...opts,situation:clamp(Number(opts.situation||0)+health.modifier,-4,4)});
  return resolvePlan(state,plan,{hiddenDc:opts.hiddenDc===true,allowRepeated:opts.allowRepeated===true});
}


function npcCombatSituation(npc) {
  ensureNpcHealth(npc);
  let mod=0;
  for(const injury of npc.health.injuries||[]){
    if(injury.healing_stage==='resolved'||!(injury.functional_effects||[]).includes('demanding')) continue;
    if(injury.severity==='critical') return {infeasible:true,modifier:-4,reason:`critical injury ${injury.injury_id}`};
    mod-=injury.severity==='severe'?3:injury.severity==='moderate'?2:1;
  }
  return {infeasible:false,modifier:clamp(mod,-4,4),reason:null};
}

function npcAttackResolution(state,npc,{exchangeNumber,method='attack'}={}) {
  const injury=npcCombatSituation(npc);
  if(injury.infeasible) return {outcome:'infeasible',feasible:false,check:null,reason:injury.reason,plan:null};
  const intent={action_type:'COMBAT',summary:`${npc.name} attacks`,target:'pc_1',duration_minutes:null,distance_km:null,skill:'Melee',attribute:'Agility',difficulty:'auto',method,is_pc_voluntary:false};
  const plan=buildResolutionPlan(state,intent,method,{actor_id:npc.id,attribute:'Agility',skill:'Melee',dc:pcDefenceThreshold(state),risk:'risky',effect:'full',method,stakes:['position','injury'],target:'pc_1',situation:injury.modifier,problem_state:{combat_id:state.combat.combat_id,exchange:exchangeNumber,actor_id:npc.id,target_id:'pc_1'}});
  return resolvePlan(state,plan);
}

function pcAttackResolution(state,intent,playerInput,npc,exchangeNumber) {
  const ranged=/shoot|bow|arrow|throw|ranged/i.test(playerInput);
  const force=/grapple|shove|smash|heavy|force/i.test(playerInput);
  const attribute=force?'Might':'Agility';
  const skill=ranged?'Ranged':'Melee';
  return planAndResolve(state,intent,playerInput,{attribute,skill,dc:defenceThreshold(npc),risk:'dangerous',effect:'full',method:playerInput,stakes:['position','injury'],target:npc.id,health_tags:['demanding'],problem_state:{combat_id:state.combat.combat_id,exchange:exchangeNumber,actor_id:'pc_1',target_id:npc.id}});
}

function pendingPcAttackHarm(state,resolution,playerInput) {
  if(!['mixed','success','exceptional_success'].includes(resolution?.outcome)) return null;
  const weapon=activeWeapon(state);
  const nonlethal=/nonlethal|knock out|subdue/i.test(playerInput);
  return {potential:harmPotential({weapon:weapon?{harm:Number(weapon.harm||2)}:{harm:1},outcome:resolution.outcome,effect:resolution.plan?.effect||'full',nonlethal}),penetration:Number(weapon?.penetration||0),sourceEventId:resolution.check?.roll_id||resolution.plan?.plan_digest,nonlethal};
}

function applyPendingNpcHarm(state,npc,pending,events,emit) {
  if(!pending) return null;
  const hit=applyNpcHarm(npc,pending);
  if(hit.injury) emit(events,'npc_injury_added',`${npc.name} suffers a ${hit.injury.severity} injury.`,{npc_id:npc.id,injury:hit.injury},{known_by:['pc_1',npc.id],entity_ids:['pc_1',npc.id]});
  const morale=npcMoraleChoice(npc,{escapeAvailable:true});
  if(morale!=='continue') emit(events,'npc_morale_pressure',`${npc.name} is under enough pressure to reconsider continuing.`,{npc_id:npc.id,morale_choice:morale},{known_by:['pc_1',npc.id],entity_ids:[npc.id]});
  return hit;
}

function pendingNpcAttackHarm(resolution) {
  if(!['mixed','success','exceptional_success'].includes(resolution?.outcome)) return null;
  return {potential:harmPotential({weapon:{harm:1},outcome:resolution.outcome,effect:resolution.plan?.effect||'full'}),penetration:0,sourceEventId:resolution.check?.roll_id||resolution.plan?.plan_digest,nonlethal:false};
}

function applyPendingPcHarm(state,npc,pending,events,emit) {
  if(!pending) return null;
  const hit=applyPcHarm(state,pending);
  if(hit.injury) emit(events,'pc_injury_added',`${state.pc.identity.name} suffers a ${hit.injury.severity} injury from ${npc.name}'s attack.`,{npc_id:npc.id,injury:hit.injury},{known_by:['pc_1',npc.id],entity_ids:['pc_1',npc.id]});
  return hit;
}

function resolveNpcCombatContribution(state,npc,events,emit,{exchangeNumber,deferAttackHarm=false,forcedChoice=null}={}) {
  const choice=forcedChoice||npcMoraleChoice(npc,{escapeAvailable:true});
  if(choice==='surrender-seeking') {
    const offer=offerSurrender(state,npc.id,{terms:'surrender'});
    recordExchangeContribution(state,npc.id,{kind:'surrender_offer',offer_id:offer.offer_id});
    emit(events,'surrender_offered',`${npc.name} offers surrender; the player character has not accepted it.`,{offer_id:offer.offer_id,offered_by:npc.id,terms:offer.terms},{known_by:['pc_1',npc.id],entity_ids:['pc_1',npc.id]});
    return {kind:'surrender',resolution:null,pendingHarm:null};
  }
  if(choice==='withdrawing') {
    const request=requestRetreat(state,npc.id,{method:'break contact from the engagement',opposed:true});
    const injury=npcCombatSituation(npc);
    let result;
    if(!request.feasible||injury.infeasible) result={outcome:'infeasible',feasible:false,check:null,reason:request.reason||injury.reason,plan:null};
    else {
      const intent={action_type:'COMBAT',summary:`${npc.name} attempts to withdraw`,target:'pc_1',skill:'Defence',attribute:'Agility',method:'break contact',is_pc_voluntary:false};
      const plan=buildResolutionPlan(state,intent,'break contact',{actor_id:npc.id,attribute:'Agility',skill:'Defence',dc:pcDefenceThreshold(state),risk:'dangerous',effect:'full',method:'break contact',stakes:['escape','position'],target:'pc_1',situation:injury.modifier,problem_state:{combat_id:state.combat.combat_id,exchange:exchangeNumber,actor_id:npc.id,goal:'withdraw'}});
      result=resolvePlan(state,plan);
    }
    emitInternalResolutionAudit(events,emit,result,{actorId:npc.id,context:'combat_retreat'});
    recordExchangeContribution(state,npc.id,{kind:'retreat',outcome:result.outcome});
    if(['success','exceptional_success'].includes(result.outcome)) {
      const done=completeRetreat(state,npc.id,{route:'break_contact'});
      emit(events,'npc_retreat_completed',`${npc.name} successfully breaks contact and withdraws.`,{npc_id:npc.id,...done},{known_by:['pc_1',npc.id],entity_ids:['pc_1',npc.id]});
    } else emit(events,'npc_retreat_contested',`${npc.name} tries to withdraw but remains engaged.`,{npc_id:npc.id,outcome:result.outcome},{known_by:['pc_1',npc.id],entity_ids:['pc_1',npc.id]});
    return {kind:'retreat',resolution:result,pendingHarm:null};
  }
  const result=npcAttackResolution(state,npc,{exchangeNumber,method:`${npc.name} attacks ${state.pc.identity.name}`});
  emitInternalResolutionAudit(events,emit,result,{actorId:npc.id,context:'combat_attack'});
  recordExchangeContribution(state,npc.id,{kind:'attack',outcome:result.outcome,plan_digest:result.plan?.plan_digest||null});
  emit(events,'npc_attack_resolved',`${npc.name} makes their own hostile contribution to the exchange.`,{npc_id:npc.id,outcome:result.outcome,natural:result.check?.natural??null,total:result.check?.total??null,plan_digest:result.plan?.plan_digest||null},{known_by:['pc_1',npc.id],entity_ids:['pc_1',npc.id]});
  const pendingHarm=pendingNpcAttackHarm(result);
  if(!deferAttackHarm) applyPendingPcHarm(state,npc,pendingHarm,events,emit);
  return {kind:'attack',resolution:result,pendingHarm};
}

function emitInternalResolutionAudit(events,emit,resolution,{actorId='unknown',context='resolution'}={}) {
  if(!resolution?.plan || !resolution?.check) return;
  emit(events,'resolution_audit','A resolution plan was executed against the committed pre-roll contract.',{actor_id:actorId,context,plan:resolution.plan,check:resolution.check,outcome:resolution.outcome},{known_by:['internal'],entity_ids:actorId&&actorId!=='unknown'?[actorId]:[]});
}

function consequenceFromRisk(state,events,emit,resolution,context='attempt') {
  if(!resolution?.plan || !['failure','severe_failure','mixed'].includes(resolution.outcome))return;
  const risk=resolution.plan.risk;
  if(risk==='controlled') return;
  if(risk==='risky' && resolution.outcome==='severe_failure') { changeFatigue(state,1,context); emit(events,'fatigue_changed','The failed attempt leaves the character taxed.',{level:state.pc.health.fatigue.level,reason:context},{known_by:['pc_1']}); }
  // Dangerous/lethal harm requires an explicit opposing/hazard cause; generic resolution does not invent an injury.
}

export function resolveTurn(currentState,intent,playerInput) {
  if(!intent?.is_pc_voluntary) throw new Error('Engine rejected an intent that was not a voluntary PC contribution.');
  const migrated=migrateState(currentState); const state=migrated.state; validateState(state);
  const events=[]; const emit=createEventEmitter(state,playerInput); const action=intent.action_type; const pendingTravelDiscoveries=[];
  let resolution={action_type:action,outcome:'resolved_without_roll',check:null,feasible:true,plan:null};
  if(migrated.migrated) emit(events,'state_schema_migrated',`The campaign runtime state was migrated to ERGPT External schema v${migrated.to_schema}.`,{from_schema:migrated.from_schema,to_schema:migrated.to_schema},{known_by:['pc_1']});
  if(state.pc.health.life_status==='dead') return {state:currentState,events:[],resolution:{action_type:action,outcome:'infeasible',feasible:false,reason:'The player character is dead.'}};

  if(action==='LOOK') {
    advanceWorldTime(state,events,emit,1,'look');
    emit(events,'scene_observed','The player character takes stock of the immediate scene without inventing hidden facts.',{location_id:currentLocationId(state)},{known_by:['pc_1']});
  } else if(action==='WAIT') {
    advanceWorldTime(state,events,emit,intent.duration_minutes||calendarMetrics(state.world.calendar).minutes_per_hour,'wait');
  } else if(action==='REST') {
    const minutes=intent.duration_minutes||480; advanceWorldTime(state,events,emit,minutes,'rest');
    const delta=minutes>=480?-2:minutes>=120?-1:0; if(delta) { const f=changeFatigue(state,delta,'rest'); emit(events,'fatigue_changed',`Fatigue is now ${state.pc.health.fatigue.label}.`,f,{known_by:['pc_1']}); }
    if(minutes>=240 && state.pc.magic.resource_model==='internal_mana') { const before=state.pc.magic.mana; state.pc.magic.mana=Math.min(state.pc.magic.max_mana,before+Math.floor(minutes/120)); if(before!==state.pc.magic.mana)emit(events,'mana_restored','Fictional-time rest restored magical reserve.',{before,after:state.pc.magic.mana},{known_by:['pc_1']}); }
  } else if(action==='INVESTIGATE') {
    const method=(intent.method||(/arcane|magic/i.test(playerInput)?'arcane_analysis':'search'));
    const available=(state.scene.evidence||[]).filter(e=>e.location_id===currentLocationId(state) && e.methods?.includes(method) && !e.destroyed && !e.discovered_by?.includes('pc_1'));
    const dc=available.length?Math.max(DC.easy,Math.min(DC.legendary,DC.standard+Math.max(...available.map(e=>Number(e.obscurity||0)))*2)):difficultyFor(intent,'standard');
    resolution=planAndResolve(state,intent,playerInput,{attribute:'Intellect',skill:'Investigation',dc,risk:'controlled',effect:'full',method,stakes:['time','exposure'],problem_state:{location_id:currentLocationId(state),method,evidence_ids:available.map(e=>e.evidence_id),evidence_version:state.scene.evidence.length}});
    if(resolution.outcome==='repeat_blocked') { emit(events,'repeat_attempt_blocked',resolution.reason,{attempt_identity:resolution.plan.attempt_identity},{known_by:['pc_1']}); }
    else {
      const search=searchEvidence(state,{actorId:'pc_1',method,locationId:currentLocationId(state),outcome:resolution.outcome,attemptKey:resolution.plan?.attempt_identity});
      advanceWorldTime(state,events,emit,intent.duration_minutes||10,'investigation');
      for(const id of search.discovered) { const e=state.scene.evidence.find(x=>x.evidence_id===id); emit(events,'evidence_discovered',e?.description||'Evidence was discovered.',{evidence_id:id,fact_ids:e?.fact_ids||[],method},{known_by:['pc_1'],entity_ids:['pc_1']}); }
      emit(events,'investigation_resolved','Investigation resolved against evidence that already existed in committed world state.',search,{known_by:['pc_1']});
    }
  } else if(action==='TALK') {
    const npc=targetNpc(state,intent,playerInput);
    const socialKind=/intimidat|threat/i.test(playerInput)?'intimidate':/deceiv|\blie\b|bluff/i.test(playerInput)?'deception':/negotiat|\bdeal\b|offer terms|bargain/i.test(playerInput)?'negotiate':/persuad|convinc|request|ask/i.test(playerInput)?'request':'conversation';
    if(npc && socialKind!=='conversation') {
      ensureNpcHealth(npc); const skill=socialKind==='intimidate'?'Intimidation':socialKind==='deception'?'Deception':'Persuasion';
      resolution=planAndResolve(state,intent,playerInput,{attribute:'Presence',skill,dc:socialResistance(npc,socialKind),risk:'controlled',effect:'full',method:playerInput,stakes:['belief_pressure','relationship_pressure'],target:npc.id});
      if(resolution.outcome!=='repeat_blocked') {
        const communicationEvent=emit(events,'social_communication',`${state.pc.identity.name} directs a ${socialKind} attempt toward ${npc.name}.`,{npc_id:npc.id,kind:socialKind,proposition:intent.summary||playerInput},{known_by:['pc_1',npc.id],entity_ids:['pc_1',npc.id]});
        npc.adaptive.known_event_ids ||= []; if(!npc.adaptive.known_event_ids.includes(communicationEvent.id)) npc.adaptive.known_event_ids.push(communicationEvent.id);
        if(socialKind==='deception') {
          const belief=applyDeceptionBelief(npc,{proposition:intent.summary||playerInput,outcome:resolution.outcome,communicationEventId:communicationEvent.id,generation:state.meta.generation+1});
          emit(events,'npc_belief_pressure',belief.updated?`${npc.name}'s belief state changes in response to the claim.`:`${npc.name}'s belief state resists the claim.`,{npc_id:npc.id,updated:belief.updated,reason:belief.reason||null,belief_id:belief.belief?.belief_id||null},{known_by:[npc.id],entity_ids:[npc.id]});
        }
        const choice=resolveNpcSocialChoice(npc,state,{outcome:resolution.outcome,request:{summary:intent.summary||playerInput,conflict_with_goal:false,urgency:false},leverage:[]});
        const decisionEvent=emit(events,'npc_social_decision',`${npc.name} makes their own response to the social attempt.`,{npc_id:npc.id,response:choice.proposal.action||'no_decision',pressure:choice.pressure,proposal_id:choice.proposal.proposal_id,grants_decision:false},{known_by:['pc_1',npc.id],entity_ids:['pc_1',npc.id]});
        if(socialKind==='negotiate' && choice.proposal.action==='agree') {
          const agreement=createAgreement(state,{parties:['pc_1',npc.id],terms:intent.summary||playerInput,sourceEventId:decisionEvent.id,acceptedBy:['pc_1',npc.id]});
          emit(events,'agreement_committed','A durable agreement is committed only after both parties accept its explicit terms.',{agreement_id:agreement.agreement_id,parties:agreement.parties,terms:agreement.terms},{known_by:['pc_1',npc.id],entity_ids:['pc_1',npc.id]});
        }
        applySocialAftermath(npc,{kind:socialKind,outcome:resolution.outcome,sourceEventId:decisionEvent.id,truthful:socialKind!=='deception'});
      }
    } else emit(events,'social_attempt_recorded',npc?`Conversation with ${npc.name} proceeds without a coercive resolution check.`:'The player character speaks, but no committed target NPC was identified.',{npc_id:npc?.id||null},{known_by:['pc_1',...(npc?[npc.id]:[])]});
    advanceWorldTime(state,events,emit,Math.max(1,intent.duration_minutes||3),'conversation');
  } else if(action==='STEALTH') {
    const observers=(state.scene.present_npc_ids||[]).map(id=>state.npcs[id]).filter(Boolean);
    if(!observers.length) {
      advanceWorldTime(state,events,emit,2,'stealth preparation'); emit(events,'stealth_no_observer','No committed observer is currently available to oppose the covert action.',{}, {known_by:['pc_1']});
    } else {
      const hardest=Math.max(...observers.map(n=>10+Number(n.attributes?.Awareness||0)+Number(n.skills?.Perception||0)));
      const breakObservation=/cover|corner|dark|distraction|hide behind|out of sight/i.test(playerInput);
      resolution=planAndResolve(state,intent,playerInput,{attribute:'Agility',skill:'Stealth',dc:hardest,risk:'risky',effect:'full',method:playerInput,stakes:['exposure'],problem_state:{location_id:currentLocationId(state),observer_ids:observers.map(n=>n.id),breakObservation}});
      if(resolution.check) for(const npc of observers) {
        ensureObserverState(state,npc.id); const dc=10+Number(npc.attributes?.Awareness||0)+Number(npc.skills?.Perception||0); const band=outcomeForTotal(resolution.check.total,dc,resolution.check.natural);
        const rr=resolveStealthForObserver({state,observerId:npc.id,subjectId:'pc_1',outcome:band.outcome,breakObservation,location:currentLocationId(state),sourceEventId:null});
        emit(events,'observer_awareness_changed',`${npc.name}'s awareness resolves independently.`,{observer_id:npc.id,outcome:band.outcome,current_awareness:rr.awareness.current_awareness,known_identity:rr.awareness.known_identity},{known_by:['pc_1',npc.id],entity_ids:['pc_1',npc.id]});
      }
      advanceWorldTime(state,events,emit,2,'stealth attempt'); consequenceFromRisk(state,events,emit,resolution,'stealth');
    }
  } else if(action==='MAGIC') {
    const bp=blueprintFromIntent(intent,playerInput); const authorizeOverdraw=/overdraw|use my life|push beyond/i.test(playerInput); const valid=validateCast(state,bp,{authorizeOverdraw});
    if(!valid.feasible) resolution={action_type:action,outcome:'infeasible',feasible:false,check:null,reason:valid.reason,plan:null,magic:{blueprint:bp,validation:valid}};
    else {
      const paid=payCastCost(state,valid); emit(events,'magic_resource_spent','Magical resource cost was committed before narration.',paid,{known_by:['pc_1']});
      if(valid.formation_uncertain) resolution=planAndResolve(state,intent,playerInput,{attribute:'Intellect',skill:'Arcana',dc:valid.dc,risk:valid.overdraw?'dangerous':'risky',effect:'full',method:`form:${bp.blueprint_id}`,stakes:['mana','strain'],problem_state:{law_profile:state.pc.magic.law_profile.profile_id,blueprint_id:bp.blueprint_id,load:valid.load,cost:valid.cost}});
      else resolution={action_type:action,outcome:'success',feasible:true,check:null,certain:true,plan:null};
      const formation=formationFromOutcome(bp,resolution.outcome,'full'); const applied=applyMagicEffect(state,bp,formation,{destination:intent.target||null});
      if(valid.overdraw>0){changeFatigue(state,1,`magic_overdraw:${bp.blueprint_id}`);emit(events,'magic_overdraw','The explicitly authorized overdraw created physiological strain.',{overdraw:valid.overdraw,fatigue:state.pc.health.fatigue.level},{known_by:['pc_1']});}
      emit(events,'magic_formation_resolved',formation.formed?'The magical working forms according to the committed law profile.':'The magical working fails to form.',{blueprint:bp,validation:valid,formation,application:applied},{known_by:['pc_1']});
      advanceWorldTime(state,events,emit,Math.max(1,bp.casting_time_minutes||1),'magic'); consequenceFromRisk(state,events,emit,resolution,'magic');
    }
  } else if(action==='COMBAT') {
    const npc=targetNpc(state,intent,playerInput);
    if(!npc) resolution={action_type:action,outcome:'infeasible',feasible:false,check:null,reason:'No committed target NPC could be identified.',plan:null};
    else {
      ensureNpcHealth(npc);
      if(!state.combat?.active) {
        startCombat(state,npc.id,{pcGoal:/capture|subdue/i.test(playerInput)?'capture':'unspecified',npcGoal:'survive'});
        emit(events,'combat_started',`Combat begins with ${npc.name}.`,{combat_id:state.combat.combat_id,target_id:npc.id,initiative_groups:state.combat.initiative_groups},{known_by:['pc_1',npc.id],entity_ids:['pc_1',npc.id]});
      }
      const exchangeNumber=Number(state.combat.exchange||0)+1;
      beginExchange(state);
      const openNpcOffer=(state.combat.surrender_offers||[]).find(o=>o.offered_by===npc.id && ['offered','negotiating'].includes(o.status));
      const acceptNpcSurrender=Boolean(openNpcOffer && /(?:accept|take)\b.*(?:surrender|yield)|(?:surrender|yield)\b.*accept/i.test(playerInput));
      const refuseNpcSurrender=Boolean(openNpcOffer && /(?:refuse|reject)\b.*(?:surrender|yield)|(?:surrender|yield)\b.*(?:refuse|reject)/i.test(playerInput));
      const negotiateNpcSurrender=Boolean(openNpcOffer && /negotiate|terms|conditions/i.test(playerInput));
      const surrender=!acceptNpcSurrender&&!refuseNpcSurrender&&!negotiateNpcSurrender && /\bsurrender\b|give myself up|\byield\b/i.test(playerInput);
      const retreat=/\bretreat\b|withdraw|disengage|flee|escape/i.test(playerInput);

      if(acceptNpcSurrender) {
        recordExchangeContribution(state,'pc_1',{kind:'surrender_response',response:'accept',offer_id:openNpcOffer.offer_id});
        respondToSurrender(state,openNpcOffer.offer_id,'pc_1','accept');
        emit(events,'surrender_accepted',`${state.pc.identity.name} explicitly accepts ${npc.name}'s surrender.`,{offer_id:openNpcOffer.offer_id,accepted_by:'pc_1'},{known_by:['pc_1',npc.id],entity_ids:['pc_1',npc.id]});
        resolution={action_type:action,outcome:'surrender_accepted',feasible:true,check:null,plan:null};
      } else if(refuseNpcSurrender||negotiateNpcSurrender) {
        const response=negotiateNpcSurrender?'negotiate':'refuse';
        recordExchangeContribution(state,'pc_1',{kind:'surrender_response',response,offer_id:openNpcOffer.offer_id});
        respondToSurrender(state,openNpcOffer.offer_id,'pc_1',response);
        emit(events,'surrender_response',`${state.pc.identity.name} ${response==='refuse'?'refuses':'negotiates'} the surrender offer.`,{offer_id:openNpcOffer.offer_id,response},{known_by:['pc_1',npc.id],entity_ids:['pc_1',npc.id]});
        resolution={action_type:action,outcome:response==='refuse'?'surrender_refused':'surrender_negotiating',feasible:true,check:null,plan:null};
      } else if(surrender) {
        const offer=offerSurrender(state,'pc_1',{terms:intent.summary||playerInput,explicitPcChoice:true});
        recordExchangeContribution(state,'pc_1',{kind:'surrender_offer',offer_id:offer.offer_id});
        emit(events,'surrender_offered',"The player character explicitly offers surrender; acceptance remains the opponent's decision.",{offer_id:offer.offer_id,offered_by:'pc_1',terms:offer.terms},{known_by:['pc_1',npc.id],entity_ids:['pc_1',npc.id]});
        resolution={action_type:action,outcome:'offer_made',feasible:true,check:null,plan:null};
      } else if(retreat) {
        const routeMatch=String(playerInput).match(/(?:through|via|toward|towards|to)\s+([^,.]+)/i);
        const route=routeMatch?.[1]?.trim()||null;
        const req=requestRetreat(state,'pc_1',{route,method:route?playerInput:null,opposed:true});
        if(!req.feasible) resolution={action_type:action,outcome:'infeasible',feasible:false,check:null,reason:req.reason,plan:null};
        else {
          resolution=planAndResolve(state,intent,playerInput,{attribute:'Agility',skill:'Acrobatics',dc:defenceThreshold(npc),risk:'dangerous',effect:'full',method:playerInput,stakes:['escape','position'],target:npc.id,problem_state:{combat_id:state.combat.combat_id,exchange:exchangeNumber,route}});
          recordExchangeContribution(state,'pc_1',{kind:'retreat',outcome:resolution.outcome,route});
          if(['success','exceptional_success'].includes(resolution.outcome)) { const done=completeRetreat(state,'pc_1',{route}); emit(events,'combat_retreat_completed','The retreat succeeds through the declared route.',done,{known_by:['pc_1',npc.id],entity_ids:['pc_1',npc.id]}); }
          else emit(events,'combat_retreat_contested','The retreat remains contested; the character is not teleported out of combat.',{route,outcome:resolution.outcome},{known_by:['pc_1',npc.id],entity_ids:['pc_1',npc.id]});
        }
        if(!state.combat.current_exchange.contributions.pc_1) recordExchangeContribution(state,'pc_1',{kind:'retreat_failed_to_form',outcome:resolution.outcome});
      } else {
        const pcPos=initiativePosition(state,'pc_1');
        const npcPos=initiativePosition(state,npc.id);
        const simultaneous=pcPos.group_index===npcPos.group_index;
        if(simultaneous && ['continue','reconsider'].includes(npcMoraleChoice(npc,{escapeAvailable:true}))) {
          // Both attacks are resolved against the same pre-harm exchange state. Harm is committed only after both rolls exist.
          const npcAction=resolveNpcCombatContribution(state,npc,events,emit,{exchangeNumber,deferAttackHarm:true,forcedChoice:'continue'});
          resolution=pcAttackResolution(state,intent,playerInput,npc,exchangeNumber);
          recordExchangeContribution(state,'pc_1',{kind:'attack',outcome:resolution.outcome,plan_digest:resolution.plan?.plan_digest||null});
          const pcPending=pendingPcAttackHarm(state,resolution,playerInput);
          applyPendingNpcHarm(state,npc,pcPending,events,emit);
          applyPendingPcHarm(state,npc,npcAction.pendingHarm,events,emit);
          emit(events,'combat_simultaneous_group','Exact initiative ties resolved as overlapping contributions before either injury changed the other action.',{actor_ids:['pc_1',npc.id],exchange:exchangeNumber},{known_by:['pc_1',npc.id],entity_ids:['pc_1',npc.id]});
        } else if(npcPos.group_index<pcPos.group_index) {
          resolveNpcCombatContribution(state,npc,events,emit,{exchangeNumber});
          if(state.combat.active && state.combat.participants.includes(npc.id)) {
            resolution=pcAttackResolution(state,intent,playerInput,npc,exchangeNumber);
            recordExchangeContribution(state,'pc_1',{kind:'attack',outcome:resolution.outcome,plan_digest:resolution.plan?.plan_digest||null});
            applyPendingNpcHarm(state,npc,pendingPcAttackHarm(state,resolution,playerInput),events,emit);
          } else {
            resolution={action_type:action,outcome:'infeasible',feasible:false,check:null,reason:`${npc.name} disengaged before the later initiative contribution could reach them.`,plan:null};
            recordExchangeContribution(state,'pc_1',{kind:'attack_lost_to_initiative',outcome:'infeasible'});
          }
        } else {
          resolution=pcAttackResolution(state,intent,playerInput,npc,exchangeNumber);
          recordExchangeContribution(state,'pc_1',{kind:'attack',outcome:resolution.outcome,plan_digest:resolution.plan?.plan_digest||null});
          applyPendingNpcHarm(state,npc,pendingPcAttackHarm(state,resolution,playerInput),events,emit);
          if(state.combat.active && state.combat.participants.includes(npc.id)) resolveNpcCombatContribution(state,npc,events,emit,{exchangeNumber});
        }
      }
      const exchange=finishExchange(state,{duration_minutes:1/6});
      advanceWorldTime(state,events,emit,exchange.duration_minutes,'combat exchange');
      consequenceFromRisk(state,events,emit,resolution,'combat');
    }
  } else if(action==='TRAVEL') {
    const target=String(intent.target||'').trim();
    if(!state.projects.travel?.status || ['complete','cancelled'].includes(state.projects.travel?.status)) {
      const targetLocationId=target?resolveLocationId(state,target):null;
      if(!targetLocationId)resolution={action_type:action,outcome:'infeasible',feasible:false,check:null,reason:'Travel target is not an established persistent location.',plan:null};
      else {
        const local=resolveLocalConnection(state,targetLocationId);
        if(local.connection){
          if(!local.feasible)resolution={action_type:action,outcome:'infeasible',feasible:false,check:null,reason:local.reason,plan:null};
          else if(local.connection.distance_scale==='regional'||local.connection.travel_minutes>=calendarMetrics(state.world.calendar).minutes_per_hour){
            const minutesPerHour=calendarMetrics(state.world.calendar).minutes_per_hour,baselineDistance=5*(local.connection.travel_minutes/minutesPerHour),factor=travelRateKmh(state,{base_rate:1,terrain_factor:1,activity:'travel',pace:'normal'}),baseRate=5/factor;
            startTravel(state,{target_location_id:targetLocationId,total_distance_km:baselineDistance,route_id:local.connection.connection_id,base_rate:baseRate,terrain_factor:1,activity:'travel',pace:'normal'});
          }
          else {
            advanceWorldTime(state,events,emit,local.connection.travel_minutes,'authoritative local movement');
            setPcLocation(state,targetLocationId);refreshScheduledNpcPresence(state);
            const movementEvent=emit(events,'local_movement_completed',`Movement to ${state.world.locations[targetLocationId].label} is complete.`,{connection_id:local.connection.connection_id,from_location_id:local.connection.from_location_id,to_location_id:targetLocationId,travel_minutes:local.connection.travel_minutes},{known_by:['pc_1'],location_id:targetLocationId});
            pendingTravelDiscoveries.push({event:movementEvent,route_id:local.connection.connection_id});
            resolution={action_type:action,outcome:'local_movement_completed',feasible:true,check:null,plan:null};
          }
        }else{
          const route=authoritativeWorldRoute(state,state.pc.location_id,targetLocationId);
          if(!route)resolution={action_type:action,outcome:'infeasible',feasible:false,check:null,reason:local.reason,plan:null};
          else {
            const minutesPerHour=calendarMetrics(state.world.calendar).minutes_per_hour,baseRate=route.distance/(route.travel_time_model.minutes/minutesPerHour);
            startTravel(state,{target_location_id:targetLocationId,total_distance_km:route.distance,route_id:route.route_id,base_rate:baseRate,terrain_factor:1,activity:'travel',pace:'normal'});
          }
        }
      }
    }
    if(resolution.feasible!==false && resolution.outcome!=='local_movement_completed') {
      const p=state.projects.travel; const totalMinutes=minutesToCompleteTravel(state,p); const requested=intent.duration_minutes||totalMinutes; const intended=Math.min(requested,totalMinutes);
      const interrupt=nextInterruptMinute(state,state.world.absolute_minute+intended); const actual=interrupt==null?intended:Math.max(0,interrupt-state.world.absolute_minute);
      const moved=advanceTravel(state,actual); advanceWorldTime(state,events,emit,actual,'travel'); refreshScheduledNpcPresence(state);
      if(actual>=120) {changeFatigue(state,1,'travel');emit(events,'fatigue_changed',`Travel leaves the character ${state.pc.health.fatigue.label}.`,{level:state.pc.health.fatigue.level},{known_by:['pc_1']});}
      const travelEvent=emit(events,p.status==='complete'?'travel_completed':'travel_progressed',p.status==='complete'?`Travel to ${state.world.locations[p.target_location_id].label} is complete.`:`Travel is interrupted/paused with ${p.remaining_distance_km.toFixed(2)} km remaining.`,{project_id:p.project_id,route_id:p.route_id,target_location_id:p.target_location_id,distance_completed_km:moved.distance_km,total_completed_km:p.completed_distance_km,remaining_distance_km:p.remaining_distance_km,rate_kmh:moved.rate_kmh},{known_by:['pc_1']});
      if(p.status==='complete')pendingTravelDiscoveries.push({event:travelEvent,route_id:p.route_id});
    }
  } else if(action==='CRAFT') {
    const active=Object.values(state.projects.crafts).find(p=>p.status==='active'); let p=active;
    if(!p) { try { p=startCraftProject(state,{recipe_id:'generic',output_name:intent.target||'Crafted Item',required_progress:4,required_materials:1}); emit(events,'craft_project_started',`A craft project for ${p.output_name} begins.`,{project_id:p.project_id,work_interval_minutes:p.work_interval_minutes,required_progress:p.required_progress},{known_by:['pc_1']}); } catch(e){ resolution={action_type:action,outcome:'infeasible',feasible:false,check:null,reason:e.message,plan:null}; } }
    if(p && resolution.feasible!==false) {
      const minutes=Math.max(1,intent.duration_minutes||p.work_interval_minutes); const work=addCraftWorkTime(state,p.project_id,minutes); advanceWorldTime(state,events,emit,minutes,'craft work');
      if(work.completed_intervals===0) emit(events,'craft_work_accumulated','Craft work accumulated but has not yet completed a full resolution interval.',{project_id:p.project_id,worked_minutes_in_interval:p.worked_minutes_in_interval},{known_by:['pc_1']});
      else {
        // Resolve one interval per committed player action; extra complete intervals remain as banked elapsed work, not free rolls.
        p.worked_minutes_in_interval += Math.max(0,work.completed_intervals-1)*p.work_interval_minutes;
        resolution=planAndResolve(state,intent,playerInput,{attribute:'Intellect',skill:'Crafting',dc:difficultyFor(intent,'standard'),risk:'controlled',effect:'full',method:`craft:${p.recipe_id}`,stakes:['time','materials'],target:p.project_id,health_tags:['demanding'],problem_state:{project_id:p.project_id,current_progress:p.current_progress,interval:p.work_interval_minutes}});
        if(resolution.outcome!=='repeat_blocked') workCraftInterval(state,p.project_id,resolution.outcome,resolution.plan?.effect||'full');
        emit(events,'craft_interval_resolved','A full craft work interval was resolved.',{project_id:p.project_id,outcome:resolution.outcome,current_progress:p.current_progress,required_progress:p.required_progress},{known_by:['pc_1']});
        if(p.status==='complete') {const itemId=`item_${sha256({project:p.project_id,g:state.meta.generation+1}).slice(0,16)}`; const item=finishCraft(state,p.project_id,itemId); emit(events,'item_created',`${item.name} is completed.`,{item_id:item.id,project_id:p.project_id},{known_by:['pc_1']});}
      }
    }
  } else {
    const uncertain=intent.difficulty && intent.difficulty!=='auto';
    if(uncertain) resolution=planAndResolve(state,intent,playerInput,{attribute:intent.attribute||null,skill:intent.skill||null,dc:difficultyFor(intent,'standard'),risk:'risky',effect:'full',method:playerInput,stakes:[]});
    advanceWorldTime(state,events,emit,intent.duration_minutes||2,'other action'); consequenceFromRisk(state,events,emit,resolution,'other');
  }

  if (!resolution.action_type) resolution.action_type=action;
  if (resolution.plan && resolution.check) {
    emit(events,'resolution_audit','A resolution plan was executed against the committed pre-roll contract.',{plan:resolution.plan,check:resolution.check,outcome:resolution.outcome},{known_by:['internal']});
    emit(events,'resolution_visible',`The check resolved as ${String(resolution.outcome).replaceAll('_',' ')}.`,{natural:resolution.check.natural,attribute:resolution.check.attribute,attribute_value:resolution.check.attribute_value,skill:resolution.check.skill,skill_value:resolution.check.skill_value,situation:resolution.check.situation,total:resolution.check.total,dc:resolution.check.hidden_dc?null:resolution.check.dc,outcome:resolution.outcome,plan_digest:resolution.plan.plan_digest},{known_by:['pc_1']});
  }
  state.meta.generation=currentState.meta.generation+1; state.meta.schema_version=CORE.schemaVersion; state.meta.rules_version=CORE.rulesVersion;
  for(const discovery of pendingTravelDiscoveries)recordTravelGeographicKnowledge(state,discovery);
  state.scene.summary=summarizeTurn(playerInput,resolution,events);
  emit(events,'turn_committed',`Generation ${state.meta.generation} prepared for commit.`,{generation:state.meta.generation,action_type:action,player_input_hash:sha256(playerInput).slice(0,16),resolution_plan_digest:resolution.plan?.plan_digest||null},{known_by:['pc_1']});
  validateTransition(migrateState(currentState).state,state);
  return {state,events,resolution};
}

export function summarizeTurn(playerInput,resolution,events){
  const bits=[`Attempt: ${String(playerInput).trim()}`]; if(resolution?.outcome)bits.push(`Outcome: ${String(resolution.outcome).replaceAll('_',' ')}`);
  const important=events.filter(e=>['travel_completed','travel_progressed','npc_injury_added','item_created','evidence_discovered','npc_social_decision','magic_formation_resolved','hazard_checkpoint_applied'].includes(e.type)); if(important.length)bits.push(important.map(x=>x.summary).join(' ')); return bits.join(' · ');
}

function playerKnownFacts(state){
  return (state.world.known_facts||[]).filter(f=>Array.isArray(f.known_by) && (f.known_by.includes('pc_1')||f.known_by.includes('public'))).map(f=>({...f}));
}
function playerKnownNpcs(state,derivedScene){
  const present=new Set(derivedScene.visible_npc_ids);
  const ids=new Set([...present]);
  for(const [id,n] of Object.entries(state.npcs||{})) if(n.known_to_pc===true) ids.add(id);
  return [...ids].map(id=>state.npcs[id]).filter(Boolean).map(n=>{
    const out={
      id:n.id,name:n.name,gender:n.gender,role:n.role,
      visible_condition:n.health?{life_status:n.health.life_status,injuries:(n.health.injuries||[]).filter(i=>i.visible_to_pc!==false).map(i=>({severity:i.severity,body_location:i.body_location}))}:null
    };
    // Authoritative current location is visible only while the NPC is actually present.
    // Off-screen location requires an explicit PC-knowledge field, never inference from simulation state.
    if(present.has(n.id)){out.location_id=n.location_id;out.location=state.world.locations[n.location_id]?.label||'Unknown Location';}
    else if(n.player_knowledge?.last_known_location) out.last_known_location=n.player_knowledge.last_known_location;
    return out;
  });
}

export function publicState(inputState){
  const state=migrateState(inputState).state;
  const derivedScene=derivePlayerScene(state);
  const carriedIds=carriedItemIds(state,'pc_1'); const visibleItems={}; for(const id of carriedIds)visibleItems[id]=state.inventory.items[id];
  return {
    meta:state.meta,
    world:{calendar:state.world.calendar,absolute_minute:state.world.absolute_minute,world_time:state.world.world_time,time_label:state.world.time_label,location_id:currentLocationId(state),location:currentLocationLabel(state),weather:state.world.weather,known_facts:playerKnownFacts(state)},
    campaign_clock:state.campaign_clock,
    ...(state.starting_situation?{starting_situation:projectStartingSituation(state)}:{}),
    ...(state.geographic_knowledge?{geographic_knowledge:projectGeographicKnowledge(state)}:{}),
    ...(state.geographic_knowledge?{player_map:projectPlayerMap(state)}:{}),
    pc:{
      id:state.pc.id,location_id:state.pc.location_id,identity:state.pc.identity,attributes:state.pc.attributes,skills:state.pc.skills,health:state.pc.health,carry_capacity:state.pc.carry_capacity,knowledge:state.pc.knowledge,capabilities:state.pc.capabilities||[],social_positions:state.pc.social_positions||[],relationships:state.pc.relationships||[],obligations:state.pc.obligations||[],reputations:state.pc.reputations||[],access_rights:state.pc.access_rights||[],current_circumstances:state.pc.current_circumstances||[],resource_positions:state.pc.resource_positions||[],equipment_access:state.pc.equipment_access||[],standing_instructions:state.pc.standing_instructions,
      magic:{resource_model:state.pc.magic.resource_model,mana:state.pc.magic.mana,max_mana:state.pc.magic.max_mana,known_operations:state.pc.magic.known_operations,known_techniques:state.pc.magic.known_techniques,known_spells:state.pc.magic.known_spells,sustained_effects:state.pc.magic.sustained_effects},
    },
    scene:{id:derivedScene.projection_id,summary:derivedScene.summary,location_id:derivedScene.location_id,present_npc_ids:derivedScene.visible_npc_ids,evidence:derivedScene.visible_evidence,exits:derivedScene.exits,environment:derivedScene.environment,unresolved_threads:state.scene.unresolved_threads,provenance:derivedScene.provenance},
    known_npcs:playerKnownNpcs(state,derivedScene), resources:state.resources,
    agreements:Object.values(state.agreements||{}).filter(a=>a.parties?.includes('pc_1') && a.status==='accepted'),
    inventory:{carried_load:carriedLoad(state,'pc_1'),load_band:loadBand(state),carried_item_ids:carriedIds,items:visibleItems},
    projects:{travel:state.projects.travel,crafts:Object.values(state.projects.crafts).filter(p=>['active','complete'].includes(p.status))},
    combat:state.combat?.active?{combat_id:state.combat.combat_id,exchange:state.combat.exchange,zones:state.combat.zones,participants:state.combat.participants}:null,
  };
}

export function debugState(inputState){return migrateState(inputState).state;}
