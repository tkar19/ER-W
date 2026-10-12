import { CORE } from './core_constants.mjs';
import { nowIso, sha256, slugify } from './util.mjs';
import { validateState, validateTransition } from './state_validator.mjs';
import { migrateState } from './state_migration.mjs';
import { validateCampaignId } from './identity.mjs';
import { validateRecordEvents } from './event_validation.mjs';
import { currentLocationLabel } from './world_foundation.mjs';
import { createBrowserCheckpoint, validateBrowserCheckpoint } from './browser_persistence.mjs';
import { buildHistoryIndex, buildStateRoot, flattenStateRootRefs, validateHistoryIndex } from './incremental_persistence.mjs';
import { validateConversationEntry, validateConversationLedger } from './conversation_ledger.mjs';

const DB_NAME='ergpt-external-local';
const DB_VERSION=5;
const STORES=Object.freeze({heads:'heads',previous:'previous_heads',generations:'generations',roots:'state_roots',objects:'canonical_objects',indexes:'derived_indexes',presentations:'presentations',conversation:'conversation',interactions:'interaction_phases'});
export const LOCAL_IMPORT_LIMITS=Object.freeze({
  maxFileBytes:64*1024*1024,
  maxGenerations:100_000,
  maxRoots:100_000,
  maxObjects:500_000,
  maxEvents:1_000_000,
  maxPresentations:10_000,
  maxConversationEntries:100_000,
  maxStringLength:100_000,
  maxDepth:64,
  maxNodes:2_000_000,
});

function requestResult(request){
  return new Promise((resolve,reject)=>{request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error||new Error('IndexedDB request failed.'));});
}
function transactionDone(tx){
  return new Promise((resolve,reject)=>{tx.oncomplete=()=>resolve();tx.onabort=()=>reject(tx.error||new Error('IndexedDB transaction aborted.'));tx.onerror=()=>{};});
}
function generationKey(campaignId,generation,recordHash){return `${campaignId}|${String(generation).padStart(12,'0')}|${recordHash}`;}
function headObject(campaignId,generation,recordHash){return {campaign_id:campaignId,branch_id:CORE.branchId,generation,record_hash:recordHash,updated_at:nowIso()};}
function clone(v){return structuredClone(v);}

function sanitizePresentation(entry,{index=0,maxGeneration=Infinity}={}){
  if(!entry || typeof entry!=='object' || Array.isArray(entry)) throw new Error(`Presentation ${index} must be an object.`);
  const generation=Number(entry.generation);
  if(!Number.isInteger(generation)||generation<0||generation>maxGeneration) throw new Error(`Presentation ${index} has an invalid generation.`);
  if(typeof entry.text!=='string'||entry.text.length>100_000) throw new Error(`Presentation ${index} text is invalid.`);
  return {
    generation,
    text:entry.text,
    source:String(entry.source||'local').slice(0,64),
    kind:String(entry.kind||'turn').slice(0,64),
    narration_error:entry.narration_error==null?null:String(entry.narration_error).slice(0,1000),
    recorded_at:entry.recorded_at==null?null:String(entry.recorded_at).slice(0,128),
  };
}

function sanitizeConversation(entry,{index=0,campaignId=null,maxGeneration=Infinity}={}){
  const clean=clone(entry);validateConversationEntry(clean);
  if(clean.sequence!==index)throw new Error(`Conversation ${index} has an invalid sequence.`);
  if(campaignId!==null&&clean.campaign_id!==campaignId)throw new Error(`Conversation ${index} has a foreign campaign.`);
  if(clean.world_generation>maxGeneration)throw new Error(`Conversation ${index} references a future generation.`);
  return clean;
}

export function openLocalDatabase({name=DB_NAME}={}){
  if(!globalThis.indexedDB) return Promise.reject(new Error('IndexedDB is unavailable in this runtime.'));
  return new Promise((resolve,reject)=>{
    const req=indexedDB.open(name,DB_VERSION);
    req.onupgradeneeded=()=>{
      const db=req.result;
      if(!db.objectStoreNames.contains(STORES.heads)) db.createObjectStore(STORES.heads,{keyPath:'campaign_id'});
      if(!db.objectStoreNames.contains(STORES.previous)) db.createObjectStore(STORES.previous,{keyPath:'campaign_id'});
      if(!db.objectStoreNames.contains(STORES.generations)){
        const store=db.createObjectStore(STORES.generations,{keyPath:'key'});
        store.createIndex('campaign_id','campaign_id',{unique:false});
      }
      if(!db.objectStoreNames.contains(STORES.roots)) db.createObjectStore(STORES.roots,{keyPath:'ref'});
      if(!db.objectStoreNames.contains(STORES.objects)) db.createObjectStore(STORES.objects,{keyPath:'ref'});
      if(!db.objectStoreNames.contains(STORES.indexes)) db.createObjectStore(STORES.indexes,{keyPath:'campaign_id'});
      if(!db.objectStoreNames.contains(STORES.presentations)){
        const store=db.createObjectStore(STORES.presentations,{keyPath:'id',autoIncrement:true});
        store.createIndex('campaign_id','campaign_id',{unique:false});
      }
      if(!db.objectStoreNames.contains(STORES.conversation)){
        const store=db.createObjectStore(STORES.conversation,{keyPath:'entry_id'});
        store.createIndex('campaign_id','campaign_id',{unique:false});
      }
      if(!db.objectStoreNames.contains(STORES.interactions)){
        const store=db.createObjectStore(STORES.interactions,{keyPath:'interaction_id'});
        store.createIndex('campaign_id','campaign_id',{unique:false});
      }
    };
    req.onsuccess=()=>resolve(req.result);
    req.onerror=()=>reject(req.error||new Error('Could not open local ERGPT database.'));
  });
}

