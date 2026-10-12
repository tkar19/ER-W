import { sha256 } from './util.mjs';

export const WORLD_FOUNDATION=Object.freeze({
  stateSchema:4,
  manifestContract:'ER_WORLD_GENERATION_MANIFEST_V1',
  persistenceContract:'ER_INCREMENTAL_COMMIT_V1',
  stateRootContract:'ER_STATE_ROOT_V1',
  canonicalObjectContract:'ER_CANONICAL_OBJECT_V1',
  historyIndexContract:'ER_HISTORY_INDEX_V1',
  randomnessContract:'ER_RANDOMNESS_NAMESPACES_V1',
  locationContract:'ER_LOCATION_V1',
  fidelityContract:'ER_FIDELITY_V1',
  worldgenEngine:'ER_WORLDGEN_FOUNDATION_V1',
});
export const SUPPORTED_STATE_SCHEMAS=Object.freeze({current:4,migratable:Object.freeze([1,2,3])});
const MANIFEST_VERSIONS=Object.freeze({
  worldgen_engine_version:WORLD_FOUNDATION.worldgenEngine,randomness_contract_version:WORLD_FOUNDATION.randomnessContract,
  compatibility_rule_version:'ER_WORLDGEN_COMPAT_V1',geography_rule_version:'ER_GEOGRAPHY_FOUNDATION_V1',population_rule_version:'ER_POPULATION_FOUNDATION_V1',economy_rule_version:'ER_ECONOMY_FOUNDATION_V1',history_rule_version:'ER_HISTORY_FOUNDATION_V1',magic_catalog_version:'ER_MAGIC_BASELINE_V1',equipment_catalog_version:'ER_EQUIPMENT_BASELINE_V1',genesis_schema_version:'ER_GENESIS_LEGACY_V1',
});
const GENESIS_SCHEMAS=Object.freeze(['ER_GENESIS_LEGACY_V1','ER_GENESIS_RESOLVER_V1']);
const MANIFEST_KEYS=['campaign_id','campaign_seed','compatibility_rule_version','content_catalog_versions','contract_id','economy_rule_version','equipment_catalog_version','genesis_schema_version','geography_rule_version','history_rule_version','magic_catalog_version','manifest_id','population_rule_version','provenance','randomness_contract_version','worldgen_engine_version'];

const ID=/^[a-z][a-z0-9_:-]{0,127}$/;
const DETAIL=['foundation','regional','local','scene'];
const PROCESS=['strategic','regional','local','scene'];

function validatedContentPins(state){
  const pins=state.world_content_pins??[];
  if(!Array.isArray(pins))throw new Error('World Content Pack pins must be an array.');
  const ids=new Set();let previous='';
  for(const pin of pins){
    if(!pin||typeof pin!=='object'||Array.isArray(pin)||Object.keys(pin).sort().join(',')!=='manifest_hash,pack_id,pack_version'||typeof pin.pack_id!=='string'||!pin.pack_id||typeof pin.pack_version!=='string'||!pin.pack_version||typeof pin.manifest_hash!=='string'||!/^[a-f0-9]{64}$/.test(pin.manifest_hash))throw new Error('Invalid World Content Pack pin.');
    if(ids.has(pin.pack_id))throw new Error(`Multiple releases selected for stable Content Pack ID ${pin.pack_id}.`);
    if(previous&&previous.localeCompare(pin.pack_id)>=0)throw new Error('World Content Pack pins must be uniquely ordered by stable pack ID.');
    ids.add(pin.pack_id);previous=pin.pack_id;
  }
  return pins;
}

export function locationIdForLegacy(campaignId,label){
  const normalized=String(label||'').trim().toLowerCase().replace(/[^a-z0-9]+/g,'_').replace(/^_+|_+$/g,'').slice(0,48)||'unnamed';
  return `loc_${normalized}_${sha256(`${campaignId}|legacy_location|${String(label).trim()}`).slice(0,12)}`;
}

export function createLocationEntity(campaignId,label,{location_id=null,parent_location_id=null,source='legacy_location_migration',world_genesis_entity_id=null}={}){
  const id=location_id||locationIdForLegacy(campaignId,label);
  return {contract_id:WORLD_FOUNDATION.locationContract,location_id:id,label:String(label).trim(),parent_location_id,detail_fidelity:'local',...(world_genesis_entity_id?{world_genesis_entity_id}:{}),provenance:{source,original_label:String(label).trim()}};
}

