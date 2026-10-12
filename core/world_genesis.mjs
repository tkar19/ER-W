import { sha256 } from './util.mjs';
import { locationIdForLegacy, validateWorldGenerationManifest } from './world_foundation.mjs';

export const WORLD_GENESIS=Object.freeze({contentPackContract:'ER_CONTENT_PACK_MANIFEST_V1',catalogEntryContract:'ER_CATALOG_ENTRY_V1',planContract:'ER_WORLD_GENESIS_PLAN_V1',graphContract:'ER_WORLD_GRAPH_V1',snapshotContract:'ER_WORLD_GENESIS_SNAPSHOT_V1',populationContract:'ER_POPULATION_PROFILE_V1',npcRequirementContract:'ER_NPC_REQUIREMENT_V1',expansionContract:'ER_WORLD_EXPANSION_V1',corePackId:'pack.er_core_reference',corePackVersion:'1.0.0'});
export const WORLD_GENESIS_PASS_ORDER=Object.freeze(['world_foundation','environment_geography','resources_affordances','travel_connectivity','population_culture','historical_development','politics_social_structures','settlements_institutions','economy_trade','religion_philosophy','magic_supernatural','factions_houses_military','conflicts_pressures_obligations','population_npc_requirements','starting_region_support','validation','canonical_commit']);
const ID=/^[a-z][a-z0-9_.:-]{0,127}$/;
const requireObj=(v,label)=>{if(!v||typeof v!=='object'||Array.isArray(v))throw new Error(`Invalid ${label}.`);return v};
const requireStrings=(v,label)=>{if(!Array.isArray(v)||v.some(x=>typeof x!=='string'||!x.trim()))throw new Error(`Invalid ${label}.`);return v};
const requireId=(v,label)=>{if(typeof v!=='string'||!ID.test(v))throw new Error(`Invalid ${label}.`);return v};
const SYSTEM=Object.freeze({authority:'system'});
const SUPPORTED_SCHEMAS=Object.freeze({culture:'ER_CULTURE_SCHEMA_V1',environment:'ER_ENVIRONMENT_SCHEMA_V1',resource:'ER_RESOURCE_SCHEMA_V1',settlement:'ER_SETTLEMENT_SCHEMA_V1',institution:'ER_INSTITUTION_SCHEMA_V1',profession:'ER_PROFESSION_SCHEMA_V1',economy:'ER_ECONOMY_SCHEMA_V1',history:'ER_HISTORY_SCHEMA_V1',law:'ER_LAW_SCHEMA_V1',magic:'ER_MAGIC_CONTENT_SCHEMA_V1'});
const CREATION_REQUIREMENT_RULES=Object.freeze({
  academy_affiliation:Object.freeze({role_catalog_id:'profession.academic_mentor',institution_id:'institution_river_academy',location_entity_id:'settlement_rivergate',npc_name:'Academy Mentor',live_role:'academic mentor'}),
  family_household_and_succession:Object.freeze({role_catalog_id:'profession.household_steward',institution_id:'institution_noble_household',location_entity_id:'settlement_rivergate',npc_name:'Household Steward',live_role:'household steward'}),
});
const RUNTIME_LOCATION_RULES=Object.freeze({
  location_arrival_point:Object.freeze({label:'Arrival Point'}),
  settlement_rivergate:Object.freeze({label:'Rivergate'}),
});
const clone=v=>structuredClone(v);
function npcRequirementsForCreation(creationRequirements){return [{contract_id:WORLD_GENESIS.npcRequirementContract,requirement_id:'npc_requirement_arrival_clerk',role_catalog_id:'profession.clerk',location_entity_id:'location_arrival_point',population_id:'population_rivergate',institution_id:'institution_arrival_office',reason:'starting_support',source_requirement_id:null,provenance:clone(SYSTEM)},...creationRequirements.map((requirement,index)=>{const rule=CREATION_REQUIREMENT_RULES[requirement.kind];if(!rule)throw new Error(`Unsupported creation requirement kind ${requirement.kind}; no authoritative content chain exists.`);return {contract_id:WORLD_GENESIS.npcRequirementContract,requirement_id:`npc_requirement_creation_${index+1}`,role_catalog_id:rule.role_catalog_id,location_entity_id:rule.location_entity_id,population_id:'population_rivergate',institution_id:rule.institution_id,reason:requirement.kind,source_requirement_id:requirement.requirement_id,provenance:clone(SYSTEM)}})]}
function materializedNpcsForRequirements(requirements){const result={};for(const requirement of requirements){let npc_id,name;if(requirement.requirement_id==='npc_requirement_arrival_clerk'&&requirement.reason==='starting_support'){npc_id='npc_arrival_clerk';name='Arrival Clerk'}else{const match=requirement.requirement_id.match(/^npc_requirement_creation_([1-9][0-9]*)$/),rule=CREATION_REQUIREMENT_RULES[requirement.reason];if(!match||!rule)throw new Error(`NPC requirement ${requirement.requirement_id} cannot produce an authoritative materialized identity.`);npc_id=`npc_creation_support_${match[1]}`;name=rule.npc_name}result[npc_id]={npc_id,requirement_id:requirement.requirement_id,name,role_catalog_id:requirement.role_catalog_id,location_entity_id:requirement.location_entity_id,population_id:requirement.population_id,institution_id:requirement.institution_id,persistent:true,provenance:clone(SYSTEM)}}return result}
export function generationZeroLiveNpcProjection(materializedNpc){const rule=Object.values(CREATION_REQUIREMENT_RULES).find(candidate=>candidate.role_catalog_id===materializedNpc.role_catalog_id);return {name:materializedNpc.name,role:materializedNpc.role_catalog_id==='profession.clerk'?'Clerk':rule?.live_role??null,world_genesis_entity_id:materializedNpc.location_entity_id}}
export function generationZeroRuntimeLocationProjection(campaignId,worldGenesisEntityId){const rule=RUNTIME_LOCATION_RULES[worldGenesisEntityId];if(!rule)throw new Error(`World Genesis entity ${worldGenesisEntityId} has no authoritative generation-zero runtime location projection.`);return {location_id:locationIdForLegacy(campaignId,rule.label),label:rule.label,world_genesis_entity_id:worldGenesisEntityId,provenance:{source:'world_generation',original_label:rule.label}}}
const entry=(entry_id,catalog_family,capabilities,dependencies=[],compatibility=[])=>({contract_id:WORLD_GENESIS.catalogEntryContract,entry_id,catalog_family,schema_version:SUPPORTED_SCHEMAS[catalog_family],content_version:'1.0.0',display_name:entry_id.split('.').at(-1).replaceAll('_',' '),tags:[],capabilities,compatibility,exclusions:[],dependencies,source_pack_id:WORLD_GENESIS.corePackId,provenance:{authority:'system'}});

