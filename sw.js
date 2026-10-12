const CACHE='ergpt-external-shell-v0.20';
const CORE_MODULES=['core_constants.mjs','hash.mjs','util.mjs','world_foundation.mjs','rng.mjs','calendar.mjs','intent.mjs','events.mjs','visibility.mjs','action_resolution.mjs','health.mjs','scheduler.mjs','cognition.mjs','social.mjs','combat.mjs','magic.mjs','perception.mjs','scene_builder.mjs','exploration.mjs','routines.mjs','genesis.mjs','world_genesis.mjs','starting_region.mjs','starting_region_systems.mjs','starting_situation.mjs','geographic_knowledge.mjs','player_map.mjs','state_migration.mjs','state_validator.mjs','engine.mjs','event_validation.mjs','identity.mjs','context.mjs','contracts.mjs','interaction_router.mjs','presentation_events.mjs','dm_voice.mjs','simulation_attention.mjs','dm_contract.mjs','online_dm_contract.mjs','online_dm_session.mjs','online_dm_client.mjs','online_dm_adapter.mjs','conversation_ledger.mjs','runtime_adapter.mjs','local_dm_adapter.mjs','local_ai_v09_baseline/local_cognition.mjs','local_ai_v09_baseline/local_reasoner.mjs','local_ai_v09_baseline/local_narrator.mjs','local_ai_v09_bridge.mjs','incremental_persistence.mjs','browser_persistence.mjs','local_store.mjs','browser_runtime.mjs'];
const SHELL=['./','./styles.css','./runtime-config.js','./app.js','./manifest.webmanifest','./icons/icon.svg','./icons/icon-192.png','./icons/icon-512.png',...CORE_MODULES.map(name=>`./core/${name}`)];
self.addEventListener('install',event=>event.waitUntil(caches.open(CACHE).then(c=>c.addAll(SHELL)).then(()=>self.skipWaiting())));
self.addEventListener('activate',event=>event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim())));
self.addEventListener('fetch',event=>{
  if(event.request.method!=='GET') return; // authoritative POST commits are never cached/replayed.
  const url=new URL(event.request.url);
  if(url.origin!==self.location.origin || url.pathname.includes('/api/')) return;
  event.respondWith(fetch(event.request).then(response=>{const copy=response.clone();caches.open(CACHE).then(c=>c.put(event.request,copy));return response;}).catch(()=>caches.match(event.request).then(x=>x||caches.match('./'))));
});
