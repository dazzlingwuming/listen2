#!/usr/bin/env bash
set -euo pipefail

# Test-only signer fixture for reproducibility-gate.sh --self-test. It emits
# the subset of apksigner output that the production gate normalizes.
apk="${!#}"
cert='cert-a'
key='key-a'
if [[ "$apk" == *signer-change.apk ]]; then
    cert='cert-b'
    key='key-b'
fi
printf 'Verified using v1 scheme (JAR signing): false\n'
printf 'Verified using v2 scheme (APK Signature Scheme v2): true\n'
printf 'Verified using v3 scheme (APK Signature Scheme v3): false\n'
printf 'Verified for SourceStamp: false\n'
printf 'Number of signers: 1\n'
printf 'V2 Signer: certificate SHA-256 digest: %s\n' "$cert"
printf 'V2 Signer: public key SHA-256 digest: %s\n' "$key"
