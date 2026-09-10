import type { Campaign, Lead } from './types';
import {
  ai,
  arr,
  obj,
  str,
  lusha,
  results,
  workEmail,
  industryIds,
  resolveMainIndustryIds,
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

function escapeHtml(value: string) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

export function textEmailHtml(text: string) {
  const linked = text
    .split(/(https?:\/\/[^\s<>"']+)/g)
    .map((part) =>
      /^https?:\/\//.test(part)
        ? `<a href="${escapeHtml(part)}">${escapeHtml(part)}</a>`
        : escapeHtml(part),
    )
    .join('')
    .replaceAll('\n', '<br>');
  return `<div style="font-family:Arial,sans-serif;font-size:16px;line-height:1.6;color:#10243e">${linked}</div>`;
}

export function explicitEmployeeRange(text: string) {
  const normalized = text.toLowerCase().replace(/\./g, '');
  const employee = '(?:funcionários|funcionarios|colaboradores|employees)';
  const range = normalized.match(
    new RegExp(
      `(?:entre\\s+)?(\\d{1,7})\\s*(?:a|e|até|ate|[-–])\\s*(\\d{1,7})\\s+${employee}`,
    ),
  );
  if (range) return { min: Number(range[1]), max: Number(range[2]) };
  const minimum = normalized.match(
    new RegExp(
      `(?:mais de|acima de|mínimo de|minimo de|a partir de)\\s*(\\d{1,7})\\s+${employee}`,
    ),
  );
  const plus = normalized.match(new RegExp(`(\\d{1,7})\\+\\s*${employee}`));
  const maximum = normalized.match(
    new RegExp(
      `(?:até|ate|menos de|máximo de|maximo de)\\s*(\\d{1,7})\\s+${employee}`,
    ),
  );
  return {
    min: Number(minimum?.[1] || plus?.[1] || 0),
    max: Number(maximum?.[1] || 0),
  };
}

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
        html: textEmailHtml(lead.body),
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
    const acceptedAt = new Date().toISOString();
    lead.delivery = {
      ...lead.delivery,
      acceptedAt,
      lastEvent: 'email.sent',
      lastEventAt: acceptedAt,
    };
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
    const resolvedIndustryIds = resolveMainIndustryIds(
      c.profile.industryIds,
      c.profile.industries,
      catalog.values,
    );
    if (
      !resolvedIndustryIds.length ||
      resolvedIndustryIds.length > 4 ||
      resolvedIndustryIds.some((id) => !allowed.has(id))
    )
      throw new AppError(
        'A IA selecionou um setor inválido. Retome a análise.',
        502,
      );
    c.profile.industryIds = resolvedIndustryIds;
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
    const explicitSize = explicitEmployeeRange(
      `${c.input.description} ${c.input.market}`,
    );
    c.profile.minEmployees = explicitSize.min;
    c.profile.maxEmployees = explicitSize.max;
    c.stage = 'companies';
    c.cursor = 0;
    c.note = 'Perfil de cliente definido. Preparando a busca de empresas.';
  } else if (c.stage === 'companies') {
    if (!c.profile) throw new AppError('Perfil da campanha não encontrado.');
    const companyFilters: Json = { mainIndustriesIds: c.profile.industryIds };
    if (c.profile.country)
      companyFilters.locations = [{ country: c.profile.country }];
    if (!c.broadSearch && (c.profile.minEmployees || c.profile.maxEmployees))
      companyFilters.sizes = [
        {
          ...(c.profile.minEmployees ? { min: c.profile.minEmployees } : {}),
          ...(c.profile.maxEmployees ? { max: c.profile.maxEmployees } : {}),
        },
      ];

    // One bulk prospecting call yields a decision-maker preview and its company.
    // This replaces 30 company enrichments plus one contact search per company.
    const search = await lusha(keys.lushaKey, 'contacts/prospecting', {
      pagination: { page: 0, size: 25 },
      filters: {
        companies: { include: companyFilters },
        contacts: {
          include: {
            ...(!c.broadSearch ? { jobTitles: c.profile.titles } : {}),
            existingDataPoints: ['work_email'],
          },
        },
      },
      options: { maxContactsPerCompany: c.broadSearch ? 3 : 1 },
    });
    const rawResults = results(search);
    if (!rawResults.length && !c.broadSearch) {
      c.broadSearch = true;
      c.note =
        'A busca específica não encontrou resultados. Tentando novamente sem porte e cargos rígidos.';
      return c;
    }
    const seenContacts = new Set<string>();
    const candidates = rawResults.flatMap((raw) => {
      const companyId = String(raw.company?.id || '');
      const contactId = String(raw.id || '');
      const name = [raw.firstName, raw.lastName]
        .filter(Boolean)
        .join(' ')
        .trim();
      const companyName = String(raw.company?.name || '').trim();
      const domain = safeDomain(raw.company?.domain);
      if (
        raw.error ||
        !companyId ||
        !contactId ||
        !companyName ||
        seenContacts.has(contactId)
      )
        return [];
      seenContacts.add(contactId);
      return [
        {
          contactId,
          contactName: name,
          contactTitle: String(raw.jobTitle?.title || ''),
          contactLocation: raw.location || {},
          company: {
            id: companyId,
            name: companyName.slice(0, 300),
            domain,
            description: '',
            industry: c.profile!.industries.join(', ').slice(0, 300),
            country: c.profile!.country,
            employees:
              c.profile!.minEmployees || c.profile!.maxEmployees
                ? `${c.profile!.minEmployees || 1}–${c.profile!.maxEmployees || '+'}`
                : '',
          },
        },
      ];
    });
    if (!candidates.length) {
      c.stage = 'done';
      c.note =
        'A Lusha não retornou decisores com e-mail profissional disponível para este perfil. Crie uma campanha com um mercado mais amplo.';
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
            id: { type: 'string', enum: candidates.map((v) => v.contactId) },
            score: { type: 'integer', minimum: 0, maximum: 100 },
            reason: str,
          }),
        ),
      }),
      'Selecione até 10 empresas e respectivos decisores com melhor adequação ao software e mercado. Use somente as candidatas fornecidas e IDs únicos. Todas as candidatas já correspondem aos filtros de setor, porte e região do perfil; use isso e o cargo como evidência. Score é uma estimativa de adequação, não intenção de compra: inclua apenas score >= 60. Explique em até 350 caracteres sem afirmar dores confirmadas, intenção de compra, notícias, tecnologias ou fatos que não foram fornecidos.',
      { input: c.input, profile: c.profile, candidates },
    );
    const selected = new Set<string>();
    const selectedCompanies = new Set<string>();
    c.leads = ranked.choices
      .filter((choice) => {
        if (choice.score < 60 || selected.has(choice.id)) return false;
        const candidate = candidates.find((v) => v.contactId === choice.id);
        if (!candidate) return true;
        const companyKey = candidate.company.domain || candidate.company.id;
        if (selectedCompanies.has(companyKey)) return false;
        selected.add(choice.id);
        selectedCompanies.add(companyKey);
        return true;
      })
      .slice(0, 10)
      .map((choice) => {
        const candidate = candidates.find((v) => v.contactId === choice.id);
        if (!candidate)
          throw new AppError('A IA retornou um contato fora da busca.', 502);
        return {
          id: crypto.randomUUID(),
          company: candidate.company,
          contact: {
            id: candidate.contactId,
            name: candidate.contactName,
            title: candidate.contactTitle,
          },
          reason: choice.reason,
          score: choice.score,
          status: 'pending',
        };
      });
    delete c.candidates;
    c.cursor = 0;
    c.stage = c.leads.length ? 'contacts' : 'done';
    c.note = `${c.leads.length} de 10 empresas e decisores selecionados em uma única busca econômica.${c.leads.length < 10 ? ' Não havia 10 resultados com adequação suficiente.' : ''}`;
  } else if (c.stage === 'contacts') {
    const pending = c.leads.filter(
      (lead) => lead.status === 'pending' && lead.contact?.id,
    );
    if (!pending.length) {
      c.stage = 'drafts';
      c.cursor = 0;
      return c;
    }
    // A single bulk reveal keeps ten new work e-mails within a 12-credit budget:
    // one prospecting result block + one enrich result block + ten e-mail fields.
    const enriched = results(
      await lusha(keys.lushaKey, 'contacts/enrich', {
        ids: pending.map((lead) => lead.contact!.id),
        reveal: ['emails'],
        waterfallEnabled: false,
      }),
    );
    const usedEmails = new Set<string>();
    for (const lead of pending) {
      const contact = lead.contact!;
      const raw = enriched.find((v) => String(v.id) === contact.id);
      const sameCompany =
        raw &&
        (String(raw.company?.id) === lead.company.id ||
          (lead.company.domain &&
            safeDomain(raw.company?.domain) === lead.company.domain));
      const email = raw && sameCompany ? workEmail(raw) : undefined;
      if (raw && email && !usedEmails.has(email)) {
        const name = String(
          raw.fullName ||
            [raw.firstName, raw.lastName].filter(Boolean).join(' ') ||
            contact.name,
        ).trim();
        if (!name) {
          lead.status = 'skipped';
          lead.issue = 'A Lusha não retornou o nome deste contato.';
          continue;
        }
        contact.name = name;
        contact.title = String(
          raw.jobTitle?.title || raw.jobTitle || contact.title,
        );
        lead.email = email;
        usedEmails.add(email);
      } else {
        lead.status = 'skipped';
        lead.issue =
          'A Lusha não retornou um e-mail profissional utilizável para este contato.';
      }
    }
    c.stage = 'drafts';
    c.cursor = 0;
    c.note = `${c.leads.filter((lead) => lead.email).length} e-mail(s) profissional(is) revelado(s) em uma única consulta.`;
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
