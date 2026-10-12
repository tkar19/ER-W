# Eternal Realms — Public Web Playtest

**Status:** early playable browser/PWA test release, not a finished RPG or trained generative local DM.

**Play URL (after GitHub Pages is enabled):** https://tkar19.github.io/ER-W/

This repository publishes only the **browser-safe release** of Eternal Realms from the private development repository. It is not a fork of the game design or its authoritative development history.

## What works

- Browser-local world simulation and character creation.
- IndexedDB campaign storage, turn history, export/import and recovery support.
- Rule-based local narration, without an API key, account or paid service.
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
- The Local DM is not a trained generative language model. It expresses committed state using bounded narration.
- ChatGPT handoff is manual; it does not continuously sync ChatGPT's answers into game authority.

## Release provenance

- Source: private `tkar19/Eternal-Realms`, main commit `127a83ff69e55f4253a648a4e115e63eab448113`.
- Browser-safe application assembled from `game/public/` and the allowlisted `game/src/` modules from that exact commit.
- This recreates the `build:web` transformation and includes the four latest source modules absent from the previously checked-in `game/www/` output.
- No Node server code, API secrets, training datasets, or private project planning documents are published.
- The authoritative project remains the private Eternal Realms repository. Updates to this public repository are separate releases.

© Project owner. No public software reuse license has been granted by this repository.
