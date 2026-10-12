export const DM_VOICE_POLICY=Object.freeze({
  id:'ER_DM_VOICE_V1',
  perspective:'grounded_second_person',
  authority:'presentation_only',
  rules:Object.freeze([
    'State mandatory player-perceivable consequences explicitly.',
    'Prioritize significant selected events and keep routine bookkeeping concise.',
    'Use only the supplied player-safe context and never invent or alter canon.',
    'Ask for clarification instead of guessing when the bounded context is insufficient.',
  ]),
});

export const NARRATION_DENSITIES=Object.freeze(['adaptive','concise','balanced','expansive']);

export function normalizeNarrationDensity(value='adaptive'){
  if(!NARRATION_DENSITIES.includes(value))throw new TypeError('Unsupported narration density.');
  return value;
}

export function dmVoiceInstruction(){
  return `Follow ${DM_VOICE_POLICY.id}: ${DM_VOICE_POLICY.rules.join(' ')} Return only one JSON object conforming to the supplied ER DM output contract. Narration is presentation-only and may not change canon.`;
}

function normalizedText(value){return String(value||'').trim().replace(/\s+/g,' ').replace(/[.!?]+$/,'').toLowerCase();}
function sentence(value){const text=String(value||'').trim();return !text||/[.!?]$/.test(text)?text:`${text}.`;}

// The Local renderer is deterministic, so its shared voice policy can be
// enforced rather than merely prompted. Mandatory summaries are already
// player-safe Presentation Events; append any the baseline renderer did not
// explicitly communicate. Optional references are reported only when their
// supplied summary is actually present in the rendered text.
export function applyLocalVoicePolicy(text,presentationEvents=[]){
  let rendered=String(text||'').trim();
  for(const event of presentationEvents){
    if(!event?.mandatory)continue;
    const summary=normalizedText(event.summary);
    if(summary&&!normalizedText(rendered).includes(summary))rendered=[rendered,sentence(event.summary)].filter(Boolean).join(' ');
  }
  return rendered;
}

export function referencedVoiceEventIds(text,presentationEvents=[]){
  const rendered=normalizedText(text);
  return presentationEvents.filter(event=>{
    const summary=normalizedText(event?.summary);
    return event?.mandatory||Boolean(summary&&rendered.includes(summary));
  }).map(event=>event.presentation_event_id);
}
