// No-key, manual guest bridge. Never authenticates, calls an API, or writes canon.
export const CHATGPT_GUEST_REPLY_LIMIT=8000;
export const CHATGPT_HANDOFF_LIMIT=256*1024;

export function buildChatGptHandoff(handoff,{campaignId,generation}={}){
  if(typeof campaignId!=='string'||!campaignId||!Number.isSafeInteger(generation)||generation<0)
    throw new Error('A valid committed campaign is required for ChatGPT handoff.');
  if(typeof handoff!=='string'||!handoff.trim()||new TextEncoder().encode(handoff).length>CHATGPT_HANDOFF_LIMIT)
    throw new Error('ChatGPT handoff is missing or too large.');
  return [
    '# Eternal Realms — ChatGPT guest invitation',
    '',
    'This is a player-approved transfer from a separate offline-first game, NOT a live API session.',
    'You are an optional guest at the D&D-style table. The resident Eternal Realms AI remains playable without you.',
    'Discuss the scene, roleplay a companion, ask questions, or propose a next action. Do not say your suggestions have happened in the game.',
    'The committed game state is authoritative. NPC private knowledge, player intentions and outcomes must not be invented.',
    'No external response can update the save; any proposed actions must be explicitly chosen and resolved in Eternal Realms.',
    'A return reply can be pasted into the game as a clearly labeled NON-CANONICAL guest comment.',
    'Campaign: '+campaignId,
    'Generation: '+generation,
    '',
    '## Player-safe context',
    handoff.trim(),
  ].join('\n');
}

export function validateChatGptGuestReply(text,{transfer,campaignId,generation}={}){
  if(!transfer||transfer.campaignId!==campaignId||transfer.generation!==generation)
    throw new Error('The campaign changed since the handoff. Copy a new handoff before bringing back a reply.');
  if(!Number.isSafeInteger(generation)||generation<0||typeof campaignId!=='string'||!campaignId)
    throw new Error('No active committed campaign.');
  if(typeof text!=='string'||!text.trim()||text.length>CHATGPT_GUEST_REPLY_LIMIT)
    throw new Error('ChatGPT reply must contain 1–8000 characters.');
  return Object.freeze({
    campaign_id:campaignId,generation,text:text.trim(),
    source:'ChatGPT — manually pasted',authority:'guest_comment_only',
  });
}

export function activeChatGptGuestReply(reply,{campaignId,generation}={}){
  return reply?.authority==='guest_comment_only'&&reply.campaign_id===campaignId&&reply.generation===generation?reply:null;
}
