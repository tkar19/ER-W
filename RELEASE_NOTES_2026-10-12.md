# October 12, 2026 — Character creation and interface redesign

This browser release retains the deterministic world/simulation and local narration architecture from Eternal Realms rather than substituting an AI chat front end.

Changes:
- A storybook presentation with illustrated landscape, location-driven scene header, parchment-style chronicle and horizontally scrolling actions.
- A mobile-first character creation view, readable final review, errors in the dialog and persistent drafts.
- Free-form personal history is retained. Unrecognised or underspecified training doesn't block review or grant unearned skills.
- Invalid timelines, invented world events, and contradictory structured mechanics remain blocked.
- A new service-worker cache generation, and a CI browser smoke test using a mobile-size Chromium viewport.

Limits: local narration is rule-based rather than a generative trained DM; scenery is decorative and is not canonical geography; automatic ChatGPT narration is not enabled. Manual ChatGPT handoff is available. Android phone testing is still necessary.

Private source commit: `9eec5d6a51b2f691fb400ca26ca9f6c1609efc55`.
