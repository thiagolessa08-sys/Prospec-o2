# Órbita · Prospecção com Lusha

Aplicação privada em português: descrição do software → perfil ideal → até 10 empresas da Lusha → um contato relevante por empresa → e-mails individuais → revisão ou envio automático pelo Resend.

## Configuração

Abra **Conexões** e informe suas chaves da Lusha, Anthropic e Resend. O remetente precisa usar um domínio verificado no Resend. As chaves ficam criptografadas com AES-256-GCM no banco; a chave mestra `APP_ENCRYPTION_KEY` é um segredo do servidor (64 caracteres hexadecimais). Nunca troque ou remova essa chave sem migrar as credenciais existentes.

O projeto é publicado com acesso privado do proprietário pelo Sites. Essa barreira protege também as rotas da API. Não torne o site público/compartilhado sem implementar autenticação e segregação por usuário. Escritas exigem JSON e Origin da própria aplicação.

## Uso

1. Descreva funcionalidades, benefícios comprovados, diferenciais e público do software.
2. Informe mercado, nome do remetente, endereço e assinatura/convite.
3. Escolha revisão ou envio automático e inicie a campanha.
4. Mantenha a página aberta durante a execução. Cada etapa salva o progresso; pelo Histórico é possível retomar uma campanha interrompida. Não há processamento agendado em segundo plano.
5. No modo revisão, abra e edite os e-mails, salve as alterações e clique em enviar.

O modo econômico faz uma busca agrupada de até 25 contatos, limitada a uma pessoa por empresa, usando setor, porte, região e cargos derivados do perfil. A IA seleciona até 10 pares de empresa e decisor, e o sistema revela os e-mails profissionais escolhidos em uma única operação em lote. Para 10 novos e-mails, o custo esperado pelas regras publicadas pela Lusha é de até 12 créditos: 1 bloco da busca, 1 bloco do enriquecimento e 10 revelações de e-mail. O custo real depende da resposta, do plano e de dados já revelados; o sistema não promete que o provedor aceitará a operação. Menos de 10 resultados, falta de e-mail e restrições são informados sem inventar dados.

O pedido de prospecção não ativa `excludeDnc`, pois esse filtro de telefones é restrito a determinados planos da Lusha e não é necessário para campanhas que revelam somente e-mails profissionais.

O porte da empresa só é aplicado quando o usuário escreve explicitamente uma quantidade de funcionários ou colaboradores. Se uma busca com cargos específicos não retornar resultados, o sistema tenta uma segunda consulta sem porte e cargos rígidos, mantendo setor, país e disponibilidade de e-mail. Campanhas vazias também oferecem a ação **Tentar busca mais ampla**.

A IA usa apenas a descrição fornecida e os registros retornados pela Lusha; o percentual é uma estimativa de adequação, não probabilidade de compra. Não há pesquisa de notícias na web. A integração Anthropic usa a Messages API e Structured Outputs com `claude-sonnet-4-6`. Respostas incompletas, recusadas ou fora do esquema são rejeitadas antes de prosseguir. Os limites numéricos são validados também no servidor. A chave Anthropic é armazenada separadamente; uma eventual chave antiga de outro provedor não é utilizada nem transferida.

## Entrega e retomada

Cada destinatário tem uma reserva única e persistente por campanha antes do pedido de envio, mais uma chave de idempotência do Resend. Duas abas não processam a mesma campanha simultaneamente. Se a conexão cair depois que o provedor pode ter aceitado a mensagem, o sistema marca **Verificar no Resend** e não repete o envio. Confira a caixa de saída do provedor antes de criar uma nova tentativa. O estado **Enviado ao provedor** confirma aceitação, não entrega; bounces, entrega e respostas são acompanhados no Resend e na caixa do remetente. Não há retries automáticos de erro externo, evitando consumo e envios repetidos.

O convite para não receber novos contatos é respondido ao remetente. Pedidos recebidos precisam ser respeitados pelo operador; esta versão não processa respostas nem mantém uma lista automática de supressão. O histórico mostra as 100 campanhas mais recentes.

## Desenvolvimento

Requer Node 22.13+ e npm. Instale com `npm install`, configure `.dev.vars` com `APP_ENCRYPTION_KEY` e execute `npm run dev`. O banco local D1 precisa das migrações em `drizzle/`; no Sites, elas são incluídas automaticamente no pacote de publicação. `npm run db:generate` gera novas migrações após mudanças em `db/schema.ts`.

Validação: `npm run typecheck`, `npm test`, `npm run lint` e `npm run build`. Os testes usam respostas simuladas conforme os contratos publicados; nenhuma campanha de teste envia e-mail real. A operação real exige credenciais válidas e deve ser verificada com as contas do usuário.

## Railway

O arquivo `railway.json` executa o build, inicia o servidor em `0.0.0.0` na porta fornecida pelo Railway e valida `/api/health` antes de liberar o deploy. No primeiro start, o inicializador cria as tabelas e uma chave de criptografia própria; nenhum segredo é gravado no Git.

Antes de cadastrar credenciais reais, anexe um volume ao serviço com ponto de montagem `/data`. O inicializador detecta `RAILWAY_VOLUME_MOUNT_PATH` e mantém nesse volume o banco e a chave de criptografia. Sem volume, campanhas e conexões são apagadas quando o container é substituído.

No Railway, configure preferencialmente `LUSHA_API_KEY`, `ANTHROPIC_API_KEY` e `RESEND_API_KEY` na aba Variables. Essas variáveis têm prioridade sobre credenciais salvas pela tela e aparecem na interface como administradas pelo Railway. A validação de origem aceita o host público encaminhado pelo proxy, mantendo o bloqueio de requisições de outros sites.

O acesso privado do Sites não acompanha uma cópia publicada no Railway. Restrinja o domínio do Railway antes de cadastrar credenciais de produção.

## Referências dos provedores

- [Lusha V3: introdução e autenticação](https://docs.lusha.com/guides)
- [Busca de empresas](https://docs.lusha.com/apis/openapi/prospecting/prospectingcompanies)
- [Enriquecimento de empresas](https://docs.lusha.com/apis/openapi/enrich/enrichcompanies)
- [Busca de contatos](https://docs.lusha.com/apis/openapi/prospecting/prospectingcontacts)
- [Enriquecimento de contatos](https://docs.lusha.com/apis/openapi/enrich/enrichcontacts)
- [Anthropic Structured Outputs](https://platform.claude.com/docs/en/build-with-claude/structured-outputs)
- [Anthropic Messages API](https://platform.claude.com/docs/en/api/messages/create)
- [Resend: envio de e-mails](https://resend.com/docs/api-reference/emails/send-email)
- [Resend: idempotência](https://resend.com/docs/dashboard/emails/idempotency-keys)
