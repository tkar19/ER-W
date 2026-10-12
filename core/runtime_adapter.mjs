import { CONTRACTS, requireContract, keys } from './contracts.mjs';

// Interface only: the Node server is the current adapter; local authority belongs to M4.
export function validateRuntimeAdapter(adapter){
  requireContract(adapter,'runtime_adapter');
  keys(adapter,['contract_id','authority','load_current','commit_action','read_conversation','append_conversation','project_player_view'],'runtime adapter');
  if(!['node','browser_local'].includes(adapter.authority))throw new Error('Invalid runtime authority.');
  for(const field of ['load_current','commit_action','read_conversation','append_conversation','project_player_view'])if(typeof adapter[field]!=='function')throw new Error(`Missing runtime adapter method: ${field}`);
  return true;
}
export const RUNTIME_ADAPTER_CONTRACT_ID=CONTRACTS.runtime_adapter;
