# Contributing

Thanks for helping. A few rules keep this tool trustworthy, because people plan real flights with it.

## Before you open a pull request

```
npm run lint && npm run typecheck && npm test && npx playwright test
```

All four must pass. CI runs the same.

## Rules

1. **Do not invent facts.** No made-up coordinates, airspace boundaries, zone polygons or Skydio file formats. If something is unknown, show it as unknown in the app (a warning, a disabled button with the reason) and list it in `docs/assumptions.md` with who can confirm it.
2. **Keep `src/core/` pure.** No DOM, no map library, no randomness, no clock. Same input, byte-identical output. If you add a setting, put its default in `src/core/defaults.ts`, add it to `PlanConfig`, and make sure old saved plans still open (`parsePlan` fills missing settings from the defaults).
3. **Metres, not degrees.** Do geometry in the local frame.
4. **Change a default or a rule?** Update `docs/assumptions.md` in the same pull request. If it changes behaviour relative to the Python reference, update the table in `docs/golden.md`.
5. **Write for pilots.** Messages in the UI say what went wrong and how to fix it, in plain words ("distance from pilot", not "VLOS radius"). No jargon, no codes.
6. **Test what you change.** A new check needs a test that makes it fail and a test that makes it pass. A new pattern needs a test of its shape and a golden or property test of its limits.
7. **Accessibility.** Everything works from the keyboard, focus is visible, colour is never the only signal, and both themes stay readable.
8. **No secrets.** The Google key lives only in the user's browser. Never put keys, tokens or personal data in the repo, a saved plan or a share link.

## Adding an export format

Implement `Exporter` (`src/exporters/types.ts`), register it in `src/exporters/index.ts`, and add tests that parse the output back.

## Updating the golden file

See `docs/golden.md`. Regenerate it only when the Python reference changes, and explain why in the pull request.

## Imagery

Only use tile services whose terms allow it, and keep the attribution on the map. Never use unofficial Google tile URLs: Google imagery goes through the official Map Tiles API with a key the user supplies.
