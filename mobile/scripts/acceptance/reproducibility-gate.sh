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

phase8_strip_apk_signing_block() {
    local apk="$1"
    local output="$2"
    # The signing block sits immediately before the ZIP central directory.
    # Locate a valid EOCD (including a comment), resolve Zip64 when needed,
    # then require matching size fields and APK Sig Block magic. This fails
    # closed: stripped payload integrity is a release gate.
    perl -0777 -e '
        use strict;
        use warnings;
        my ($input, $output) = @ARGV;
        open my $in, "<:raw", $input or die "open input: $!";
        my $data = do { local $/; <$in> };
        my $length = length($data);
        die "APK is too short for EOCD" if $length < 22;
        my $minimum = $length > 65557 ? $length - 65557 : 0;
        my $eocd = -1;
        for (my $offset = $length - 22; $offset >= $minimum; $offset -= 1) {
            next unless substr($data, $offset, 4) eq pack("V", 0x06054b50);
            my $comment = unpack("v", substr($data, $offset + 20, 2));
            if ($offset + 22 + $comment == $length) { $eocd = $offset; last; }
        }
        die "missing valid EOCD" if $eocd < 0;
        my $central = unpack("V", substr($data, $eocd + 16, 4));
        if ($central == 0xffffffff) {
            my $locator = $eocd - 20;
            die "missing Zip64 locator" if $locator < 0 || substr($data, $locator, 4) ne pack("V", 0x07064b50);
            my $zip64 = unpack("Q<", substr($data, $locator + 8, 8));
            die "invalid Zip64 EOCD offset" if $zip64 + 56 > $length || substr($data, $zip64, 4) ne pack("V", 0x06064b50);
            $central = unpack("Q<", substr($data, $zip64 + 48, 8));
        }
        die "invalid central directory offset" if $central < 24 || $central > $length;
        die "missing APK Signing Block magic" if substr($data, $central - 16, 16) ne "APK Sig Block 42";
        my $trailing = unpack("Q<", substr($data, $central - 24, 8));
        die "invalid APK Signing Block size" if $trailing < 24 || $trailing + 8 > $central;
        my $start = $central - ($trailing + 8);
        my $leading = unpack("Q<", substr($data, $start, 8));
        die "APK Signing Block size mismatch" if $leading != $trailing;
        open my $out, ">:raw", $output or die "open output: $!";
        print {$out} substr($data, 0, $start), substr($data, $central);
    ' "$apk" "$output"
}

