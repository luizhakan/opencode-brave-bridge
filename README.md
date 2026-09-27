# OpenCode Brave Bridge

Instalador para o host de mensagens nativas do Brave e configuração MCP global do OpenCode. Protocolo detalhado em [protocol/README.md](protocol/README.md). Requer Node.js 20 ou superior.

## macOS e Linux

Na cópia local do projeto, rode `sh scripts/install-unix.sh` (não usa sudo). Copia `package.json` e o lock, quando existir, instala dependências de produção na cópia (`npm ci --omit=dev` com lock; senão `npm install --omit=dev`) e cria launchers separados para `src/host.js` (Brave) e `src/mcp.js` (OpenCode). Configura o MCP global via `opencode mcp add brave --global -- <caminho-absoluto-de-launch-mcp>`. Se OpenCode CLI não estiver no PATH, execute esse comando manualmente usando o caminho impresso/instalado.

## Windows

PowerShell: `./installers/install.ps1` (não requer administrador; exige `LOCALAPPDATA`). O instalador compila `installers/host-launcher.cs` em um executável nativo com `Add-Type` (Windows PowerShell 5.1 ou PowerShell 7 para Windows); se a compilação não estiver disponível, falha com uma mensagem explícita. Brave aponta para esse `.exe` sem argumentos; o launcher ignora os argumentos fornecidos pelo navegador e lê os caminhos absolutos de `node.exe` e `src/host.js` do `host-config.json` adjacente, encaminhando stdin/stdout como bytes e mantendo stderr separado. A configuração fica em `LOCALAPPDATA` com as ACLs herdadas do usuário. O launcher MCP do OpenCode continua sendo `.cmd`. O registro fica somente em HKCU e usa JSON gerado de objeto PowerShell. Para diagnóstico/remoção use `installers/doctor.ps1` e `installers/uninstall.ps1`; o diagnóstico verifica executável, manifesto e configuração adjacente. O fluxo Windows não foi testado neste ambiente.

## Brave: instalação manual obrigatória

Abra `brave://extensions`, habilite Modo do desenvolvedor e use **Carregar sem compactação** apontando para a cópia instalada em `extension/` sob os dados do usuário. O projeto contém uma chave **pública** no campo `key` de `extension/manifest.json` para manter o mesmo ID entre computadores: `gffmhlbhkkgcmjnganoobbnjbplgehdo`. Confirme que o Brave mostra esse ID. Depois da instalação/reinstalação, clique em **Recarregar** na extensão. Não é feita automação do Brave.

Para usar em outro computador, copie/clone o projeto nesse computador e execute o instalador localmente; não copie os dados de registro entre sistemas. Instale Node 20+ e OpenCode previamente. O diretório de extensão carregado manualmente é a cópia instalada, não a árvore-fonte.

## Limites e segurança

O v2 preview é somente leitura quanto ao conteúdo da página: status de grupo, listar abas e snapshots (com máscara de campos secretos e truncamento). Também pode abrir/navegar abas inativas, somente em origens aprovadas pelo usuário. **Ainda não faz upload do AAB.** Não oferece clique, digitação, screenshot, cookies/storage/rede nem execução de JavaScript arbitrário; a leitura de DOM usa uma função fixa empacotada na extensão. A autorização é concedida explicitamente no popup por **sessão**, grupo e origem: escolha a sessão, destaque as abas, confira a prévia e confirme. Você pode adicionar outras abas ao mesmo grupo depois; sessões distintas têm grupos distintos. As concessões são revogadas ao reiniciar o navegador ou pelo popup; a extensão nunca ativa abas. O texto visível pode conter dados pessoais apesar da máscara de campos: conceda apenas páginas que queira compartilhar. Conteúdo de páginas é dado não confiável. **Esse isolamento é organizacional, não protege contra outro programa/agente com shell rodando como o mesmo usuário**, capaz de acessar o socket local. Veja o protocolo para detalhes.

Scripts: `scripts/doctor-unix.sh`, `scripts/uninstall-unix.sh` e equivalentes PowerShell em `installers/`. Uninstall remove dados e registro do host/MCP global (`opencode mcp remove brave --global`), mas não desinstala a extensão carregada; remova-a manualmente em `brave://extensions`.

## Estado das plataformas

**macOS é a primeira plataforma-alvo.** Linux e Windows possuem instaladores iniciais no repositório, mas ainda não foram testados nesses sistemas e não são considerados versões lançadas. O host já aceita múltiplas conexões simultâneas e testes automatizados verificam o roteamento separado; a passagem real de IDs entre várias sessões OpenCode e a interação com o Brave ainda precisam de aceite no navegador. O upload do Google Play requer uma próxima etapa, com confirmação explícita de arquivo e destino.