function makeRecord({campaignId,generation,parentHash,state,events,committedAt=nowIso()}){
  const payload={branch_id:CORE.branchId,campaign_id:campaignId,generation,parent_hash:parentHash,state,events,committed_at:committedAt};
  return {...payload,record_hash:sha256(payload)};
}
function storedRecord(record){return {key:generationKey(record.campaign_id,record.generation,record.record_hash),...clone(record)};}
function stripStorageKey(value){if(!value)return value;const {key,...record}=value;return record;}
function verifyRecord(record,{campaignId=null,generation=null,recordHash=null}={}){
  if(!record||typeof record!=='object')throw new Error('Generation record is missing.');
  const {record_hash,...payload}=record;
  if(!/^[0-9a-f]{64}$/.test(String(record_hash||''))||sha256(payload)!==record_hash)throw new Error(`Generation ${record.generation} hash mismatch.`);
  if(record.branch_id!==CORE.branchId)throw new Error('Generation branch mismatch.');
  if(campaignId!==null&&record.campaign_id!==campaignId)throw new Error('Generation campaign mismatch.');
  if(generation!==null&&record.generation!==generation)throw new Error('Generation number mismatch.');
  if(recordHash!==null&&record.record_hash!==recordHash)throw new Error('Generation hash does not match requested canonical record.');
  return record;
}
function validateHead(head,campaignId){
  if(!head||typeof head!=='object'||head.branch_id!==CORE.branchId||head.campaign_id!==campaignId||!Number.isInteger(head.generation)||head.generation<0||!/^[0-9a-f]{64}$/.test(String(head.record_hash||'')))throw new Error('Invalid local campaign head.');
  return head;
}

function isIncrementalRecord(record){return record?.storage_contract==='ER_INCREMENTAL_COMMIT_V1'&&!Object.hasOwn(record,'state');}
function verifyStoredRecord(record,{campaignId=null,generation=null,recordHash=null}={}){
  if(!isIncrementalRecord(record))return verifyRecord(record,{campaignId,generation,recordHash});
  if(!record||typeof record!=='object')throw new Error('Generation record is missing.');
  const {record_hash,...payload}=record;
  if(!/^[0-9a-f]{64}$/.test(String(record_hash||''))||sha256(payload)!==record_hash)throw new Error(`Generation ${record.generation} hash mismatch.`);
  if(record.branch_id!==CORE.branchId)throw new Error('Generation branch mismatch.');
  if(campaignId!==null&&record.campaign_id!==campaignId)throw new Error('Generation campaign mismatch.');
  if(generation!==null&&record.generation!==generation)throw new Error('Generation number mismatch.');
  if(recordHash!==null&&record.record_hash!==recordHash)throw new Error('Generation hash does not match requested canonical record.');
  return record;
}
async function getRawRecord(store,campaignId,generation,hash){
  const raw=await requestResult(store.get(generationKey(campaignId,generation,hash)));
  return raw?verifyStoredRecord(stripStorageKey(raw),{campaignId,generation,recordHash:hash}):null;
}
async function getRootFromStore(store,ref){
  const envelope=await requestResult(store.get(ref));
  if(!envelope||envelope.ref!==ref||!envelope.root)throw new Error(`Canonical state root ${ref} is missing.`);
  return envelope.root;
}
async function hydrateIncrementalRecord(tx,record,previousRoot,seenEventIds=new Set()){
  const root=await getRootFromStore(tx.objectStore(STORES.roots),record.state_root_ref);
  const objects=[];
  for(const ref of new Set(Object.values(flattenStateRootRefs(root)))){
    const envelope=await requestResult(tx.objectStore(STORES.objects).get(ref));
    if(!envelope||envelope.ref!==ref||!Object.hasOwn(envelope,'object'))throw new Error(`Browser checkpoint is missing canonical object ${ref}.`);
    objects.push({ref,object:envelope.object});
  }
  const checkpoint={contract_id:'ER_BROWSER_CHECKPOINT_V1',record,root,objects};
  const state=validateBrowserCheckpoint(checkpoint,{previousRoot,seenEventIds});
  const hydrated=clone(record);Object.defineProperty(hydrated,'state',{value:state,enumerable:false});Object.defineProperty(hydrated,'state_root',{value:root,enumerable:false});return hydrated;
}
async function publishCheckpoint(tx,checkpoint){
  const roots=tx.objectStore(STORES.roots),objects=tx.objectStore(STORES.objects);
  const existingRoot=await requestResult(roots.get(checkpoint.record.state_root_ref));
  if(existingRoot&&JSON.stringify(existingRoot.root)!==JSON.stringify(checkpoint.root))throw new Error('Immutable browser state-root reference collision.');
  if(!existingRoot)await requestResult(roots.add({ref:checkpoint.record.state_root_ref,root:clone(checkpoint.root)}));
  for(const entry of checkpoint.objects){
    const existing=await requestResult(objects.get(entry.ref));
    if(existing&&JSON.stringify(existing.object)!==JSON.stringify(entry.object))throw new Error('Immutable browser object reference collision.');
    if(!existing)await requestResult(objects.add({ref:entry.ref,object:clone(entry.object)}));
  }
}