export function createCoreReferencePack(){
  const entries=[
    entry('culture.river_realm','culture',['written_literacy','realm_naming']),
    entry('environment.temperate_river','environment',['temperate','navigable_water','arable_land','timber_ecology']),
    entry('resource.grain','resource',['food_resource'],[],['arable_land']),
    entry('resource.timber','resource',['construction_resource'],[],['timber_ecology']),
    entry('resource.iron','resource',['metallurgy_iron']),
    entry('resource.tools','resource',['finished_tools'],['resource.iron','resource.timber']),
    entry('resource.administration','resource',['administrative_service'],['profession.clerk']),
    entry('settlement.river_market','settlement',['housing','market','storage','river_port'],[],['navigable_water','arable_land']),
    entry('profession.clerk','profession',['administration'],[],['written_literacy']),
    entry('profession.farmer','profession',['food_production'],[],['arable_land']),
    entry('profession.crafter','profession',['tool_production'],[],['construction_resource']),
    entry('profession.academic_mentor','profession',['education'],[],['written_literacy']),
    entry('profession.household_steward','profession',['household_governance','property_administration'],[],['written_literacy']),
    entry('institution.arrival_office','institution',['public_service'],['profession.clerk'],['administration']),
    entry('institution.academy','institution',['education','formal_magic_instruction'],['profession.academic_mentor'],['written_literacy']),
    entry('institution.noble_household','institution',['household_governance','succession_administration'],['profession.household_steward'],['property_administration']),
    entry('economy.river_trade','economy',['currency_marks','regional_trade'],['resource.grain','resource.timber'],['market','navigable_water']),
    entry('history.river_compact','history',['dynasty_history','trade_history','settlement_history'],['economy.river_trade']),
    entry('law.realm_succession','law',['succession_law','property_law'],['culture.river_realm']),
    entry('magic.luminous_tradition','magic',['magic_law','magic_operation','magic_training'],['institution.academy']),
  ];
  const content_hashes=Object.fromEntries(entries.map(item=>[item.entry_id,sha256(item)]));
  return {manifest:{contract_id:WORLD_GENESIS.contentPackContract,pack_id:WORLD_GENESIS.corePackId,pack_version:WORLD_GENESIS.corePackVersion,required_schema_versions:clone(SUPPORTED_SCHEMAS),dependencies:[],incompatibilities:[],provided_catalog_families:[...new Set(entries.map(x=>x.catalog_family))].sort(),world_feature_support:['written_literacy','magic_enabled','magic_disabled','urban_start','rural_start','travel_start'],entry_ids:entries.map(x=>x.entry_id),content_hashes,provenance:{authority:'system'}},entries};
}

export function contentPackPins(packs){validateContentPackSet(packs);return packs.map(pack=>({pack_id:pack.manifest.pack_id,pack_version:pack.manifest.pack_version,manifest_hash:sha256(pack.manifest)})).sort((a,b)=>a.pack_id.localeCompare(b.pack_id))}

export function validateContentPack(pack){
  requireObj(pack,'content pack'); const manifest=requireObj(pack.manifest,'content pack manifest');
  if(manifest.contract_id!==WORLD_GENESIS.contentPackContract)throw new Error('Unsupported content pack contract.');
  requireId(manifest.pack_id,'pack_id'); if(typeof manifest.pack_version!=='string'||!manifest.pack_version)throw new Error('Invalid pack_version.');
  requireObj(manifest.required_schema_versions,'required schema versions'); requireStrings(manifest.provided_catalog_families,'provided catalog families'); requireStrings(manifest.world_feature_support,'world feature support'); requireStrings(manifest.entry_ids,'entry_ids'); requireObj(manifest.content_hashes,'content hashes');
  for(const [family,version] of Object.entries(manifest.required_schema_versions))if(SUPPORTED_SCHEMAS[family]!==version)throw new Error(`Unsupported ${family} catalog schema ${version}.`);
  if(!Array.isArray(manifest.dependencies)||!Array.isArray(manifest.incompatibilities))throw new Error('Content pack dependency metadata must be arrays.');
  if(requireObj(manifest.provenance,'pack provenance').authority!=='system')throw new Error('Content pack must be system-owned.');
  const entries=Array.isArray(pack.entries)?pack.entries:[]; if(entries.length!==manifest.entry_ids.length)throw new Error('Content pack entry manifest mismatch.');
  const ids=new Set();
  for(const entry of entries){
    requireObj(entry,'catalog entry'); requireId(entry.entry_id,'entry_id');
    if(entry.contract_id!==WORLD_GENESIS.catalogEntryContract||entry.source_pack_id!==manifest.pack_id)throw new Error('Invalid catalog entry authority envelope.');
    if(manifest.required_schema_versions[entry.catalog_family]!==entry.schema_version)throw new Error(`Catalog entry ${entry.entry_id} schema is not pinned by its pack.`);
    if(requireObj(entry.provenance,'entry provenance').authority!=='system')throw new Error('Catalog entry must be system-owned.');
    for(const field of ['tags','capabilities','compatibility','exclusions','dependencies'])requireStrings(entry[field],field);
    if(ids.has(entry.entry_id))throw new Error('Duplicate catalog entry identity.'); ids.add(entry.entry_id);
    if(manifest.content_hashes[entry.entry_id]!==sha256(entry))throw new Error(`Catalog entry ${entry.entry_id} content hash mismatch.`);
  }
  if(manifest.entry_ids.some(x=>!ids.has(x))||Object.keys(manifest.content_hashes).sort().join(',')!==[...ids].sort().join(','))throw new Error('Content pack IDs/hashes disagree.');
  return true;
}

