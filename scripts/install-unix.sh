#!/bin/sh
set -eu
ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
case "$(uname -s)" in
 Darwin) DATA="$HOME/Library/Application Support/opencode-brave-bridge"; HOSTS="$HOME/Library/Application Support/BraveSoftware/Brave-Browser/NativeMessagingHosts" ;;
 Linux) DATA="${XDG_DATA_HOME:-$HOME/.local/share}/opencode-brave-bridge"; HOSTS="$HOME/.config/BraveSoftware/Brave-Browser/NativeMessagingHosts" ;;
 *) echo 'Use installers/install.ps1.' >&2; exit 1;;
esac
command -v node >/dev/null || { echo 'Instale Node.js >=20.' >&2; exit 1; }
NODE=$(command -v node); [ "$($NODE -p 'process.versions.node.split(".")[0]')" -ge 20 ] || { echo 'Node.js >=20 necessário.' >&2; exit 1; }
[ -d "$ROOT/src" ] && [ -d "$ROOT/extension" ] || { echo 'Diretórios src/ e extension/ ausentes.' >&2; exit 1; }
mkdir -p "$DATA" "$HOSTS"; rm -rf "$DATA/src" "$DATA/extension"; cp -R "$ROOT/src" "$DATA/src"; cp -R "$ROOT/extension" "$DATA/extension"
cat > "$DATA/launch-host" <<EOF2
#!/bin/sh
exec "$NODE" "$DATA/src/index.js" "\$@"
EOF2
chmod 700 "$DATA/launch-host"
EXT_ID=$($NODE - "$DATA/extension/manifest.json" <<'NODE' || true
const fs=require('fs'),c=require('crypto');try{const m=JSON.parse(fs.readFileSync(process.argv[2]));if(!m.key)process.exit(2);console.log([...c.createHash('sha256').update(Buffer.from(m.key,'base64')).digest().subarray(0,16)].map(b=>String.fromCharCode(97+(b>>4))+String.fromCharCode(97+(b&15))).join(''))}catch{process.exit(2)}
NODE
)
if [ -z "$EXT_ID" ]; then echo "Carregue $DATA/extension em brave://extensions e obtenha o ID exibido."; EXT_ID=INSIRA_ID_DA_EXTENSAO; else echo "ID da extensão: $EXT_ID"; fi
printf '{"name":"dev.opencode.brave_bridge","description":"OpenCode Brave Bridge","path":"%s","type":"stdio","allowed_origins":["chrome-extension://%s/"]}\n' "$DATA/launch-host" "$EXT_ID" > "$HOSTS/dev.opencode.brave_bridge.json"
if command -v opencode >/dev/null 2>&1; then opencode mcp add brave --global -- "$DATA/launch-host" || echo 'Falha MCP: veja README.'; else echo 'OpenCode CLI indisponível; configuração manual descrita em README.md.'; fi