export async function createLocalCampaign(state,initialEvents=[],options={}){
  validateState(state,{requireGeneration:0});
  const campaignId=validateCampaignId(state.meta.campaign_id);
  const checkpoint=createBrowserCheckpoint(state,initialEvents,{committedAt:nowIso()});const record=checkpoint.record;
  const db=await openLocalDatabase(options); const tx=db.transaction([STORES.heads,STORES.generations,STORES.roots,STORES.objects,STORES.indexes],'readwrite');
  try{
    const heads=tx.objectStore(STORES.heads); const generations=tx.objectStore(STORES.generations);
    if(await requestResult(heads.get(campaignId)))throw new Error('Campaign already exists.');
    await publishCheckpoint(tx,checkpoint);
    await requestResult(generations.add(storedRecord(record)));
    await requestResult(tx.objectStore(STORES.indexes).put({campaign_id:campaignId,index:buildHistoryIndex([record])}));
    await requestResult(heads.add(headObject(campaignId,0,record.record_hash)));
    await transactionDone(tx); return Object.assign(clone(record),{state:clone(state)});
  }catch(error){try{tx.abort();}catch{} throw error;} finally{db.close();}
}

export async function loadLocalHead(campaignId,options={}){
  validateCampaignId(campaignId);const db=await openLocalDatabase(options);const tx=db.transaction(STORES.heads,'readonly');
  try{const head=await requestResult(tx.objectStore(STORES.heads).get(campaignId));await transactionDone(tx);return validateHead(head,campaignId);}finally{db.close();}
}

export async function loadLocalGeneration(campaignId,generation,recordHash,options={}){
  validateCampaignId(campaignId);const db=await openLocalDatabase(options);const tx=db.transaction([STORES.generations,STORES.roots,STORES.objects],'readonly');
  try{const chain=await collectChainInTransaction(tx,campaignId,{campaign_id:campaignId,branch_id:CORE.branchId,generation,record_hash:recordHash});await transactionDone(tx);return chain.at(-1);}finally{db.close();}
}

export async function loadLocalCurrent(campaignId,options={}){
  validateCampaignId(campaignId);const db=await openLocalDatabase(options);const tx=db.transaction([STORES.heads,STORES.generations,STORES.roots,STORES.objects],'readonly');
  try{
    const head=validateHead(await requestResult(tx.objectStore(STORES.heads).get(campaignId)),campaignId);
    const chain=await collectChainInTransaction(tx,campaignId,head);
    await transactionDone(tx); return chain.at(-1);
  }finally{db.close();}
}

async function collectChainInTransaction(tx,campaignId,head){
  const raw=[];let generation=head.generation,hash=head.record_hash;const store=tx.objectStore(STORES.generations);
  while(generation>=0){
    const record=await getRawRecord(store,campaignId,generation,hash);if(!record)throw new Error(`Committed generation ${generation} is missing.`);
    raw.push(record);
    if(generation===0){if(record.parent_hash!==null)throw new Error('Generation 0 has a parent.');break;}
    if(!record.parent_hash)throw new Error(`Generation ${generation} is missing parent hash.`);
    hash=record.parent_hash;generation-=1;
  }
  raw.reverse();const generations=[];let previousRoot=null;const seen=new Set();
  for(const record of raw){
    let hydrated;
    if(isIncrementalRecord(record))hydrated=await hydrateIncrementalRecord(tx,record,previousRoot,seen);
    else{validateRecordEvents(record,seen);const state=migrateState(record.state).state;validateState(state,{requireGeneration:record.generation});hydrated=clone(record);previousRoot=buildStateRoot(state).root;}
    for(const event of record.events||[])seen.add(event.id);
    if(isIncrementalRecord(record))previousRoot=hydrated.state_root;
    generations.push(hydrated);
  }
  return generations;
}