export function validateContentPackSet(packs,{enabled_features=[]}={}){
  if(!Array.isArray(packs)||!packs.length)throw new Error('At least one authoritative content pack is required.'); requireStrings(enabled_features,'enabled features');
  const releases=new Map(),packIds=new Set(),entries=new Map();
  for(const pack of packs){validateContentPack(pack); const packId=pack.manifest.pack_id,key=`${packId}@${pack.manifest.pack_version}`; if(packIds.has(packId))throw new Error(`Multiple releases selected for stable Content Pack ID ${packId}.`); if(releases.has(key))throw new Error('Duplicate content pack release.'); packIds.add(packId);releases.set(key,pack); for(const entry of pack.entries){if(entries.has(entry.entry_id))throw new Error('Duplicate released catalog identity.'); entries.set(entry.entry_id,entry)}}
  for(const pack of packs){
    for(const dep of pack.manifest.dependencies){const key=`${dep.pack_id}@${dep.pack_version}`; if(!releases.has(key))throw new Error(`Missing content pack dependency ${key}.`)}
    for(const conflict of pack.manifest.incompatibilities){const version=conflict.pack_version?`@${conflict.pack_version}`:'';if([...releases.keys()].some(key=>key===`${conflict.pack_id}${version}`||(!version&&key.startsWith(`${conflict.pack_id}@`))))throw new Error(`Incompatible content packs selected: ${pack.manifest.pack_id} and ${conflict.pack_id}.`)}
    for(const entry of pack.entries)for(const dep of entry.dependencies)if(!entries.has(dep))throw new Error(`Catalog entry ${entry.entry_id} references missing dependency ${dep}.`);
  }
  const assertAcyclic=(nodes,dependencies,label)=>{const visiting=new Set(),visited=new Set();const visit=id=>{if(visiting.has(id))throw new Error(`${label} dependency cycle involving ${id}.`);if(visited.has(id))return;visiting.add(id);for(const dependency of dependencies(id))visit(dependency);visiting.delete(id);visited.add(id)};for(const id of nodes)visit(id)};
  assertAcyclic(releases.keys(),key=>(releases.get(key).manifest.dependencies||[]).map(dep=>`${dep.pack_id}@${dep.pack_version}`),'Content pack');
  assertAcyclic(entries.keys(),id=>entries.get(id).dependencies,'Catalog entry');
  const supported=new Set(packs.flatMap(p=>p.manifest.world_feature_support)); for(const feature of enabled_features)if(!supported.has(feature))throw new Error(`Enabled world feature ${feature} has no authoritative content support.`);
  const capabilities=new Set([...entries.values()].flatMap(item=>item.capabilities));
  for(const item of entries.values())for(const requirement of item.compatibility)if(!capabilities.has(requirement))throw new Error(`Catalog entry ${item.entry_id} has unsatisfied semantic requirement ${requirement}.`);
  for(const item of entries.values())for(const exclusion of item.exclusions)if(enabled_features.includes(exclusion))throw new Error(`Catalog entry ${item.entry_id} is incompatible with enabled feature ${exclusion}.`);
  if(enabled_features.includes('magic_enabled'))for(const required of ['magic_law','magic_operation','magic_training'])if(!capabilities.has(required))throw new Error(`Magic-enabled content is missing ${required}.`);
  return true;
}

export function createWorldGenesisPlan(state,{creation_requirements=[],packs,enabled_features=[]}={}){
  validateWorldGenerationManifest(state.world_generation_manifest,state); validateContentPackSet(packs,{enabled_features}); if(!Array.isArray(creation_requirements))throw new Error('Creation requirements must be an array.');
  const seenRequirements=new Set();for(const requirement of creation_requirements){requireObj(requirement,'creation requirement');if(['entity_id','route_id','canonical_state','world_truth','provenance'].some(field=>Object.hasOwn(requirement,field)))throw new Error('Player creation requirements cannot author canonical world entities.');requireId(requirement.requirement_id,'creation requirement ID');requireId(requirement.source_fact_id,'creation requirement source fact ID');if(requirement.authority_class!=='system_instantiated_support')throw new Error('Creation requirement exceeds constraints-only authority.');if(!CREATION_REQUIREMENT_RULES[requirement.kind])throw new Error(`Unsupported creation requirement kind ${requirement.kind}; no authoritative content chain exists.`);if(seenRequirements.has(requirement.requirement_id))throw new Error('Duplicate creation requirement identity.');seenRequirements.add(requirement.requirement_id);}
  const pins=packs.map(p=>({pack_id:p.manifest.pack_id,pack_version:p.manifest.pack_version,manifest_hash:sha256(p.manifest)})).sort((a,b)=>a.pack_id.localeCompare(b.pack_id));
  const basis={campaign_id:state.meta.campaign_id,manifest_id:state.world_generation_manifest.manifest_id,campaign_seed:state.rng.seed,creation_requirements_digest:sha256(creation_requirements),pack_pins:pins,enabled_features:[...new Set(enabled_features)].sort(),pass_order:[...WORLD_GENESIS_PASS_ORDER]};
  return {contract_id:WORLD_GENESIS.planContract,plan_id:`wgplan_${sha256(basis).slice(0,24)}`,...basis,provenance:{authority:'system',creation_requirements_role:'constraints_only'}};
}

