# 13 October 2026 — Eternal Realms current-DM language corrections

This public browser update is built from the tested **current** private Eternal Realms game runtime. It improves several existing interactions, while preserving the authoritative world simulation and saved campaigns.

- Quoted dialogue with action words is treated as speech rather than accidentally triggering combat or spellcasting.
- A present action after an explicit refusal (e.g. “I do not attack; instead I speak”) is interpreted from the positive clause.
- A present action after a past report (“Yesterday I waited, but now I look around”) uses the new instruction.
- Game-help, current-state and world-event questions are distinguished more precisely.
- Offline service worker cache updated to v0.22 so the new browser-safe modules replace the prior cached code.

**Verification:** the private Eternal Realms final CI run passed 360/360 game tests and the 40-case game-language diagnostic improved from 29/40 to 34/40 exact. These tests are limited; player language and multi-action support are still incomplete.

**Not yet published:** the first newly trained experimental language model, its training data, offline training scripts, and the proposed CIM-DM algorithm. Initial development evaluation for the trained model was 23/66 and did not qualify for gameplay authority or public release. The browser still runs the existing safe DM presentation path.

Private source commit: `59e32b2af9de3572095063b505a1e541bf599740`.
Public release from the private browser-safe source: changed `game/src/` modules map to the corresponding `core/` files; `game/public/sw.js` maps to `sw.js`. No paid API, secret, training corpus, node server or new hosting is included.
