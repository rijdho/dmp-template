# Contributing

Issues and pull requests are welcome. Contributions are accepted under the licences of the
repository: MIT for code and CC BY 4.0 for the schema, the examples and the texts. Submitting a
contribution means it is offered under those same terms.

Before opening a pull request:

1. Run the tests: `node --test tests/*.test.mjs`. They need Node 20 or later and nothing else,
   and none of them touches the network.
2. If you changed `src/requirements.js` or `src/plan.js`, regenerate the schema files with
   `node scripts/build-schema.mjs` and say in the pull request how the method changed.
3. If you changed any file the page serves, bump `?v=N` in `index.html` and in every relative
   import, then run `node tests/assets-lock.mjs --write`.
4. Regenerate the single-file demo with `node scripts/build-demo.mjs`; the tests fail until you do.
5. Every string the interface shows lives in `src/i18n/en.js`; the tests say which one is
   missing. A new language is one more file there, held by the tests to the English key set.

A new check belongs in `src/evidence.js`, with a test in `tests/evidence.test.mjs` that states
its expected outcome exactly, a name under `chk.` and its messages under `det.`, and a line in
the README's caveats if it rests on an assumption about how repositories fill their records.
