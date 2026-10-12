import { ATTRIBUTES } from './action_resolution.mjs';
import { formatWorldTime, campaignElapsedView, calendarMetrics } from './calendar.mjs';
import { validateCampaignId } from './identity.mjs';
import { WORLD_FOUNDATION, SUPPORTED_STATE_SCHEMAS, validateWorldGenerationManifest, validateLocationEntity, validateFidelity } from './world_foundation.mjs';
import { GENESIS, validateGenesisResult } from './genesis.mjs';
import { contentPackPins, validateWorldGenesisSnapshot, generationZeroLiveNpcProjection, generationZeroRuntimeLocationProjection } from './world_genesis.mjs';
import { validateStartingRegion } from './starting_region.mjs';
import { validateStartingRegionSystems } from './starting_region_systems.mjs';
import { validateStartingSituation } from './starting_situation.mjs';
import { validateGeographicKnowledge, validateGeographicKnowledgeTransition } from './geographic_knowledge.mjs';

function assert(cond, message) { if (!cond) throw new Error(message); }
function isObj(v) { return v && typeof v === 'object' && !Array.isArray(v); }

export function validateState(state, { expectedBranch='ergpt-external', requireGeneration=null } = {}) {
  assert(isObj(state), 'State must be an object.');
  assert(isObj(state.meta), 'State meta is required.');
  assert(state.meta.branch_id === expectedBranch, `State branch must be ${expectedBranch}.`);
  assert(typeof state.meta.campaign_id === 'string' && state.meta.campaign_id.length > 0, 'Campaign ID is required.');
  validateCampaignId(state.meta.campaign_id);
  assert(Number.isInteger(state.meta.generation) && state.meta.generation >= 0, 'Generation must be a non-negative integer.');
  if (requireGeneration !== null) assert(state.meta.generation === requireGeneration, 'State generation mismatch.');
  assert(state.meta.schema_version===SUPPORTED_STATE_SCHEMAS.current, 'Unsupported authoritative state schema version.');

  assert(isObj(state.world), 'World state is required.');
  assert(Number.isFinite(state.world.absolute_minute) && state.world.absolute_minute >= 0, 'World absolute time must be a non-negative minute.');
  assert(isObj(state.world.calendar) && Array.isArray(state.world.calendar.months) && state.world.calendar.months.length > 0, 'World calendar definition is required.');
  const calendarTime=calendarMetrics(state.world.calendar);
  assert(Array.isArray(state.world.calendar.weekdays) && state.world.calendar.weekdays.length>0, 'World calendar weekdays are required.');
  const renderedWorldTime=formatWorldTime(state.world.absolute_minute,state.world.calendar);
  assert(state.world.time_label===renderedWorldTime.label, 'World time label does not match the authoritative absolute world minute.');
  assert(isObj(state.campaign_clock), 'Campaign elapsed clock is required.');
  assert(Number.isFinite(state.campaign_clock.start_absolute_minute) && state.campaign_clock.start_absolute_minute >= 0, 'Campaign start world minute is invalid.');
  assert(Number.isFinite(state.campaign_clock.elapsed_minute) && state.campaign_clock.elapsed_minute >= 0, 'Campaign elapsed minute is invalid.');
  // Authoritative world timestamps are persisted to six decimal places; large absolute
  // calendar values can accumulate IEEE-754 subtraction noise below one micro-minute.
  assert(Math.abs((state.world.absolute_minute-state.campaign_clock.start_absolute_minute)-state.campaign_clock.elapsed_minute)<=1e-6, 'Campaign elapsed time diverged from world time.');
  assert(state.campaign_clock.elapsed?.label===campaignElapsedView(state.campaign_clock.elapsed_minute,state.world.calendar).label, 'Campaign elapsed label is stale.');
  assert(!Object.hasOwn(state.world,'location'), 'World may not own a singleton current location.');
  assert(isObj(state.world.locations)&&Object.keys(state.world.locations).length>0,'Persistent location index is required.');
  for(const [id,location] of Object.entries(state.world.locations)){assert(location.location_id===id,`Location key/id mismatch for ${id}.`);validateLocationEntity(location);assert(location.parent_location_id===null||state.world.locations[location.parent_location_id],`Location ${id} has an unknown parent.`);}
  validateFidelity(state.world.fidelity,state.world.locations);

  assert(isObj(state.pc) && state.pc.id === 'pc_1', 'Player character record is required.');
  assert(typeof state.pc.location_id==='string'&&state.world.locations[state.pc.location_id],'PC persistent location is invalid.');
  assert(isObj(state.pc.identity), 'Player identity is required.');
  for (const key of ['name','age','race','class','gender','appearance','background','starting_goal']) {
    assert(state.pc.identity[key] !== undefined && String(state.pc.identity[key]).trim() !== '', `Missing PC identity field ${key}.`);
  }
  assert(isObj(state.pc.attributes), 'PC attributes are required.');
  for (const attr of ATTRIBUTES) assert(Number.isFinite(Number(state.pc.attributes[attr])), `Missing/invalid attribute ${attr}.`);
  assert(isObj(state.pc.skills), 'PC skills are required.');
  if(state.genesis!==undefined){
    assert(state.genesis?.contract_id===GENESIS.resultContract,'Unsupported authoritative Genesis record.');
    validateGenesisResult(state.genesis);
    if(state.meta.generation===0){
      for(const field of ['name','age','race','gender','class','appearance','background','starting_goal'])assert(state.pc.identity[field]===state.genesis.identity[field],`Generation-zero PC identity.${field} diverges from Genesis.`);
      for(const field of ['attributes','skills','capabilities','social_positions','relationships','knowledge','obligations','reputations','access_rights','current_circumstances','resource_positions','world_requirements'])assert(JSON.stringify(state.pc[field])===JSON.stringify(state.genesis[field]),`Generation-zero PC ${field} diverges from Genesis.`);
      assert(state.pc.carry_capacity===state.genesis.carry_capacity,'Generation-zero carry capacity diverges from Genesis.');
      assert(JSON.stringify(state.pc.equipment_access)===JSON.stringify(state.genesis.equipment),'Generation-zero equipment access diverges from Genesis.');
      assert(JSON.stringify(state.resources)===JSON.stringify(state.genesis.starting_resources),'Generation-zero resources diverge from Genesis.');
      assert(state.pc.magic.resource_model===state.genesis.magic_profile.resource_model,'Generation-zero magic resource model diverges from Genesis.');
      assert(state.pc.magic.law_profile?.resource_model===state.genesis.magic_profile.resource_model,'Generation-zero Magic Law resource model diverges from Genesis.');
      for(const field of ['mana','max_mana','known_operations','known_techniques'])assert(JSON.stringify(state.pc.magic[field])===JSON.stringify(state.genesis.magic_profile[field]),`Generation-zero magic ${field} diverges from Genesis.`);
      assert(state.pc.health.fatigue?.level===state.genesis.health_profile.fatigue_level,'Generation-zero fatigue diverges from Genesis.');
      assert(state.pc.health.life_status===state.genesis.health_profile.life_status,'Generation-zero life status diverges from Genesis.');
      assert(JSON.stringify(state.pc.health.injuries.map(x=>({injury_id:x.injury_id,severity:x.severity})))===JSON.stringify(state.genesis.health_profile.injuries.map(x=>({injury_id:x.injury_id,severity:x.severity}))),'Generation-zero injuries diverge from Genesis.');
      const expectedCarried=state.genesis.equipment.filter(x=>x.carried).map(x=>x.item_id).sort();
      assert(JSON.stringify(Object.keys(state.inventory?.items||{}).sort())===JSON.stringify(expectedCarried),'Generation-zero inventory diverges from Genesis equipment placement.');
      for(const item of state.genesis.equipment.filter(x=>x.carried)){
        const actual=state.inventory.items[item.item_id],expected={id:item.item_id,name:item.name,quantity:item.quantity,load:item.load,tags:item.tags,condition:'sound',defects:[],owner_id:item.owner_ref,holder_id:item.holder_ref,container_id:null,location_id:null,custodian_id:item.custodian_ref,access:item.access,source_event_id:'evt_gen0'};
        assert(JSON.stringify(actual)===JSON.stringify(expected),`Generation-zero equipment ${item.item_id} catalog details, ownership, access, or placement diverge from Genesis.`)
      }
    }
  }

  assert(isObj(state.pc.health), 'PC health state is required.');
  assert(!Object.hasOwn(state.pc.health, 'hp') && !Object.hasOwn(state.pc.health, 'hit_points') && !Object.hasOwn(state.pc, 'hp'), 'Universal HP is forbidden in authoritative state.');
  assert(Array.isArray(state.pc.health.injuries), 'Health injuries must be an array.');
  assert(isObj(state.pc.health.fatigue), 'Health fatigue state is required.');
  assert(Number.isInteger(state.pc.health.fatigue.level)&&state.pc.health.fatigue.level>=0&&state.pc.health.fatigue.level<=4,'Health fatigue level must be an integer from 0 to 4.');

  assert(isObj(state.rng) && typeof state.rng.seed === 'string' && Number.isInteger(state.rng.roll_index) && state.rng.roll_index >= 0 && state.rng.contract_version===WORLD_FOUNDATION.randomnessContract, 'RNG state is invalid.');
  validateWorldGenerationManifest(state.world_generation_manifest,state);
  if(state.world_genesis!==undefined){
    assert(Array.isArray(state.world_content_packs)&&state.world_content_packs.length>0,'World Genesis authoritative Content Packs are required.');
    const retainedOrder=state.world_content_packs.map(pack=>`${pack?.manifest?.pack_id??''}\u0000${pack?.manifest?.pack_version??''}`),canonicalOrder=[...retainedOrder].sort((a,b)=>a.localeCompare(b));
    assert(JSON.stringify(retainedOrder)===JSON.stringify(canonicalOrder),'World Genesis authoritative Content Packs must be uniquely ordered by stable pack ID and version.');
    assert(JSON.stringify(contentPackPins(state.world_content_packs))===JSON.stringify(state.world_content_pins),'World Genesis Content Pack pins diverge from retained authoritative Content Packs.');
    assert(Array.isArray(state.world_content_pins)&&JSON.stringify(state.world_content_pins)===JSON.stringify(state.world_genesis.pack_pins),'World Genesis Content Pack pins diverge from state.');
    validateWorldGenesisSnapshot(state.world_genesis,{packs:state.world_content_packs,manifestId:state.world_generation_manifest?.manifest_id,state});
    const mappedRuntimeLocations=new Map();
    for(const location of Object.values(state.world.locations))if(location.world_genesis_entity_id!==undefined){
      assert(state.world_genesis.graph.entities[location.world_genesis_entity_id],`Runtime location ${location.location_id} maps to an unknown World Genesis entity.`);
      assert(!mappedRuntimeLocations.has(location.world_genesis_entity_id),`Duplicate runtime-to-World-Graph mapping for ${location.world_genesis_entity_id}.`);
      const expected=generationZeroRuntimeLocationProjection(state.meta.campaign_id,location.world_genesis_entity_id);
      assert(location.location_id===expected.location_id&&location.label===expected.label&&location.parent_location_id===null&&location.provenance?.source===expected.provenance.source&&location.provenance?.original_label===expected.provenance.original_label,`Runtime-to-World-Graph location mapping for ${location.world_genesis_entity_id} diverges from its deterministic system-owned projection.`);
      if(state.meta.generation===0){
        assert(Object.keys(location).sort().join(',')==='contract_id,detail_fidelity,label,location_id,parent_location_id,provenance,world_genesis_entity_id'&&Object.keys(location.provenance).sort().join(',')==='original_label,source'&&location.detail_fidelity==='local',`Generation-zero runtime location ${location.location_id} diverges from the complete allowed system-owned mapping shape.`);
      }
      mappedRuntimeLocations.set(location.world_genesis_entity_id,location.location_id);
    }
    if(state.meta.generation===0){
      const requiredMappings=[...new Set(Object.values(state.world_genesis.materialized_npcs).map(canonical=>canonical.location_entity_id))].sort(),actualMappings=[...mappedRuntimeLocations.keys()].sort();
      assert(JSON.stringify(actualMappings)===JSON.stringify(requiredMappings),'Generation-zero runtime-to-World-Graph mappings must exactly match authoritative materialized-NPC locations.');
    }
  }else assert(state.world_content_pins===undefined||Array.isArray(state.world_content_pins),'World Content Pack pins must be an array.');
  if(state.starting_region!==undefined)validateStartingRegion(state);
  assert(isObj(state.scheduler) && Array.isArray(state.scheduler.pending), 'Scheduler state is required.');
  assert(Number.isFinite(state.scheduler.absolute_minute), 'Scheduler absolute world time is invalid.');
  assert(Math.abs(state.scheduler.absolute_minute - state.world.absolute_minute) < 1e-9, 'Scheduler and absolute world time diverged.');

  assert(isObj(state.inventory) && isObj(state.inventory.items), 'Inventory state is required.');
  const ids = new Set();
  for (const [id,item] of Object.entries(state.inventory.items)) {
    assert(item.id === id, `Inventory key/id mismatch for ${id}.`);
    assert(!ids.has(id), `Duplicate item id ${id}.`); ids.add(id);
    const placement = [item.holder_id, item.container_id, item.location_id].filter(v => v !== null && v !== undefined);
    assert(placement.length <= 1, `Item ${id} has conflicting physical placement references.`);
    if (item.container_id) assert(state.inventory.items[item.container_id], `Item ${id} references missing container ${item.container_id}.`);
    if (item.location_id) assert(state.world.locations[item.location_id], `Item ${id} references missing location ${item.location_id}.`);
    assert(Number(item.quantity) >= 0, `Item ${id} has invalid quantity.`);
    assert(Number(item.load ?? item.mass ?? 0) >= 0, `Item ${id} has invalid load.`);
  }
  // containment cycle check
  for (const id of ids) {
    const seen = new Set([id]);
    let cur = state.inventory.items[id];
    while (cur?.container_id) {
      if (seen.has(cur.container_id)) throw new Error(`Inventory containment cycle involving ${id}.`);
      seen.add(cur.container_id); cur = state.inventory.items[cur.container_id];
    }
  }

  assert(isObj(state.projects), 'Project state is required.');
  assert(isObj(state.perception), 'Perception state is required.');
  assert(isObj(state.environment), 'Environment state is required.');
  assert(isObj(state.npcs), 'NPC index is required.');
  for (const [npcId,npc] of Object.entries(state.npcs)) {
    assert(npc.id===npcId,`NPC key/id mismatch for ${npcId}.`);
    assert(typeof npc.location_id==='string'&&state.world.locations[npc.location_id],`NPC ${npc.id} persistent location is invalid.`);
    if (!npc?.scheduler?.routines) continue;
    const routineIds=new Set();
    for (const routine of npc.scheduler.routines) {
      assert(typeof routine.routine_id==='string' && routine.routine_id.length>0, `NPC ${npc.id} has a routine without an id.`);
      assert(!routineIds.has(routine.routine_id), `NPC ${npc.id} has duplicate routine ${routine.routine_id}.`); routineIds.add(routine.routine_id);
      assert(Number.isInteger(routine.start_minute_of_day) && routine.start_minute_of_day>=0 && routine.start_minute_of_day<calendarTime.minutes_per_day, `NPC ${npc.id} routine ${routine.routine_id} has invalid start time.`);
      assert(Number.isInteger(routine.end_minute_of_day) && routine.end_minute_of_day>=0 && routine.end_minute_of_day<calendarTime.minutes_per_day, `NPC ${npc.id} routine ${routine.routine_id} has invalid end time.`);
      assert(Array.isArray(routine.weekday_indices) && routine.weekday_indices.every(i=>Number.isInteger(i)&&i>=0&&i<state.world.calendar.weekdays.length), `NPC ${npc.id} routine ${routine.routine_id} has invalid weekdays.`);
      assert(state.world.locations[routine.active_location_id]&&state.world.locations[routine.inactive_location_id],`NPC ${npc.id} routine ${routine.routine_id} has invalid location IDs.`);
    }
  }
  if(state.world_genesis!==undefined){
    for(const canonical of Object.values(state.world_genesis.materialized_npcs)){const live=state.npcs[canonical.npc_id];assert(live,`Committed generation-zero NPC ${canonical.npc_id} is missing from authoritative live state.`);assert(live.world_genesis_requirement_id===canonical.requirement_id&&live.world_genesis_role_catalog_id===canonical.role_catalog_id&&live.world_genesis_location_id===canonical.location_entity_id&&live.world_genesis_population_id===canonical.population_id&&live.world_genesis_institution_id===canonical.institution_id,`Committed generation-zero NPC ${canonical.npc_id} diverges from its World Genesis binding.`);if(state.meta.generation===0){const projection=generationZeroLiveNpcProjection(canonical),location=state.world.locations[live.location_id];assert(projection.role&&live.name===projection.name&&live.role===projection.role,`Generation-zero live NPC ${canonical.npc_id} diverges from its materialized identity.`);assert(location?.world_genesis_entity_id===projection.world_genesis_entity_id,`Generation-zero live NPC ${canonical.npc_id} has an invalid runtime-to-World-Graph location mapping.`)}}
  }
  if(state.starting_region_systems!==undefined)validateStartingRegionSystems(state);
  if(state.starting_situation!==undefined)validateStartingSituation(state);
  if(state.geographic_knowledge!==undefined)validateGeographicKnowledge(state);
  if(state.projects?.travel){assert(state.world.locations[state.projects.travel.target_location_id],'Travel target must be a persistent location ID.');assert(!Object.hasOwn(state.projects.travel,'target'),'Legacy travel target is forbidden after migration.');}
  if (state.combat !== undefined && state.combat !== null) {
    assert(isObj(state.combat), 'Combat state must be an object.');
    assert(typeof state.combat.combat_id==='string' && state.combat.combat_id.length>0, 'Combat id is required.');
    assert(typeof state.combat.active==='boolean', 'Combat active flag must be boolean.');
    assert(Number.isInteger(state.combat.exchange) && state.combat.exchange>=0, 'Combat exchange must be a non-negative integer.');
    assert(Array.isArray(state.combat.participants), 'Combat participants must be an array.');
    assert(new Set(state.combat.participants).size===state.combat.participants.length, 'Combat participants must be unique.');
    assert(isObj(state.combat.zones), 'Combat zones are required.');
    assert(Array.isArray(state.combat.initiative_entries) && state.combat.initiative_entries.length>=2, 'Combat initiative entries are required.');
    const initiativeActors=new Set();
    for(const entry of state.combat.initiative_entries){
      assert(typeof entry.actor_id==='string' && entry.actor_id.length>0, 'Combat initiative entry actor is required.');
      assert(!initiativeActors.has(entry.actor_id), `Duplicate combat initiative actor ${entry.actor_id}.`); initiativeActors.add(entry.actor_id);
      assert(Number.isFinite(Number(entry.score)), `Combat initiative score for ${entry.actor_id} is invalid.`);
      assert(Number.isFinite(Number(entry.agility)), `Combat initiative Agility for ${entry.actor_id} is invalid.`);
    }
    for(const actorId of state.combat.participants) assert(initiativeActors.has(actorId), `Combat participant ${actorId} lacks initiative.`);
    assert(Array.isArray(state.combat.initiative_groups) && state.combat.initiative_groups.length>0, 'Combat initiative groups are required.');
    const groupedActors=[];
    for(const group of state.combat.initiative_groups){
      assert(Array.isArray(group.actor_ids) && group.actor_ids.length>0, 'Combat initiative group cannot be empty.');
      for(const actorId of group.actor_ids){ assert(initiativeActors.has(actorId), `Combat initiative group references unknown actor ${actorId}.`); groupedActors.push(actorId); }
    }
    assert(new Set(groupedActors).size===groupedActors.length, 'Combat initiative groups contain duplicate actors.');
    assert(groupedActors.length===initiativeActors.size, 'Combat initiative groups must account for every initiative actor.');
    assert(state.combat.current_exchange===undefined, 'Committed combat state cannot retain an unfinished current exchange.');
    if(state.combat.exchange_log!==undefined){
      assert(Array.isArray(state.combat.exchange_log), 'Combat exchange log must be an array.');
      let prior=0;
      for(const exchange of state.combat.exchange_log){
        assert(isObj(exchange), 'Combat exchange log entry must be an object.');
        assert(Number.isInteger(exchange.number) && exchange.number===prior+1, 'Combat exchange numbers must be contiguous and increasing.');
        prior=exchange.number;
        assert(Number.isFinite(exchange.duration_minutes) && exchange.duration_minutes>0, `Combat exchange ${exchange.number} must have positive duration.`);
        assert(isObj(exchange.contributions), `Combat exchange ${exchange.number} contributions must be an object.`);
        for(const [actorId,contribution] of Object.entries(exchange.contributions)){
          assert(initiativeActors.has(actorId), `Combat exchange ${exchange.number} contribution references unknown actor ${actorId}.`);
          assert(isObj(contribution) && contribution.actor_id===actorId, `Combat exchange ${exchange.number} contribution actor mismatch for ${actorId}.`);
          assert(typeof contribution.kind==='string' && contribution.kind.length>0, `Combat exchange ${exchange.number} contribution kind is required.`);
        }
      }
      if(state.combat.exchange_log.length) assert(state.combat.exchange===state.combat.exchange_log.at(-1).number, 'Combat exchange counter does not match exchange log.');
    }
    if(state.combat.active) assert(state.combat.participants.length>=2, 'Active combat requires at least two participants.');
    assert(Array.isArray(state.combat.surrender_offers), 'Combat surrender offers must be an array.');
    for(const offer of state.combat.surrender_offers){
      assert(typeof offer.offer_id==='string' && offer.offer_id.length>0, 'Combat surrender offer id is required.');
      assert(initiativeActors.has(offer.offered_by), `Combat surrender offer references unknown actor ${offer.offered_by}.`);
      assert(['offered','accepted','refused','negotiating'].includes(offer.status), `Combat surrender offer ${offer.offer_id} has invalid status.`);
      if(offer.status==='accepted') assert(typeof offer.accepted_by==='string' && initiativeActors.has(offer.accepted_by), `Accepted surrender offer ${offer.offer_id} requires a valid accepting actor.`);
    }
  }

  if (state.agreements !== undefined) {
    assert(isObj(state.agreements), 'Agreement store must be an object.');
    for (const [id,a] of Object.entries(state.agreements)) {
      assert(a.agreement_id===id, `Agreement key/id mismatch for ${id}.`);
      assert(Array.isArray(a.parties) && a.parties.length>=2, `Agreement ${id} needs at least two parties.`);
      assert(Array.isArray(a.accepted_by) && a.accepted_by.every(x=>a.parties.includes(x)), `Agreement ${id} has invalid acceptance.`);
      if (a.status==='accepted') assert(a.parties.every(x=>a.accepted_by.includes(x)), `Agreement ${id} cannot be accepted without all parties.`);
    }
  }

  for (const p of state.scheduler.pending) {
    assert(p.campaign_id === state.meta.campaign_id && p.branch_id === state.meta.branch_id, `Scheduled process ${p.process_id} identity mismatch.`);
    assert(Number.isFinite(p.due_absolute_minute) && p.due_absolute_minute >= state.scheduler.absolute_minute - 1e-9, `Scheduled process ${p.process_id} is in resolved world time.`);
    assert(!(p.owner_id === 'pc_1' && p.voluntary === true), 'Scheduler cannot contain a voluntary PC action.');
    if(typeof p.kind==='string'&&p.kind.startsWith('npc_'))assert(state.npcs[p.owner_id],`Scheduled NPC process ${p.process_id} has missing live owner ${p.owner_id}.`);
  }
  return true;
}

