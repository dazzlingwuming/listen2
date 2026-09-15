#!/usr/bin/env bash
# Canonical APK content comparison. APK Signature Scheme blocks intentionally
# live outside the ZIP entries, so raw APK bytes are retained as diagnostics
# while content and signer identity remain the release gate.
set -euo pipefail

phase8_sha256() {
    shasum -a 256 "$1" | awk '{print $1}'
}

phase8_zip_metadata_manifest() {
    # Exclude only unzip's archive-name banner. The remaining table preserves
    # ZIP entry order, CRC, compression, sizes, and timestamps.
    unzip -lv "$1" | tail -n +2
}

phase8_zip_content_manifest() {
    local apk="$1"
    local entry
    # Keep ZIP order. A duplicate entry name is still protected by the
    # metadata/CRC manifest; unzip -p deterministically hashes its payload.
    while IFS= read -r entry; do
        printf '%s\t' "$entry"
        unzip -p "$apk" "$entry" | shasum -a 256 | awk '{print $1}'
    done < <(unzip -Z1 "$apk")
}

phase8_signer_manifest() {
    local apksigner="$1"
    local apk="$2"
    "$apksigner" verify --verbose --print-certs "$apk" >/dev/null
    "$apksigner" verify --verbose --print-certs "$apk" |
        awk '/^Verified using v[0-9.]+ scheme/ || /^Verified for SourceStamp/ || /^Number of signers:/ || /^V[0-9.]+ Signer: certificate SHA-256 digest:/ || /^V[0-9.]+ Signer: public key SHA-256 digest:/'
}

phase8_compare_apks() {
    local reference="$1"
    local candidate="$2"
    local apksigner="$3"
    local label="$4"
    local directory
    local raw_reference raw_candidate metadata_reference metadata_candidate content_reference content_candidate signer_reference signer_candidate

    [[ -f "$reference" && -f "$candidate" && -x "$apksigner" ]] || {
        printf 'Phase 8 reproducibility failed: missing APK or apksigner for %s.\n' "$label" >&2
        return 1
    }

    directory="$(mktemp -d "${TMPDIR:-/tmp}/listen2-phase8-repro.XXXXXX")"
    raw_reference="$(phase8_sha256 "$reference")"
    raw_candidate="$(phase8_sha256 "$candidate")"
    phase8_zip_metadata_manifest "$reference" > "$directory/reference-metadata.txt"
    phase8_zip_metadata_manifest "$candidate" > "$directory/candidate-metadata.txt"
    phase8_zip_content_manifest "$reference" > "$directory/reference-content.txt"
    phase8_zip_content_manifest "$candidate" > "$directory/candidate-content.txt"
    phase8_signer_manifest "$apksigner" "$reference" > "$directory/reference-signer.txt"
    phase8_signer_manifest "$apksigner" "$candidate" > "$directory/candidate-signer.txt"

    metadata_reference="$(phase8_sha256 "$directory/reference-metadata.txt")"
    metadata_candidate="$(phase8_sha256 "$directory/candidate-metadata.txt")"
    content_reference="$(phase8_sha256 "$directory/reference-content.txt")"
    content_candidate="$(phase8_sha256 "$directory/candidate-content.txt")"
    signer_reference="$(phase8_sha256 "$directory/reference-signer.txt")"
    signer_candidate="$(phase8_sha256 "$directory/candidate-signer.txt")"

    if ! cmp -s "$directory/reference-metadata.txt" "$directory/candidate-metadata.txt"; then
        printf 'Phase 8 reproducibility failed: %s canonical ZIP metadata differs.\n' "$label" >&2
        rm -rf "$directory"
        return 1
    fi
    if ! cmp -s "$directory/reference-content.txt" "$directory/candidate-content.txt"; then
        printf 'Phase 8 reproducibility failed: %s ZIP entry content differs.\n' "$label" >&2
        rm -rf "$directory"
        return 1
    fi
    if ! cmp -s "$directory/reference-signer.txt" "$directory/candidate-signer.txt"; then
        printf 'Phase 8 reproducibility failed: %s signing scheme or signer identity differs.\n' "$label" >&2
        rm -rf "$directory"
        return 1
    fi

    printf 'Phase 8 reproducibility: %s raw_sha256=%s/%s canonical_zip_metadata_sha256=%s/%s zip_entry_content_sha256=%s/%s signer_identity_sha256=%s/%s status=PASS\n' \
        "$label" "$raw_reference" "$raw_candidate" "$metadata_reference" "$metadata_candidate" "$content_reference" "$content_candidate" "$signer_reference" "$signer_candidate"
    rm -rf "$directory"
}

phase8_reproducibility_self_test() {
    local directory fake_apksigner script_dir
    directory="$(mktemp -d "${TMPDIR:-/tmp}/listen2-phase8-repro-self-test.XXXXXX")"
    trap 'rm -rf "$directory"' RETURN
    mkdir -p "$directory/input"
    printf 'same payload\n' > "$directory/input/payload.txt"
    (cd "$directory/input" && zip -q -X "$directory/same-one.apk" payload.txt)
    cp "$directory/same-one.apk" "$directory/same-two.apk"
    # APK Signature Scheme blocks sit before the ZIP central directory. Insert
    # a controlled fixture at that exact position and repair the EOCD central
    # directory offset. The fake signer below models a successful same-signer
    # verification without putting key material in this repository.
    perl -0777 -e '
        my ($input, $output) = @ARGV;
        open my $in, "<:raw", $input or die $!;
        my $data = do { local $/; <$in> };
        my $eocd = rindex($data, pack("V", 0x06054b50));
        die "missing EOCD" if $eocd < 0;
        my $central = unpack("V", substr($data, $eocd + 16, 4));
        my $block = "phase8-signature-block-fixture";
        substr($data, $central, 0) = $block;
        $eocd += length($block);
        substr($data, $eocd + 16, 4) = pack("V", $central + length($block));
        open my $out, ">:raw", $output or die $!;
        print {$out} $data;
    ' "$directory/same-one.apk" "$directory/same-two.apk"
    printf 'changed payload\n' > "$directory/input/payload.txt"
    (cd "$directory/input" && zip -q -X "$directory/content-change.apk" payload.txt)
    cp "$directory/same-one.apk" "$directory/signer-change.apk"
    script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
    fake_apksigner="$script_dir/reproducibility-gate-fixture-apksigner.sh"
    [[ -x "$fake_apksigner" ]] || { printf 'Phase 8 reproducibility self-test fixture is not executable.\n' >&2; return 1; }

    phase8_compare_apks "$directory/same-one.apk" "$directory/same-two.apk" "$fake_apksigner" 'self-test signing-only'
    if phase8_compare_apks "$directory/same-one.apk" "$directory/content-change.apk" "$fake_apksigner" 'self-test content-change'; then
        printf 'Phase 8 reproducibility self-test failed: content mutation passed.\n' >&2
        return 1
    fi
    if phase8_compare_apks "$directory/same-one.apk" "$directory/signer-change.apk" "$fake_apksigner" 'self-test signer-change'; then
        printf 'Phase 8 reproducibility self-test failed: signer mutation passed.\n' >&2
        return 1
    fi
    printf 'Phase 8 reproducibility self-test passed.\n'
}

if [[ "${BASH_SOURCE[0]}" == "$0" ]]; then
    [[ "${1:-}" == '--self-test' ]] || { printf 'usage: reproducibility-gate.sh --self-test\n' >&2; exit 2; }
    phase8_reproducibility_self_test
fi