export function validateWorldGenesisPlan(plan,{state=null,creationRequirements=null}={}){
  requireObj(plan,'World Genesis plan');if(plan.contract_id!==WORLD_GENESIS.planContract)throw new Error('Unsupported World Genesis plan contract.');requireId(plan.plan_id,'World Genesis plan ID');requireId(plan.campaign_id,'World Genesis campaign ID');requireId(plan.manifest_id,'World Genesis manifest ID');
  if(typeof plan.campaign_seed!=='string'||!plan.campaign_seed)throw new Error('Invalid World Genesis campaign seed.');if(!Array.isArray(plan.pack_pins)||!Array.isArray(plan.enabled_features)||!Array.isArray(plan.pass_order))throw new Error('Invalid World Genesis plan collections.');requireStrings(plan.enabled_features,'World Genesis enabled features');
  if(plan.provenance?.authority!=='system'||plan.provenance?.creation_requirements_role!=='constraints_only')throw new Error('Invalid World Genesis plan provenance.');
  if(JSON.stringify(plan.pass_order)!==JSON.stringify(WORLD_GENESIS_PASS_ORDER))throw new Error('World Genesis causal pass order changed.');
  const basis={campaign_id:plan.campaign_id,manifest_id:plan.manifest_id,campaign_seed:plan.campaign_seed,creation_requirements_digest:plan.creation_requirements_digest,pack_pins:plan.pack_pins,enabled_features:plan.enabled_features,pass_order:plan.pass_order};
  if(plan.plan_id!==`wgplan_${sha256(basis).slice(0,24)}`)throw new Error('World Genesis plan identity mismatch.');
  const expectedRequirements=creationRequirements??(state?(state.genesis?.world_requirements||state.pc?.world_requirements||[]):null);
  if(expectedRequirements!==null&&plan.creation_requirements_digest!==sha256(expectedRequirements))throw new Error('World Genesis plan creation requirements diverge from committed Genesis.');
  if(state){
    if(plan.campaign_id!==state.meta.campaign_id||plan.campaign_seed!==state.rng.seed||plan.manifest_id!==state.world_generation_manifest?.manifest_id)throw new Error('World Genesis plan is not bound to the authoritative campaign RNG seed or World Generation Manifest.');
    const magicEnabled=Boolean(state.genesis&&(state.genesis.magic_profile.known_operations.length||state.genesis.magic_profile.known_techniques.length));const expectedFeatures=['magic_disabled','travel_start','urban_start','written_literacy'];if(magicEnabled)expectedFeatures.splice(0,1,'magic_enabled');
    if(JSON.stringify(plan.enabled_features)!==JSON.stringify(expectedFeatures))throw new Error('World Genesis feature selection diverges from committed Genesis.');
  }
  return true;
}

export function validateWorldGraph(graph,manifestId){
  requireObj(graph,'world graph'); if(graph.contract_id!==WORLD_GENESIS.graphContract)throw new Error('Invalid World Graph contract.'); if(graph.manifest_id!==manifestId)throw new Error('World Generation Manifest pin does not match the World Graph.'); if(requireObj(graph.provenance,'graph provenance').authority!=='system')throw new Error('World Graph must be system-owned.');
  const entities=requireObj(graph.entities,'world entities'),routes=requireObj(graph.routes,'world routes'); const ids=Object.keys(entities); if(!ids.length)throw new Error('World Graph requires entities.');
  const entityTypes=new Set(['world','geographic_region','political_territory','settlement','site','immediate_location']);
  const allowedParentTypes={world:new Set(),geographic_region:new Set(['world','geographic_region']),political_territory:new Set(['world','geographic_region','political_territory']),settlement:new Set(['geographic_region','political_territory']),site:new Set(['settlement','site']),immediate_location:new Set(['site','immediate_location'])};
  for(const [key,e] of Object.entries(entities)){
    if(e.entity_id!==key||!ID.test(key))throw new Error('World entity key/id mismatch.'); if(!entityTypes.has(e.entity_type))throw new Error(`World entity ${key} has invalid entity type.`); if(requireObj(e.provenance,'entity provenance').authority!=='system')throw new Error('World entity must be system-owned.');
    if(e.parent_entity_id!==null&&!entities[e.parent_entity_id])throw new Error(`World entity ${key} has unknown parent.`);
    if(e.entity_type==='world'?(e.parent_entity_id!==null):(e.parent_entity_id===null||!allowedParentTypes[e.entity_type].has(entities[e.parent_entity_id].entity_type)))throw new Error(`World entity ${key} violates the typed containment hierarchy.`);
    for(const ref of requireStrings(e.geographic_region_ids,'geographic_region_ids'))if(entities[ref]?.entity_type!=='geographic_region')throw new Error(`World entity ${key} has invalid geographic region reference ${ref}.`);
    for(const ref of requireStrings(e.political_region_ids,'political_region_ids'))if(entities[ref]?.entity_type!=='political_territory')throw new Error(`World entity ${key} has invalid political region reference ${ref}.`);
    for(const ref of requireStrings(e.controlling_entity_ids,'controlling_entity_ids'))if(entities[ref]?.entity_type!=='political_territory')throw new Error(`World entity ${key} has invalid political controller ${ref}.`);
    for(const ref of requireStrings(e.route_ids,'route_ids'))if(!routes[ref])throw new Error(`World entity ${key} has unknown route_ids reference ${ref}.`);
  }
  if(ids.filter(id=>entities[id].entity_type==='world').length!==1||entities[ids.find(id=>entities[id].entity_type==='world')].parent_entity_id!==null)throw new Error('World Genesis Graph requires exactly one root world entity.');
  for(const [key,r] of Object.entries(routes)){
    if(r.route_id!==key||!ID.test(key)||!entities[r.from_entity_id]||!entities[r.to_entity_id])throw new Error(`World route ${key} has unknown endpoint or mismatched identity.`); if(r.from_entity_id===r.to_entity_id)throw new Error(`World route ${key} must connect distinct endpoints.`); if(requireObj(r.provenance,'route provenance').authority!=='system')throw new Error('World route must be system-owned.');
    if(!Number.isFinite(r.distance)||r.distance<=0)throw new Error(`World route ${key} has invalid distance.`);const travel=requireObj(r.travel_time_model,'route travel time model');if(typeof travel.mode!=='string'||!travel.mode||!Number.isFinite(travel.minutes)||travel.minutes<=0)throw new Error(`World route ${key} has invalid travel time model.`);
    for(const ref of requireStrings(r.control_entity_ids,'route control_entity_ids'))if(entities[ref]?.entity_type!=='political_territory')throw new Error(`World route ${key} has invalid political controller ${ref}.`);
    for(const field of ['route_type','capacity','seasonality','condition'])if(typeof r[field]!=='string'||!r[field])throw new Error(`World route ${key} has invalid ${field}.`);requireStrings(r.hazards,'route hazards');
    if(!entities[r.from_entity_id].route_ids.includes(key)||!entities[r.to_entity_id].route_ids.includes(key))throw new Error(`World route ${key} is missing an endpoint backlink.`);
  }
  for(const start of ids){const seen=new Set([start]); let cur=entities[start]; while(cur.parent_entity_id!==null){if(seen.has(cur.parent_entity_id))throw new Error(`World containment cycle involving ${start}.`); seen.add(cur.parent_entity_id); cur=entities[cur.parent_entity_id]}}
  return true;
}

