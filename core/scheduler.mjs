import { deepClone, sha256 } from './util.mjs';

export function createSchedulerState() {
  return { absolute_minute:0, next_creation_order:0, pending:[] };
}

export function scheduleProcess(state, input) {
  const s = state.scheduler;
  if (!s) throw new Error('Missing scheduler state.');
  if (!Number.isFinite(input.due_absolute_minute) || input.due_absolute_minute < s.absolute_minute - 1e-9) throw new Error('Cannot schedule into resolved world time.');
  const process_id = input.process_id || `proc_${sha256({campaign:state.meta.campaign_id, order:s.next_creation_order, kind:input.kind, due:input.due_absolute_minute, owner:input.owner_id || null}).slice(0,20)}`;
  if (s.pending.some(x => x.process_id === process_id)) throw new Error('Duplicate scheduled process ID.');
  const process = {
    process_id,
    campaign_id:state.meta.campaign_id,
    branch_id:state.meta.branch_id,
    due_absolute_minute:input.due_absolute_minute,
    owner_id:input.owner_id || 'world',
    kind:input.kind,
    creation_order:s.next_creation_order++,
    priority:Number.isFinite(input.priority) ? input.priority : 50,
    payload:input.payload || {},
    voluntary:input.voluntary === true,
    fidelity:input.fidelity || 'local',
    protected_identity:input.protected_identity === true,
  };
  if (process.owner_id === 'pc_1' && process.voluntary) throw new Error('Scheduler cannot author a voluntary PC action.');
  s.pending.push(process);
  return process;
}

export function cancelProcess(state, processId) {
  const before = state.scheduler.pending.length;
  state.scheduler.pending = state.scheduler.pending.filter(x => x.process_id !== processId);
  return state.scheduler.pending.length !== before;
}

function order(a,b) {
  return a.due_absolute_minute - b.due_absolute_minute || a.priority - b.priority || a.creation_order - b.creation_order || a.process_id.localeCompare(b.process_id);
}

export function chooseFidelity(process) {
  if (process.protected_identity) return 'scene';
  const p = process.payload || {};
  if (p.player_relevance >= 3 || p.consequence >= 4 || p.uniqueness >= 4) return 'scene';
  if (p.player_relevance >= 2 || p.consequence >= 3) return 'local';
  if (p.consequence >= 2) return 'regional';
  return process.fidelity || 'strategic';
}

export function planAdvance(state, targetMinute, resolver, {eventCeiling=500} = {}) {
  if (!Number.isFinite(targetMinute) || targetMinute < state.scheduler.absolute_minute - 1e-9) throw new Error('Absolute world scheduler time cannot move backward.');
  const candidate = deepClone(state.scheduler);
  const resolved = [];
  let count = 0;
  while (true) {
    candidate.pending.sort(order);
    const next = candidate.pending[0];
    if (!next || next.due_absolute_minute > targetMinute) break;
    if (++count > eventCeiling) throw new Error('Scheduler event ceiling exceeded; candidate advance rejected.');
    candidate.pending.shift();
    if (next.branch_id !== state.meta.branch_id || next.campaign_id !== state.meta.campaign_id) throw new Error('Scheduled process identity mismatch.');
    if (next.owner_id === 'pc_1' && next.voluntary) throw new Error('Scheduler attempted voluntary PC action.');
    const fidelity = chooseFidelity(next);
    const result = resolver ? resolver(next, fidelity) : {events:[], followups:[]};
    resolved.push({process:next, fidelity, events:result?.events || []});
    for (const followup of result?.followups || []) {
      if (followup.due_absolute_minute < next.due_absolute_minute) throw new Error('Scheduler follow-up cannot travel backward in world time.');
      const proc = {
        process_id:followup.process_id || `proc_${sha256({campaign:state.meta.campaign_id, order:candidate.next_creation_order, kind:followup.kind, due:followup.due_absolute_minute, owner:followup.owner_id || 'world'}).slice(0,20)}`,
        campaign_id:state.meta.campaign_id,
        branch_id:state.meta.branch_id,
        due_absolute_minute:followup.due_absolute_minute,
        owner_id:followup.owner_id || 'world',
        kind:followup.kind,
        creation_order:candidate.next_creation_order++,
        priority:Number.isFinite(followup.priority) ? followup.priority : 50,
        payload:followup.payload || {},
        voluntary:followup.voluntary === true,
        fidelity:followup.fidelity || 'local',
        protected_identity:followup.protected_identity === true,
      };
      if (proc.owner_id === 'pc_1' && proc.voluntary) throw new Error('Scheduler follow-up attempted voluntary PC action.');
      candidate.pending.push(proc);
    }
  }
  candidate.absolute_minute = targetMinute;
  return {scheduler:candidate, resolved};
}

export function nextInterruptMinute(state, endMinute) {
  const p=(state.scheduler?.pending||[]).filter(x=>x.due_absolute_minute<=endMinute && x.payload?.interrupt_pc===true).sort(order)[0];
  return p ? p.due_absolute_minute : null;
}
