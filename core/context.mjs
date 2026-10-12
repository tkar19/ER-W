import { sha256 } from './util.mjs';
import { projectEventForViewpoint } from './visibility.mjs';

function words(text) { return String(text || '').trim().split(/\s+/).filter(Boolean); }
function eventWords(e) { return words(`${e.type || ''} ${e.summary || ''} ${JSON.stringify(e.data || {})}`); }
function containsFocus(e, terms) {
  if (!terms?.length) return false;
  const hay = `${e.type || ''} ${e.summary || ''} ${JSON.stringify(e.data || {})}`.toLowerCase();
  return terms.some(t => hay.includes(String(t).toLowerCase()));
}

export function normalizeEvent(event, fallback = {}) {
  return {
    id:event.id,
    type:event.type || 'event',
    summary:event.summary || '',
    data:event.data || {},
    player_data:event.player_data && typeof event.player_data === 'object' && !Array.isArray(event.player_data) ? structuredClone(event.player_data) : undefined,
    generation:event.generation ?? fallback.generation ?? null,
    sequence:event.sequence ?? fallback.sequence ?? 0,
    campaign_id:event.campaign_id || fallback.campaign_id || null,
    branch_id:event.branch_id || fallback.branch_id || null,
    known_by:Array.isArray(event.known_by) ? [...event.known_by] : ['internal'],
    entity_ids:Array.isArray(event.entity_ids) ? [...event.entity_ids] : [],
    location_id:event.location_id || null,
    thread_ids:Array.isArray(event.thread_ids) ? [...event.thread_ids] : [],
    causal_parent_ids:Array.isArray(event.causal_parent_ids) ? [...event.causal_parent_ids] : [],
    data_only:true,
  };
}

export function flattenCommittedEvents(generations) {
  const out=[];
  let seq=0;
  for (const record of generations || []) {
    for (const raw of record.events || []) {
      const e = normalizeEvent(raw, {generation:record.generation, campaign_id:record.campaign_id, branch_id:record.branch_id, sequence:seq++});
      out.push(e);
    }
  }
  return out;
}