phase8_compare_apks() {
    local reference="$1"
    local candidate="$2"
    local apksigner="$3"
    local label="$4"
    local directory
    local raw_reference raw_candidate metadata_reference metadata_candidate content_reference content_candidate signer_reference signer_candidate payload_reference payload_candidate

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
    if ! phase8_strip_apk_signing_block "$reference" "$directory/reference-stripped.apk"; then
        printf 'Phase 8 reproducibility failed: %s has a malformed APK Signing Block.\n' "$label" >&2
        rm -rf "$directory"
        return 1
    fi
    if ! phase8_strip_apk_signing_block "$candidate" "$directory/candidate-stripped.apk"; then
        printf 'Phase 8 reproducibility failed: %s has a malformed APK Signing Block.\n' "$label" >&2
        rm -rf "$directory"
        return 1
    fi
    phase8_signer_manifest "$apksigner" "$reference" > "$directory/reference-signer.txt"
    phase8_signer_manifest "$apksigner" "$candidate" > "$directory/candidate-signer.txt"

    metadata_reference="$(phase8_sha256 "$directory/reference-metadata.txt")"
    metadata_candidate="$(phase8_sha256 "$directory/candidate-metadata.txt")"
    content_reference="$(phase8_sha256 "$directory/reference-content.txt")"
    content_candidate="$(phase8_sha256 "$directory/candidate-content.txt")"
    signer_reference="$(phase8_sha256 "$directory/reference-signer.txt")"
    signer_candidate="$(phase8_sha256 "$directory/candidate-signer.txt")"
    payload_reference="$(phase8_sha256 "$directory/reference-stripped.apk")"
    payload_candidate="$(phase8_sha256 "$directory/candidate-stripped.apk")"

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
    if ! cmp -s "$directory/reference-stripped.apk" "$directory/candidate-stripped.apk"; then
        printf 'Phase 8 reproducibility failed: %s raw payload excluding the complete APK Signing Block differs.\n' "$label" >&2
        rm -rf "$directory"
        return 1
    fi

    if [[ "$raw_reference" == "$raw_candidate" ]]; then
        printf 'Phase 8 reproducibility: %s raw_sha256=%s/%s stripped_payload_sha256=%s/%s canonical_zip_metadata_sha256=%s/%s zip_entry_content_sha256=%s/%s signer_identity_sha256=%s/%s classification=BYTE_IDENTICAL status=PASS\n' \
            "$label" "$raw_reference" "$raw_candidate" "$payload_reference" "$payload_candidate" "$metadata_reference" "$metadata_candidate" "$content_reference" "$content_candidate" "$signer_reference" "$signer_candidate"
    else
        printf 'Phase 8 reproducibility: %s raw_sha256=%s/%s stripped_payload_sha256=%s/%s canonical_zip_metadata_sha256=%s/%s zip_entry_content_sha256=%s/%s signer_identity_sha256=%s/%s classification=AGP_SDK_DEPENDENCY_METADATA_RANDOMIZED status=PASS\n' \
            "$label" "$raw_reference" "$raw_candidate" "$payload_reference" "$payload_candidate" "$metadata_reference" "$metadata_candidate" "$content_reference" "$content_candidate" "$signer_reference" "$signer_candidate"
    fi
    rm -rf "$directory"
}

