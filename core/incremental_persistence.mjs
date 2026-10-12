import { sha256 } from './util.mjs';
import { WORLD_FOUNDATION } from './world_foundation.mjs';

const SHARDED_WORLD_COLLECTIONS=Object.freeze(['locations','regions','settlements']);

export function canonicalObject(domain,value){const object={contract_id:WORLD_FOUNDATION.canonicalObjectContract,domain,value:structuredClone(value)};return {ref:sha256(object),object};}
function addObject(objects,domain,value){const item=canonicalObject(domain,value);objects.push(item);return item.ref;}

export function flattenStateRootRefs(root){
  const refs={};for(const [domain,ref] of Object.entries(root.domains||{}))refs[domain]=ref;
  for(const [domain,collections] of Object.entries(root.collections||{}))for(const [collection,entries] of Object.entries(collections||{}))for(const [id,ref] of Object.entries(entries||{}))refs[`${domain}.${collection}.${id}`]=ref;
  return refs;
}
export function diffStateRoots(previousRoot,currentRoot){const prior=previousRoot?flattenStateRootRefs(previousRoot):{};const current=flattenStateRootRefs(currentRoot);const domains=new Set([...Object.keys(prior),...Object.keys(current)]);return [...domains].filter(domain=>prior[domain]!==current[domain]).map(domain=>({domain,ref:current[domain]??null})).sort((a,b)=>a.domain.localeCompare(b.domain));}

export function buildStateRoot(state,previousRoot=null){
  const objects=[];const domains={};const collections={world:{locations:{},regions:{},settlements:{}},npcs:{entries:{}}};
  for(const domain of Object.keys(state).sort()){
    if(domain==='world'){
      const meta=structuredClone(state.world);
      for(const collection of SHARDED_WORLD_COLLECTIONS){const values=meta[collection]||{};delete meta[collection];for(const id of Object.keys(values).sort())collections.world[collection][id]=addObject(objects,`world.${collection}.${id}`,values[id]);}
      domains.world=addObject(objects,'world',meta);
    }else if(domain==='npcs')for(const id of Object.keys(state.npcs||{}).sort())collections.npcs.entries[id]=addObject(objects,`npcs.entries.${id}`,state.npcs[id]);
    else domains[domain]=addObject(objects,domain,state[domain]);
  }
  const root={contract_id:WORLD_FOUNDATION.stateRootContract,schema_version:state.meta.schema_version,campaign_id:state.meta.campaign_id,generation:state.meta.generation,domains,collections};
  const rootRef=sha256(root);return {root,rootRef,objects,changed:diffStateRoots(previousRoot,root)};
}

export function validateCanonicalObject(ref,object){if(!object||object.contract_id!==WORLD_FOUNDATION.canonicalObjectContract||typeof object.domain!=='string'||!Object.hasOwn(object,'value')||sha256(object)!==ref)throw new Error('Invalid content-addressed canonical object.');return true;}
function referenceMap(value,label){if(!value||typeof value!=='object'||Array.isArray(value))throw new Error(`Invalid ${label}.`);for(const ref of Object.values(value))if(!/^[a-f0-9]{64}$/.test(ref))throw new Error('Invalid canonical object reference.');}

export function validateStateRoot(ref,root,{campaignId=null,generation=null,schemaVersion=null}={}){
  if(!root||root.contract_id!==WORLD_FOUNDATION.stateRootContract||sha256(root)!==ref)throw new Error('Invalid canonical state root.');
  if(Object.keys(root).sort().join(',')!=='campaign_id,collections,contract_id,domains,generation,schema_version')throw new Error('Unexpected canonical state root field.');
  referenceMap(root.domains,'canonical state domains');
  if(!root.collections||Object.keys(root.collections).sort().join(',')!=='npcs,world')throw new Error('Invalid canonical state collections.');
  if(Object.keys(root.collections.world||{}).sort().join(',')!=='locations,regions,settlements'||Object.keys(root.collections.npcs||{}).join(',')!=='entries')throw new Error('Invalid canonical state collection shape.');
  for(const entries of [...Object.values(root.collections.world),root.collections.npcs.entries])referenceMap(entries,'canonical state collection');
  if(campaignId!==null&&root.campaign_id!==campaignId)throw new Error('State root campaign binding mismatch.');if(generation!==null&&root.generation!==generation)throw new Error('State root generation binding mismatch.');if(schemaVersion!==null&&root.schema_version!==schemaVersion)throw new Error('State root schema binding mismatch.');return true;
}