export function validateTransition(before, after) {
  validateState(before);
  if (after.meta.campaign_id !== before.meta.campaign_id || after.meta.branch_id !== before.meta.branch_id) throw new Error('Transition changed campaign/branch identity.');
  if (after.rng?.seed !== before.rng.seed) throw new Error('Ordinary transition cannot replace the campaign RNG seed; an explicit migration contract is required.');
  if (after.world_generation_manifest?.manifest_id !== before.world_generation_manifest.manifest_id) throw new Error('Ordinary transition cannot replace the pinned World Generation Manifest; an explicit migration contract is required.');
  validateState(after, { requireGeneration: before.meta.generation + 1 });
  if (after.world.absolute_minute + 1e-9 < before.world.absolute_minute) throw new Error('Absolute world time moved backward.');
  if (after.campaign_clock.elapsed_minute + 1e-9 < before.campaign_clock.elapsed_minute) throw new Error('Campaign elapsed time moved backward.');
  if (after.rng.roll_index < before.rng.roll_index) throw new Error('RNG roll index moved backward.');
  if(JSON.stringify(after.genesis??null)!==JSON.stringify(before.genesis??null))throw new Error('Ordinary transition cannot rewrite the committed Genesis derivation record.');
  if(JSON.stringify(after.world_content_packs??null)!==JSON.stringify(before.world_content_packs??null)||JSON.stringify(after.world_content_pins??null)!==JSON.stringify(before.world_content_pins??null))throw new Error('Ordinary transition cannot rewrite the authoritative World Content Pack set.');
  if(before.world_genesis!==undefined){
    if(after.world_genesis===undefined)throw new Error('Ordinary transition cannot erase committed World Genesis.');
    const prior=structuredClone(before.world_genesis),next=structuredClone(after.world_genesis);delete prior.expansions;delete next.expansions;delete prior.snapshot_id;delete next.snapshot_id;
    if(JSON.stringify(prior)!==JSON.stringify(next))throw new Error('Ordinary transition cannot rewrite committed World Genesis foundations.');
    for(const [key,value] of Object.entries(before.world_genesis.expansions||{}))if(JSON.stringify(after.world_genesis.expansions?.[key])!==JSON.stringify(value))throw new Error(`Ordinary transition cannot rewrite canonical expansion ${key}.`);
  }
  if(before.geographic_knowledge!==undefined){
    if(after.geographic_knowledge===undefined)throw new Error('Ordinary transition cannot erase Geographic Knowledge.');
    for(const [id,item] of Object.entries(before.geographic_knowledge.records))if(JSON.stringify(after.geographic_knowledge.records?.[id])!==JSON.stringify(item))throw new Error(`Ordinary transition cannot rewrite Geographic Knowledge ${id}.`);
    validateGeographicKnowledgeTransition(before,after);
  }

  const detailOrder=['foundation','regional','local','scene'];
  for (const [locationId,beforeLocation] of Object.entries(before.world.locations)) {
    const afterLocation=after.world.locations[locationId];
    if (!afterLocation) throw new Error(`Committed location ${locationId} cannot disappear during an ordinary transition.`);
    const beforeHasDetail=Object.hasOwn(before.world.fidelity.detail_by_location,locationId);
    const afterHasDetail=Object.hasOwn(after.world.fidelity.detail_by_location,locationId);
    if (beforeHasDetail && !afterHasDetail) throw new Error(`Committed world detail fidelity for ${locationId} cannot disappear.`);
    const beforeDetail=before.world.fidelity.detail_by_location[locationId] ?? beforeLocation.detail_fidelity;
    const afterDetail=after.world.fidelity.detail_by_location[locationId] ?? afterLocation.detail_fidelity;
    if (detailOrder.indexOf(afterDetail) < detailOrder.indexOf(beforeDetail) || detailOrder.indexOf(afterLocation.detail_fidelity) < detailOrder.indexOf(beforeLocation.detail_fidelity)) {
      throw new Error(`Committed world detail for ${locationId} cannot be demoted or erased.`);
    }
  }
  return true;
}
