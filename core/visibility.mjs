function cloneJson(value) {
  if (value === undefined) return undefined;
  return structuredClone(value);
}

export function eventKnownTo(event, viewpointId = 'pc_1') {
  if (!event || !Array.isArray(event.known_by)) return false;
  return event.known_by.includes(viewpointId) || event.known_by.includes('public');
}

export function projectEventForViewpoint(event, viewpointId = 'pc_1') {
  if (!eventKnownTo(event, viewpointId)) return null;
  const projected = {
    id: event.id,
    type: event.type,
    summary: String(event.summary || ''),
    generation: event.generation ?? null,
    sequence: event.sequence ?? 0,
    campaign_id: event.campaign_id ?? null,
    branch_id: event.branch_id ?? null,
    entity_ids: Array.isArray(event.entity_ids) ? [...event.entity_ids] : [],
    location_id: event.location_id ?? null,
    thread_ids: Array.isArray(event.thread_ids) ? [...event.thread_ids] : [],
    causal_parent_ids: Array.isArray(event.causal_parent_ids) ? [...event.causal_parent_ids] : [],
    world_absolute_minute: Number.isFinite(Number(event.world_absolute_minute)) ? Number(event.world_absolute_minute) : null,
    world_time_label: event.world_time_label ?? null,
    campaign_elapsed_minute: Number.isFinite(Number(event.campaign_elapsed_minute)) ? Number(event.campaign_elapsed_minute) : null,
    // Fail closed: authoritative event data is internal unless the emitter explicitly
    // supplies a player-safe projection. Never serialize raw event.data to player/API/LLM views.
    data: event.player_data && typeof event.player_data === 'object' && !Array.isArray(event.player_data)
      ? cloneJson(event.player_data)
      : {},
  };
  return projected;
}

export function projectEventsForViewpoint(events = [], viewpointId = 'pc_1') {
  return (events || []).map(e => projectEventForViewpoint(e, viewpointId)).filter(Boolean);
}
