#!/usr/bin/env bash
# Builds the LeekWallet SDK's libleek_zcash_ffi.so (arm64-v8a) and copies
# its Kotlin bindings into android/app/build/leek-sdk, which the app's
# Gradle build reads.
#
# LEEK_SDK_HOST names the SDK's host/ directory (github.com/0xOucan/leekwallet-zcash).
# The SDK checkout is read only: cargo builds into android/app/build/leek-sdk/target.
# ABIS (default "arm64-v8a"), ANDROID_API (default 26, the app's minSdk) and
# ANDROID_NDK_HOME (default the app's NDK) change the build.
set -euo pipefail
root="$(cd "$(dirname "$0")/.." && pwd)"
host="${LEEK_SDK_HOST:?set LEEK_SDK_HOST to the LeekWallet SDK host/ directory}"
host="$(cd "$host" && pwd)"
crate="$host/leek-zcash-ffi"
out="$root/android/app/build/leek-sdk"
target="$out/target"
ndk="${ANDROID_NDK_HOME:-${ANDROID_HOME:-$HOME/Android/Sdk}/ndk/28.2.13676358}"
bin="$ndk/toolchains/llvm/prebuilt/linux-x86_64/bin"
api="${ANDROID_API:-26}"
abis="${ABIS:-arm64-v8a}"
[[ -x "$bin/clang" ]] || { echo "no NDK clang in $bin" >&2; exit 1; }

triple() {
    case "$1" in
        arm64-v8a) echo aarch64-linux-android ;;
        x86_64)    echo x86_64-linux-android ;;
        *) echo "unsupported ABI $1" >&2; exit 1 ;;
    esac
}

export CARGO_TARGET_DIR="$target"
remap="--remap-path-prefix=$host=/leek/host"
remap+=" --remap-path-prefix=${CARGO_HOME:-$HOME/.cargo}=/cargo"
for abi in $abis; do
    t="$(triple "$abi")"
    T="$(echo "$t" | tr 'a-z-' 'A-Z_')"
    u="$(echo "$t" | tr '-' '_')"
    export "CARGO_TARGET_${T}_LINKER=$bin/$t$api-clang"
    export "CARGO_TARGET_${T}_RUSTFLAGS=$remap -C link-arg=-Wl,-z,max-page-size=16384"
    export "CC_$u=$bin/$t$api-clang"
    export "CXX_$u=$bin/$t$api-clang++"
    export "AR_$u=$bin/llvm-ar"
    export "RANLIB_$u=$bin/llvm-ranlib"
    cargo build --release --locked --manifest-path "$host/Cargo.toml" -p leek-zcash-ffi --lib --target "$t"
done

first="$(triple "$(set -- $abis; echo "$1")")"
gen="$out/generated"
rm -rf "$gen" "$out/jniLibs" "$out/kotlin"
(cd "$host" && cargo run -q --locked -p leek-zcash-ffi --features bindgen --bin uniffi-bindgen -- \
    generate --library "$target/$first/release/libleek_zcash_ffi.so" --language kotlin \
    --config "$crate/uniffi.toml" --out-dir "$gen" --no-format)
diff -r "$gen" "$crate/bindings/kotlin" >/dev/null \
    || { echo "the SDK's committed Kotlin bindings differ from its library" >&2; exit 1; }

for abi in $abis; do
    mkdir -p "$out/jniLibs/$abi"
    "$bin/llvm-strip" --strip-all -o "$out/jniLibs/$abi/libleek_zcash_ffi.so" \
        "$target/$(triple "$abi")/release/libleek_zcash_ffi.so"
done
cp -r "$crate/bindings/kotlin" "$out/kotlin"
cp "$crate/android/consumer-rules.pro" "$out/consumer-rules.pro"
git -C "$host" rev-parse HEAD > "$out/sdk-commit.txt"
echo "LeekWallet SDK $(cat "$out/sdk-commit.txt") in $out"