export async function commitLocalGeneration(campaignId,expectedGeneration,state,events,options={}){
  validateCampaignId(campaignId);
  const db=await openLocalDatabase(options);
  const tx=db.transaction([STORES.heads,STORES.previous,STORES.generations,STORES.roots,STORES.objects,STORES.indexes,STORES.interactions],'readwrite');
  try{
    const heads=tx.objectStore(STORES.heads), previous=tx.objectStore(STORES.previous), generations=tx.objectStore(STORES.generations);
    const head=validateHead(await requestResult(heads.get(campaignId)),campaignId);
    if(head.generation!==expectedGeneration){const e=new Error(`Stale writer: expected generation ${expectedGeneration}, current is ${head.generation}.`);e.code='STALE_WRITER';throw e;}
    const chain=await collectChainInTransaction(tx,campaignId,head),parent=chain.at(-1);if(!parent)throw new Error('Canonical parent generation is missing.');
    const generation=expectedGeneration+1;
    if(state.meta.generation!==generation)throw new Error('State generation does not match commit generation.');
    validateState(state,{requireGeneration:generation}); validateTransition(migrateState(parent.state).state,state);
    const seen=new Set();for(const r of chain)for(const e of r.events||[])seen.add(e.id);
    const previousRoot=parent.state_root||buildStateRoot(parent.state).root;
    const checkpoint=createBrowserCheckpoint(state,events,{previousRoot,parentHash:parent.record_hash,committedAt:nowIso()}),record=checkpoint.record;validateBrowserCheckpoint(checkpoint,{previousRoot,seenEventIds:seen});
    await publishCheckpoint(tx,checkpoint);
    await requestResult(generations.add(storedRecord(record)));
    await requestResult(tx.objectStore(STORES.indexes).put({campaign_id:campaignId,index:buildHistoryIndex([...chain,record])}));
    await requestResult(previous.put(clone(head)));
    await requestResult(heads.put(headObject(campaignId,generation,record.record_hash)));
    if(options.interaction_phase)await requestResult(tx.objectStore(STORES.interactions).put({...clone(options.interaction_phase),phase:'committed_awaiting_presentation',head:{campaign_id:campaignId,branch_id:CORE.branchId,generation,head_hash:record.record_hash}}));
    await transactionDone(tx);return Object.assign(clone(record),{state:clone(state)});
  }catch(error){try{tx.abort();}catch{} throw error;}finally{db.close();}
}

const INTERACTION_PHASES=new Set(['received_uncommitted','clarification_pending','committed_awaiting_presentation','fully_presented']);
function validateInteractionPhase(value,campaignId){
  if(!value||typeof value!=='object'||Array.isArray(value)||value.campaign_id!==campaignId||typeof value.interaction_id!=='string'||!INTERACTION_PHASES.has(value.phase))throw new Error('Invalid interaction recovery phase.');
  return clone(value);
}
export async function saveLocalInteractionPhase(campaignId,value,options={}){
  validateCampaignId(campaignId);const clean=validateInteractionPhase(value,campaignId),db=await openLocalDatabase(options),tx=db.transaction(STORES.interactions,'readwrite');
  try{await requestResult(tx.objectStore(STORES.interactions).put(clean));await transactionDone(tx);return clean;}finally{db.close();}
}
export async function readLocalInteractionPhases(campaignId,options={}){
  validateCampaignId(campaignId);const db=await openLocalDatabase(options),tx=db.transaction(STORES.interactions,'readonly');
  try{const values=await requestResult(tx.objectStore(STORES.interactions).index('campaign_id').getAll(campaignId));await transactionDone(tx);return values.map(value=>validateInteractionPhase(value,campaignId));}finally{db.close();}
}
export async function clearLocalInteractionPhase(campaignId,interactionId,options={}){
  validateCampaignId(campaignId);const db=await openLocalDatabase(options),tx=db.transaction(STORES.interactions,'readwrite');
  try{const store=tx.objectStore(STORES.interactions),current=await requestResult(store.get(interactionId));if(current?.campaign_id===campaignId)await requestResult(store.delete(interactionId));await transactionDone(tx);}finally{db.close();}
}
export async function finalizeLocalInteraction(campaignId,{phase,presentation,conversation},options={}){
  validateCampaignId(campaignId);const cleanPhase=validateInteractionPhase(phase,campaignId),cleanPresentation=sanitizePresentation({...presentation,recorded_at:presentation?.recorded_at||nowIso()}),db=await openLocalDatabase(options);
  const tx=db.transaction([STORES.presentations,STORES.conversation,STORES.interactions],'readwrite');
  try{
    const phases=tx.objectStore(STORES.interactions),current=await requestResult(phases.get(cleanPhase.interaction_id));
    if(!current||current.campaign_id!==campaignId||current.phase!==cleanPhase.phase)throw new Error('Interaction recovery phase changed.');
    const conversations=tx.objectStore(STORES.conversation),existing=(await requestResult(conversations.index('campaign_id').getAll(campaignId))).map(clone).sort((a,b)=>a.sequence-b.sequence),cleanConversation=sanitizeConversation(conversation,{index:existing.length,campaignId});
    validateConversationLedger([...existing,cleanConversation]);await requestResult(tx.objectStore(STORES.presentations).add({campaign_id:campaignId,...cleanPresentation}));await requestResult(conversations.add(cleanConversation));
    await requestResult(phases.delete(cleanPhase.interaction_id));await transactionDone(tx);return clone(cleanConversation);
  }catch(error){try{tx.abort();}catch{}throw error;}finally{db.close();}
}

export async function appendLocalPresentation(campaignId,presentation,options={}){
  validateCampaignId(campaignId);const clean=sanitizePresentation({...presentation,recorded_at:presentation?.recorded_at||nowIso()});const db=await openLocalDatabase(options);const tx=db.transaction(STORES.presentations,'readwrite');
  try{await requestResult(tx.objectStore(STORES.presentations).add({campaign_id:campaignId,...clean}));await transactionDone(tx);}finally{db.close();}
}

export async function readLocalPresentations(campaignId,max=50,options={}){
  validateCampaignId(campaignId);const db=await openLocalDatabase(options);const tx=db.transaction(STORES.presentations,'readonly');
  try{const all=await requestResult(tx.objectStore(STORES.presentations).index('campaign_id').getAll(campaignId));await transactionDone(tx);return all.slice(-max).map(({id,...x})=>x);}finally{db.close();}
}

