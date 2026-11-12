# Zingo Android and iOS apps

Zingo Mobile is a shielded Zcash light-client wallet for Android and iOS, built with React Native and powered by the [Zingolib](https://github.com/zingolabs/zingolib) Rust SDK.

App Store: [https://apps.apple.com/app/zingo/id1668209531](https://apps.apple.com/app/zingo/id1668209531)

Google Play: [https://play.google.com/store/apps/details?id=org.ZingoLabs.Zingo](https://play.google.com/store/apps/details?id=org.ZingoLabs.Zingo)

## LeekWallet hardware signer (this fork)

The `leekwallet-qr` branch of this fork adds the LeekWallet board as a signer
for Zingo on Android. LeekWallet is a DIY Zcash hardware signer on an ESP32-S3
([zcash.leekwallet.xyz](https://zcash.leekwallet.xyz),
[0xOucan/leekwallet-zcash](https://github.com/0xOucan/leekwallet-zcash)). The
board holds the seed, shows the transaction and returns the spend-auth
signatures. Zingo builds the PCZT, proves it and broadcasts the transaction.

The branch is offered to the Zingo team for review. It is a fork, and Zingo
Labs has not released it.

### Whose code

The external-signer wallet and the PCZT steps are Zingo Labs' work: Dorian's
draft [zingolib PR #3147](https://github.com/zingolabs/zingolib/pull/3147)
(head `abf25aff`), used unmodified. It provides `init_from_ufvk_with_derivation`,
`pczt_from_stored_proposal`, `pczt_prove`, `pczt_finish_and_store`,
`pczt_abandon` and `transmit_calculated`. The rest of zingo-mobile is Zingo
Labs' code under MIT.

Our part is the commits on top of zingo-mobile `d8a6040f5`, with backend and
UI in separate commits:

| Commit | Side | Change |
|---|---|---|
| `3858fdacd` | build | a local zingolib Binding Layer and the LeekWallet SDK |
| `ac0dd3594` | backend | `LeekQrModule.kt`, `LeekSigner.kt`: QR signing and the signer derivation |
| `6675f28c7` | UI | import and sign over QR |
| `109446cfe` | backend | `LeekUsbLink.kt`, `LeekBleLink.kt`, `LeekLinkModule.kt`: USB and Bluetooth |
| `8019574a9` | UI | import and sign over USB and Bluetooth |
| `df5701432` | backend | the mixnet wait before broadcast, the address check on the board |
| `943b6785d` | UI | the mixnet wait, Verify on LeekWallet, QR brightness |
| `397a5f67c` | UI | the QR screens lose the "Experimental" caption |

`LeekUsbLink.kt` and `LeekBleLink.kt` were adapted from our Zodl fork (MIT).
Each file names its origin at the top.

### The LeekWallet SDK

The app calls the SDK's `leek-zcash-ffi` (Apache-2.0) through its Kotlin
bindings, package `io.leekwallet.zcash.sdk`:

- `FrameTransport` over USB (the board's ESP32-S3 USB Serial/JTAG) and over
  Bluetooth LE (the board's GATT service). `LeekDevice.pair` shows a six-digit
  code on the phone and on the board at every connection. The app stores no
  pairing.
- `signPczt(…, SignerView.COMPACT, verifyAccount = true)` runs the preflight,
  uploads the signer view, waits for the review on the board and verifies
  every returned signature before Zingo proves.
- `QrEncoder` and `QrScanner` carry the animated `ur:leek-pczt` and
  `ur:leek-zsig` codes. `applyZsig` verifies the board's signatures.
- `showAddress` makes the board page a Zingo receive address and confirm that
  it belongs to the account.

The View key import uses `QrScanner` on the board's account record, or
`getAccount` over USB and Bluetooth after the board asks "Share view key?".
zingolib's FFI has no getter for the stored derivation. `LeekSigner.kt` keeps
the seed fingerprint, account index, UFVK and network in an `EncryptedFile`
(`wallet.leek.json`), deleted with the wallet.

### Tested

The owner tested the branch on testnet, on a phone with the board, on
2026-11-11 and 2026-11-12. USB, Bluetooth and QR signing all worked.

- Import of the View key over USB, Bluetooth and QR.
- Signing over USB, Bluetooth and QR.
- Verify on LeekWallet, with the board showing the address.
- The wait for the mixnet before the broadcast.
- The QR brightness button (system, 60 %, 80 %, 100 %).

Checks on `397a5f67c`, re-run on 2026-11-12: `yarn typecheck`,
`yarn lint:check` (0 errors, 14 warnings from upstream), `yarn prettier:check`
and `jest` (287 suites, 2112 tests, 67 snapshots passed). The Kotlin modules have no JVM tests.

### Build (Android)

The build needs NDK 28.2.13676358, CMake 3.22.1, `ccache` on `PATH`, Node
24.22.0 and `yarn install --frozen-lockfile`. Clone
[0xOucan/zingolib `leekwallet-signer`](https://github.com/0xOucan/zingolib/tree/leekwallet-signer)
next to this checkout and a clone of `leekwallet-zcash` two levels above it
(zingo-cli has path dependencies on `../../../leekwallet-zcash`).

Build zingolib's Binding Layer in zingolib's CI image, then its AAR:

```sh
cd ../zingolib
docker run --rm -v "$PWD":/zingolib \
  -v <leekwallet-zcash>:/leekwallet-zcash:ro \
  -v zingolib-cargo-registry:/root/.cargo/registry -w /zingolib \
  ghcr.io/zingolabs/android_builder:019 sh -c 'git config --global --add safe.directory /zingolib &&
    cargo run --manifest-path tools/workbench/Cargo.toml --bin build-binding-layer -- \
      android --in-image --abi arm64-v8a --out bindings/android/build/binding-layer'
../zingo-mobile/android/gradlew -p bindings/android \
  -PbindingLayerPrebuilt=$PWD/bindings/android/build/binding-layer \
  -PbindingLayerVersion=8.0.0-leek-f1add3152 publish
```

Build the SDK library and its Kotlin bindings, then the APK:

```sh
LEEK_SDK_HOST=<leekwallet-zcash>/host scripts/leek_sdk_android.sh
cd android && ./gradlew assembleProdDebug -PreactNativeArchitectures=arm64-v8a \
  -PbundleDebugJs=true \
  -PbindingLayerLocalRepository=<zingolib>/bindings/android/build/repository \
  -PbindingLayerLocalVersion=8.0.0-leek-f1add3152
```

`leek_sdk_android.sh` builds `libleek_zcash_ffi.so` for arm64-v8a and refuses
if the regenerated bindings differ from the SDK's committed ones. The APK keeps
the package name `org.ZingoLabs.Zingo` and the debug keystore. Uninstall the
store Zingo first.

### Known limits

- Android only. The entry is hidden on iOS, which has no Swift bridge.
- Untested on mainnet.
- The signer view is always COMPACT, with no setting.
- A broadcast that fails after `pczt_finish_and_store` leaves the transaction
  Calculated ("Prepared") with its inputs spent until it expires. Zingo's
  rebroadcast logic was not checked for Calculated transactions.
- A Cancel pressed while the PCZT is still being built can leave a session
  behind until the next send or an app restart.
- Zingo's send retry on another server proposes again and asks the board
  again.
- Shield and Swap are hidden for the board wallet.
- LeekSign, LeekImport and LeekVerify use existing tokens and components, and
  nobody has reviewed them against `DESIGN.md`.
- The SDK comes in as a build directory. Upstream would want an AAR.

### AI use

Per zingolib's `AI_POLICY.md`: the commits on this branch, the Kotlin and
TypeScript code and this section were written with Claude Code (Claude Opus
5.5), with 0xOucan directing the work. 0xOucan ran the board tests and answers
for the code.

# Security Vulnerability Disclosure

If you believe you have discovered a security issue, please contact us at:

zingodisclosure@proton.me

## Building The App

 Please see the platform specific [iOS](./docs/ios_developer_quickstart.md) and [Android](./docs/android_developer_quickstart.md) "quickstart" documentation.

## Releasing

Zingo ships as two parallel apps from this repo:

- **Production** (`org.ZingoLabs.Zingo`) — App Store + Play Production.
- **Beta** (`org.ZingoLabs.Zingo.Beta`) — TestFlight External + Play Open Testing.

Both share the same JS bundle and Rust libs; only the native shell differs
(bundle ID, display name, icon with `BETA` band). Version/build bumps are
scoped per channel via:

```bash
yarn release:prod:prep <version> <build>
yarn release:beta:prep <version> <build>
```

Create the tag **before** building the app: the About screen shows the
zingo-mobile descriptor that the app build computes, so an app built before the
tag ships naming its commit instead of the tag.
See [Release order](./docs/release_quickstart.md#release-order-tag-first-then-build).

Pushing a `zingo-<version>-<build>` or `zingo-beta-<version>-<build>` tag
triggers a CI workflow that builds the 4 ABI APKs and a universal APK on the
tagged commit, against the Binding Layer AAR that the Bundle Pin names, and
publishes them to a fresh GitHub Release.

Full step-by-step for both stores, signing setup, and the underlying iOS/Android
flavor architecture: see [docs/release_quickstart.md](./docs/release_quickstart.md).

## Architecture decision records

Architecture decision records live in
[zingo-adrs](https://github.com/zingolabs/zingo-adrs), and zingo-mobile's own
records sit under `docs/adr/zingo-mobile/` once the submodule is initialised.
The [zingo-adrs README](https://github.com/zingolabs/zingo-adrs#pointing-a-code-repository-at-zingo-adrs) explains how to read them, advance the
pointer, and propose a record.

## The Binding Layer

The Rust wallet and the mixnet proxy, with their Kotlin and Swift bindings,
live in [zingolabs/zingolib](https://github.com/zingolabs/zingolib), which
publishes them as Prebuilt Bundles. This repository pins one published
zingolib commit in `binding-layer.json`, the Bundle Pin (ADR
zingo-mobile/0020). The Android and iOS builds fetch the pinned bundles
through the `fetch:binding-layer` script. A build host needs Node and
network access to `ghcr.io` the first time. `yarn pin <commit>` moves the
pin to another published commit. The tests that read zingolib's source
run in zingolib.

## Testing
### Yarn Tests
1. From the root directory, run: <br />
   `yarn test`

### Memory Benchmark
Peak heap per wallet-file path, on a connected Android device or emulator.

- `yarn bench:memory`: measure and compare against `scripts/wallet_memory_baseline.json`, non-zero exit on a regression
- `yarn bench:memory --report`: measure only
- `yarn bench:memory:accept`: record a new baseline

### Device Tests
The device tests exercise the Binding Layer through Kotlin and Swift on an
emulator or a simulator. An annotation on each Android test class names its
kind (`CONTEXT.md` defines the terms).

- An offline device test (`@OfflineDeviceTest`) opens a wallet with an empty
  server URI and reads no chain.
- A public-chain test (`@PublicChainTest`) reads mainnet or testnet through a
  public server. A test that needs funds reads a testnet fixture wallet
  (`docs/testnet_fixture_wallets.md`).

The `android-ubuntu-integration-test-ci` workflow runs both kinds on every
pull request, and `ios-integration-test` runs the XCTest classes of
`ios/ZingoTests`.

To run the Android tests, boot an emulator and run these commands from the
`android` directory. Replace `x86_64` with the ABI of the emulator.

```sh
./gradlew :app:connectedProdDebugAndroidTest \
  -PreactNativeArchitectures=x86_64 \
  -Pandroid.testInstrumentationRunnerArguments.annotation=org.ZingoLabs.Zingo.OfflineDeviceTest

./gradlew :app:connectedProdDebugAndroidTest \
  -PreactNativeArchitectures=x86_64 \
  -Pandroid.testInstrumentationRunnerArguments.annotation=org.ZingoLabs.Zingo.PublicChainTest \
  -Pandroid.testInstrumentationRunnerArguments.timeout_msec=420000
```

To run the iOS tests, open `ios/Zingo.xcworkspace` in Xcode and run the
`ZingoTests` target on a simulator.

### End-to-End Tests (Maestro UI flows)
[Maestro](https://maestro.mobile.dev/) drives the released app from the
outside, asserting on the rendered UI. Flows live in `.maestro/` as YAML
(`01_new_wallet.yaml`, etc.). Runs nightly in CI via
`.github/workflows/maestro-nightly.yaml` against both Android and iOS;
this is the e2e suite that PR reviewers and releases lean on going
forward.

To run locally:

1. Install the Maestro CLI: <br />
   `curl -Ls "https://get.maestro.mobile.dev" | bash` (puts the binary in `~/.maestro/bin`)

2. Boot an emulator/simulator and install the app you want to test against
   (debug or release). Maestro talks to whatever device is currently
   selected by `adb` / `xcrun simctl`.

3. From the repo root: <br />
   `maestro test --exclude-tags=screen-awake .maestro/`
   Or run a single flow: <br />
   `maestro test .maestro/01_new_wallet.yaml`

The flows restore or create their wallets on mainnet, and need network
access. The `screen-awake` flow runs alone in CI, after a step that
shortens the device's screen-off timeout. New e2e coverage lands as
Maestro flows.

# Storybook & visual review
Browse components in isolation with Storybook (on-device via
`yarn storybook:ios`/`storybook:android`, web via `yarn storybook:web`).

The web build powers per-PR visual regression: `yarn visual` captures and
diffs components and animations against a baseline. See
[visual/README.md](./visual/README.md) for the harness, and
[.github/CLOUDFLARE.md](./.github/CLOUDFLARE.md) for the Cloudflare Pages deploy
that publishes the review site.

# Troubleshooting
For notes on known issues and problems, see the [trouble-shooting notes](./TROUBLESHOOTING.md).
