#!/bin/bash
# Run with bash from Terminal. Do not run as root.
set -euo pipefail
export PATH=/usr/bin:/bin:/usr/sbin:/sbin
export LC_ALL=C
umask 022
expected_manifest_sha='@MANIFEST_SHA256@'
fail() { printf 'Listen1: %s\n' "$*" >&2; exit 1; }
[ "$(/usr/bin/uname -s)" = Darwin ] || fail 'This helper requires macOS.'
[ "$EUID" -ne 0 ] || fail 'Run this helper as your normal user, without sudo.'
[ "$#" -eq 0 ] || { [ "$#" -eq 1 ] && [ "$1" = --verify-only ]; } || fail 'Only --verify-only is supported.'
[ ! -L "${BASH_SOURCE[0]}" ] || fail 'The helper must not be a symbolic link.'
base=$(cd -P -- "$(/usr/bin/dirname -- "${BASH_SOURCE[0]}")" && pwd)
source_app="$base/Listen1.app"
manifest="$base/Listen1.integrity.tsv"
[ -f "$manifest" ] && [ ! -L "$manifest" ] || fail 'Missing real integrity manifest.'
[ "$(/usr/bin/shasum -a 256 "$manifest" | /usr/bin/awk '{print $1}')" = "$expected_manifest_sha" ] || fail 'Integrity manifest has changed.'
IFS=$'\t' read -r schema bundle_id version architectures < "$manifest"
[ "$schema" = LISTEN1-INTEGRITY-1 ] && [ "$bundle_id" = com.listen1.listen1 ] || fail 'Unknown manifest identity.'
case "$version" in ''|*[!0-9A-Za-z.+-]*) fail 'Invalid manifest version.' ;; esac
case "$architectures" in arm64|x86_64|'arm64 x86_64') ;; *) fail 'Invalid manifest architecture.' ;; esac

