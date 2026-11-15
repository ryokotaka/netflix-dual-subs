#!/bin/sh
# Copies ext/ to the Mac's internal disk; Chrome loads the extension from that copy.
#
# Why: this repository lives on an external USB SSD. When Chrome starts before the SSD
# is mounted (after a reboot), it can't find an unpacked extension's folder and drops
# the extension from chrome://extensions, along with its saved data.
#
# Run it after changing anything in ext/, then press reload in chrome://extensions.
#
#   tools/install.sh                      copy ext/ (keeps any bundled backups)
#   tools/install.sh --with-backups DIR   also bundle DIR/backup*.json into restore/:
#                                         when the extension starts with no data (a
#                                         reinstall), it restores them by itself
set -eu
DEST="${NDS_INSTALL_DIR:-$HOME/Library/Application Support/NetflixDualSubs/ext}"
SRC="$(cd "$(dirname "$0")/.." && pwd)/ext"
mkdir -p "$DEST"
rsync -a --delete --exclude .DS_Store --filter 'P restore/' "$SRC/" "$DEST/"
echo "Copied to: $DEST"

if [ "${1:-}" = "--with-backups" ]; then
  DIR="${2:?usage: tools/install.sh --with-backups DIR}"
  rm -rf "$DEST/restore"; mkdir -p "$DEST/restore"
  # newest first: restoring merges, and settings already there win over later files
  names=$(cd "$DIR" && ls -t backup*.json)
  for n in $names; do cp "$DIR/$n" "$DEST/restore/$n"; done
  printf '%s\n' $names | python3 -I -c 'import json,sys; print(json.dumps([l.strip() for l in sys.stdin if l.strip()]))' > "$DEST/restore/index.json"
  echo "Bundled for restore: $(cat "$DEST/restore/index.json")"
fi