export function solveWorldConstraints(candidates,requirements){
  if(!Array.isArray(candidates)||!candidates.length)throw new Error('World constraint solver requires candidates.'); requireStrings(requirements,'world constraints');
  const ordered=[...candidates].sort((a,b)=>String(a.candidate_id).localeCompare(String(b.candidate_id))),rejected=[];
  for(const candidate of ordered){requireId(candidate.candidate_id,'constraint candidate');const provides=new Set(requireStrings(candidate.provides,'candidate capabilities'));const missing=requirements.filter(x=>!provides.has(x));if(!missing.length)return {selected:clone(candidate),rejected,backtracked:rejected.length>0};rejected.push({candidate_id:candidate.candidate_id,missing});}
  throw new Error(`World constraints unsatisfied: ${requirements.join(', ')}.`);
}

function entity(entity_id,entity_type,parent_entity_id,extra={}){return {entity_id,entity_type,parent_entity_id,geographic_region_ids:[],political_region_ids:[],controlling_entity_ids:[],route_ids:[],provenance:clone(SYSTEM),...extra}}
function route(route_id,from_entity_id,to_entity_id){return {route_id,from_entity_id,to_entity_id,route_type:'road',distance:12,travel_time_model:{mode:'foot',minutes:180},capacity:'regional',hazards:['seasonal_flood'],control_entity_ids:['polity_river_realm'],seasonality:'all_seasons',condition:'sound',provenance:clone(SYSTEM)}}

