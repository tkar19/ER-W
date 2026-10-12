import { CORE } from './core_constants.mjs';
import { sha256 } from './util.mjs';
import { validateState } from './state_validator.mjs';
import { validateRecordEvents } from './event_validation.mjs';
import {
  buildStateRoot,
  diffStateRoots,
  flattenStateRootRefs,
  materializeState,
  validateCanonicalObject,
  validateStateRoot,
} from './incremental_persistence.mjs';
import { WORLD_FOUNDATION } from './world_foundation.mjs';

export const BROWSER_PERSISTENCE=Object.freeze({
  checkpointContract:'ER_BROWSER_CHECKPOINT_V1',
});

const HASH=/^[a-f0-9]{64}$/;
const CHECKPOINT_KEYS='contract_id,objects,record,root';
const RECORD_KEYS='branch_id,campaign_id,changed_object_refs,committed_at,events,generation,parent_hash,record_hash,state_root_ref,storage_contract';
const exact=(value,keys)=>value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).sort().join(',')===keys;

function recordPayload({stateRootRef,changedObjectRefs,state,events,parentHash,committedAt}){
  return {
    storage_contract:WORLD_FOUNDATION.persistenceContract,
    branch_id:CORE.branchId,
    campaign_id:state.meta.campaign_id,
    generation:state.meta.generation,
    parent_hash:parentHash,
    state_root_ref:stateRootRef,
    changed_object_refs:structuredClone(changedObjectRefs),
    events:structuredClone(events),
    committed_at:String(committedAt),
  };
}

function validateRecordShape(record){
  if(!exact(record,RECORD_KEYS)||record.storage_contract!==WORLD_FOUNDATION.persistenceContract||record.branch_id!==CORE.branchId||typeof record.campaign_id!=='string'||!record.campaign_id||!Number.isInteger(record.generation)||record.generation<0||!HASH.test(record.state_root_ref)||!Array.isArray(record.changed_object_refs)||!Array.isArray(record.events)||typeof record.committed_at!=='string'||!record.committed_at||!HASH.test(record.record_hash))throw new Error('Invalid browser checkpoint record.');
  if((record.generation===0&&record.parent_hash!==null)||(record.generation>0&&!HASH.test(String(record.parent_hash||''))))throw new Error('Invalid browser checkpoint parent binding.');
  const {record_hash,...payload}=record;if(sha256(payload)!==record_hash)throw new Error('Browser checkpoint record integrity mismatch.');
}

function objectMap(objects){
  if(!Array.isArray(objects))throw new Error('Browser checkpoint objects must be an array.');
  const map=new Map();
  for(const entry of objects){
    if(!entry||typeof entry!=='object'||Array.isArray(entry)||Object.keys(entry).sort().join(',')!=='object,ref'||!HASH.test(String(entry.ref||'')))throw new Error('Invalid browser checkpoint object envelope.');
    validateCanonicalObject(entry.ref,entry.object);
    if(map.has(entry.ref)&&JSON.stringify(map.get(entry.ref))!==JSON.stringify(entry.object))throw new Error('Immutable browser object reference collision.');
    map.set(entry.ref,entry.object);
  }
  return map;
}

export function createBrowserCheckpoint(state,events,{previousRoot=null,parentHash=null,committedAt}={}){
  validateState(state,{requireGeneration:state.meta.generation});
  if(typeof committedAt!=='string'||!committedAt)throw new Error('Browser checkpoint requires an explicit commit timestamp.');
  if((state.meta.generation===0&&parentHash!==null)||(state.meta.generation>0&&!HASH.test(String(parentHash||''))))throw new Error('Browser checkpoint parent binding does not match generation.');
  const built=buildStateRoot(state,previousRoot);
  const payload=recordPayload({stateRootRef:built.rootRef,changedObjectRefs:built.changed,state,events,parentHash,committedAt});
  const record={...payload,record_hash:sha256(payload)};
  validateRecordEvents(record,new Set());
  return {contract_id:BROWSER_PERSISTENCE.checkpointContract,record,root:built.root,objects:built.objects};
}

export function validateBrowserCheckpoint(checkpoint,{previousRoot=null,seenEventIds=new Set()}={}){
  if(!exact(checkpoint,CHECKPOINT_KEYS)||checkpoint.contract_id!==BROWSER_PERSISTENCE.checkpointContract)throw new Error('Invalid browser checkpoint envelope.');
  const {record,root}=checkpoint;validateRecordShape(record);
  validateStateRoot(record.state_root_ref,root,{campaignId:record.campaign_id,generation:record.generation});
  const expectedChanged=diffStateRoots(previousRoot,root);
  if(JSON.stringify(record.changed_object_refs)!==JSON.stringify(expectedChanged))throw new Error('Browser checkpoint changed-object metadata mismatch.');
  const objects=objectMap(checkpoint.objects),required=new Set(Object.values(flattenStateRootRefs(root)));
  for(const ref of required)if(!objects.has(ref))throw new Error(`Browser checkpoint is missing canonical object ${ref}.`);
  for(const ref of objects.keys())if(!required.has(ref))throw new Error(`Browser checkpoint contains unreferenced canonical object ${ref}.`);
  const state=materializeState(root,objects);
  validateStateRoot(record.state_root_ref,root,{campaignId:record.campaign_id,generation:record.generation,schemaVersion:state.meta?.schema_version});
  if(state.meta?.campaign_id!==record.campaign_id||state.meta?.branch_id!==record.branch_id||state.meta?.generation!==record.generation)throw new Error('Browser checkpoint state identity binding mismatch.');
  validateState(state,{requireGeneration:record.generation});validateRecordEvents(record,seenEventIds);
  return state;
}

export function mergeBrowserObjects(target,checkpoint){
  if(!(target instanceof Map))throw new Error('Browser canonical object target must be a Map.');
  const incoming=objectMap(checkpoint.objects);
  for(const [ref,object] of incoming){
    if(target.has(ref)&&JSON.stringify(target.get(ref))!==JSON.stringify(object))throw new Error('Immutable browser object reference collision.');
    target.set(ref,structuredClone(object));
  }
  return target;
}
