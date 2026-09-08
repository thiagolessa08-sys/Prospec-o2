import type { Campaign, Lead } from './types';
import {
  ai,
  arr,
  obj,
  str,
  lusha,
  results,
  company,
  workEmail,
  industryIds,
  ProviderError,
  type Credentials,
  type Json,
} from './providers';
import { AppError, validEmail, safeDomain } from './validation';

export type Receipt = { status: string; providerId?: string | null };
export type DeliveryStore = {
  claim(id: string, campaignId: string, email: string): Promise<boolean>;
  get(id: string): Promise<Receipt | null>;
  finish(id: string, status: string, providerId?: string): Promise<void>;
};
const integer = { type: 'integer' };
const profileSchema = obj({
  summary: str,
  industries: arr(str),
  titles: arr(str),
  country: str,
  industryIds: arr(integer),
  minEmployees: integer,
  maxEmployees: integer,
});

export async function sendLead(
  c: Campaign,
  lead: Lead,
  key: string,
  store: DeliveryStore,
) {
  if (
    !lead.email ||
    !validEmail(lead.email) ||
    !lead.subject ||
    !lead.body ||
    /[\r\n]/.test(lead.subject)
  )
    throw new AppError('Mensagem sem destinatário ou conteúdo válido.');
  const receiptId = `${c.id}:${lead.email.toLowerCase()}`;
  // Persist the unique claim BEFORE the external side effect. Never resend an ambiguous delivery.
  if (!(await store.claim(receiptId, c.id, lead.email))) {
    const receipt = await store.get(receiptId);
    lead.status =
      receipt?.status === 'sent'
        ? 'sent'
        : receipt?.status === 'failed'
          ? 'failed'
          : 'uncertain';
    if (receipt?.providerId) lead.providerId = receipt.providerId;
    if (lead.status === 'uncertain')
      lead.issue =
        'O envio anterior pode ter sido aceito. Confira no Resend; ele não será repetido automaticamente.';
    return;
  }
  try {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      signal: AbortSignal.timeout(30000),
      headers: {
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
        'Idempotency-Key': `orbita/${c.id}/${lead.id}`,
      },
      body: JSON.stringify({
        from: `${c.input.senderName} <${c.input.senderEmail}>`,
        to: [lead.email],
        reply_to: c.input.senderEmail,
        subject: lead.subject,
        text: lead.body,
        tags: [{ name: 'campaign', value: c.id }],
      }),
    });
    if (!response.ok) {
      const definite =
        response.status >= 400 &&
        response.status < 500 &&
        ![408, 409].includes(response.status);
      lead.status = definite ? 'failed' : 'uncertain';
      lead.issue = new ProviderError('Resend', response.status).message;
      await store.finish(receiptId, lead.status);
      return;
    }
    const result = (await response.json()) as Json;
    if (typeof result.id !== 'string' || !result.id)
      throw new Error('Missing provider ID');
    await store.finish(receiptId, 'sent', result.id);
    lead.providerId = result.id;
    lead.status = 'sent';
  } catch {
    lead.status = 'uncertain';
    lead.issue =
      'Não foi possível confirmar o envio. Confira no Resend antes de uma nova tentativa; o sistema não vai duplicar esta mensagem.';
    await store.finish(receiptId, 'uncertain');
  }
}