export async function appendLocalConversation(campaignId,entry,options={}){
  validateCampaignId(campaignId);const db=await openLocalDatabase(options);const tx=db.transaction(STORES.conversation,'readwrite');
  try{
    const store=tx.objectStore(STORES.conversation),existing=(await requestResult(store.index('campaign_id').getAll(campaignId))).map(clone).sort((a,b)=>a.sequence-b.sequence),clean=sanitizeConversation(entry,{index:existing.length,campaignId});
    validateConversationLedger([...existing,clean]);await requestResult(store.add(clean));await transactionDone(tx);return clone(clean);
  }catch(error){try{tx.abort();}catch{}throw error;}finally{db.close();}
}

export async function readLocalConversation(campaignId,max=50,options={}){
  validateCampaignId(campaignId);const db=await openLocalDatabase(options);const tx=db.transaction(STORES.conversation,'readonly');
  try{const all=(await requestResult(tx.objectStore(STORES.conversation).index('campaign_id').getAll(campaignId))).map(clone).sort((a,b)=>a.sequence-b.sequence);validateConversationLedger(all);await transactionDone(tx);return all.slice(-max);}finally{db.close();}
}

export async function listLocalCampaigns(options={}){
  const db=await openLocalDatabase(options);const tx=db.transaction([STORES.heads,STORES.previous,STORES.generations,STORES.roots,STORES.objects,STORES.indexes],'readonly');
  try{
    const heads=await requestResult(tx.objectStore(STORES.heads).getAll());const out=[];
    for(const head of heads){
      let campaignId;try{campaignId=validateCampaignId(head?.campaign_id);}catch{continue;}
      try{
        const validHead=validateHead(head,campaignId),record=(await collectChainInTransaction(tx,campaignId,validHead)).at(-1);if(!record)throw new Error('Campaign has no current generation.');
        const state=migrateState(record.state).state,envelope=await requestResult(tx.objectStore(STORES.indexes).get(campaignId));let indexStatus='valid',recoveryAction=null;
        try{if(!envelope||envelope.campaign_id!==campaignId)throw new Error('Local history index is missing.');validateHistoryIndex(envelope.index,validHead.record_hash);}catch{indexStatus='invalid';recoveryAction='rebuild_index';}
        out.push({campaign_id:campaignId,generation:validHead.generation,name:state.pc.identity.name,location:currentLocationLabel(state),time_label:state.world.time_label,campaign_day:state.campaign_clock.elapsed.day,updated_at:validHead.updated_at,integrity_status:'valid',index_status:indexStatus,recovery_action:recoveryAction});
      }catch{
        let recoveryAction=null;
        try{const candidate=validateHead(await requestResult(tx.objectStore(STORES.previous).get(campaignId)),campaignId);if((await collectChainInTransaction(tx,campaignId,candidate)).at(-1))recoveryAction='previous_head';}catch{}
        out.push({campaign_id:campaignId,generation:Number.isInteger(head?.generation)?head.generation:null,name:'Recovery required',location:'Canonical data unavailable',time_label:'Recovery mode',campaign_day:null,updated_at:typeof head?.updated_at==='string'?head.updated_at:'',integrity_status:'invalid',index_status:'not_checked',recovery_action:recoveryAction});
      }
    }
    await transactionDone(tx);return out.sort((a,b)=>String(b.updated_at).localeCompare(String(a.updated_at)));
  }finally{db.close();}
}

export async function validateLocalAncestry(campaignId,options={}){
  validateCampaignId(campaignId);const db=await openLocalDatabase(options);const tx=db.transaction([STORES.heads,STORES.generations,STORES.roots,STORES.objects],'readonly');
  try{
    const head=validateHead(await requestResult(tx.objectStore(STORES.heads).get(campaignId)),campaignId);const chain=await collectChainInTransaction(tx,campaignId,head);let parent=null;
    for(let i=0;i<chain.length;i++){const record=chain[i];if(record.generation!==i||record.parent_hash!==parent)throw new Error(`Broken local ancestry at generation ${i}.`);parent=record.record_hash;}
    if(parent!==head.record_hash)throw new Error('Local head is not the end of validated ancestry.');await transactionDone(tx);return {valid:true,generations:chain.length,head};
  }finally{db.close();}
}

export async function loadLocalHistoryIndex(campaignId,options={}){
  validateCampaignId(campaignId);const db=await openLocalDatabase(options);const tx=db.transaction([STORES.heads,STORES.indexes],'readonly');
  try{
    const head=validateHead(await requestResult(tx.objectStore(STORES.heads).get(campaignId)),campaignId),envelope=await requestResult(tx.objectStore(STORES.indexes).get(campaignId));
    if(!envelope||envelope.campaign_id!==campaignId)throw new Error('Local history index is missing.');validateHistoryIndex(envelope.index,head.record_hash);await transactionDone(tx);return clone(envelope.index);
  }finally{db.close();}
}