export function createWorldGenerationManifest(state){
  const pinnedCatalogs={core:'ER_CORE_CATALOG_BASELINE_V1'};
  for(const pin of validatedContentPins(state))pinnedCatalogs[pin.pack_id]=`${pin.pack_version}#${pin.manifest_hash}`;
  const manifest={
    contract_id:WORLD_FOUNDATION.manifestContract,
    campaign_id:state.meta.campaign_id,
    campaign_seed:state.rng.seed,
    ...MANIFEST_VERSIONS,
    genesis_schema_version:state.genesis?.contract_id==='ER_GENESIS_RESULT_V1'?'ER_GENESIS_RESOLVER_V1':'ER_GENESIS_LEGACY_V1',
    content_catalog_versions:pinnedCatalogs,
    provenance:{authority:'system',committed_generation:0},
  };
  return {...manifest,manifest_id:`wgm_${sha256(manifest).slice(0,24)}`};
}

export function validateWorldGenerationManifest(manifest,state){
  if(!manifest||manifest.contract_id!==WORLD_FOUNDATION.manifestContract)throw new Error('Unsupported World Generation Manifest revision.');
  if(Object.keys(manifest).sort().join(',')!==MANIFEST_KEYS.join(','))throw new Error('Invalid World Generation Manifest shape.');
  if(manifest.campaign_id!==state.meta.campaign_id||manifest.campaign_seed!==state.rng.seed)throw new Error('World Generation Manifest identity mismatch.');
  for(const [field,supported] of Object.entries(MANIFEST_VERSIONS))if(field!=='genesis_schema_version'&&manifest[field]!==supported)throw new Error(`Unsupported pinned World Generation Manifest ${field}.`);
  if(!GENESIS_SCHEMAS.includes(manifest.genesis_schema_version))throw new Error('Unsupported pinned World Generation Manifest genesis_schema_version.');
  if(state.meta.generation===0&&Boolean(state.genesis)!==(manifest.genesis_schema_version==='ER_GENESIS_RESOLVER_V1'))throw new Error('World Generation Manifest Genesis revision does not match generation-zero state.');
  const pins=validatedContentPins(state),expectedCatalogs={core:'ER_CORE_CATALOG_BASELINE_V1'};for(const pin of pins)expectedCatalogs[pin.pack_id]=`${pin.pack_version}#${pin.manifest_hash}`;
  if(Object.keys(expectedCatalogs).length!==pins.length+1)throw new Error('World Generation Manifest does not losslessly represent Content Pack pins.');
  if(!manifest.content_catalog_versions||JSON.stringify(manifest.content_catalog_versions)!==JSON.stringify(expectedCatalogs))throw new Error('Unsupported pinned content catalog revision.');
  if(!manifest.provenance||Object.keys(manifest.provenance).sort().join(',')!=='authority,committed_generation'||manifest.provenance.authority!=='system'||manifest.provenance.committed_generation!==0)throw new Error('Invalid World Generation Manifest provenance.');
  const {manifest_id,...identity}=manifest;if(manifest_id!==`wgm_${sha256(identity).slice(0,24)}`)throw new Error('World Generation Manifest integrity mismatch.');
  return true;
}

export function validateLocationEntity(location){
  if(!location||location.contract_id!==WORLD_FOUNDATION.locationContract||!ID.test(location.location_id)||typeof location.label!=='string'||!location.label.trim())throw new Error('Invalid persistent location entity.');
  if(location.parent_location_id!==null&&!ID.test(location.parent_location_id))throw new Error('Invalid parent location ID.');
  if(location.world_genesis_entity_id!==undefined&&!ID.test(location.world_genesis_entity_id))throw new Error('Invalid World Genesis location mapping.');
  if(!DETAIL.includes(location.detail_fidelity))throw new Error('Invalid world detail fidelity.');
  if(location.provenance?.source!=='legacy_location_migration'&&location.provenance?.source!=='world_generation')throw new Error('Invalid location provenance.');
  return true;
}

