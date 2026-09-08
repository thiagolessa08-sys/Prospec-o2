# Órbita · Prospecção com Lusha

Aplicação privada em português: descrição do software → perfil ideal → até 10 empresas da Lusha → um contato relevante por empresa → e-mails individuais → revisão ou envio automático pelo Resend.

## Configuração

Abra **Conexões** e informe suas chaves da Lusha, OpenAI e Resend. O remetente precisa usar um domínio verificado no Resend. As chaves ficam criptografadas com AES-256-GCM no banco; a chave mestra `APP_ENCRYPTION_KEY` é um segredo do servidor (64 caracteres hexadecimais). Nunca troque ou remova essa chave sem migrar as credenciais existentes.

O projeto é publicado com acesso privado do proprietário pelo Sites. Essa barreira protege também as rotas da API. Não torne o site público/compartilhado sem implementar autenticação e segregação por usuário. Escritas exigem JSON e Origin da própria aplicação.

## Uso

1. Descreva funcionalidades, benefícios comprovados, diferenciais e público do software.
2. Informe mercado, nome do remetente, endereço e assinatura/convite.
3. Escolha revisão ou envio automático e inicie a campanha.
4. Mantenha a página aberta durante a execução. Cada etapa salva o progresso; pelo Histórico é possível retomar uma campanha interrompida. Não há processamento agendado em segundo plano.
5. No modo revisão, abra e edite os e-mails, salve as alterações e clique em enviar.

Uma busca avalia até 30 empresas da Lusha e seleciona até 10 com adequação suficiente. Enriquecemos essas candidatas para obter descrição e contexto. Por empresa selecionada, a busca retorna até 5 pessoas com os cargos relevantes e e-mail de trabalho; a IA prioriza até 3 para enriquecimento, e apenas uma pessoa com e-mail profissional utilizável é selecionada. Créditos e permissões dependem da conta Lusha. Menos de 10 resultados, falta de e-mail e restrições são informados sem inventar dados.

A IA usa apenas a descrição fornecida e os registros retornados pela Lusha; o percentual é uma estimativa de adequação, não probabilidade de compra. Não há pesquisa de notícias na web. A integração OpenAI usa Responses, Structured Outputs e `store: false`, com `gpt-5.4-mini`.

## Entrega e retomada

Cada destinatário tem uma reserva única e persistente por campanha antes do pedido de envio, mais uma chave de idempotência do Resend. Duas abas não processam a mesma campanha simultaneamente. Se a conexão cair depois que o provedor pode ter aceitado a mensagem, o sistema marca **Verificar no Resend** e não repete o envio. Confira a caixa de saída do provedor antes de criar uma nova tentativa. O estado **Enviado ao provedor** confirma aceitação, não entrega; bounces, entrega e respostas são acompanhados no Resend e na caixa do remetente. Não há retries automáticos de erro externo, evitando consumo e envios repetidos.

O convite para não receber novos contatos é respondido ao remetente. Pedidos recebidos precisam ser respeitados pelo operador; esta versão não processa respostas nem mantém uma lista automática de supressão. O histórico mostra as 100 campanhas mais recentes.

## Desenvolvimento

Requer Node 22.13+ e npm. Instale com `npm install`, configure `.dev.vars` com `APP_ENCRYPTION_KEY` e execute `npm run dev`. O banco local D1 precisa das migrações em `drizzle/`; no Sites, elas são incluídas automaticamente no pacote de publicação. `npm run db:generate` gera novas migrações após mudanças em `db/schema.ts`.

Validação: `npm run typecheck`, `npm test`, `npm run lint` e `npm run build`. Os testes usam respostas simuladas conforme os contratos publicados; nenhuma campanha de teste envia e-mail real. A operação real exige credenciais válidas e deve ser verificada com as contas do usuário.

## Referências dos provedores

- [Lusha V3: introdução e autenticação](https://docs.lusha.com/guides)
- [Busca de empresas](https://docs.lusha.com/apis/openapi/prospecting/prospectingcompanies)
- [Enriquecimento de empresas](https://docs.lusha.com/apis/openapi/enrich/enrichcompanies)
- [Busca de contatos](https://docs.lusha.com/apis/openapi/prospecting/prospectingcontacts)
- [Enriquecimento de contatos](https://docs.lusha.com/apis/openapi/enrich/enrichcontacts)
- [OpenAI Structured Outputs](https://developers.openai.com/api/docs/guides/structured-outputs)
- [Resend: envio de e-mails](https://resend.com/docs/api-reference/emails/send-email)
- [Resend: idempotência](https://resend.com/docs/dashboard/emails/idempotency-keys)