export async function rebuildLocalHistoryIndex(campaignId,options={}){
  validateCampaignId(campaignId);const db=await openLocalDatabase(options);let expectedHead,index;
  try{
    const read=db.transaction([STORES.heads,STORES.generations,STORES.roots,STORES.objects],'readonly');expectedHead=validateHead(await requestResult(read.objectStore(STORES.heads).get(campaignId)),campaignId);const chain=await collectChainInTransaction(read,campaignId,expectedHead);index=buildHistoryIndex(chain);validateHistoryIndex(index,expectedHead.record_hash);await transactionDone(read);
    const write=db.transaction([STORES.heads,STORES.indexes],'readwrite');try{
      const current=validateHead(await requestResult(write.objectStore(STORES.heads).get(campaignId)),campaignId);if(current.record_hash!==expectedHead.record_hash){const error=new Error('Stale index rebuild: canonical HEAD changed.');error.code='STALE_INDEX_REBUILD';throw error;}
      await requestResult(write.objectStore(STORES.indexes).put({campaign_id:campaignId,index:clone(index)}));await transactionDone(write);return clone(index);
    }catch(error){try{write.abort();}catch{}throw error;}
  }finally{db.close();}
}

export async function exportLocalCampaign(campaignId,options={}){
  validateCampaignId(campaignId);const db=await openLocalDatabase(options);const tx=db.transaction([STORES.heads,STORES.generations,STORES.roots,STORES.objects,STORES.presentations,STORES.conversation],'readonly');
  try{
    const head=validateHead(await requestResult(tx.objectStore(STORES.heads).get(campaignId)),campaignId);const hydrated=await collectChainInTransaction(tx,campaignId,head),generations=hydrated.map(({state,state_root,...record})=>clone(record));
    const roots=[],objects=[],rootRefs=new Set(),objectRefs=new Set();
    for(const record of generations)if(isIncrementalRecord(record)){
      if(!rootRefs.has(record.state_root_ref)){const root=await getRootFromStore(tx.objectStore(STORES.roots),record.state_root_ref);roots.push({ref:record.state_root_ref,root:clone(root)});rootRefs.add(record.state_root_ref);for(const ref of Object.values(flattenStateRootRefs(root)))objectRefs.add(ref);}
    }
    for(const ref of [...objectRefs].sort()){const envelope=await requestResult(tx.objectStore(STORES.objects).get(ref));if(!envelope)throw new Error(`Browser checkpoint is missing canonical object ${ref}.`);objects.push({ref,object:clone(envelope.object)});}
    const presentations=(await requestResult(tx.objectStore(STORES.presentations).index('campaign_id').getAll(campaignId))).map(({id,...x})=>x);
    const conversation=(await requestResult(tx.objectStore(STORES.conversation).index('campaign_id').getAll(campaignId))).map(clone).sort((a,b)=>a.sequence-b.sequence);validateConversationLedger(conversation);
    await transactionDone(tx);return {export_format:'ERGPT_EXT_SAVE_V2',branch_id:CORE.branchId,exported_at:nowIso(),head:clone(head),generations,roots,objects,presentations,conversation};
  }finally{db.close();}
}

function assertImportEnvelope(bundle){
  if(!bundle||typeof bundle!=='object'||Array.isArray(bundle))throw new Error('Invalid save bundle envelope.');
  const v2=bundle.export_format==='ERGPT_EXT_SAVE_V2',allowed=new Set(v2?['export_format','branch_id','exported_at','head','generations','roots','objects','presentations','conversation']:['export_format','branch_id','exported_at','head','generations','presentations']);
  for(const key of Object.keys(bundle))if(!allowed.has(key))throw new Error(`Unexpected save bundle field ${key}.`);
  for(const key of ['export_format','branch_id','exported_at','head','generations','presentations'])if(!Object.hasOwn(bundle,key))throw new Error(`Save bundle is missing ${key}.`);
  if(v2)for(const key of ['roots','objects'])if(!Object.hasOwn(bundle,key))throw new Error(`Incremental save bundle is missing ${key}.`);
  if(typeof bundle.exported_at!=='string'||!bundle.exported_at||bundle.exported_at.length>128)throw new Error('Save bundle export timestamp is invalid.');
}

function assertImportResourceBounds(bundle){
  const limits=LOCAL_IMPORT_LIMITS;
  if(bundle.generations.length>limits.maxGenerations)throw new Error('Save bundle exceeds the generation limit.');
  if((bundle.roots?.length||0)>limits.maxRoots)throw new Error('Save bundle exceeds the state-root limit.');
  if((bundle.objects?.length||0)>limits.maxObjects)throw new Error('Save bundle exceeds the canonical-object limit.');
  if((bundle.presentations?.length||0)>limits.maxPresentations)throw new Error('Save bundle exceeds the presentation limit.');
  if((bundle.conversation?.length||0)>limits.maxConversationEntries)throw new Error('Save bundle exceeds the conversation-entry limit.');
  let events=0;for(const record of bundle.generations){if(!record||typeof record!=='object'||Array.isArray(record)||!Array.isArray(record.events))throw new Error('Imported generation events must be an array.');events+=record.events.length;if(events>limits.maxEvents)throw new Error('Save bundle exceeds the event limit.');}
  const stack=[{value:bundle,depth:0,exit:false}],active=new WeakSet();let nodes=0;
  while(stack.length){const {value,depth,exit}=stack.pop();if(exit){active.delete(value);continue;}if(++nodes>limits.maxNodes)throw new Error('Save bundle exceeds the structural node limit.');if(depth>limits.maxDepth)throw new Error('Save bundle exceeds the nesting limit.');
    if(typeof value==='string'){if(value.length>limits.maxStringLength)throw new Error('Save bundle contains an oversized string.');continue;}
    if(!value||typeof value!=='object')continue;if(active.has(value))throw new Error('Save bundle contains a cyclic structure.');active.add(value);stack.push({value,depth,exit:true});
    if(Array.isArray(value)){for(const child of value)stack.push({value:child,depth:depth+1});continue;}
    for(const [key,child] of Object.entries(value)){if(key.length>256)throw new Error('Save bundle contains an oversized field name.');stack.push({value:child,depth:depth+1});}
  }
}

