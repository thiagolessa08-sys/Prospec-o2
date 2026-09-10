import { advance } from '@/lib/pipeline';
import { syncResendDeliveryEvents } from '@/lib/resend-tracking';
import { isSameOriginRequest } from '@/lib/request-security';
import { AppError, campaignInput, textValue } from '@/lib/validation';
import {
  settingsView,
  listCampaigns,
  saveCredentials,
  createCampaign,
  withCampaign,
  getCredentials,
  deliveryStore,
} from '@/lib/storage';

const headers = {
  'Cache-Control': 'no-store',
  'X-Content-Type-Options': 'nosniff',
};
function json(data: unknown, status = 200) {
  return Response.json(data, { status, headers });
}
function failure(error: unknown) {
  return json(
    {
      error:
        error instanceof AppError
          ? error.message
          : 'Não foi possível concluir esta operação. Verifique a configuração do servidor e tente novamente.',
    },
    error instanceof AppError ? error.status : 500,
  );
}
export async function GET() {
  try {
    const [settings, campaigns] = await Promise.all([
      settingsView(),
      listCampaigns(),
    ]);
    return json({ settings, campaigns });
  } catch (e) {
    return failure(e);
  }
}
export async function POST(request: Request) {
  try {
    // Sites supplies owner-only access at the perimeter. Railway requests arrive through a proxy.
    // In both runtimes, writes require same-origin JSON.
    if (!isSameOriginRequest(request))
      throw new AppError('Origem da solicitação não permitida.', 403);
    if (!request.headers.get('content-type')?.startsWith('application/json'))
      throw new AppError('Formato de solicitação inválido.', 415);
    const content = await request.text();
    if (content.length > 24000)
      throw new AppError('Solicitação muito grande.', 413);
    let raw: Record<string, unknown>;
    try {
      raw = JSON.parse(content);
    } catch {
      throw new AppError('JSON inválido.');
    }
    if (!raw || typeof raw !== 'object' || Array.isArray(raw))
      throw new AppError('Solicitação inválida.');
    if (raw.action === 'settings')
      return json({ settings: await saveCredentials(raw) });
    if (raw.action === 'sync-delivery') {
      const resendKey = (await getCredentials()).resendKey;
      if (!resendKey) throw new AppError('Configure o Resend em Conexões.');
      const sync = await syncResendDeliveryEvents(resendKey);
      return json({ campaigns: await listCampaigns(), sync });
    }
    if (raw.action === 'create') {
      if (!raw.input || typeof raw.input !== 'object')
        throw new AppError('Preencha os dados do software.');
      const input = campaignInput(raw.input as Record<string, unknown>);
      const settings = await settingsView();
      if (
        !settings.connected.lushaKey ||
        !settings.connected.anthropicKey ||
        (input.autoSend && !settings.connected.resendKey)
      )
        throw new AppError(
          'Configure as conexões necessárias antes de iniciar.',
        );
      return json({
        campaign: await createCampaign({
          id: crypto.randomUUID(),
          createdAt: new Date().toISOString(),
          input,
          stage: 'analyze',
          cursor: 0,
          note: 'Campanha criada. Preparando a análise do software.',
          leads: [],
        }),
      });
    }
    if (
      !['advance', 'retry-broader', 'start-send', 'edit'].includes(
        String(raw.action),
      )
    )
      throw new AppError('Ação desconhecida.');
    const id = textValue(raw.id, 'Campanha', 36, 36);
    const campaign = await withCampaign(id, async (c) => {
      if (raw.action === 'advance')
        return advance(c, await getCredentials(), deliveryStore);
      if (raw.action === 'retry-broader') {
        if (c.stage !== 'done' || c.leads.length || !c.profile)
          throw new AppError('Esta campanha não pode refazer a busca.', 409);
        c.profile.minEmployees = 0;
        c.profile.maxEmployees = 0;
        c.broadSearch = true;
        c.stage = 'companies';
        c.cursor = 0;
        c.note = 'Preparando uma busca mais ampla na Lusha.';
        return c;
      }
      if (raw.action === 'start-send') {
        if (c.stage !== 'review' || !c.leads.some((l) => l.status === 'ready'))
          throw new AppError(
            'Não há mensagens prontas para envio nesta campanha.',
            409,
          );
        if (!(await settingsView()).connected.resendKey)
          throw new AppError('Configure o Resend em Conexões.');
        c.stage = 'send';
        c.cursor = 0;
        c.note = 'Envio iniciado.';
        return c;
      }
      const lead = c.leads.find((l) => l.id === raw.leadId);
      if (c.stage !== 'review' || !lead || lead.status !== 'ready')
        throw new AppError('Este e-mail não pode mais ser alterado.', 409);
      lead.subject = textValue(raw.subject, 'Assunto', 1, 200);
      if (/[\r\n]/.test(lead.subject))
        throw new AppError('O assunto não pode ter quebras de linha.');
      lead.body = textValue(raw.body, 'Mensagem', 10, 6000);
      return c;
    });
    return json({ campaign });
  } catch (e) {
    return failure(e);
  }
}
