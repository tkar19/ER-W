# 13 October 2026 — Current grounded Local DM

This browser-safe release was assembled from private Eternal Realms main commit `1d8fc7a37196e8c1e3fc2d874b51ffe8648a86c2`.

- Changes the default resident DM from the historical compatibility narration bridge to `core/local_dm_current.mjs`, authored against the current game's closed player-safe presentation contract.
- Every selected mandatory player-visible event is expressed in sequence; exact event identifiers are carried into output, and the generated draft gate rejects unsupported additions, reversals or missing facts.
- Adds more accurate bounded answers for world time, carried inventory and player-visible surroundings, while refusing to invent unknown canon.
- Fixes player inventory routing (for example, “What am I carrying?”).
- Removes historical narrator files from the public web bundle and offline pre-cache; retains archival provenance **only in the private development repository**.
- Advances offline browser cache generation to v0.23.

**Not a final AI deployment:** This current narrator is an offline deterministic *safety fallback*, not a trained natural-language storyteller. The experimental conventional and CIM-integrated model weights remain private because they have not met the necessary comprehension, narrative integrity, multi-turn RPG and Android performance gates.

**Private validation before release:** 373/373 game tests passed on private branch head `b71123eb5b9ec78d959184253568df6356f91676`. This change does not modify the canonical engine, existing save schema, payment requirements or gameplay permissions.

Verification of the public build and browser Pages publication is tracked by the ER-W GitHub Actions workflows on this commit.