function validateImportBundle(bundle){
  assertImportEnvelope(bundle);
  if(!bundle||!['ERGPT_EXT_SAVE_V1','ERGPT_EXT_SAVE_V2'].includes(bundle.export_format)||bundle.branch_id!==CORE.branchId)throw new Error('Unsupported or foreign save bundle.');
  if(!Array.isArray(bundle.generations)||bundle.generations.length===0)throw new Error('Save bundle has no generations.');
  if(!Array.isArray(bundle.presentations))throw new Error('Imported presentations must be an array.');
  if(bundle.conversation!==undefined&&!Array.isArray(bundle.conversation))throw new Error('Imported conversation must be an array.');
  if(bundle.roots!==undefined&&!Array.isArray(bundle.roots))throw new Error('Incremental save bundle roots must be an array.');
  if(bundle.objects!==undefined&&!Array.isArray(bundle.objects))throw new Error('Incremental save bundle objects must be an array.');
  assertImportResourceBounds(bundle);
  const campaignId=validateCampaignId(bundle.head?.campaign_id);let previous=null,previousState=null,previousRoot=null;const seen=new Set(),roots=new Map(),objects=new Map(),usedRoots=new Set(),usedObjects=new Set();
  if(bundle.export_format==='ERGPT_EXT_SAVE_V2'){
    if(!Array.isArray(bundle.roots)||!Array.isArray(bundle.objects))throw new Error('Incremental save bundle is missing roots or objects.');
    for(const entry of bundle.roots){if(!entry||typeof entry.ref!=='string'||!entry.root||roots.has(entry.ref))throw new Error('Invalid or duplicate imported state root.');roots.set(entry.ref,entry.root);}
    for(const entry of bundle.objects){if(!entry||typeof entry.ref!=='string'||!Object.hasOwn(entry,'object')||objects.has(entry.ref))throw new Error('Invalid or duplicate imported canonical object.');objects.set(entry.ref,entry.object);}
  }
  for(let i=0;i<bundle.generations.length;i++){
    const record=verifyStoredRecord(bundle.generations[i],{campaignId,generation:i});
    if((i===0&&record.parent_hash!==null)||(previous&&record.parent_hash!==previous.record_hash))throw new Error('Imported generation ancestry mismatch.');
    let state;
    if(isIncrementalRecord(record)){
      const root=roots.get(record.state_root_ref);if(!root)throw new Error(`Imported canonical state root ${record.state_root_ref} is missing.`);usedRoots.add(record.state_root_ref);
      const refs=[...new Set(Object.values(flattenStateRootRefs(root)))],checkpointObjects=[];for(const ref of refs){if(!objects.has(ref))throw new Error(`Imported canonical object ${ref} is missing.`);usedObjects.add(ref);checkpointObjects.push({ref,object:objects.get(ref)});}
      state=validateBrowserCheckpoint({contract_id:'ER_BROWSER_CHECKPOINT_V1',record,root,objects:checkpointObjects},{previousRoot,seenEventIds:seen});previousRoot=root;
    }else{validateRecordEvents(record,seen);state=migrateState(record.state).state;validateState(state,{requireGeneration:i});previousRoot=buildStateRoot(state).root;}
    if(state.meta.campaign_id!==campaignId||state.meta.branch_id!==CORE.branchId)throw new Error('Imported state identity does not match its generation record.');if(previousState)validateTransition(previousState,state);for(const event of record.events||[])seen.add(event.id);previousState=state;previous=record;
  }
  if(previous.record_hash!==bundle.head.record_hash||previous.generation!==bundle.head.generation)throw new Error('Imported head does not match final generation.');
  if(bundle.export_format==='ERGPT_EXT_SAVE_V2'&&(usedRoots.size!==roots.size||usedObjects.size!==objects.size))throw new Error('Incremental save bundle contains unreferenced canonical content.');
  const presentations=bundle.presentations;
  const safePresentations=presentations.map((p,i)=>sanitizePresentation(p,{index:i,maxGeneration:bundle.head.generation}));
  const safeConversation=(bundle.conversation||[]).map((entry,i)=>sanitizeConversation(entry,{index:i,campaignId,maxGeneration:bundle.head.generation}));validateConversationLedger(safeConversation);
  return {campaignId,previous,safePresentations,safeConversation,roots,objects};
}