verify_bundle() {
  local app="$1" kind mode value relative entry actual count=0 expected_count
  [ -d "$app" ] && [ ! -L "$app" ] || fail 'Listen1.app must be a real directory.'
  [ ! -L "$app/Contents" ] && [ ! -L "$app/Contents/Info.plist" ] && [ ! -L "$app/Contents/MacOS" ] && [ ! -L "$app/Contents/MacOS/Listen1" ] || fail 'Bundle identity paths must not be symbolic links.'
  [ "$(/usr/libexec/PlistBuddy -c 'Print :CFBundleIdentifier' "$app/Contents/Info.plist")" = "$bundle_id" ] || fail 'Wrong application identifier.'
  [ "$(/usr/libexec/PlistBuddy -c 'Print :CFBundleShortVersionString' "$app/Contents/Info.plist")" = "$version" ] || fail 'Wrong application version.'
  [ "$(/usr/libexec/PlistBuddy -c 'Print :CFBundleExecutable' "$app/Contents/Info.plist")" = Listen1 ] || fail 'Wrong executable.'
  actual=$(/usr/bin/lipo -archs "$app/Contents/MacOS/Listen1" | /usr/bin/tr ' ' '\n' | /usr/bin/sort | /usr/bin/xargs)
  [ "$actual" = "$architectures" ] || fail 'Wrong application architecture.'
  while IFS=$'\t' read -r kind mode value relative; do
    case "$relative" in ''|/*|../*|*/../*|*/..|..|./*|*/./*|*/.) fail 'Unsafe manifest path.' ;; esac
    case "$relative$value" in *[$'\001'-$'\010'$'\013'-$'\037'$'\177']*) fail 'Control character in manifest.' ;; esac
    case "$mode" in ''|*[!0-7]*) fail 'Invalid permission mode.' ;; esac
    [ "${#mode}" -le 3 ] || fail 'Special permission modes are not allowed.'
    entry="$app/$relative"
    [ -e "$entry" ] || [ -L "$entry" ] || fail "Missing bundle entry: $relative"
    actual=$(/usr/bin/stat -f '%Lp' "$entry")
    [ "$actual" = "$mode" ] || fail "Permission mismatch: $relative"
    case "$kind" in
      F) [ -f "$entry" ] && [ ! -L "$entry" ] || fail "Wrong file type: $relative"
         [ "$(/usr/bin/shasum -a 256 "$entry" | /usr/bin/awk '{print $1}')" = "$value" ] || fail "File hash mismatch: $relative" ;;
      D) [ -d "$entry" ] && [ ! -L "$entry" ] && [ "$value" = - ] || fail "Wrong directory type: $relative" ;;
      L) [ -L "$entry" ] && [ -e "$entry" ] || fail "Broken or absent link: $relative"
         [ "$(/usr/bin/readlink "$entry")" = "$value" ] || fail "Link mismatch: $relative"
         case "$value" in ''|/*) fail 'Absolute or empty symlink target.' ;; esac
         # All links have exact manifest targets, and each relative target must
         # stay in the app lexically; together these also bound chained links.
         actual="$(/usr/bin/dirname "$relative")/$value"
         /usr/bin/awk -v p="$actual" 'BEGIN {n=split(p,a,"/"); d=0; for(i=1;i<=n;i++){if(a[i]=="..") {if(--d<0)exit 1} else if(a[i]!=""&&a[i]!=".")d++}}' || fail 'Symlink escapes app.' ;;
      *) fail 'Unknown manifest entry type.' ;;
    esac
    count=$((count + 1))
  done < <(/usr/bin/tail -n +2 "$manifest")
  # Reject added entries as well as changed/missing entries. NUL counting handles
  # unexpected newline-containing names without splitting them into fake paths.
  expected_count=$(/usr/bin/find "$app" -print0 | /usr/bin/tr -cd '\000' | /usr/bin/wc -c | /usr/bin/tr -d ' ')
  [ "$count" -eq "$expected_count" ] || fail 'Unexpected bundle entries.'
}

verify_bundle "$source_app"
printf 'Listen1 %s (%s): integrity verified.\n' "$version" "$architectures"
if [ "${1:-}" = --verify-only ]; then exit 0; fi

home=$(cd -P -- "$HOME" && pwd)
user_apps="$home/Applications"
system_apps=/Applications
system_app="$system_apps/Listen1.app"
user_app="$user_apps/Listen1.app"
[ ! -L "$system_apps" ] && [ ! -L "$user_apps" ] || fail 'An Applications folder is a symbolic link.'
if { [ -e "$system_app" ] || [ -L "$system_app" ]; } && { [ -e "$user_app" ] || [ -L "$user_app" ]; }; then fail 'Listen1 exists in both Applications folders. Resolve the duplicate first.'; fi
if [ -e "$system_app" ] || [ -L "$system_app" ]; then
  [ -w "$system_apps" ] || fail 'The existing /Applications app needs administrator management; no password will be requested.'
  parent="$system_apps"
elif [ -e "$user_app" ] || [ -L "$user_app" ]; then
  parent="$user_apps"
elif [ -w "$system_apps" ]; then parent="$system_apps"
else
  [ -d "$user_apps" ] || /bin/mkdir -m 755 "$user_apps"
  parent="$user_apps"
fi
destination="$parent/Listen1.app"
[ -w "$parent" ] && [ ! -L "$destination" ] || fail 'Destination is protected or a symbolic link.'
[ "$source_app" != "$destination" ] || fail 'Run the helper from the mounted download disk.'
if [ -e "$destination" ]; then
  [ -d "$destination" ] && [ ! -L "$destination/Contents" ] && [ ! -L "$destination/Contents/Info.plist" ] || fail 'Existing destination is not a normal app.'
  [ "$(/usr/libexec/PlistBuddy -c 'Print :CFBundleIdentifier' "$destination/Contents/Info.plist")" = com.listen1.listen1 ] || fail 'Existing destination is a different application.'
fi
not_running() {
  local process
  while IFS= read -r process; do
    case "$process" in Listen1|*/Listen1.app/Contents/*) fail 'Quit Listen1 before installing. No process was stopped.' ;; esac
  done < <(/bin/ps -axo comm=)
}
not_running
printf 'Install to: %s\nOnly this Listen1 copy will have its download quarantine removed.\nSettings and playlists are preserved. Type INSTALL to continue: ' "$destination"
IFS= read -r confirmation
[ "$confirmation" = INSTALL ] || fail 'Installation cancelled.'
not_running
stage=$(/usr/bin/mktemp -d "$parent/.Listen1-install.XXXXXXXX")
backup=''
old_moved=0
new_installed=0
success=0
cleanup() {
  local result=$?
  trap - EXIT INT TERM
  if [ "$success" -ne 1 ]; then
    if [ "$new_installed" -eq 1 ]; then
      /bin/mv "$destination" "$stage/failed-Listen1.app" || { printf 'Rollback needs manual recovery. Backup: %s\n' "$backup" >&2; exit 1; }
    fi
    if [ "$old_moved" -eq 1 ]; then
      /bin/mv "$backup/Listen1.app" "$destination" || { printf 'Rollback needs manual recovery. Backup: %s\n' "$backup" >&2; exit 1; }
      /bin/rmdir "$backup" || true
      printf 'Previous Listen1 restored.\n' >&2
    fi
  fi
  # This is exclusively the directory returned by mktemp above; never user data.
  [ ! -L "$stage" ] && /bin/rm -rf "$stage"
  exit "$result"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
/usr/bin/ditto "$source_app" "$stage/Listen1.app"
verify_bundle "$stage/Listen1.app"
# The only extended attribute operation, on the verified staged app exclusively.
/usr/bin/xattr -dr com.apple.quarantine "$stage/Listen1.app"
verify_bundle "$stage/Listen1.app"
not_running
if [ -e "$destination" ]; then
  backup=$(/usr/bin/mktemp -d "$parent/.Listen1-backup.XXXXXXXX")
  /bin/mv "$destination" "$backup/Listen1.app"
  old_moved=1
fi
/bin/mv "$stage/Listen1.app" "$destination"
new_installed=1
verify_bundle "$destination"
success=1
printf 'Installed: %s\nOpen Listen1 from Finder.\n' "$destination"
[ -z "$backup" ] || printf 'Previous app retained: %s/Listen1.app\n' "$backup"
