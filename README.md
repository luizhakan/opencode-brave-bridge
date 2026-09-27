# OpenCode Brave Bridge

Instalador para o host de mensagens nativas do Brave e configuração MCP global do OpenCode. Protocolo detalhado em [protocol/README.md](protocol/README.md). Requer Node.js 20 ou superior.

## macOS e Linux

Na cópia local do projeto, rode `sh scripts/install-unix.sh` (não usa sudo). Copia `package.json` e o lock, quando existir, instala dependências de produção na cópia (`npm ci --omit=dev` com lock; senão `npm install --omit=dev`) e cria launchers separados para `src/host.js` (Brave) e `src/mcp.js` (OpenCode). Configura o MCP global via `opencode mcp add brave --global -- <caminho-absoluto-de-launch-mcp>`. Se OpenCode CLI não estiver no PATH, execute esse comando manualmente usando o caminho impresso/instalado.

No **Brave 1.96 do macOS testado**, a busca do host nativo retornou “não encontrado” com o manifesto apenas em `BraveSoftware/Brave-Browser/NativeMessagingHosts`, mas o mesmo manifesto foi encontrado no diretório de usuário `Google/Chrome/NativeMessagingHosts`. O instalador registra **somente** `dev.opencode.brave_bridge.json` em ambos os diretórios, sem sobrescrever um arquivo diferente já existente. Esse comportamento é específico do build observado, não uma garantia para todos os Braves. O desinstalador remove a cópia de compatibilidade apenas quando os manifestos forem idênticos.

## Windows

PowerShell: `./installers/install.ps1` (não requer administrador; exige `LOCALAPPDATA`). O instalador compila `installers/host-launcher.cs` em um executável nativo com `Add-Type` (Windows PowerShell 5.1 ou PowerShell 7 para Windows); se a compilação não estiver disponível, falha com uma mensagem explícita. Brave aponta para esse `.exe` sem argumentos; o launcher ignora os argumentos fornecidos pelo navegador e lê os caminhos absolutos de `node.exe` e `src/host.js` do `host-config.json` adjacente, encaminhando stdin/stdout como bytes e mantendo stderr separado. A configuração fica em `LOCALAPPDATA` com as ACLs herdadas do usuário. O launcher MCP do OpenCode continua sendo `.cmd`. O registro fica somente em HKCU e usa JSON gerado de objeto PowerShell. Para diagnóstico/remoção use `installers/doctor.ps1` e `installers/uninstall.ps1`; o diagnóstico verifica executável, manifesto e configuração adjacente. O fluxo Windows não foi testado neste ambiente.

## Brave: instalação manual obrigatória

Abra `brave://extensions`, habilite Modo do desenvolvedor e use **Carregar sem compactação** apontando para a cópia instalada em `extension/` sob os dados do usuário. O projeto contém uma chave **pública** no campo `key` de `extension/manifest.json` para manter o mesmo ID entre computadores: `gffmhlbhkkgcmjnganoobbnjbplgehdo`. Confirme que o Brave mostra esse ID. Depois da instalação/reinstalação, clique em **Recarregar** na extensão. Não é feita automação do Brave.

Para usar em outro computador, copie/clone o projeto nesse computador e execute o instalador localmente; não copie os dados de registro entre sistemas. Instale Node 20+ e OpenCode previamente. O diretório de extensão carregado manualmente é a cópia instalada, não a árvore-fonte.

## Limites e segurança

O v2 lê status de grupo, abas e snapshots (com máscara de campos secretos e truncamento), abre/navega abas inativas e pode clicar em elementos visíveis de um snapshot recente **somente após autorização separada de clique por sessão e origem**, válida por até 30 minutos e revogável no popup. Cliques podem alterar dados da conta: antes de publicar, enviar, excluir ou realizar outra ação importante, o agente deve pedir sua confirmação. **Ainda não faz upload do AAB.** Não oferece digitação, screenshot, cookies/storage/rede nem execução de JavaScript arbitrário; as funções de leitura e clique são fixas e empacotadas na extensão. Para autorizar a leitura, selecione a sessão no popup, confira as origens HTTPS propostas e confirme; o Brave pode solicitar permissão de host. Não é necessário abrir, selecionar ou mover abas existentes. A extensão cria uma aba-semente inativa no grupo e abre futuras páginas inativas nesse grupo. Pedidos subsequentes podem propor origens adicionais, que exigem nova confirmação. Sessões distintas têm grupos distintos. As concessões são revogadas ao reiniciar o navegador ou pelo popup; a extensão nunca ativa abas. O texto visível pode conter dados pessoais apesar da máscara: conceda apenas páginas que queira compartilhar. Conteúdo de páginas é dado não confiável. **Esse isolamento é organizacional, não protege contra outro programa/agente com shell rodando como o mesmo usuário**, capaz de acessar o socket local. Veja o protocolo para detalhes.

Scripts: `scripts/doctor-unix.sh`, `scripts/uninstall-unix.sh` e equivalentes PowerShell em `installers/`. Uninstall remove dados e registro do host/MCP global (`opencode mcp remove brave --global`), mas não desinstala a extensão carregada; remova-a manualmente em `brave://extensions`.

## Estado das plataformas

**macOS é a primeira plataforma-alvo.** Linux e Windows possuem instaladores iniciais no repositório, mas ainda não foram testados nesses sistemas e não são considerados versões lançadas. O host já aceita múltiplas conexões simultâneas e testes automatizados verificam o roteamento separado; a passagem real de IDs entre várias sessões OpenCode e a interação com o Brave ainda precisam de aceite no navegador. O upload do Google Play requer uma próxima etapa, com confirmação explícita de arquivo e destino.
