#!/bin/sh
set -eu
case "$(uname -s)" in
 Darwin) DATA="$HOME/Library/Application Support/opencode-brave-bridge"; HOSTS="$HOME/Library/Application Support/BraveSoftware/Brave-Browser/NativeMessagingHosts"; COMPAT_HOSTS="$HOME/Library/Application Support/Google/Chrome/NativeMessagingHosts" ;;
 Linux) DATA="${XDG_DATA_HOME:-$HOME/.local/share}/opencode-brave-bridge"; HOSTS="$HOME/.config/BraveSoftware/Brave-Browser/NativeMessagingHosts" ;;
 *) echo 'Use installers/doctor.ps1.' >&2; exit 1;;
esac
echo "Node: $(command -v node || echo ausente)"; node --version 2>/dev/null || true
for f in "$DATA/src/host.js" "$DATA/src/mcp.js" "$DATA/launch-host" "$DATA/launch-mcp" "$DATA/package.json" "$DATA/node_modules" "$DATA/extension/manifest.json" "$HOSTS/dev.opencode.brave_bridge.json"; do if [ -e "$f" ]; then echo "OK $f"; else echo "FALTA $f"; fi; done
if [ "$(uname -s)" = Darwin ]; then if cmp -s "$HOSTS/dev.opencode.brave_bridge.json" "$COMPAT_HOSTS/dev.opencode.brave_bridge.json"; then echo 'OK manifestos Brave/Chrome idênticos'; else echo 'FALTA OU DIVERGE manifesto de compatibilidade macOS'; fi; fi
if command -v opencode >/dev/null 2>&1; then opencode mcp list; else echo 'OpenCode CLI indisponível'; fi
