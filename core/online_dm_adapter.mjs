import { buildDmContext, buildOnlineHandoff } from './dm_contract.mjs';
import { buildOnlineDmRequest } from './online_dm_contract.mjs';

export const ONLINE_DM_ADAPTER_CONTRACT='ER_ONLINE_DM_ADAPTER_V1';

function requestPhase(interaction,committedResolution){
  if(committedResolution)return 'post_commit_presentation';
  if(interaction.interaction_mode==='clarification_needed')return 'clarification';
  if(interaction.interaction_mode==='persistent_state_query')return 'state_query';
  return 'interpretation';
}

export function createOnlineDmAdapter({client,session}={}){
  if(!client||typeof client.exchange!=='function')throw new Error('Online DM client is required.');
  if(!session||typeof session!=='object')throw new Error('Online DM session state is required.');
  return Object.freeze({
    contract_id:ONLINE_DM_ADAPTER_CONTRACT,
    authority:'presentation_only',
    async respond({interaction,head,player_safe_state,conversation=[],presentation_events=[],committed_resolution=null}={}){
      const packet=buildDmContext({interaction,head,player_safe_state,conversation,presentation_events,committed_resolution});
      const handoff=buildOnlineHandoff(packet,head);
      const request=buildOnlineDmRequest({handoff,currentHead:head,request_phase:requestPhase(interaction,committed_resolution)});
      const result=await client.exchange({session,request,currentHead:head});
      if(!result.accepted)return Object.freeze({accepted:false,implementation:'local',reason:result.reason,error_class:result.error_class||null,packet:structuredClone(packet)});
      return Object.freeze({accepted:true,implementation:'online',reason:result.reason,packet:structuredClone(packet),output:structuredClone(result.dm_output)});
    },
  });
}
