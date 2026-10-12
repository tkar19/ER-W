# Eternal Realms — Public Web Playtest

**Status:** early browser/PWA playtest — mobile storybook update, not a finished RPG or trained generative local DM.

**Play URL (after GitHub Pages is enabled):** https://tkar19.github.io/ER-W/

This repository publishes only the **browser-safe release** of Eternal Realms from the private development repository. It is not a fork of the game design or its authoritative development history.

## What works

- Browser-local world simulation and character creation with in-form errors, a readable review and saved drafts.
- IndexedDB campaign storage, turn history, export/import and recovery support.
- Rule-based local narration, without an API key, account or paid service.
- Landscape scene, manuscript chronicle, compact touch action choices and mobile navigation.
- Free-form player history retained even when exact mechanics cannot be inferred.
- An installable Progressive Web App (PWA) on supported Android browsers.
- Manual **ChatGPT handoff**, which copies a player-safe snapshot and opens ChatGPT.

**Automatic ChatGPT narration is not enabled.** The OpenAI API requires separate billing; no paid provider credentials or gateway are embedded or connected in this public build. This release defaults to browser-local authority and the Local DM.

## Enable free GitHub Pages (one-time setup)

Repository owner: open **Settings → Pages → Build and deployment**. Select **Deploy from a branch**, then select **main** and **/(root)**; save. Once GitHub reports successful deployment, open the play URL above.

On Android, open the URL in Chrome, test a new campaign and select **Add to Home screen** or **Install app** if supported. This is a PWA, **not yet a native APK**.

## Player notes

- The in-browser save is held in your device/browser's IndexedDB for this website, not on GitHub. Clearing site data, changing phones or switching browsers can remove local saves.
- Use **Export** to make a portable campaign backup before clearing browser data or updating large builds. Re-import via the in-game tools.
- Keep the site at the same URL; using another hostname/browser means a different save store.
- Real-device functionality and offline service-worker behavior still require Android playtesting. Do not treat this as a production-ready release.
- The Local DM is not yet a trained generative language model. It now uses the current game's player-safe event presentation contract and a deliberately restrictive grounding fallback. Research models remain private.
- ChatGPT handoff is manual; it does not continuously sync ChatGPT's answers into game authority.

## Release provenance

- Source: private `tkar19/Eternal-Realms`, main commit `1d8fc7a37196e8c1e3fc2d874b51ffe8648a86c2` (current grounded Local DM integration).
- Browser-safe application assembled from `game/public/` and the allowlisted `game/src/` modules from that exact commit.
- This public release is assembled from the current source module allowlist, not the sometimes-stale checked-in `game/www/` directory.
- No Node server code, API secrets, training datasets, or private project planning documents are published.
- The authoritative project remains the private Eternal Realms repository. Updates to this public repository are separate releases.

© Project owner. No public software reuse license has been granted by this repository.

## Mobile smoke test

The public workflow also runs a headless Chromium test at a narrow Android-sized viewport: free-form character creation, Review, commit, first action, save and reload. The workflow is a browser approximation, not a physical-device guarantee. See [GitHub Actions](https://github.com/tkar19/ER-W/actions).

## Full gameplay audit

The private source now contains `game/test/full_gameplay_audit.test.mjs` (16 domain-level checks), and this public repository contains an Android-size multi-action Playwright audit. This release fixes first-person LOOK commands and punctuation/case matching for *existing* travel destinations. Audit traces are retained in GitHub Actions artifacts; device testing remains distinct from CI emulation.

### Conversation ledger hotfix

The full-playthrough audit exposed a real IndexedDB ordering defect after consecutive questions. This release sorts stored conversations by canonical sequence and uses absolute sequence numbers when the recent-context window exceeds 50 entries. This is a storage repair; it does not alter canonical world events.

The 2026-10-12 gameplay audit also repaired player-visible projection of scheduled local situation changes and short local travel, which previously failed post-commit because the event types were not in the presentation allowlist.