export function createWorldGenesisSnapshot(state,{creation_requirements=[],packs=[createCoreReferencePack()],magic_enabled=false}={}){
  const enabled_features=['written_literacy',magic_enabled?'magic_enabled':'magic_disabled','urban_start','travel_start'];
  const plan=createWorldGenesisPlan(state,{creation_requirements,packs,enabled_features});
  if(JSON.stringify(plan.pack_pins)!==JSON.stringify(state.world_content_pins))throw new Error('World Genesis Content Packs are not bound to the authoritative campaign manifest.');
  const environment=solveWorldConstraints([
    {candidate_id:'environment_inland_plain',provides:['temperate','arable_land']},
    {candidate_id:'environment_temperate_river',provides:['temperate','arable_land','navigable_water','timber_ecology']},
  ],['temperate','arable_land','navigable_water']);
  const graph={contract_id:WORLD_GENESIS.graphContract,manifest_id:state.world_generation_manifest.manifest_id,provenance:clone(SYSTEM),entities:{
    world_realm:entity('world_realm','world',null),
    geo_riverlands:entity('geo_riverlands','geographic_region','world_realm',{geographic_region_ids:['geo_riverlands']}),
    polity_river_realm:entity('polity_river_realm','political_territory','world_realm',{geographic_region_ids:['geo_riverlands'],political_region_ids:['polity_river_realm'],controlling_entity_ids:['polity_river_realm']}),
    settlement_rivergate:entity('settlement_rivergate','settlement','geo_riverlands',{geographic_region_ids:['geo_riverlands'],political_region_ids:['polity_river_realm'],controlling_entity_ids:['polity_river_realm'],route_ids:['route_rivergate_hinterland']}),
    site_arrival_district:entity('site_arrival_district','site','settlement_rivergate',{geographic_region_ids:['geo_riverlands'],political_region_ids:['polity_river_realm'],controlling_entity_ids:['polity_river_realm'],route_ids:['route_rivergate_hinterland']}),
    location_arrival_point:entity('location_arrival_point','immediate_location','site_arrival_district',{geographic_region_ids:['geo_riverlands'],political_region_ids:['polity_river_realm'],controlling_entity_ids:['polity_river_realm'],route_ids:['route_rivergate_hinterland']}),
    geo_hinterland:entity('geo_hinterland','geographic_region','world_realm',{geographic_region_ids:['geo_hinterland'],route_ids:['route_rivergate_hinterland']}),
  },routes:{route_rivergate_hinterland:route('route_rivergate_hinterland','location_arrival_point','geo_hinterland')}};
  validateWorldGraph(graph,plan.manifest_id);
  const populations={population_rivergate:{contract_id:WORLD_GENESIS.populationContract,population_id:'population_rivergate',entity_id:'settlement_rivergate',total_population:2400,cohorts:[{cohort_id:'cohort_farmers',profession_id:'profession.farmer',count:960,provenance:clone(SYSTEM)},{cohort_id:'cohort_crafters',profession_id:'profession.crafter',count:240,provenance:clone(SYSTEM)},{cohort_id:'cohort_clerks',profession_id:'profession.clerk',count:48,provenance:clone(SYSTEM)},{cohort_id:'cohort_academic_mentors',profession_id:'profession.academic_mentor',count:12,provenance:clone(SYSTEM)},{cohort_id:'cohort_household_stewards',profession_id:'profession.household_steward',count:12,provenance:clone(SYSTEM)},{cohort_id:'cohort_other',profession_id:null,count:1128,provenance:clone(SYSTEM)}],labour_distribution:{agriculture:0.4,craft:0.1,administration:0.02,education:0.005,household_service:0.005,other:0.47},resource_demand:{food:2400,water:2400,timber:120},military_capacity:120,provenance:clone(SYSTEM)}};
  const npc_requirements=npcRequirementsForCreation(creation_requirements);
  const materialized_npcs=materializedNpcsForRequirements(npc_requirements);
  const economy={resource_profiles:{resource_profile_riverlands:{resource_profile_id:'resource_profile_riverlands',entity_id:'geo_riverlands',produces:['resource.grain','resource.timber'],consumes:['resource.iron'],provenance:clone(SYSTEM)},resource_profile_rivergate:{resource_profile_id:'resource_profile_rivergate',entity_id:'settlement_rivergate',produces:['resource.administration','resource.tools'],consumes:['resource.grain','resource.timber','resource.iron'],provenance:clone(SYSTEM)}},trade_edges:[{trade_edge_id:'trade_hinterland_rivergate',route_id:'route_rivergate_hinterland',from_profile_id:'resource_profile_riverlands',to_profile_id:'resource_profile_rivergate',goods:['resource.grain','resource.timber'],provenance:clone(SYSTEM)}],provenance:clone(SYSTEM)};
  const history=[{history_id:'history_river_compact',cause_ids:['geo_riverlands','route_rivergate_hinterland'],effect_ids:['polity_river_realm','settlement_rivergate'],catalog_id:'history.river_compact',provenance:clone(SYSTEM)}];
  const power={controllers:{polity_river_realm:{controller_id:'polity_river_realm',territory_ids:['polity_river_realm'],law_catalog_id:'law.realm_succession',provenance:clone(SYSTEM)}},conflicts:[{conflict_id:'conflict_flood_recovery',affected_entity_ids:['settlement_rivergate','geo_hinterland'],pressure:'seasonal_flood',provenance:clone(SYSTEM)}],provenance:clone(SYSTEM)};
  const institutions={institution_arrival_office:{institution_id:'institution_arrival_office',catalog_id:'institution.arrival_office',site_entity_id:'site_arrival_district',jurisdiction_entity_ids:['settlement_rivergate','polity_river_realm'],staff_requirement_ids:['npc_requirement_arrival_clerk'],provenance:clone(SYSTEM)},institution_river_academy:{institution_id:'institution_river_academy',catalog_id:'institution.academy',site_entity_id:'settlement_rivergate',jurisdiction_entity_ids:['polity_river_realm'],staff_requirement_ids:npc_requirements.filter(x=>x.institution_id==='institution_river_academy').map(x=>x.requirement_id),provenance:clone(SYSTEM)},...(creation_requirements.some(x=>x.kind==='family_household_and_succession')?{institution_noble_household:{institution_id:'institution_noble_household',catalog_id:'institution.noble_household',site_entity_id:'settlement_rivergate',jurisdiction_entity_ids:['polity_river_realm'],staff_requirement_ids:npc_requirements.filter(x=>x.institution_id==='institution_noble_household').map(x=>x.requirement_id),provenance:clone(SYSTEM)}}:{})};
  const factions={faction_riverward:{faction_id:'faction_riverward',base_entity_id:'settlement_rivergate',controlled_entity_ids:['site_arrival_district'],institution_ids:['institution_arrival_office'],military_capacity:populations.population_rivergate.military_capacity,current_conflict_ids:['conflict_flood_recovery'],provenance:clone(SYSTEM)}};
  const religion_philosophy={traditions:{tradition_river_stewardship:{tradition_id:'tradition_river_stewardship',culture_catalog_id:'culture.river_realm',associated_entity_ids:['geo_riverlands','settlement_rivergate'],tenets:['mutual_aid','responsible_stewardship'],provenance:clone(SYSTEM)}},provenance:clone(SYSTEM)};
  const magic={enabled:magic_enabled,law_catalog_id:magic_enabled?'magic.luminous_tradition':null,operation_catalog_ids:magic_enabled?['magic.luminous_tradition']:[],training_institution_ids:magic_enabled?['institution_river_academy']:[],provenance:clone(SYSTEM)};
  const core={contract_id:WORLD_GENESIS.snapshotContract,plan,pack_pins:contentPackPins(packs),constraint_resolution:environment,graph,populations,npc_requirements,materialized_npcs,institutions,economy,history,power,religion_philosophy,magic,factions,lazy_index:{frontier_north:{expansion_key:'frontier_north',parent_entity_id:'geo_riverlands',catalog_entry_ids:['environment.temperate_river'],provenance:clone(SYSTEM)}},expansions:{},provenance:{authority:'system',dm_prose_role:'presentation_only'}};
  const snapshot={...core,snapshot_id:`wgs_${sha256(core).slice(0,24)}`};validateWorldGenesisSnapshot(snapshot,{packs,manifestId:plan.manifest_id,creationRequirements:creation_requirements});return snapshot;
}

function resolvePinnedPacks(snapshot,packs){
  if(packs!==null&&packs!==undefined)return packs;
  const core=[createCoreReferencePack()];
  if(JSON.stringify(contentPackPins(core))!==JSON.stringify(snapshot.pack_pins))throw new Error('Exact pinned Content Packs are required for non-core World Genesis expansion.');
  return core;
}

export function materializeWorldExpansion(snapshot,expansionKey,{packs=null}={}){
  const selectedPacks=resolvePinnedPacks(snapshot,packs);validateWorldGenesisSnapshot(snapshot,{packs:selectedPacks,skipExpansionValidation:true});const spec=snapshot.lazy_index[expansionKey];if(!spec)throw new Error('Unknown canonical lazy expansion key.');
  const core={contract_id:WORLD_GENESIS.expansionContract,expansion_key:expansionKey,parent_entity_id:spec.parent_entity_id,entity_id:`lazy_${sha256(`${snapshot.plan.campaign_seed}|${snapshot.plan.plan_id}|${expansionKey}`).slice(0,20)}`,catalog_entry_ids:[...spec.catalog_entry_ids],traits:[Number.parseInt(sha256(`${snapshot.plan.campaign_seed}|${expansionKey}|terrain`).slice(0,2),16)%2?'wooded':'riverine'],provenance:clone(SYSTEM)};
  return {...core,expansion_id:`wgexp_${sha256(core).slice(0,24)}`};
}