phase8_reproducibility_self_test() {
    local directory fake_apksigner script_dir
    directory="$(mktemp -d "${TMPDIR:-/tmp}/listen2-phase8-repro-self-test.XXXXXX")"
    trap 'rm -rf "$directory"' RETURN
    mkdir -p "$directory/input"
    printf 'same payload\n' > "$directory/input/payload.txt"
    (cd "$directory/input" && zip -q -X "$directory/same-one.apk" payload.txt)
    # Create structurally valid, deliberately different signing blocks. The
    # fixture signer below models same-key verification without key material.
    perl -0777 -e '
        my ($input, $output) = @ARGV;
        open my $in, "<:raw", $input or die $!;
        my $data = do { local $/; <$in> };
        my $eocd = rindex($data, pack("V", 0x06054b50));
        die "missing EOCD" if $eocd < 0;
        my $central = unpack("V", substr($data, $eocd + 16, 4));
        my $value = $output =~ /signed-two/ ? "bbbb" : "aaaa";
        my $block = pack("Q<", 40) . pack("Q<", 8) . pack("V", 0xdeadbeef) . $value . pack("Q<", 40) . "APK Sig Block 42";
        substr($data, $central, 0) = $block;
        $eocd += length($block);
        substr($data, $eocd + 16, 4) = pack("V", $central + length($block));
        open my $out, ">:raw", $output or die $!;
        print {$out} $data;
    ' "$directory/same-one.apk" "$directory/signed-one.apk"
    perl -0777 -e '
        my ($input, $output) = @ARGV;
        open my $in, "<:raw", $input or die $!;
        my $data = do { local $/; <$in> };
        my $eocd = rindex($data, pack("V", 0x06054b50));
        die "missing EOCD" if $eocd < 0;
        my $central = unpack("V", substr($data, $eocd + 16, 4));
        my $block = pack("Q<", 40) . pack("Q<", 8) . pack("V", 0xdeadbeef) . "bbbb" . pack("Q<", 40) . "APK Sig Block 42";
        substr($data, $central, 0) = $block;
        $eocd += length($block);
        substr($data, $eocd + 16, 4) = pack("V", $central + length($block));
        open my $out, ">:raw", $output or die $!;
        print {$out} $data;
    ' "$directory/same-one.apk" "$directory/signed-two.apk"
    printf 'changed payload\n' > "$directory/input/payload.txt"
    (cd "$directory/input" && zip -q -X "$directory/content-change.apk" payload.txt)
    perl -0777 -e '
        my ($input, $output) = @ARGV;
        open my $in, "<:raw", $input or die $!;
        my $data = do { local $/; <$in> };
        my $eocd = rindex($data, pack("V", 0x06054b50));
        my $central = unpack("V", substr($data, $eocd + 16, 4));
        my $block = pack("Q<", 40) . pack("Q<", 8) . pack("V", 0xdeadbeef) . "aaaa" . pack("Q<", 40) . "APK Sig Block 42";
        substr($data, $central, 0) = $block;
        $eocd += length($block);
        substr($data, $eocd + 16, 4) = pack("V", $central + length($block));
        open my $out, ">:raw", $output or die $!;
        print {$out} $data;
    ' "$directory/content-change.apk" "$directory/signed-content-change.apk"
    cp "$directory/signed-one.apk" "$directory/signer-change.apk"
    cp "$directory/signed-one.apk" "$directory/local-header-change.apk"
    perl -0777 -i -pe 'substr($_, 4, 1) = chr(ord(substr($_, 4, 1)) + 1) if length($_) > 5' "$directory/local-header-change.apk"
    cp "$directory/signed-one.apk" "$directory/alignment-change.apk"
    perl -0777 -i -pe '
        my $eocd = rindex($_, pack("V", 0x06054b50));
        my $central = unpack("V", substr($_, $eocd + 16, 4));
        my $size = unpack("Q<", substr($_, $central - 24, 8));
        my $start = $central - ($size + 8);
        substr($_, $start, 0) = "\0\0\0\0";
        $eocd += 4;
        substr($_, $eocd + 16, 4) = pack("V", $central + 4);
    ' "$directory/alignment-change.apk"
    cp "$directory/signed-one.apk" "$directory/malformed-signing-block.apk"
    perl -0777 -i -pe 's/APK Sig Block 42/BAD Sig Block 42/' "$directory/malformed-signing-block.apk"
    script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
    fake_apksigner="$script_dir/reproducibility-gate-fixture-apksigner.sh"
    [[ -x "$fake_apksigner" ]] || { printf 'Phase 8 reproducibility self-test fixture is not executable.\n' >&2; return 1; }

    phase8_compare_apks "$directory/signed-one.apk" "$directory/signed-two.apk" "$fake_apksigner" 'self-test signing-only'
    if phase8_compare_apks "$directory/signed-one.apk" "$directory/signed-content-change.apk" "$fake_apksigner" 'self-test content-change'; then
        printf 'Phase 8 reproducibility self-test failed: content mutation passed.\n' >&2
        return 1
    fi
    if phase8_compare_apks "$directory/signed-one.apk" "$directory/signer-change.apk" "$fake_apksigner" 'self-test signer-change'; then
        printf 'Phase 8 reproducibility self-test failed: signer mutation passed.\n' >&2
        return 1
    fi
    if phase8_compare_apks "$directory/signed-one.apk" "$directory/local-header-change.apk" "$fake_apksigner" 'self-test local-header-change'; then
        printf 'Phase 8 reproducibility self-test failed: local-header mutation passed.\n' >&2
        return 1
    fi
    if phase8_compare_apks "$directory/signed-one.apk" "$directory/alignment-change.apk" "$fake_apksigner" 'self-test alignment-change'; then
        printf 'Phase 8 reproducibility self-test failed: alignment mutation passed.\n' >&2
        return 1
    fi
    if phase8_compare_apks "$directory/signed-one.apk" "$directory/malformed-signing-block.apk" "$fake_apksigner" 'self-test malformed-signing-block'; then
        printf 'Phase 8 reproducibility self-test failed: malformed signing block passed.\n' >&2
        return 1
    fi
    printf 'Phase 8 reproducibility self-test passed.\n'
}

if [[ "${BASH_SOURCE[0]}" == "$0" ]]; then
    [[ "${1:-}" == '--self-test' ]] || { printf 'usage: reproducibility-gate.sh --self-test\n' >&2; exit 2; }
    phase8_reproducibility_self_test
fi
