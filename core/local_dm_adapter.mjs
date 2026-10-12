import { CONTRACTS } from './contracts.mjs';
import { buildDmContext, validateDmContext, validateDmOutput } from './dm_contract.mjs';

export const LOCAL_DM_ADAPTER_CONTRACT='ER_LOCAL_DM_ADAPTER_V1';

function clone(value){return structuredClone(value);}
function assertFunction(value,label){if(typeof value!=='function')throw new Error(`${label} must be a function.`);}
function boundedTimeout(value){if(!Number.isInteger(value)||value<1||value>30000)throw new Error('Local AI timeout must be an integer from 1 to 30000 ms.');return value;}
async function invokeWithTimeout(invoke,packet,timeoutMs){
  let timer;
  const timeout=new Promise((_,reject)=>{timer=setTimeout(()=>{const error=new Error('Local AI response timed out.');error.code='LOCAL_DM_TIMEOUT';reject(error);},timeoutMs);});
  try{return await Promise.race([Promise.resolve().then(()=>invoke(packet)),timeout]);}
  finally{clearTimeout(timer);}
}

function validateLocalReferences(output,packet){
  const ledgerIds=new Set(packet.recent_conversation.map(entry=>entry.entry_id));
  for(const id of output.referenced_ledger_entry_ids)if(!ledgerIds.has(id))throw new Error('Local DM output references conversation outside its packet.');
}

export function createLocalDmAdapter({invoke,timeout_ms=4000}={}){
  assertFunction(invoke,'Local AI invoke');
  const timeoutMs=boundedTimeout(timeout_ms);
  return Object.freeze({
    contract_id:LOCAL_DM_ADAPTER_CONTRACT,
    authority:'presentation_only',
    async respond({interaction,head,player_safe_state,conversation=[],presentation_events=[],committed_resolution=null}={}){
      const packet=buildDmContext({interaction,head,player_safe_state,conversation,presentation_events,committed_resolution});
      validateDmContext(packet,head);
      // The separated Local AI receives a detached, closed player-safe packet.
      // It never receives canonical state, raw events, storage, or commit methods.
      const output=await invokeWithTimeout(invoke,clone(packet),timeoutMs);
      validateDmOutput(output,packet);
      if(output.provenance.role!=='local')throw new Error('Local DM adapter accepts only local-provenance output.');
      validateLocalReferences(output,packet);
      return {packet:clone(packet),output:clone(output)};
    },
  });
}

export function localDmOutput({interaction_id,output_kind,text,presentation_event_ids=[],ledger_entry_ids=[],clarification=null,npc_expression_links=[]}={}){
  return {
    contract_id:CONTRACTS.dm_output,
    interaction_id,
    output_kind,
    text,
    referenced_presentation_event_ids:[...presentation_event_ids],
    referenced_ledger_entry_ids:[...ledger_entry_ids],
    clarification,
    npc_expression_links:[...npc_expression_links],
    provenance:{role:'local'},
  };
}
