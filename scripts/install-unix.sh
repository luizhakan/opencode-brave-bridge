#!/bin/sh
set -eu
ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
case "$(uname -s)" in
 Darwin) DATA="$HOME/Library/Application Support/opencode-brave-bridge"; HOSTS="$HOME/Library/Application Support/BraveSoftware/Brave-Browser/NativeMessagingHosts"; COMPAT_HOSTS="$HOME/Library/Application Support/Google/Chrome/NativeMessagingHosts"; BRAVE='/Applications/Brave Browser.app/Contents/MacOS/Brave Browser' ;;
 Linux) DATA="${XDG_DATA_HOME:-$HOME/.local/share}/opencode-brave-bridge"; HOSTS="$HOME/.config/BraveSoftware/Brave-Browser/NativeMessagingHosts"; BRAVE=$(command -v brave-browser || command -v brave || true) ;;
 *) echo 'Use installers/install.ps1.' >&2; exit 1;;
esac
command -v node >/dev/null || { echo 'Instale Node.js >=20.' >&2; exit 1; }
NODE=$(command -v node); [ "$("$NODE" -p 'process.versions.node.split(".")[0]')" -ge 20 ] || { echo 'Node.js >=20 necessário.' >&2; exit 1; }
[ -d "$ROOT/src" ] && [ -d "$ROOT/extension" ] || { echo 'Diretórios src/ e extension/ ausentes.' >&2; exit 1; }
mkdir -p "$DATA" "$HOSTS"; chmod 700 "$DATA"
rm -rf "$DATA/src" "$DATA/extension" "$DATA/node_modules"
cp -R "$ROOT/src" "$DATA/src"; cp -R "$ROOT/extension" "$DATA/extension"
cp "$ROOT/package.json" "$DATA/package.json"
if [ -f "$ROOT/package-lock.json" ]; then cp "$ROOT/package-lock.json" "$DATA/package-lock.json"; (cd "$DATA" && npm ci --omit=dev)
else (cd "$DATA" && npm install --omit=dev); fi
printf '#!/bin/sh\nexec %s %s "$@"\n' "$(printf '%s' "$NODE" | sed "s/'/'\\''/g" | sed "s/^/'/;s/$/'/")" "$(printf '%s' "$DATA/src/host.js" | sed "s/'/'\\''/g" | sed "s/^/'/;s/$/'/")" > "$DATA/launch-host"
printf '#!/bin/sh\nexec %s %s "$@"\n' "$(printf '%s' "$NODE" | sed "s/'/'\\''/g" | sed "s/^/'/;s/$/'/")" "$(printf '%s' "$DATA/src/mcp.js" | sed "s/'/'\\''/g" | sed "s/^/'/;s/$/'/")" > "$DATA/launch-mcp"
chmod 700 "$DATA/launch-host" "$DATA/launch-mcp"
EXT_ID=$("$NODE" - "$DATA/extension/manifest.json" <<'NODE' || true
const fs=require('fs'),c=require('crypto');try{const m=JSON.parse(fs.readFileSync(process.argv[2]));if(!m.key)process.exit(2);console.log([...c.createHash('sha256').update(Buffer.from(m.key,'base64')).digest().subarray(0,16)].map(b=>String.fromCharCode(97+(b>>4))+String.fromCharCode(97+(b&15))).join(''))}catch{process.exit(2)}
NODE
)
if [ -z "$EXT_ID" ]; then
 case "${1:-}" in --extension-id) EXT_ID=${2:-};; *) echo 'manifest.key ausente; use --extension-id <ID>.' >&2; exit 1;; esac
fi
printf '%s' "$EXT_ID" | grep -Eq '^[a-p]{32}$' || { echo 'ID inválido (esperado 32 letras a-p).' >&2; exit 1; }
BRAVE_PATH=$BRAVE
[ -n "$BRAVE_PATH" ] && [ -x "$BRAVE_PATH" ] || BRAVE_PATH=''
NATIVE="$HOSTS/dev.opencode.brave_bridge.json"
NATIVE_PATH=$NATIVE BRAVE_PATH=$BRAVE_PATH EXT_ID=$EXT_ID DATA=$DATA "$NODE" <<'NODE'
const fs=require('fs');fs.writeFileSync(process.env.NATIVE_PATH,JSON.stringify({name:'dev.opencode.brave_bridge',description:'OpenCode Brave Bridge',path:process.env.DATA+'/launch-host',type:'stdio',allowed_origins:[`chrome-extension://${process.env.EXT_ID}/`]},null,2)+'\n')
NODE
if [ "$(uname -s)" = Darwin ]; then
  # Brave 1.96 on this Mac resolves native hosts via the Chrome user-level
  # lookup directory. Keep Brave's own manifest and install the same, narrowly
  # scoped host in the compatibility directory; never overwrite another host.
  mkdir -p "$COMPAT_HOSTS"
  if [ -e "$COMPAT_HOSTS/dev.opencode.brave_bridge.json" ] && ! cmp -s "$NATIVE" "$COMPAT_HOSTS/dev.opencode.brave_bridge.json"; then
    echo 'Existing Chrome native host with this name differs; refusing to overwrite.' >&2; exit 1
  fi
  cp "$NATIVE" "$COMPAT_HOSTS/dev.opencode.brave_bridge.json"
fi
if command -v opencode >/dev/null 2>&1; then opencode mcp add brave --global -- "$DATA/launch-mcp" || echo 'Falha ao configurar MCP global.' >&2; else echo 'OpenCode CLI indisponível; configure: opencode mcp add brave --global -- "<caminho>/launch-mcp"'; fi
echo "Instalado em $DATA. Brave verificado: ${BRAVE_PATH:-não encontrado (instale Brave)}"
