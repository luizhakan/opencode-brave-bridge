# OpenCode Brave Bridge

Instalador para o host de mensagens nativas do Brave e configuração MCP global do OpenCode. Protocolo detalhado em [protocol/README.md](protocol/README.md). Requer Node.js 20 ou superior.

## macOS e Linux

Na cópia local do projeto, rode `sh scripts/install-unix.sh` (não usa sudo). Instala `src/` e `extension/` em dados privados do usuário, fixa o caminho absoluto do Node no wrapper e registra o host no diretório nativo correto. O script não inicia o host. Se OpenCode não estiver disponível, configure MCP global manualmente, no formato: `{"mcp":{"brave":{"type":"local","command":["CAMINHO_ABSOLUTO_DO_WRAPPER"]}}}`. Confirme a sintaxe compatível com sua versão do OpenCode.

## Windows

PowerShell: `./installers/install.ps1` (não requer administrador). O registro fica somente em HKCU. Para diagnóstico/remoção use `installers/doctor.ps1` e `installers/uninstall.ps1`.

## Brave: instalação manual obrigatória

Abra `brave://extensions`, habilite Modo do desenvolvedor e use **Carregar sem compactação** apontando para a cópia instalada em `extension/` sob os dados do usuário. Copie o ID mostrado. Se `manifest.key` não existir, edite o manifesto nativo `dev.opencode.brave_bridge.json` para substituir `INSIRA_ID_DA_EXTENSAO` pelo ID e reinicie o Brave. Se houver `manifest.key`, o instalador calcula o ID estável. Não é feita instalação, alteração de configurações nem automação do Brave.

Para usar em outro computador, copie/clone o projeto nesse computador e execute o instalador localmente; não copie os dados de registro entre sistemas. Instale Node 20+ e OpenCode previamente. O diretório de extensão carregado manualmente é a cópia instalada, não a árvore-fonte.

## Limites e segurança

O v1 é somente leitura quanto ao conteúdo da página: status de grupo, listar abas e snapshots (com máscara de campos secretos e truncamento). Também pode abrir/navegar abas inativas, somente em origens aprovadas pelo usuário. Não executa JS, clica, digita, captura screenshots, acessa cookies/storage/rede ou faz upload. A autorização é concedida explicitamente no popup por projeto/grupo/origem e revogada ao reiniciar o browser ou pelo popup; abas nunca são ativadas. Conteúdo de páginas é dado não confiável. Veja o protocolo para detalhes.

Scripts: `scripts/doctor-unix.sh`, `scripts/uninstall-unix.sh` e equivalentes PowerShell em `installers/`. Uninstall remove dados e registro do host/MCP, mas não desinstala a extensão carregada; remova-a manualmente em `brave://extensions`.