export async function advance(
  c: Campaign,
  keys: Credentials,
  deliveries: DeliveryStore,
): Promise<Campaign> {
  if (['review', 'done'].includes(c.stage)) return c;
  if (c.stage === 'send') {
    if (!keys.resendKey)
      throw new AppError('Configure a chave do Resend em Conexões.');
    const lead = c.leads.find((l) => l.status === 'ready');
    if (lead) {
      await sendLead(c, lead, keys.resendKey, deliveries);
      c.cursor++;
      c.note = `Envio processado para ${lead.company.name}.`;
    }
    if (!c.leads.some((l) => l.status === 'ready')) {
      c.stage = 'done';
      c.cursor = 0;
      const sent = c.leads.filter((l) => l.status === 'sent').length;
      const problems = c.leads.filter((l) =>
        ['failed', 'uncertain'].includes(l.status),
      ).length;
      c.note = `${sent} e-mail(s) aceito(s) pelo Resend. ${problems ? `${problems} envio(s) exigem atenção nos cartões abaixo.` : 'Você pode consultar as mensagens abaixo.'} A entrega na caixa de entrada deve ser acompanhada no Resend.`;
    }
    return c;
  }
  if (!keys.lushaKey || !keys.anthropicKey)
    throw new AppError('Configure Lusha e Anthropic em Conexões.');
  if (c.stage === 'analyze') {
    const catalog = await lusha(
      keys.lushaKey,
      'companies/prospecting/filters/industriesLabels',
    );
    const allowed = industryIds(catalog.values);
    if (!allowed.size)
      throw new AppError(
        'Lusha: o catálogo de setores retornou um formato não reconhecido. A busca foi interrompida para não usar filtros incorretos.',
        502,
      );
    c.profile = await ai<NonNullable<Campaign['profile']>>(
      keys.anthropicKey,
      'perfil_cliente',
      profileSchema,
      'Analise o produto e o mercado para definir clientes potenciais. Escolha de 1 a 4 mainIndustriesIds do catálogo fornecido, nunca IDs de subindústrias. industryIds deve conter apenas esses IDs numéricos. industries contém seus rótulos. country é o nome em inglês do país definido pelo usuário, vazio se global. titles são até 8 variações PT/EN de cargos compradores relevantes. minEmployees/maxEmployees são limites explícitos do usuário; 0 significa sem limite. summary explica o perfil em até 400 caracteres. Não infira provas de resultado.',
      {
        software: c.input.description,
        name: c.input.name,
        market: c.input.market,
        industryCatalog: catalog.values,
      },
    );
    if (
      !c.profile.industryIds.length ||
      c.profile.industryIds.length > 4 ||
      c.profile.industryIds.some((id) => !allowed.has(id))
    )
      throw new AppError(
        'A IA selecionou um setor inválido. Retome a análise.',
        502,
      );
    if (
      !c.profile.titles.length ||
      c.profile.titles.length > 8 ||
      c.profile.minEmployees < 0 ||
      c.profile.maxEmployees < 0 ||
      (c.profile.maxEmployees > 0 &&
        c.profile.maxEmployees < c.profile.minEmployees)
    )
      throw new AppError(
        'O perfil retornado está inconsistente. Retome a análise.',
        502,
      );
    c.stage = 'companies';
    c.cursor = 0;
    c.note = 'Perfil de cliente definido. Preparando a busca de empresas.';
  } else if (c.stage === 'companies') {
    if (!c.profile) throw new AppError('Perfil da campanha não encontrado.');
    if (c.cursor === 0) {
      const include: Json = { mainIndustriesIds: c.profile.industryIds };
      if (c.profile.country)
        include.locations = [{ country: c.profile.country }];
      if (c.profile.minEmployees || c.profile.maxEmployees)
        include.sizes = [
          {
            ...(c.profile.minEmployees ? { min: c.profile.minEmployees } : {}),
            ...(c.profile.maxEmployees ? { max: c.profile.maxEmployees } : {}),
          },
        ];
      const data = await lusha(keys.lushaKey, 'companies/prospecting', {
        pagination: { page: 0, size: 30 },
        filters: { companies: { include } },
      });
      const seen = new Set<string>();
      c.candidates = results(data)
        .map(company)
        .filter((v) => {
          if (!v) return false;
          const id = v.domain || v.id;
          if (seen.has(id)) return false;
          seen.add(id);
          return true;
        }) as NonNullable<Campaign['candidates']>;
      if (!c.candidates.length) {
        c.stage = 'done';
        c.note =
          'A Lusha não retornou empresas para este perfil. Crie uma campanha com um mercado mais amplo.';
        return c;
      }
      c.cursor = 1;
      c.note = `${c.candidates.length} empresas encontradas na Lusha. Buscando contexto para a seleção.`;
    } else if (c.cursor === 1) {
      const enriched = results(
        await lusha(keys.lushaKey, 'companies/enrich', {
          ids: c.candidates!.map((v) => v.id),
        }),
      );
      const map = new Map(enriched.map((v) => [String(v.id), v]));
      c.candidates = c.candidates!.flatMap((v) => {
        const raw = map.get(v.id);
        if (raw?.error) return [];
        const full = raw ? company(raw) : null;
        return [{ ...v, ...full }];
      });
      c.cursor = 2;
      c.note =
        'Contexto das empresas reunido. A IA está avaliando a compatibilidade.';
    } else {
      if (!c.candidates?.length) {
        c.stage = 'done';
        c.note = 'Não foi possível enriquecer as empresas encontradas.';
        return c;
      }
      const ranked = await ai<{
        choices: { id: string; score: number; reason: string }[];
      }>(
        keys.anthropicKey,
        'empresas_compativeis',
        obj({
          choices: arr(
            obj({
              id: { type: 'string', enum: c.candidates.map((v) => v.id) },
              score: { type: 'integer', minimum: 0, maximum: 100 },
              reason: str,
            }),
          ),
        }),
        'Selecione as 10 empresas com melhor adequação ao software e mercado. Use somente as candidatas fornecidas. Retorne menos apenas se houver menos de 10 relevantes. Não inclua concorrentes diretos ou empresas fora de restrições explícitas. Score é estimativa de adequação, não intenção de compra: inclua apenas score >= 60. Explique em até 350 caracteres conectando um fato fornecido ao benefício potencial. Não afirme que a empresa tem uma dor, usa certa ferramenta ou está comprando sem evidência. Retorne IDs únicos por ordem de adequação.',
        { input: c.input, profile: c.profile, companies: c.candidates },
      );
      const seen = new Set<string>();
      c.leads = ranked.choices
        .filter((v) => {
          if (v.score < 60 || seen.has(v.id)) return false;
          seen.add(v.id);
          return true;
        })
        .slice(0, 10)
        .map((v) => {
          const comp = c.candidates!.find((x) => x.id === v.id);
          if (!comp)
            throw new AppError('A IA retornou uma empresa fora da busca.', 502);
          return {
            id: crypto.randomUUID(),
            company: comp,
            reason: v.reason,
            score: v.score,
            status: 'pending',
          };
        });
      delete c.candidates;
      c.cursor = 0;
      c.stage = c.leads.length ? 'contacts' : 'done';
      c.note = `${c.leads.length} de 10 empresas selecionadas com base nos dados da Lusha.${c.leads.length < 10 ? ' A busca não encontrou 10 empresas com adequação suficiente.' : ''}`;
    }
  } else if (c.stage === 'contacts') {
    const lead = c.leads[c.cursor];
    if (!lead) {
      c.stage = 'drafts';
      c.cursor = 0;
      return c;
    }
    // Work email requirement avoids personal addresses and unverified guessed patterns.
    const search = await lusha(keys.lushaKey, 'contacts/prospecting', {
      pagination: { page: 0, size: 5 },
      filters: {
        companies: { include: { ids: [lead.company.id] } },
        contacts: {
          include: {
            jobTitles: c.profile!.titles,
            existingDataPoints: ['work_email'],
          },
        },
      },
      options: { maxContactsPerCompany: 5 },
    });
    const candidates = results(search).filter(
      (v) =>
        !v.error &&
        v.id &&
        (String(v.company?.id) === lead.company.id ||
          (lead.company.domain &&
            safeDomain(v.company?.domain) === lead.company.domain)),
    );
    if (!candidates.length) {
      lead.status = 'skipped';
      lead.issue =
        'Nenhum contato com cargo relevante e e-mail profissional disponível nesta busca.';
    } else {
      const choice = await ai<{ ids: string[] }>(
        keys.anthropicKey,
        'contato_relevante',
        obj({
          ids: arr({
            type: 'string',
            enum: candidates.map((v) => String(v.id)),
          }),
        }),
        'Escolha até 3 contatos mais relevantes para uma conversa comercial sobre este produto, em ordem. Considere cargo e possível participação na decisão. Retorne IDs únicos, somente dos candidatos. Se nenhum cargo for relevante, retorne lista vazia.',
        {
          software: c.input.description,
          company: lead.company,
          candidates: candidates.map((v) => ({
            id: String(v.id),
            name: [v.firstName, v.lastName].filter(Boolean).join(' '),
            title: v.jobTitle,
          })),
        },
      );
      const ids = [...new Set(choice.ids)]
        .filter((id) => candidates.some((v) => String(v.id) === id))
        .slice(0, 3);
      if (ids.length) {
        const enriched = results(
          await lusha(keys.lushaKey, 'contacts/enrich', {
            ids,
            reveal: ['emails'],
            waterfallEnabled: false,
          }),
        );
        for (const id of ids) {
          const raw = enriched.find((v) => String(v.id) === id);
          if (!raw || raw.error) continue;
          if (
            String(raw.company?.id) !== lead.company.id &&
            (!lead.company.domain ||
              safeDomain(raw.company?.domain) !== lead.company.domain)
          )
            continue;
          const email = workEmail(raw);
          if (
            !email ||
            c.leads.some((v) => v.id !== lead.id && v.email === email)
          )
            continue;
          const source = candidates.find((v) => String(v.id) === id)!;
          const name = String(
            raw.fullName ||
              [
                raw.firstName || source.firstName,
                raw.lastName || source.lastName,
              ]
                .filter(Boolean)
                .join(' '),
          );
          if (!name.trim()) continue;
          lead.contact = {
            id,
            name,
            title: String(raw.jobTitle?.title || source.jobTitle?.title || ''),
          };
          lead.email = email;
          break;
        }
      }
      if (!lead.email) {
        lead.status = 'skipped';
        lead.issue =
          'Nenhum e-mail profissional utilizável foi retornado para os contatos relevantes.';
      }
    }
    c.cursor++;
    c.note = `Contatos verificados em ${c.cursor} de ${c.leads.length} empresas.`;
    if (c.cursor >= c.leads.length) {
      c.stage = 'drafts';
      c.cursor = 0;
    }
  } else if (c.stage === 'drafts') {
    const lead = c.leads[c.cursor];
    if (lead?.email && lead.contact && lead.status === 'pending') {
      const draft = await ai<{ subject: string; body: string }>(
        keys.anthropicKey,
        'email_personalizado',
        obj({ subject: str, body: str }),
        'Escreva um primeiro e-mail comercial em português, de 80 a 150 palavras, respeitoso e direto. Use o primeiro nome do contato, um fato específico dos dados da empresa e conecte a uma funcionalidade real do software. Apresente a hipótese de benefício como possibilidade. Considere o cargo. Um único convite para conversa. Não invente notícias, clientes, métricas, uso de ferramentas ou dores confirmadas. Texto simples, sem HTML ou markdown, sem placeholders. Não inclua assinatura nem descadastro (o servidor adicionará). Assunto até 100 caracteres, sem quebras de linha.',
        {
          software: { name: c.input.name, description: c.input.description },
          sender: c.input.senderName,
          company: lead.company,
          contact: lead.contact,
          reason: lead.reason,
          invitation: c.input.signature,
        },
      );
      if (
        !draft.subject.trim() ||
        draft.subject.length > 200 ||
        /[\r\n]/.test(draft.subject) ||
        !draft.body.trim() ||
        draft.body.length > 4500
      )
        throw new AppError(
          'O e-mail gerado está fora do formato permitido. Retome para gerar novamente.',
          502,
        );
      lead.subject = draft.subject.trim();
      lead.body = `${draft.body.trim()}\n\n${c.input.senderName}\n${c.input.signature}\n\nSe preferir não receber novos contatos, basta responder a este e-mail.`;
      lead.status = 'ready';
    }
    c.cursor++;
    c.note = `Personalização processada em ${Math.min(c.cursor, c.leads.length)} de ${c.leads.length} empresas.`;
    if (c.cursor >= c.leads.length) {
      const ready = c.leads.filter((l) => l.status === 'ready').length;
      c.stage = ready ? (c.input.autoSend ? 'send' : 'review') : 'done';
      c.cursor = 0;
      c.note = ready
        ? `${ready} e-mail(s) personalizado(s) pronto(s).`
        : 'Nenhum e-mail disponível para envio nesta campanha.';
    }
  }
  return c;
}
