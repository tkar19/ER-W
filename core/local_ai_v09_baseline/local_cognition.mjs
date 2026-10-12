function clean(text){return String(text||'').trim().replace(/\s+/g,' ');}

export const LOCAL_COGNITIVE_PRINCIPLES=Object.freeze([
  'Committed state outranks narration, guesses, and player hypotheses.',
  'Observations, remembered information, interpretations, and hypotheses are not interchangeable.',
  'Uncertainty should remain uncertainty; missing details are not permission to invent them.',
  'A player correction changes the current interpretation, not already committed history.',
  'The player controls the player character; the simulation controls NPCs, world reactions, and outcomes.',
  'Context should resolve ordinary ellipsis only when the reference is uniquely grounded.',
  'Past reports, future intentions, and present committed actions are different kinds of input; only the present committed action authorizes simulation advancement.',
  'An explanation needs player-known evidence linking cause and effect; sequence, correlation, or plausibility alone is not proof of cause.',
  'Potential contradictions should be surfaced as conflicts to inspect, not silently reconciled or overwritten.',
]);

export function correctionRewrite(text){
  const source=clean(text);
  if(!source)return {is_correction:false,text:source,discarded:null};
  let m=source.match(/^\s*(?:no[,.!]?\s*)?(?:actually[,.]?\s*|sorry[,.]?\s*|rather[,.]?\s*|instead[,.]?\s*|i meant(?: to)?\s+|what i meant was\s+|i mean[,.]?\s*|correction[,:]?\s+)(.+)$/i);
  if(!m)return {is_correction:false,text:source,discarded:null};
  let rewritten=clean(m[1]);
  let discarded=null;
  const contrast=rewritten.match(/^(.+?)(?:,|;|—|\s+-\s+)\s*(?:not|instead of|rather than)\s+(.+)$/i);
  if(contrast){rewritten=clean(contrast[1]);discarded=clean(contrast[2]);}
  return {is_correction:true,text:rewritten||source,discarded};
}

export function previousAttemptFromContext(context={}){
  const explicit=clean(context?.previous_intent?.summary||context?.previous_action_text||'');
  if(explicit)return {text:explicit,source:'explicit_previous_intent'};
  const scene=clean(context?.state?.scene?.summary||context?.scene?.summary||'');
  const match=scene.match(/(?:^|·\s*)Attempt:\s*(.+?)(?:\s*·\s*Outcome:|$)/i);
  if(match?.[1])return {text:clean(match[1]),source:'visible_scene_attempt'};
  return null;
}

export function continuationCue(text){
  const source=clean(text).replace(/[.!?]+$/,'');
  if(/^(?:continue|keep going|carry on|resume|go on)(?:\s+(?:with\s+)?(?:that|it|what i was doing|the same thing))?$/i.test(source)) return 'continue';
  if(/^(?:again|do (?:that|it) again|same again|same thing again|repeat (?:that|it|the action)|one more time|try (?:that|it) again)$/i.test(source)) return 'repeat';
  return null;
}

export function activeContextAction(context={}){
  const state=context?.state||context||{};
  const candidates=[];
  if(state?.projects?.travel?.status==='active') candidates.push({action_type:'TRAVEL',target:state.projects.travel.target||null,source:'active_travel'});
  if((state?.projects?.crafts||[]).some(p=>p.status==='active')){
    const active=(state.projects.crafts||[]).find(p=>p.status==='active');
    candidates.push({action_type:'CRAFT',target:active?.output_name||active?.project_id||null,source:'active_craft'});
  }
  if(state?.combat) candidates.push({action_type:'COMBAT',target:null,source:'active_combat'});
  return candidates.length===1?candidates[0]:candidates.length?{ambiguous:true,candidates}:null;
}