export function buildContextPacket({state, events, mode='entity', viewpoint_id='pc_1', mandatory_event_ids=[], entity_ids=[], location_ids=[], thread_ids=[], focus_terms=[], max_items=24, max_words=1800, causal_depth=3, head_hash=null}) {
  if (!state?.meta?.campaign_id || !state?.meta?.branch_id) throw new Error('Context requires current committed state identity.');
  if (mode === 'entity' && !viewpoint_id) throw new Error('Entity-viewpoint context requires viewpoint identity.');
  const currentGen = state.meta.generation;
  const normalized = (events || []).map((e,i) => normalizeEvent(e,{generation:e.generation ?? currentGen, campaign_id:state.meta.campaign_id, branch_id:state.meta.branch_id, sequence:i}));
  const byId = new Map();
  for (const e of normalized) {
    if (!e.id) throw new Error('Context event missing stable ID.');
    if (byId.has(e.id)) throw new Error(`Duplicate context event ID: ${e.id}`);
    if (e.campaign_id !== state.meta.campaign_id || e.branch_id !== state.meta.branch_id) throw new Error('Cross-campaign/branch event rejected.');
    if (e.generation > currentGen) throw new Error('Future/stale-generation event rejected.');
    byId.set(e.id,e);
  }
  for (const e of normalized) for (const p of e.causal_parent_ids) if (!byId.has(p)) throw new Error(`Missing causal parent ${p}.`);

  const allowed = e => mode === 'internal' || e.known_by.includes(viewpoint_id) || e.known_by.includes('public');
  const blocked=[];
  const mandatory=[];
  const selectedIds=new Set();
  for (const id of mandatory_event_ids) {
    const e=byId.get(id);
    if (!e) throw new Error(`Missing mandatory event ${id}.`);
    if (!allowed(e)) { blocked.push({event_id:id, reason:'knowledge_boundary'}); continue; }
    mandatory.push(e); selectedIds.add(id);
  }

  const queue = mandatory.map(e => ({e,depth:0}));
  while (queue.length) {
    const {e,depth}=queue.shift();
    if (depth >= causal_depth) continue;
    for (const pid of e.causal_parent_ids) {
      const p=byId.get(pid);
      if (!p || selectedIds.has(pid)) continue;
      if (!allowed(p)) { blocked.push({event_id:pid, reason:'knowledge_boundary_causal'}); continue; }
      selectedIds.add(pid); queue.push({e:p,depth:depth+1});
    }
  }

  const mandatoryExpanded=[...selectedIds].map(id=>byId.get(id));
  const score = e => {
    let s=0;
    if (selectedIds.has(e.id)) s += 100000;
    if (e.thread_ids.some(id => thread_ids.includes(id))) s += 5000;
    if (e.entity_ids.some(id => entity_ids.includes(id))) s += 2500;
    if (e.location_id && location_ids.includes(e.location_id)) s += 1800;
    if (containsFocus(e, focus_terms)) s += 1200;
    s += Math.max(0, 200 - (currentGen - (e.generation ?? currentGen)) * 5);
    return s;
  };
  const viewEvent = e => {
    if (mode === 'internal') return e;
    const projected = projectEventForViewpoint(e, viewpoint_id);
    if (!projected) return null;
    // Context packets need knowledge metadata for auditability, but never raw authoritative data.
    return {...projected, known_by:[...(e.known_by||[])]};
  };
  const safeScore = e => { const v=viewEvent(e) || e; return score({...e,data:v.data}); };
  const candidates = normalized.filter(e => allowed(e) && !selectedIds.has(e.id)).sort((a,b)=>safeScore(b)-safeScore(a) || a.sequence-b.sequence || a.id.localeCompare(b.id));
  const ordered=[...mandatoryExpanded.sort((a,b)=>a.sequence-b.sequence), ...candidates];
  let usedWords=0; const items=[]; const omitted=[];
  for (const e of ordered) {
    const visible=viewEvent(e);
    if (!visible) continue;
    const scored={...e,data:visible.data};
    const count=eventWords(visible).length;
    const isMandatory=selectedIds.has(e.id);
    if (isMandatory && (items.length >= max_items || usedWords + count > max_words)) throw new Error('Context budget cannot contain mandatory permitted evidence.');
    if (items.length >= max_items || usedWords + count > max_words) { omitted.push(e.id); continue; }
    items.push({...visible, score:score(scored)}); usedWords += count;
  }
  const packetCore={
    authority:'derived_read_only', data_only:true, mode, viewpoint_id:mode==='entity'?viewpoint_id:null,
    branch_id:state.meta.branch_id, campaign_id:state.meta.campaign_id,
    generation:currentGen, head_hash:head_hash || null,
    anchors:{mandatory_event_ids,entity_ids,location_ids,thread_ids,focus_terms},
    items, blocked, omitted, budget:{max_items,max_words,used_items:items.length,used_words:usedWords},
  };
  return {...packetCore, packet_digest:sha256(packetCore)};
}

export function validatePacketCurrent(packet, state, headHash = null) {
  if (packet.branch_id !== state.meta.branch_id || packet.campaign_id !== state.meta.campaign_id || packet.generation !== state.meta.generation) throw new Error('Stale/mismatched context packet.');
  if (headHash && packet.head_hash && packet.head_hash !== headHash) throw new Error('Context packet is bound to a different committed head.');
  return true;
}

export function buildPlayerRecap(packet, maxLines=8) {
  if (packet.mode !== 'entity' || packet.viewpoint_id !== 'pc_1') throw new Error('Player recap requires PC viewpoint packet.');
  const lines=packet.items.slice(0,maxLines).map(e=>`- ${e.summary || e.type}`);
  return {authority:'presentation_only', source_packet_digest:packet.packet_digest, text:lines.join('\n') || '- No relevant known history.'};
}