export function validateFidelity(fidelity,locations){
  if(!fidelity||fidelity.contract_id!==WORLD_FOUNDATION.fidelityContract)throw new Error('Unsupported fidelity contract.');
  for(const [id,level] of Object.entries(fidelity.detail_by_location||{})){if(!locations[id]||!DETAIL.includes(level))throw new Error('Invalid location detail fidelity.');}
  for(const [id,location] of Object.entries(locations||{})){
    if(!Object.hasOwn(fidelity.detail_by_location||{},id)||fidelity.detail_by_location[id]!==location.detail_fidelity)throw new Error(`Location ${id} detail fidelity representations must match.`);
  }
  for(const level of Object.values(fidelity.process_by_owner||{}))if(!PROCESS.includes(level))throw new Error('Invalid process simulation fidelity.');
  return true;
}

export function currentLocationId(state){return state.pc?.location_id;}
export function currentLocation(state){return state.world?.locations?.[currentLocationId(state)]||null;}
export function currentLocationLabel(state){return currentLocation(state)?.label||'Unknown Location';}

export function resolveLocationId(state,value,{createLegacy=false}={}){
  if(typeof value!=='string'||!value.trim())return null;
  if(state.world.locations?.[value])return value;
  const found=Object.values(state.world.locations||{}).find(x=>x.label===value.trim()) || Object.values(state.world.locations||{}).find(x=>x.label.toLowerCase()===value.trim().toLowerCase());
  if(found)return found.location_id;
  if(!createLegacy)return null;
  const entity=createLocationEntity(state.meta.campaign_id,value);state.world.locations[entity.location_id]=entity;return entity.location_id;
}

export function setPcLocation(state,locationId){
  if(!state.world.locations?.[locationId])throw new Error('Cannot move PC to an unknown persistent location.');
  state.pc.location_id=locationId;
}

export function migratePersistentLocations(state){
  state.world||={};state.world.locations||={};state.world.regions||={};state.world.settlements||={};
  const ensure=value=>{
    if(typeof value!=='string'||!value.trim())return null;
    if(state.world.locations[value])return value;
    const existing=Object.values(state.world.locations).find(x=>x.label===value);if(existing)return existing.location_id;
    const entity=createLocationEntity(state.meta.campaign_id,value);state.world.locations[entity.location_id]=entity;return entity.location_id;
  };
  const legacyPc=state.pc?.location_id||state.world.location;
  if(!legacyPc)throw new Error('Legacy campaign has no resolvable PC location.');
  state.pc.location_id=ensure(legacyPc);
  for(const npc of Object.values(state.npcs||{})){
    if(npc.location_id==null)npc.location_id=ensure(npc.location);
    delete npc.location;
    for(const routine of npc.scheduler?.routines||[]){
      routine.active_location_id ||= ensure(routine.active_location);
      routine.inactive_location_id ||= ensure(routine.inactive_location);
      delete routine.active_location;delete routine.inactive_location;
    }
  }
  for(const evidence of state.scene?.evidence||[])evidence.location_id=ensure(evidence.location_id)||state.pc.location_id;
  for(const item of Object.values(state.inventory?.items||{}))if(item.location_id)item.location_id=ensure(item.location_id);
  if(state.projects?.travel){
    const p=state.projects.travel;p.target_location_id ||= ensure(p.target);delete p.target;
  }
  delete state.world.location;
  state.world.fidelity||={contract_id:WORLD_FOUNDATION.fidelityContract,detail_by_location:{},process_by_owner:{world:'strategic'}};
  for(const [id,location] of Object.entries(state.world.locations))state.world.fidelity.detail_by_location[id] ||= location.detail_fidelity;
  state.world_generation_manifest ||= createWorldGenerationManifest(state);
  state.rng.contract_version ||= WORLD_FOUNDATION.randomnessContract;
  return state;
}

export function promoteLocationDetail(state,locationId,target){
  if(!DETAIL.includes(target)||!state.world.locations?.[locationId])throw new Error('Invalid world detail promotion.');
  const current=state.world.fidelity.detail_by_location[locationId]||'foundation';
  if(DETAIL.indexOf(target)<DETAIL.indexOf(current))throw new Error('World detail demotion cannot erase committed canonical detail.');
  state.world.fidelity.detail_by_location[locationId]=target;
  state.world.locations[locationId].detail_fidelity=target;
}

export function setProcessFidelity(state,ownerId,level){
  if(!PROCESS.includes(level))throw new Error('Invalid process fidelity.');
  state.world.fidelity.process_by_owner[ownerId]=level;
}
