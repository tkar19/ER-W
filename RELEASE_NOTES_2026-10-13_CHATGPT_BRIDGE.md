# Eternal Realms public web release — ChatGPT guest handoff (2026-10-13)

- Provenance: private Eternal Realms source commit f5b30e1401223023d46d0fc6330f71fd28337b97; verified private CI succeeded before promotion.
- Scope: app.js, index.html, service worker cache, new browser-only chatgpt-bridge.mjs. No game engine, resident model, campaign store, saved data, API credential, hosting, or public runtime configuration was modified.
- Player can copy a bounded player-safe handoff into the regular ChatGPT app/site, and paste a response back to the Chronicle.
- Returned text is HTML-escaped, non-canonical guest commentary only, bound to the handoff campaign and generation, and disappears on navigation/refresh or if stale. It cannot write or mutate authoritative state.
- This is **not** direct Sign in with ChatGPT or automatic subscription-backed inference. Secure native/local loopback authentication remains future work.
- Offline resident AI remains the default; optional separately billed provider gateway remains unconfigured and disabled by default.
- Static release verification, narrow-view browser playtest and gameplay audit must be green before this is treated as live.