export function commitWorldExpansion(snapshot,expansionKey,{packs=null}={}){const selectedPacks=resolvePinnedPacks(snapshot,packs),expansion=materializeWorldExpansion(snapshot,expansionKey,{packs:selectedPacks}),next=clone(snapshot);if(next.expansions[expansionKey]&&sha256(next.expansions[expansionKey])!==sha256(expansion))throw new Error('Committed lazy expansion cannot be rewritten.');next.expansions[expansionKey]=expansion;const {snapshot_id,...core}=next;next.snapshot_id=`wgs_${sha256(core).slice(0,24)}`;validateWorldGenesisSnapshot(next,{packs:selectedPacks});return next}

export function validateWorldGenesisSnapshot(snapshot,{packs=[createCoreReferencePack()],manifestId=null,skipExpansionValidation=false,state=null,creationRequirements=null}={}){
  requireObj(snapshot,'World Genesis snapshot');if(snapshot.contract_id!==WORLD_GENESIS.snapshotContract||snapshot.provenance?.authority!=='system'||snapshot.provenance?.dm_prose_role!=='presentation_only')throw new Error('Invalid system-owned World Genesis snapshot.');
  validateWorldGenesisPlan(snapshot.plan,{state,creationRequirements});validateContentPackSet(packs,{enabled_features:snapshot.plan.enabled_features});const pins=contentPackPins(packs),catalogById=new Map(packs.flatMap(pack=>pack.entries.map(entry=>[entry.entry_id,entry]))),catalogIds=new Set(catalogById.keys());if(sha256(pins)!==sha256(snapshot.pack_pins)||sha256(pins)!==sha256(snapshot.plan.pack_pins))throw new Error('World Genesis pack pins do not match authoritative content.');
  const expectedManifest=manifestId||snapshot.plan.manifest_id;if(snapshot.plan.manifest_id!==expectedManifest)throw new Error('World Genesis plan manifest pin diverges from the authoritative manifest.');validateWorldGraph(snapshot.graph,expectedManifest);
  const isFamily=(id,family)=>catalogById.get(id)?.catalog_family===family,isNonnegativeInt=value=>Number.isInteger(value)&&value>=0;
  for(const [key,population] of Object.entries(snapshot.populations)){const cohortIds=new Set();if(population.contract_id!==WORLD_GENESIS.populationContract||population.population_id!==key||!snapshot.graph.entities[population.entity_id]||population.provenance?.authority!=='system'||!Number.isInteger(population.total_population)||population.total_population<1||!Array.isArray(population.cohorts))throw new Error(`Invalid aggregate population ${key}.`);for(const cohort of population.cohorts){if(!requireId(cohort.cohort_id,'population cohort ID')||cohortIds.has(cohort.cohort_id)||!isNonnegativeInt(cohort.count)||(cohort.profession_id!==null&&!isFamily(cohort.profession_id,'profession'))||cohort.provenance?.authority!=='system')throw new Error(`Invalid population cohort ${cohort.cohort_id}.`);cohortIds.add(cohort.cohort_id)}if(population.cohorts.reduce((sum,x)=>sum+x.count,0)!==population.total_population||Object.values(population.labour_distribution).some(value=>typeof value!=='number'||value<0)||Math.abs(Object.values(population.labour_distribution).reduce((sum,value)=>sum+value,0)-1)>1e-9||Object.values(population.resource_demand).some(value=>!isNonnegativeInt(value))||!isNonnegativeInt(population.military_capacity))throw new Error(`Invalid aggregate population ${key}.`)}
  const authoritativeCreationRequirements=creationRequirements??(state?(state.genesis?.world_requirements||state.pc?.world_requirements||[]):null);if(authoritativeCreationRequirements!==null&&sha256(snapshot.npc_requirements)!==sha256(npcRequirementsForCreation(authoritativeCreationRequirements)))throw new Error('World Genesis NPC requirements diverge from authoritative Genesis requirements.');
  const requirementIds=new Set();for(const requirement of snapshot.npc_requirements){if(requirement.contract_id!==WORLD_GENESIS.npcRequirementContract||!requireId(requirement.requirement_id,'NPC requirement ID')||requirementIds.has(requirement.requirement_id)||!snapshot.populations[requirement.population_id]||!snapshot.graph.entities[requirement.location_entity_id]||!isFamily(requirement.role_catalog_id,'profession')||requirement.provenance?.authority!=='system')throw new Error(`Invalid NPC requirement ${requirement.requirement_id}.`);requirementIds.add(requirement.requirement_id)}
  if(sha256(snapshot.materialized_npcs)!==sha256(materializedNpcsForRequirements(snapshot.npc_requirements)))throw new Error('Materialized NPC records diverge from their deterministic system-owned requirements.');
  const claimedRequirements=new Map();
  for(const [key,npc] of Object.entries(snapshot.materialized_npcs)){const requirement=snapshot.npc_requirements.find(x=>x.requirement_id===npc.requirement_id),creationMatch=requirement?.requirement_id.match(/^npc_requirement_creation_([1-9][0-9]*)$/),expectedNpcId=requirement?.requirement_id==='npc_requirement_arrival_clerk'?'npc_arrival_clerk':creationMatch?`npc_creation_support_${creationMatch[1]}`:null;if(npc.npc_id!==key||npc.npc_id!==expectedNpcId||!npc.persistent||!requirement||claimedRequirements.has(npc.requirement_id)||npc.role_catalog_id!==requirement.role_catalog_id||npc.location_entity_id!==requirement.location_entity_id||npc.population_id!==requirement.population_id||npc.institution_id!==requirement.institution_id||!snapshot.graph.entities[npc.location_entity_id]||!snapshot.populations[npc.population_id]||!isFamily(npc.role_catalog_id,'profession')||npc.provenance?.authority!=='system')throw new Error(`Invalid persistent NPC ${key}: every NPC requirement must have exactly one deterministic persistent identity.`);claimedRequirements.set(npc.requirement_id,key)}
  for(const requirementId of requirementIds)if(!claimedRequirements.has(requirementId))throw new Error(`NPC requirement ${requirementId} must have exactly one deterministic persistent identity.`);
  for(const [key,institution] of Object.entries(snapshot.institutions))if(institution.institution_id!==key||!isFamily(institution.catalog_id,'institution')||!snapshot.graph.entities[institution.site_entity_id]||institution.jurisdiction_entity_ids.some(id=>!snapshot.graph.entities[id])||institution.staff_requirement_ids.some(id=>!requirementIds.has(id)||snapshot.npc_requirements.find(requirement=>requirement.requirement_id===id)?.institution_id!==key)||institution.provenance?.authority!=='system')throw new Error(`Invalid institution ${key}.`);
  for(const requirement of snapshot.npc_requirements)if(!snapshot.institutions[requirement.institution_id])throw new Error(`NPC requirement ${requirement.requirement_id} has unknown institution.`);
  for(const [key,profile] of Object.entries(snapshot.economy.resource_profiles)){if(profile.resource_profile_id!==key||!snapshot.graph.entities[profile.entity_id]||profile.provenance?.authority!=='system')throw new Error(`Invalid economy resource profile ${key}.`);for(const id of [...requireStrings(profile.produces,'produced resources'),...requireStrings(profile.consumes,'consumed resources')])if(!isFamily(id,'resource'))throw new Error(`Economy resource profile ${key} references unknown resource ${id}.`)}
  for(const edge of snapshot.economy.trade_edges)if(!requireId(edge.trade_edge_id,'trade edge ID')||!snapshot.graph.routes[edge.route_id]||!snapshot.economy.resource_profiles[edge.from_profile_id]||!snapshot.economy.resource_profiles[edge.to_profile_id]||requireStrings(edge.goods,'trade goods').some(id=>!isFamily(id,'resource'))||edge.provenance?.authority!=='system')throw new Error(`Invalid economy edge ${edge.trade_edge_id}.`);
  for(const record of snapshot.history)if(!isFamily(record.catalog_id,'history')||record.provenance?.authority!=='system'||record.cause_ids.some(id=>!snapshot.graph.entities[id]&&!snapshot.graph.routes[id])||record.effect_ids.some(id=>!snapshot.graph.entities[id]))throw new Error(`Invalid causal history ${record.history_id}.`);
  for(const [key,controller] of Object.entries(snapshot.power.controllers))if(controller.controller_id!==key||snapshot.graph.entities[key]?.entity_type!=='political_territory'||controller.provenance?.authority!=='system'||controller.territory_ids.some(id=>snapshot.graph.entities[id]?.entity_type!=='political_territory')||!isFamily(controller.law_catalog_id,'law'))throw new Error('Invalid political controller.');
  for(const conflict of snapshot.power.conflicts)if(conflict.provenance?.authority!=='system'||conflict.affected_entity_ids.some(id=>!snapshot.graph.entities[id]))throw new Error(`Invalid current conflict ${conflict.conflict_id}.`);
  for(const [key,faction] of Object.entries(snapshot.factions))if(faction.faction_id!==key||!snapshot.graph.entities[faction.base_entity_id]||faction.controlled_entity_ids.some(id=>!snapshot.graph.entities[id])||faction.institution_ids.some(id=>!snapshot.institutions[id])||faction.current_conflict_ids.some(id=>!snapshot.power.conflicts.some(conflict=>conflict.conflict_id===id))||!isNonnegativeInt(faction.military_capacity)||faction.provenance?.authority!=='system')throw new Error(`Invalid faction ${key}.`);
  if(snapshot.religion_philosophy?.provenance?.authority!=='system')throw new Error('Invalid religion/philosophy authority.');for(const tradition of Object.values(snapshot.religion_philosophy.traditions))if(!isFamily(tradition.culture_catalog_id,'culture')||tradition.associated_entity_ids.some(id=>!snapshot.graph.entities[id])||tradition.provenance?.authority!=='system')throw new Error(`Invalid religion/philosophy tradition ${tradition.tradition_id}.`);
  if(snapshot.magic?.provenance?.authority!=='system'||snapshot.magic.enabled!==snapshot.plan.enabled_features.includes('magic_enabled')||(snapshot.magic.enabled&&(!isFamily(snapshot.magic.law_catalog_id,'magic')||snapshot.magic.operation_catalog_ids.some(id=>!isFamily(id,'magic'))||snapshot.magic.training_institution_ids.some(id=>!snapshot.institutions[id])))||(!snapshot.magic.enabled&&(snapshot.magic.law_catalog_id!==null||snapshot.magic.operation_catalog_ids.length||snapshot.magic.training_institution_ids.length)))throw new Error('Invalid magic World Genesis profile.');
  for(const [key,spec] of Object.entries(snapshot.lazy_index))if(spec.expansion_key!==key||!snapshot.graph.entities[spec.parent_entity_id]||spec.catalog_entry_ids.some(id=>!catalogIds.has(id))||spec.provenance?.authority!=='system')throw new Error(`Invalid lazy expansion index ${key}.`);
  if(!skipExpansionValidation)for(const [key,expansion] of Object.entries(snapshot.expansions)){const base={...snapshot,expansions:{}};const {snapshot_id:ignored,...baseCore}=base;base.snapshot_id=`wgs_${sha256(baseCore).slice(0,24)}`;const expected=materializeWorldExpansion(base,key,{packs});if(sha256(expansion)!==sha256(expected))throw new Error(`Canonical lazy expansion ${key} is not deterministic.`)}
  const {snapshot_id,...core}=snapshot;if(snapshot_id!==`wgs_${sha256(core).slice(0,24)}`)throw new Error('World Genesis snapshot integrity mismatch.');return true;
}