export function temporalStatement(text){
  const source=clean(text); if(!source)return null;
  const lower=source.toLowerCase();
  if(/^i\s+(?:remember|recall|think|believe|suspect|assume|know)\b/i.test(source)) return null;
  // Explicit future time or intention. Immediate imperatives such as "go now" are deliberately excluded.
  if(/\b(?:tomorrow|later|afterward|afterwards|next\s+(?:hour|day|week|month|year)|eventually|someday|tonight)\b/.test(lower)
    && /\b(?:i\s+(?:will|'ll|am going to|plan to|intend to|want to)|we\s+(?:will|'ll|are going to|plan to|intend to))\b/.test(lower)){
    return {kind:'future_intent',temporal_scope:'future',source_text:source};
  }
  if(/^\s*(?:later|tomorrow|afterwards?|eventually)\s*,?\s*i\s+(?:will|'ll|am going to|plan to|intend to)\b/i.test(source)){
    return {kind:'future_intent',temporal_scope:'future',source_text:source};
  }
  // Past autobiographical/world reports. The guard is conservative: it requires a past marker or past-perfect framing.
  if(/\b(?:yesterday|earlier|before|last\s+(?:night|hour|day|week|month|year)|ago|previously|back then|this morning)\b/.test(lower)
    && /\b(?:i|we|he|she|they|the\s+\w+)\b/.test(lower)){
    return {kind:'past_report',temporal_scope:'past',source_text:source};
  }
  if(/^\s*i\s+(?:had|already)\s+\w+/i.test(source) || /^\s*(?:he|she|they|we)\s+had\s+\w+/i.test(source)){
    return {kind:'past_report',temporal_scope:'past',source_text:source};
  }
  return null;
}

export function causalQuestion(text){
  const source=clean(text); if(!source)return null;
  let m=source.match(/^\s*(?:why|how come)\s+(.+?)[?!.]*$/i);
  if(m)return {kind:'causal_question',subject:clean(m[1]).replace(/^(?:did|do|does|was|were|is|are|has|have)\s+/i,''),source_text:source};
  m=source.match(/^\s*(?:what|which)\s+(?:caused|made|led to|triggered)\s+(.+?)[?!.]*$/i);
  if(m)return {kind:'causal_question',subject:clean(m[1]),source_text:source};
  m=source.match(/^\s*(?:do|did)\s+we\s+know\s+(?:why|what caused)\s+(.+?)[?!.]*$/i);
  if(m)return {kind:'causal_question',subject:clean(m[1]),source_text:source};
  return null;
}

export function epistemicStatement(text){
  const source=clean(text); const lower=source.toLowerCase();
  const patterns=[
    {kind:'hypothesis',certainty:'tentative',re:/^(?:i think|i suspect|i guess|my guess is|maybe|perhaps|possibly|it seems|it looks like|i wonder if)\s+(.+)/i},
    {kind:'belief',certainty:'moderate',re:/^(?:i believe|i assume|i reckon|i figure|i expect)\s+(.+)/i},
    {kind:'memory_claim',certainty:'claimed_memory',re:/^(?:i remember|i recall)\s+(.+)/i},
    {kind:'assertion',certainty:'strong',re:/^(?:i know|i am sure|i'm sure|definitely|clearly|obviously)\s+(.+)/i},
  ];
  for(const p of patterns){const m=source.match(p.re);if(m)return {kind:p.kind,certainty:p.certainty,claim:clean(m[1]),source_text:source};}
  // Bare third-person/world assertions are treated as claims only when they are not obvious commands.
  const thirdPersonAssertion=/^(?:the|that|this|he|she|they|it)\s+.+\b(?:is|are|was|were|did|has|have|lied|stole|killed|knows|wants|plans|caused|means)\b/i.test(source);
  const namedAssertion=/^[A-Z][a-z]{2,}(?:\s+[A-Z][a-z]{2,})?\s+(?:is|are|was|were|did|has|have|lied|stole|killed|knows|wants|plans|caused|means)\b/.test(source);
  if((thirdPersonAssertion||namedAssertion) && !/^(?:the|that|this)\s+(?:door|gate|road|hall|room)\b.*\b(?:open|close|move|enter|leave)\b/i.test(source)){
    return {kind:'assertion',certainty:'unstated',claim:source,source_text:source};
  }
  if(/^i\s+(?:remember|recall|believe|suspect|think|assume|know)\b/i.test(lower)) return {kind:'belief',certainty:'unstated',claim:source,source_text:source};
  return null;
}

function terms(text){
  const stop=new Set(['the','a','an','and','or','but','to','of','in','on','at','for','with','is','are','was','were','it','that','this','i','he','she','they','him','her','them','my','your','his','their','be','been','being','do','did','does','have','has','had','will','would','could','should']);
  return (String(text||'').toLowerCase().match(/[a-z0-9']+/g)||[]).filter(x=>x.length>2&&!stop.has(x));
}

function polarity(text){
  const l=String(text||'').toLowerCase();
  const neg=/\b(?:not|never|no|didn't|did not|wasn't|was not|weren't|were not|isn't|is not|aren't|are not|hasn't|has not|haven't|have not|cannot|can't)\b/.test(l);
  const pairs=[['alive','dead'],['open','closed'],['present','absent'],['inside','outside'],['before','after'],['truthful','lying'],['truth','lie']];
  const states=[];
  for(const [a,b] of pairs){if(new RegExp(`\\b${a}\\b`).test(l))states.push(a);if(new RegExp(`\\b${b}\\b`).test(l))states.push(b);}
  return {neg,states};
}

export function potentialEvidenceConflict(claim,evidenceText){
  const claimTerms=new Set(terms(claim)); const evidenceTerms=new Set(terms(evidenceText));
  const overlap=[...claimTerms].filter(t=>evidenceTerms.has(t));
  const a=polarity(claim),b=polarity(evidenceText);
  const oppositeState=a.states.some(s=>b.states.some(t=>[['alive','dead'],['open','closed'],['present','absent'],['inside','outside'],['before','after'],['truthful','lying'],['truth','lie']].some(([x,y])=>(s===x&&t===y)||(s===y&&t===x))));
  const oppositeNegation=a.neg!==b.neg && overlap.length>=2;
  if(!(oppositeState&&overlap.length>=1)&&!oppositeNegation)return null;
  return {kind:'potential_conflict',overlap,reason:oppositeState?'opposed_state_terms':'opposed_polarity'};
}

export function relevantKnownEvidence(claim,publicState=null,contextPacket=null,{limit=4}={}){
  const claimTerms=new Set(terms(claim)); if(!claimTerms.size)return [];
  const candidates=[];
  for(const fact of publicState?.world?.known_facts||[]) candidates.push({kind:'known_fact',id:fact.fact_id||null,text:fact.summary||''});
  for(const ev of publicState?.scene?.evidence||[]) candidates.push({kind:'evidence',id:ev.evidence_id||ev.id||null,text:ev.description||ev.summary||''});
  for(const ev of contextPacket?.items||[]) candidates.push({kind:'known_event',id:ev.id||null,text:ev.summary||''});
  return candidates.map(c=>{
    const overlap=[...new Set(terms(c.text).filter(t=>claimTerms.has(t)))];
    return {...c,overlap,score:overlap.length,conflict:potentialEvidenceConflict(claim,c.text)};
  }).filter(x=>x.score>0).sort((a,b)=>b.score-a.score||String(a.id||'').localeCompare(String(b.id||''))).slice(0,limit);
}
