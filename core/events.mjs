import { sha256 } from './util.mjs';
import { formatWorldTime } from './calendar.mjs';
import { currentLocationId } from './world_foundation.mjs';

export function createEventEmitter(state, playerInput='') {
  let sequence = 0;
  const generation = state.meta.generation + 1;
  const inputHash = sha256(String(playerInput || '')).slice(0,16);
  return function emit(events, type, summary, data = {}, meta = {}) {
    const eventWorldMinute=Number(meta.world_absolute_minute ?? state.world.absolute_minute);
    const core = {
      type,
      summary:String(summary || ''),
      data,
      generation,
      sequence,
      campaign_id:state.meta.campaign_id,
      branch_id:state.meta.branch_id,
      known_by:Array.isArray(meta.known_by) ? [...new Set(meta.known_by)] : ['internal'],
      entity_ids:Array.isArray(meta.entity_ids) ? [...new Set(meta.entity_ids)] : [],
      location_id:meta.location_id ?? currentLocationId(state),
      thread_ids:Array.isArray(meta.thread_ids) ? [...new Set(meta.thread_ids)] : [],
      causal_parent_ids:Array.isArray(meta.causal_parent_ids) ? [...new Set(meta.causal_parent_ids)] : [],
      player_input_hash:inputHash,
      world_absolute_minute:eventWorldMinute,
      world_time_label:formatWorldTime(eventWorldMinute,state.world.calendar).label,
      campaign_elapsed_minute:Math.max(0,eventWorldMinute-Number(state.campaign_clock?.start_absolute_minute ?? eventWorldMinute)),
      // Authoritative event data stays internal. Player-facing consumers only receive
      // this explicitly declared projection; omission is intentionally deny-by-default.
      player_data: meta.player_data && typeof meta.player_data === 'object' && !Array.isArray(meta.player_data)
        ? structuredClone(meta.player_data)
        : undefined,
    };
    const event = { id:`evt_${sha256(core).slice(0,24)}`, ...core };
    sequence += 1;
    events.push(event);
    return event;
  };
}