export function materializeState(root,objects){
  const state={};for(const [domain,ref] of Object.entries(root.domains)){const object=objects.get(ref);validateCanonicalObject(ref,object);if(object.domain!==domain)throw new Error('Canonical object domain mismatch.');state[domain]=structuredClone(object.value);}
  state.world.locations={};state.world.regions={};state.world.settlements={};
  for(const collection of SHARDED_WORLD_COLLECTIONS)for(const [id,ref] of Object.entries(root.collections.world[collection])){const object=objects.get(ref);validateCanonicalObject(ref,object);if(object.domain!==`world.${collection}.${id}`)throw new Error('Canonical world-unit domain mismatch.');state.world[collection][id]=structuredClone(object.value);}
  state.npcs={};for(const [id,ref] of Object.entries(root.collections.npcs.entries)){const object=objects.get(ref);validateCanonicalObject(ref,object);if(object.domain!==`npcs.entries.${id}`)throw new Error('Canonical NPC domain mismatch.');state.npcs[id]=structuredClone(object.value);}return state;
}

function add(index,key,eventRef){if(!key)return;(index[key]||=[]).push(eventRef);}
function historyIndexIntegrity(index){const {index_id,...payload}=index;return `hix_${sha256(payload).slice(0,24)}`;}
function validateHistoryRef(ref){
  if(!ref||typeof ref!=='object'||Array.isArray(ref)||Object.keys(ref).sort().join(',')!=='event_id,generation,record_hash')throw new Error('Invalid history index reference.');
  if(!Number.isInteger(ref.generation)||ref.generation<0||!/^[a-f0-9]{64}$/.test(ref.record_hash)||typeof ref.event_id!=='string'||!ref.event_id)throw new Error('Invalid history index reference.');
}
function validateHistoryRefList(list){if(!Array.isArray(list))throw new Error('Invalid history index reference list.');for(const ref of list)validateHistoryRef(ref);}
export function buildHistoryIndex(generations){
  const index={contract_id:WORLD_FOUNDATION.historyIndexContract,head_hash:generations.at(-1)?.record_hash||null,by_entity:{},by_location:{},by_thread:{},by_evidence:{},by_causal_parent:{},recent:[]};
  for(const record of generations)for(const event of record.events||[]){const ref={generation:record.generation,record_hash:record.record_hash,event_id:event.id};for(const id of event.entity_ids||[])add(index.by_entity,id,ref);add(index.by_location,event.location_id,ref);for(const id of event.thread_ids||[])add(index.by_thread,id,ref);for(const id of [event.evidence_id,event.data?.evidence_id,event.player_data?.evidence_id])add(index.by_evidence,id,ref);for(const id of event.causal_parent_ids||[])add(index.by_causal_parent,id,ref);index.recent.push(ref);if(index.recent.length>256)index.recent.shift();}
  return {...index,index_id:historyIndexIntegrity(index)};
}
export function validateHistoryIndex(index,headHash){
  if(!index||index.contract_id!==WORLD_FOUNDATION.historyIndexContract||index.head_hash!==headHash)throw new Error('Stale or incompatible history index.');
  if(typeof index.index_id!=='string'||index.index_id!==historyIndexIntegrity(index))throw new Error('History index integrity mismatch.');
  for(const name of ['by_entity','by_location','by_thread','by_evidence','by_causal_parent']){
    if(!index[name]||typeof index[name]!=='object'||Array.isArray(index[name]))throw new Error('Invalid history index.');
    for(const refs of Object.values(index[name]))validateHistoryRefList(refs);
  }
  validateHistoryRefList(index.recent);
  return true;
}