export async function importLocalCampaign(bundle,options={}){
  const {campaignId,previous,safePresentations,safeConversation,roots,objects}=validateImportBundle(bundle);const db=await openLocalDatabase(options);const tx=db.transaction([STORES.heads,STORES.previous,STORES.generations,STORES.roots,STORES.objects,STORES.indexes,STORES.presentations,STORES.conversation],'readwrite');
  try{
    const heads=tx.objectStore(STORES.heads);if(await requestResult(heads.get(campaignId)))throw new Error('Campaign already exists; import never overwrites it.');
    const generations=tx.objectStore(STORES.generations);for(const record of bundle.generations)await requestResult(generations.add(storedRecord(record)));
    for(const [ref,root] of roots){const existing=await requestResult(tx.objectStore(STORES.roots).get(ref));if(existing&&JSON.stringify(existing.root)!==JSON.stringify(root))throw new Error('Immutable browser state-root reference collision.');if(!existing)await requestResult(tx.objectStore(STORES.roots).add({ref,root:clone(root)}));}
    for(const [ref,object] of objects){const existing=await requestResult(tx.objectStore(STORES.objects).get(ref));if(existing&&JSON.stringify(existing.object)!==JSON.stringify(object))throw new Error('Immutable browser object reference collision.');if(!existing)await requestResult(tx.objectStore(STORES.objects).add({ref,object:clone(object)}));}
    await requestResult(tx.objectStore(STORES.indexes).put({campaign_id:campaignId,index:buildHistoryIndex(bundle.generations)}));
    if(previous.generation>0){const prev=bundle.generations[previous.generation-1];await requestResult(tx.objectStore(STORES.previous).put(headObject(campaignId,prev.generation,prev.record_hash)));}
    await requestResult(heads.add(headObject(campaignId,previous.generation,previous.record_hash)));
    const presentations=tx.objectStore(STORES.presentations);for(const p of safePresentations)await requestResult(presentations.add({campaign_id:campaignId,...clone(p)}));
    const conversation=tx.objectStore(STORES.conversation);for(const entry of safeConversation)await requestResult(conversation.add(clone(entry)));
    await transactionDone(tx);return campaignId;
  }catch(error){try{tx.abort();}catch{} throw error;}finally{db.close();}
}

export async function diagnoseLocalHeadRecovery(campaignId,options={}){
  validateCampaignId(campaignId);const db=await openLocalDatabase(options);const tx=db.transaction([STORES.heads,STORES.previous,STORES.generations,STORES.roots,STORES.objects],'readonly');
  try{
    const heads=tx.objectStore(STORES.heads), prevs=tx.objectStore(STORES.previous), generations=tx.objectStore(STORES.generations);
    try{const head=validateHead(await requestResult(heads.get(campaignId)),campaignId);const current=(await collectChainInTransaction(tx,campaignId,head)).at(-1);if(current){await transactionDone(tx);return {status:'head_valid',recoverable:false,head};}}
    catch{}
    try{const candidate=validateHead(await requestResult(prevs.get(campaignId)),campaignId);const record=(await collectChainInTransaction(tx,campaignId,candidate)).at(-1);if(record){await transactionDone(tx);return {status:'previous_head_available',recoverable:true,candidate};}}
    catch{}
    await transactionDone(tx);return {status:'unrecoverable',recoverable:false};
  }finally{db.close();}
}

export async function recoverLocalPreviousHead(campaignId,options={}){
  validateCampaignId(campaignId);const diagnosis=await diagnoseLocalHeadRecovery(campaignId,options);if(!diagnosis.recoverable)throw new Error('No validated previous local head is available for recovery.');
  const db=await openLocalDatabase(options);const tx=db.transaction([STORES.heads,STORES.generations,STORES.roots,STORES.objects,STORES.indexes],'readwrite');
  try{
    const heads=tx.objectStore(STORES.heads);try{const current=validateHead(await requestResult(heads.get(campaignId)),campaignId);await collectChainInTransaction(tx,campaignId,current);throw new Error('Canonical local HEAD is valid; recovery is no longer required.');}catch(error){if(error.message==='Canonical local HEAD is valid; recovery is no longer required.')throw error;}
    const chain=await collectChainInTransaction(tx,campaignId,diagnosis.candidate),index=buildHistoryIndex(chain);validateHistoryIndex(index,diagnosis.candidate.record_hash);
    const recovered={...diagnosis.candidate,updated_at:nowIso(),recovered_at:nowIso(),recovery_reason:'explicit_previous_head_recovery'};await requestResult(heads.put(recovered));await requestResult(tx.objectStore(STORES.indexes).put({campaign_id:campaignId,index}));await transactionDone(tx);return {recovered:true,head:recovered};
  }catch(error){try{tx.abort();}catch{}throw error;}finally{db.close();}
}

export function newLocalCampaignId(name){
  const random=new Uint8Array(6);if(!globalThis.crypto?.getRandomValues)throw new Error('Secure random source is unavailable.');globalThis.crypto.getRandomValues(random);
  const suffix=Array.from(random,b=>b.toString(16).padStart(2,'0')).join('');return `${slugify(name)}-${suffix}`;
}

export async function deleteLocalDatabaseForTests({name=DB_NAME}={}){
  return new Promise((resolve,reject)=>{const req=indexedDB.deleteDatabase(name);req.onsuccess=()=>resolve();req.onerror=()=>reject(req.error);req.onblocked=()=>reject(new Error('Local database deletion blocked.'));});
}
