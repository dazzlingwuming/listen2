# Phase 08 candidate replacement — 2026-10-11

Status: candidate mechanism implemented; device/product acceptance and final reproduction remain pending.

The approved Android completion work permits a new candidate after source fixes. Historical runs retain their original APKs, HEAD, outcomes and once windows. They are never edited to describe a replacement APK. New runtime runners deliberately reject historical runs missing `08-build.sha256`.

From reviewed, committed, clean source, build and seal the releaseLike app and AndroidTest pair:

```sh
bash mobile/scripts/acceptance/build-candidate.sh
```

When the coordinator has already built those exact outputs from the current clean HEAD, avoid a duplicate build by attesting that HEAD explicitly:

```sh
bash mobile/scripts/acceptance/build-candidate.sh --seal-existing --build-head "$(git rev-parse HEAD)"
```

This checks the release-like APK gates and actual app/test certificate digests, copies both outputs into the current-HEAD run, writes immutable `08-build.json`, then seals that record's bytes. Existing candidate artifacts or records cause rejection. The attestation is the coordinator's statement of build provenance; it is not an independent reconstruction proof. The single-build record remains `NOT_VERIFIED` for REL-001. The final double-build gate remains required. The current `build-release-like.sh` still rejects a run that already contains artifacts; continuation must add an immutable same-candidate reproduction record or explicitly plan a separately validated final candidate. Do not overwrite the single-build record or silently change the tested candidate.

Resolve that run and exercise one live window on an explicitly bound API 35 device:

```sh
RUN_DIR="$(node mobile/scripts/acceptance/evidence.mjs --resolve-current-run --head "$(git rev-parse HEAD)")"
bash mobile/scripts/acceptance/run-live-provider-smoke.sh --run-dir "$RUN_DIR" --serial "$SERIAL" --all-providers
```

The default live window covers NetEase/Bilibili, `--bilibili-only` covers Bilibili and `--all-providers` covers the five-source search matrix. They share one live-provider once window per run, so select the required lane before starting. Explicit `--product-apk`/`--test-apk` inputs, when used, must match the sealed pair. Runners never rebuild an AndroidTest payload. Source restrictions are retained in `live-provider-source-outcomes.json`; missing source observations remain `NOT_VERIFIED`. Instrumentation success cannot promote an upstream restriction to PASS.

The integrated journey requires a separately prepared bundled debug seed artifact in the final full build record, as well as `--journey-test-apk "$RUN_DIR/artifacts/releaseLikeAndroidTest.apk" --journey-test-build-head "$(git rev-parse HEAD)"`. The lightweight app/test pair alone does not satisfy the debug seed prerequisite.

Performance commands require `--serial "$SERIAL" --test-apk "$RUN_DIR/artifacts/releaseLikeAndroidTest.apk" --build-evidence "$RUN_DIR/08-build.json"`. Compatibility runs use one explicit API 26 or API 36 serial per invocation plus `--compatibility-only --api 26 --api 36`; unsupported `--resume-api35` has been removed from the plan command. The existing performance implementation still does not provide honest real first-search/audio samples or playback soak proof. Do not use these command repairs as evidence that performance or parity is complete.

Local checks for this mechanism are `node mobile/scripts/acceptance/candidate.test.mjs`, the runners' `--self-test`, `node mobile/scripts/acceptance/evidence.mjs --self-test-containment` and `bash -n` on the changed shell scripts. Synthetic signer fixtures exercise evidence binding, not Android cryptographic verification; real signer/APK/device checks remain the coordinator's build/runtime gates.

Recovery: retain a consumed run and its once marker after any failure; diagnose/fix source and create a new committed HEAD/run. Restore device state using the retained device-state snapshot where a runtime was interrupted. No old run rewrite, reset or sample replacement is permitted.
