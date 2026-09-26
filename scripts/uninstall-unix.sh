#!/bin/sh
set -eu
case "$(uname -s)" in
 Darwin) DATA="$HOME/Library/Application Support/opencode-brave-bridge"; HOSTS="$HOME/Library/Application Support/BraveSoftware/Brave-Browser/NativeMessagingHosts" ;;
 Linux) DATA="${XDG_DATA_HOME:-$HOME/.local/share}/opencode-brave-bridge"; HOSTS="$HOME/.config/BraveSoftware/Brave-Browser/NativeMessagingHosts" ;;
 *) echo 'Use installers/uninstall.ps1.' >&2; exit 1;;
esac
rm -f "$HOSTS/dev.opencode.brave_bridge.json"; rm -rf "$DATA"
if command -v opencode >/dev/null 2>&1; then opencode mcp remove brave --global 2>/dev/null || true; fi
echo 'Bridge removida; remova extensão manualmente em brave://extensions.'
