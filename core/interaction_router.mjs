import { CONTRACTS, requireContract, keys, string, list, head } from './contracts.mjs';
import { sha256 } from './util.mjs';
import { localIntent } from './intent.mjs';

export const MODES=Object.freeze(['world_action','world_query','persistent_state_query','planning_query','belief_statement','past_report','future_intent','conditional_instruction','clarification_needed','correction','continue_reference','repeat_reference','non_action_statement','meta_query']);
const REFERENCE=/^(again|repeat(?: that| it)?|continue|do that|same again|ask (?:her|him|them) again)[.!\s]*$/i;
const PRESENT=/^(?:i\s+)?(?:look|observe|survey|scan|investigate|inspect|search|examine|study|talk|speak|ask|tell|persuade|convince|deceive|lie|intimidate|negotiate|bargain|travel|walk|ride|go|head|move|journey|leave|cast|enchant|conjure|summon|wait|rest|sleep|camp|attack|fight|strike|shoot|stab|parry|duel|surrender|retreat|withdraw|disengage|flee|sneak|hide|pickpocket|shadow|craft|make|forge|brew|repair|build)\b/i;
const OTHER_PRESENT=/^(?:(?:i|please)\s+)?(?:(?:first|then|now|carefully|quietly|quickly|slowly)\s+)*(?:open|close|take|pick|draw|ready|use|drink|eat|write|help|offer|give|hand|put|lift|push|pull|climb|jump|sit|stand|kneel|smell|taste|listen|touch|read|unlock|lock|light|extinguish)\b/i;
// Preserve the baseline interpreter's anywhere-in-text action recognition for
// first-person/imperative present utterances. It still cannot authorize a turn.
function presentActionWording(text){
  if(PRESENT.test(text)||OTHER_PRESENT.test(text))return true;
  if(localIntent(text).action_type==='OTHER')return false;
  if(/^(?:i\s+(?:remember|recall|wonder|imagine|heard|saw|thought|said|wish|hope|want|need|might|could|would|should)\b)/i.test(text))return false;
  return /^(?:i\b|please\b|(?:first|then|now|carefully|quietly|quickly|slowly)\b)/i.test(text);
}
// A past report followed by an explicit present instruction contains two
// clauses. Only the latter may be interpreted as the proposed action.
export function actionTextForInteraction(text){
  const contrast=text.match(/^(.*?)(?:;\s*|\bbut\s+)instead\s*[,;:]?\s*(.+)$/i);
  if(contrast&&explicitNonAction(contrast[1].trim())&&presentActionWording(contrast[2].trim()))return contrast[2].trim();
  const marker=/\b(?:but|and)\s+now\s*[,;:]?\s+/gi;
  let match,last=null;
  while((match=marker.exec(text)))last=match;
  if(!last)return text;
  const prefix=text.slice(0,last.index).trim();
  if(!/^(?:yesterday\b|earlier\b|last night\b|i\s+(?:did|was|had|already)\b|i\s+\w+ed\b)/i.test(prefix))return text;
  return text.slice(last.index+last[0].length).trim();
}
function explicitNonAction(text){
  return /^(?:(?:i|please)\s+)?(?:am\s+not|amn't|ain't|do\s+not|don't|does\s+not|doesn't|did\s+not|didn't|will\s+not|won't|would\s+not|wouldn't|can\s+not|can't|cannot|never|refuse\s+to|decide\s+not\s+to|am\s+not\s+going\s+to)\b/i.test(text)
    || /^(?:i'm\s+not|i've\s+not|i'll\s+not)\b/i.test(text);
}
export function validateInteraction(envelope){
  requireContract(envelope,'interaction');
  keys(envelope,['contract_id','interaction_id','campaign_id','branch_id','generation','head_hash','player_text','interaction_mode','confidence','ambiguity_flags','correction','context_reference','proposed_intent','commit_authorised','ledger_links','provenance'],'interaction');
  head(envelope);string(envelope.interaction_id,'interaction ID');string(envelope.player_text,'player text');
  if(!MODES.includes(envelope.interaction_mode))throw new Error('Unsupported interaction mode.');
  if(typeof envelope.confidence!=='number'||envelope.confidence<0||envelope.confidence>1)throw new Error('Invalid confidence.');
  list(envelope.ambiguity_flags,'ambiguity flags');list(envelope.ledger_links,'ledger links');
  if(typeof envelope.commit_authorised!=='boolean'||(envelope.commit_authorised&&(envelope.interaction_mode!=='world_action'||!envelope.proposed_intent?.is_pc_voluntary||envelope.ambiguity_flags.length)))throw new Error('Unsafe commit authorization.');
  if(envelope.interaction_mode!=='world_action'&&envelope.proposed_intent!==null)throw new Error('Non-action may not carry proposed intent.');
  if(envelope.correction!==null&&envelope.interaction_mode!=='correction')throw new Error('Correction mode mismatch.');
  if(envelope.context_reference!==null&&typeof envelope.context_reference!=='string')throw new Error('Invalid reference.');
  if(envelope.provenance?.source!=='player_text'&&envelope.provenance?.source!=='player_text_and_ledger')throw new Error('Invalid interaction provenance.');
  return true;
}

// Conservative deterministic gate. Advisory interpretation may fill intent only after routing.
export function routeInteraction(playerText,binding,{recent_entries=[]}={}){
  const text=String(playerText||'').trim();string(text,'player text');head(binding);
  const actionText=actionTextForInteraction(text);
  let mode='clarification_needed';let reference=null;
  if(/^(?:correction:|actually\b|no,? i meant\b|i meant\b|that is wrong\b)/i.test(actionText))mode='correction';
  else if(/^(?:if\b|when\b|unless\b)/i.test(actionText))mode='conditional_instruction';
  else if(explicitNonAction(actionText))mode='non_action_statement';
  else if(/^(?:tomorrow\b|later\b|next time\b|i (?:will|plan to|intend to|am going to|am about to)\b|i'm (?:going to|about to)\b)/i.test(actionText))mode='future_intent';
  else if(/^(?:i (?:did|was|had|already)\b|yesterday\b|earlier\b)/i.test(actionText)||/\b(?:yesterday|earlier|last night)\b/i.test(actionText)||/^i\s+\w+ed\b/i.test(actionText))mode='past_report';
  else if(/^(?:i (?:think|believe|suspect|guess)\b|maybe\b)/i.test(actionText))mode='belief_statement';
  else if(/^(?:what if\b|suppose\b|should i\b|could i\b|would (?:it|that|i)\b|can i\b|i might\b|i could\b|(?:i am|i'm) (?:thinking|considering|planning)\b)/i.test(actionText))mode='planning_query';
  else if(/^(?:what (?:is|are|do i have)|what time is it|how (?:much|many)|where (?:am i|is my)|do i (?:have|know|remember))\b/i.test(actionText))mode='persistent_state_query';
  else if(/^(?:help|settings|about|how do i play)\b/i.test(actionText))mode='meta_query';
  else if(/^(?:what|who|where|why|how|is|are|can|does|do|did)\b/i.test(actionText)||/^(?:please (?:tell me|explain|describe|clarify)|i ask what)\b/i.test(actionText)||actionText.endsWith('?'))mode='world_query';
  else if(REFERENCE.test(actionText)){
    const last=[...recent_entries].reverse().find(e=>e.status==='committed_action'&&e.interpreted_action?.is_pc_voluntary);
    reference=last?.entry_id||null;mode=/^again|^repeat|^same|^ask /i.test(text)?'repeat_reference':'continue_reference';
  } else if(presentActionWording(actionText))mode='world_action';
  else if(/^(?:hello|hi|thanks|thank you|okay|yes|no)[.!\s]*$/i.test(actionText))mode='non_action_statement';
  const ambiguous=mode==='clarification_needed'||mode==='continue_reference'||mode==='repeat_reference';
  const result={contract_id:CONTRACTS.interaction,interaction_id:`ix_${sha256(`${binding.campaign_id}|${binding.head_hash}|${text}|${((recent_entries.at(-1)?.sequence??-1)+1)}`).slice(0,24)}`,...binding,player_text:text,interaction_mode:mode,confidence:ambiguous?0:1,ambiguity_flags:ambiguous?['requires_grounding']:[],correction:mode==='correction'?text:null,context_reference:reference,proposed_intent:null,commit_authorised:false,ledger_links:reference?[reference]:[],provenance:{source:reference?'player_text_and_ledger':'player_text'}};
  validateInteraction(result);return result;
}
export function authorizeIntent(envelope,intent){
  validateInteraction(envelope);
  if(envelope.interaction_mode!=='world_action'||envelope.ambiguity_flags.length||!intent?.is_pc_voluntary)throw new Error('Intent cannot authorize this interaction.');
  const result={...envelope,proposed_intent:structuredClone(intent),commit_authorised:true};validateInteraction(result);return result;
}
export function engineIntent(envelope){validateInteraction(envelope);if(!envelope.commit_authorised)throw new Error('Interaction cannot enter simulation.');return structuredClone(envelope.proposed_intent);}
