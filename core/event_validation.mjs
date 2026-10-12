const EVENT_ID_RE=/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/;
const EVENT_TYPE_RE=/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,63}$/;

function requireString(value,label,{max=256,pattern=null}={}){
  if(typeof value!=='string'||value.length<1||value.length>max)throw new Error(`${label} is invalid.`);
  if(/[\u0000-\u001f\u007f]/.test(value))throw new Error(`${label} contains control characters.`);
  if(pattern&&!pattern.test(value))throw new Error(`${label} contains forbidden characters.`);
  return value;
}

export function validateEventEnvelope(event,{campaignId,branchId,generation,seenIds=new Set()}={}){
  if(!event||typeof event!=='object'||Array.isArray(event))throw new Error('Event must be an object.');
  requireString(event.id,'Event ID',{max:128,pattern:EVENT_ID_RE});
  if(seenIds.has(event.id))throw new Error(`Duplicate event ID: ${event.id}`);
  requireString(event.type,'Event type',{max:64,pattern:EVENT_TYPE_RE});
  if(typeof event.summary!=='string')throw new Error(`Event ${event.id} summary must be a string.`);
  if(event.summary.length>20_000)throw new Error(`Event ${event.id} summary is too long.`);
  if(event.data!==undefined&&(event.data===null||typeof event.data!=='object'||Array.isArray(event.data)))throw new Error(`Event ${event.id} data must be an object.`);
  if(!Array.isArray(event.known_by)||event.known_by.length<1)throw new Error(`Event ${event.id} must declare known_by explicitly.`);
  for(const who of event.known_by)requireString(who,`Event ${event.id} known_by identity`,{max:128,pattern:EVENT_ID_RE});
  if(event.generation!==undefined&&event.generation!==generation)throw new Error(`Event ${event.id} generation mismatch.`);
  if(event.campaign_id!==undefined&&event.campaign_id!==campaignId)throw new Error(`Event ${event.id} campaign mismatch.`);
  if(event.branch_id!==undefined&&event.branch_id!==branchId)throw new Error(`Event ${event.id} branch mismatch.`);
  if(event.sequence!==undefined&&(!Number.isInteger(event.sequence)||event.sequence<0))throw new Error(`Event ${event.id} sequence is invalid.`);
  const parents=event.causal_parent_ids??[];
  if(!Array.isArray(parents))throw new Error(`Event ${event.id} causal_parent_ids must be an array.`);
  for(const parent of parents){
    requireString(parent,`Event ${event.id} causal parent`,{max:128,pattern:EVENT_ID_RE});
    if(!seenIds.has(parent))throw new Error(`Event ${event.id} references missing or future causal parent ${parent}.`);
  }
  seenIds.add(event.id);
  return true;
}

export function validateRecordEvents(record,seenIds=new Set()){
  if(!record||!Array.isArray(record.events))throw new Error('Generation events must be an array.');
  for(const event of record.events)validateEventEnvelope(event,{campaignId:record.campaign_id,branchId:record.branch_id,generation:record.generation,seenIds});
  return seenIds;
}
