#!/bin/sh
# Copies ext/ to the Mac's internal disk; Chrome loads the extension from that copy.
#
# Why: this repository lives on an external USB SSD. When Chrome starts before the SSD
# is mounted (after a reboot), it can't find an unpacked extension's folder and drops
# the extension from chrome://extensions, along with its saved data.
#
# Run it after changing anything in ext/, then press reload in chrome://extensions.
set -eu
DEST="${NDS_INSTALL_DIR:-$HOME/Library/Application Support/NetflixDualSubs/ext}"
SRC="$(cd "$(dirname "$0")/.." && pwd)/ext"
mkdir -p "$DEST"
rsync -a --delete --exclude .DS_Store "$SRC/" "$DEST/"
echo "Copied to: $DEST"
