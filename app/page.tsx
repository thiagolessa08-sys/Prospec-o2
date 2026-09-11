'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import {
  ArrowRight,
  ArrowUpRight,
  Activity,
  Building2,
  Check,
  CheckCheck,
  CircleX,
  CircleDot,
  Cpu,
  History,
  Eye,
  Loader2,
  Mail,
  MousePointerClick,
  Orbit,
  Pencil,
  Play,
  Plus,
  RefreshCw,
  Settings2,
  Sparkles,
  Target,
  Trash2,
  Users,
  X,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Switch } from '@/components/ui/switch';
import { Progress } from '@/components/ui/progress';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import type { Campaign, CampaignInput, SettingsView } from '@/lib/types';
import { deliveryFlags } from '@/lib/delivery-tracking';

async function api(body?: unknown) {
  const res = await fetch(
    '/api/workspace',
    body
      ? {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        }
      : {},
  );
  const data = (await res.json()) as {
    error?: string;
    settings: SettingsView;
    campaigns: Campaign[];
    campaign: Campaign;
    sync?: { matched: number; stored: number };
  };
  if (!res.ok)
    throw new Error(
      data.error || 'Não foi possível concluir. Tente novamente.',
    );
  return data;
}
const steps = [
  'Entender o software',
  'Encontrar empresas',
  'Buscar contatos',
  'Personalizar e-mails',
  'Enviar',
];
const blank = {
  name: '',
  description: '',
  market: 'Brasil',
  senderName: '',
  senderEmail: '',
  signature: '',
  autoSend: false,
};
const connections = [
  {
    key: 'lushaKey',
    name: 'Lusha',
    desc: 'Empresas, decisores e e-mails profissionais.',
    url: 'https://dashboard.lusha.com',
  },
  {
    key: 'anthropicKey',
    name: 'Anthropic',
    desc: 'Análise do seu software e personalização.',
    url: 'https://platform.claude.com/settings/keys',
  },
  {
    key: 'resendKey',
    name: 'Resend',
    desc: 'Envio com seu domínio verificado.',
    url: 'https://resend.com/api-keys',
  },
];

function eventTime(value?: string) {
  if (!value) return 'Aguardando';
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? 'Registrado'
    : date.toLocaleString('pt-BR', {
        day: '2-digit',
        month: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
      });
}

export default function Home() {
  const [tab, setTab] = useState('campaign');
  const [form, setForm] = useState(blank);
  const [settings, setSettings] = useState<SettingsView | null>(null);
  const [credentials, setCredentials] = useState<Record<string, string>>({});
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [active, setActive] = useState<Campaign | null>(null);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [selected, setSelected] = useState<string | null>(null);
  const [trackingCampaignId, setTrackingCampaignId] = useState('');
  const [trackingLoading, setTrackingLoading] = useState(false);
  const [trackingRefresh, setTrackingRefresh] = useState(0);
  const [edit, setEdit] = useState({ subject: '', body: '' });
  const [campaignEdit, setCampaignEdit] = useState<Campaign | null>(null);
  const [campaignDraft, setCampaignDraft] = useState<CampaignInput>(blank);
  const [campaignToDelete, setCampaignToDelete] = useState<Campaign | null>(
    null,
  );
  const stop = useRef(false);
  const refresh = async () => {
    const data = await api();
    setSettings(data.settings);
    setCampaigns(data.campaigns);
    return data;
  };
  useEffect(() => {
    let mounted = true;
    api()
      .then((data) => {
        if (mounted) {
          setSettings(data.settings);
          setCampaigns(data.campaigns);
        }
      })
      .catch((e) => {
        if (mounted) setError(e.message);
      })
      .finally(() => {
        if (mounted) setLoading(false);
      });
    return () => {
      mounted = false;
    };
  }, []);
  useEffect(() => {
    if (tab !== 'tracking' || !settings?.connected.resendKey) return;
    let mounted = true;
    const sync = async () => {
      setTrackingLoading(true);
      try {
        const data = await api({ action: 'sync-delivery' });
        if (!mounted) return;
        setCampaigns(data.campaigns);
        setActive((current) =>
          current
            ? data.campaigns.find((campaign) => campaign.id === current.id) ||
              current
            : current,
        );
      } catch (e) {
        if (mounted) setError((e as Error).message);
      } finally {
        if (mounted) setTrackingLoading(false);
      }
    };
    void sync();
    const interval = window.setInterval(() => void sync(), 30000);
    return () => {
      mounted = false;
      window.clearInterval(interval);
    };
  }, [tab, settings?.connected.resendKey, trackingRefresh]);
  const field = (key: keyof typeof blank, value: string | boolean) =>
    setForm((f) => ({ ...f, [key]: value }));
  const campaignField = (
    key: keyof CampaignInput,
    value: string | boolean,
  ) => setCampaignDraft((current) => ({ ...current, [key]: value }));
  const safe = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await fn();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  async function run(c: Campaign) {
    stop.current = false;
    setActive(c);
    while (!stop.current && !['review', 'done'].includes(c.stage)) {
      c = (await api({ action: 'advance', id: c.id })).campaign;
      setActive(c);
    }
    await refresh();
  }
  const connected = connections.filter(
    (f) => settings?.connected[f.key],
  ).length;
  const lead = active?.leads.find((l) => l.id === selected);
  const trackingCampaign =
    campaigns.find((campaign) => campaign.id === trackingCampaignId) ||
    campaigns.find((campaign) =>
      campaign.leads.some((item) => item.providerId),
    ) ||
    campaigns[0];
  const trackedLeads =
    trackingCampaign?.leads.filter((item) => item.providerId) || [];
  const trackingHasEvents = trackedLeads.some(
    (item) => item.delivery?.lastEventAt,
  );
  const trackingTotals = trackedLeads.reduce(
    (totals, item) => {
      const flags = deliveryFlags(item.delivery);
      totals.delivered += Number(flags.delivered);
      totals.opened += Number(flags.opened);
      totals.clicked += Number(flags.clicked);
      totals.bounced += Number(flags.bounced);
      return totals;
    },
    { delivered: 0, opened: 0, clicked: 0, bounced: 0 },
  );
  const stageIndex = active
    ? Math.max(
        0,
        ['analyze', 'companies', 'contacts', 'drafts', 'send', 'done'].indexOf(
          active.stage === 'review' ? 'send' : active.stage,
        ),
      )
    : 0;
  return (
    <div className="app-shell">
      <header className="topbar">
        <Link className="brand" href="/">
          <span className="brand-icon">
            <Orbit size={23} />
          </span>
          órbita<span className="brand-label">PROSPECÇÃO</span>
        </Link>
        <div className="top-right">
          <span className="private-label">
            <CircleDot size={14} /> Espaço privado
          </span>
          <span className="avatar">TL</span>
        </div>
      </header>
      <Tabs
        value={tab}
        onValueChange={(v) => {
          setTab(String(v));
          setError('');
        }}
        className="workspace"
      >
        <div className="workspace-nav">
          <TabsList variant="line" className="nav-tabs">
            <TabsTrigger value="campaign">
              <Target /> Campanha
            </TabsTrigger>
            <TabsTrigger value="history">
              <History /> Histórico
            </TabsTrigger>
            <TabsTrigger value="tracking">
              <Activity /> Acompanhamento
            </TabsTrigger>
            <TabsTrigger value="settings">
              <Settings2 /> Conexões{' '}
              <span className="nav-count">{connected}/3</span>
            </TabsTrigger>
          </TabsList>
          <span className="workspace-label">
            SEU PRÓXIMO CLIENTE COMEÇA AQUI
          </span>
        </div>
        {error && (
          <div role="alert" className="message error">
            <span>{error}</span>
            <button aria-label="Fechar aviso" onClick={() => setError('')}>
              <X size={18} />
            </button>
          </div>
        )}
        {notice && <output className="message success">{notice}</output>}
        <TabsContent value="campaign">
          <div className="page-heading">
            <div>
              <p className="eyebrow">DO PRODUTO À CONVERSA</p>
              <h1>
                {active
                  ? active.input.name
                  : 'Encontre quem precisa do seu software.'}
              </h1>
              <p>
                {active
                  ? `Campanha criada em ${new Date(active.createdAt).toLocaleDateString('pt-BR')} · ${active.input.market}`
                  : 'Conte o que você resolve. A IA conecta sua solução às empresas certas.'}
              </p>
            </div>
            {active && (
              <Button
                variant="outline"
                disabled={busy}
                onClick={() => {
                  setActive(null);
                  setSelected(null);
                }}
              >
                <Plus size={16} /> Nova campanha
              </Button>
            )}
          </div>
          {!active ? (
            <div className="creation-grid">
              <section className="panel briefing">
                <div className="section-heading">
                  <span className="number">01</span>
                  <div>
                    <h2>Apresente seu software</h2>
                    <p>Quanto mais contexto, melhor a conexão.</p>
                  </div>
                  <Sparkles className="heading-icon" size={22} />
                </div>
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    void safe(async () => {
                      const data = await api({ action: 'create', input: form });
                      await run(data.campaign);
                    });
                  }}
                >
                  <label htmlFor="software-name">Nome do software</label>
                  <Input
                    id="software-name"
                    required
                    maxLength={120}
                    placeholder="Como se chama sua solução?"
                    value={form.name}
                    onChange={(e) => field('name', e.target.value)}
                  />
                  <label htmlFor="software-description">
                    O que ele faz e qual problema resolve?
                  </label>
                  <Textarea
                    id="software-description"
                    className="description-input"
                    required
                    minLength={60}
                    maxLength={12000}
                    placeholder="Ex.: Nosso software automatiza a gestão de estoques para redes de varejo. Integra lojas e centros de distribuição, prevê reposição e reduz rupturas. É ideal para operações com várias unidades..."
                    value={form.description}
                    onChange={(e) => field('description', e.target.value)}
                  />
                  <div className="input-hint">
                    <span>
                      Inclua funcionalidades, diferenciais e perfil de cliente.
                    </span>
                    <span>{form.description.length}/12.000</span>
                  </div>
                  <label htmlFor="market">Mercado e região de atuação</label>
                  <Input
                    id="market"
                    required
                    maxLength={300}
                    value={form.market}
                    onChange={(e) => field('market', e.target.value)}
                    placeholder="Ex.: Brasil, varejo, empresas com 50 a 500 funcionários"
                  />
                  <div className="form-divider" />
                  <h3>Quem inicia a conversa</h3>
                  <div className="two-columns">
                    <div>
                      <label htmlFor="sender-name">Seu nome</label>
                      <Input
                        id="sender-name"
                        required
                        maxLength={100}
                        value={form.senderName}
                        onChange={(e) => field('senderName', e.target.value)}
                        placeholder="Nome e sobrenome"
                      />
                    </div>
                    <div>
                      <label htmlFor="sender-email">E-mail de envio</label>
                      <Input
                        id="sender-email"
                        type="email"
                        required
                        value={form.senderEmail}
                        onChange={(e) => field('senderEmail', e.target.value)}
                        placeholder="voce@suaempresa.com.br"
                      />
                    </div>
                  </div>
                  <label htmlFor="signature">Assinatura e convite</label>
                  <Textarea
                    id="signature"
                    required
                    maxLength={1500}
                    value={form.signature}
                    onChange={(e) => field('signature', e.target.value)}
                    placeholder="Sua empresa, cargo e convite para uma conversa. Se quiser, inclua seu link de agenda."
                  />
                  <div className="auto-send">
                    <div>
                      <label htmlFor="auto-send">Enviar automaticamente</label>
                      <p>
                        {form.autoSend
                          ? 'Ao iniciar, os e-mails serão enviados após a personalização.'
                          : 'Desativado: você revisa os e-mails antes de enviar.'}
                      </p>
                    </div>
                    <Switch
                      id="auto-send"
                      checked={form.autoSend}
                      onCheckedChange={(v) => field('autoSend', v)}
                    />
                  </div>
                  <Button
                    className="primary-action"
                    type="submit"
                    disabled={
                      busy ||
                      loading ||
                      !settings?.connected.lushaKey ||
                      !settings?.connected.anthropicKey ||
                      (form.autoSend && !settings?.connected.resendKey)
                    }
                  >
                    {busy ? (
                      <Loader2 className="spin" />
                    ) : (
                      <Sparkles size={18} />
                    )}
                    {busy
                      ? 'Preparando campanha…'
                      : form.autoSend
                        ? 'Encontrar 10 empresas e enviar'
                        : 'Gerar campanha com 10 empresas'}
                    <ArrowRight size={18} />
                  </Button>
                  {connected < 3 && (
                    <p className="setup-hint">
                      {loading ? (
                        'Carregando conexões…'
                      ) : (
                        <button
                          type="button"
                          onClick={() => setTab('settings')}
                        >
                          Configure as conexões para começar{' '}
                          <ArrowUpRight size={14} />
                        </button>
                      )}
                    </p>
                  )}
                </form>
              </section>
              <aside className="process-column">
                <section className="process-card">
                  <span className="pill">
                    <span /> IA + LUSHA
                  </span>
                  <h2>
                    Uma descrição.
                    <br />
                    Dez novas oportunidades.
                  </h2>
                  <p className="process-intro">
                    Uma campanha com contexto em cada etapa.
                  </p>
                  <ol className="process-list">
                    {[
                      {
                        icon: Cpu,
                        title: 'Entende o seu produto',
                        text: 'Traduz sua solução em um perfil de cliente ideal.',
                      },
                      {
                        icon: Building2,
                        title: 'Seleciona 10 empresas',
                        text: 'Busca empresas e decisores em uma única consulta econômica.',
                      },
                      {
                        icon: Users,
                        title: 'Encontra a pessoa certa',
                        text: 'Prioriza um contato relevante por empresa e busca o e-mail profissional.',
                      },
                      {
                        icon: Mail,
                        title: 'Abre uma conversa',
                        text: 'Escreve uma mensagem individual e envia pelo seu domínio.',
                      },
                    ].map(({ icon: Icon, title, text }, i) => (
                      <li key={title}>
                        <span className="process-icon">
                          <Icon size={19} />
                        </span>
                        <div>
                          <span className="step-caption">ETAPA 0{i + 1}</span>
                          <h3>{title}</h3>
                          <p>{text}</p>
                        </div>
                      </li>
                    ))}
                  </ol>
                  <div className="process-footer">
                    <Target size={17} />
                    <span>Até 10 empresas · modo econômico de 12 créditos</span>
                  </div>
                </section>
                <section className="connection-summary">
                  <div className="summary-title">
                    <span>Suas conexões</span>
                    <button onClick={() => setTab('settings')}>
                      Configurar <ArrowUpRight size={14} />
                    </button>
                  </div>
                  {connections.map((f) => (
                    <div className="connection-row" key={f.key}>
                      <span>{f.name}</span>
                      <span
                        className={
                          settings?.connected[f.key] ? 'status good' : 'status'
                        }
                      >
                        <i />
                        {settings?.connected[f.key]
                          ? 'Configurada'
                          : 'A conectar'}
                      </span>
                    </div>
                  ))}
                </section>
                <p className="data-note">
                  Empresas e contatos vêm da Lusha. A disponibilidade depende da
                  sua conta, dos créditos e da cobertura da base.
                </p>
              </aside>
            </div>
          ) : (
            <>
              <section className="panel campaign-progress">
                <div className="progress-top">
                  <h2>
                    {busy
                      ? 'Sua campanha está em andamento'
                      : active.stage === 'review'
                        ? 'E-mails prontos para sua revisão'
                        : active.stage === 'done'
                          ? 'Campanha concluída'
                          : 'Campanha salva'}
                  </h2>
                  {busy ? (
                    <Button
                      variant="outline"
                      onClick={() => {
                        stop.current = true;
                      }}
                    >
                      Pausar após esta etapa
                    </Button>
                  ) : !['review', 'done'].includes(active.stage) ? (
                    <Button onClick={() => void safe(() => run(active))}>
                      <Play size={16} /> Continuar
                    </Button>
                  ) : active.stage === 'done' &&
                    active.leads.length === 0 &&
                    active.profile ? (
                    <Button
                      onClick={() =>
                        void safe(async () => {
                          const d = await api({
                            action: 'retry-broader',
                            id: active.id,
                          });
                          await run(d.campaign);
                        })
                      }
                    >
                      <Play size={16} /> Tentar busca mais ampla
                    </Button>
                  ) : (
                    active.stage === 'review' && (
                      <Button
                        disabled={!settings?.connected.resendKey}
                        onClick={() =>
                          void safe(async () => {
                            const d = await api({
                              action: 'start-send',
                              id: active.id,
                            });
                            await run(d.campaign);
                          })
                        }
                      >
                        <Mail size={16} /> Enviar e-mails prontos
                      </Button>
                    )
                  )}
                </div>
                <div className="stages">
                  {steps.map((s, i) => (
                    <div
                      key={s}
                      className={stageIndex >= i ? 'stage current' : 'stage'}
                    >
                      <span>
                        {stageIndex > i ? <Check size={14} /> : i + 1}
                      </span>
                      {s}
                    </div>
                  ))}
                </div>
                <Progress
                  value={
                    active.stage === 'done'
                      ? 100
                      : stageIndex * 20 + (active.cursor / 10) * 18
                  }
                />
                <p className="progress-note" aria-live="polite">
                  {active.note || 'Pronto para começar.'}
                  {busy &&
                    ' Mantenha esta página aberta; se fechar, você poderá retomar pelo histórico.'}
                </p>
              </section>
              {active.profile && (
                <section className="profile-strip">
                  <Sparkles size={22} />
                  <div>
                    <h3>O perfil que faz sentido</h3>
                    <p>{active.profile.summary}</p>
                  </div>
                </section>
              )}
              <div className="results-heading">
                <h2>
                  Empresas selecionadas <span>{active.leads.length}/10</span>
                </h2>
                <span>
                  {active.leads.filter((l) => l.email).length} contatos com
                  e-mail ·{' '}
                  {active.leads.filter((l) => l.status === 'sent').length}{' '}
                  enviados
                </span>
              </div>
              <div className="results-grid">
                {active.leads.map((l, i) => (
                  <article className="panel lead-card" key={l.id}>
                    <div className="lead-top">
                      <span className="company-initial">
                        {l.company.name.slice(0, 2).toUpperCase()}
                      </span>
                      <span className="match">
                        {l.score}% afinidade estimada
                      </span>
                    </div>
                    <span className="step-caption">
                      EMPRESA {String(i + 1).padStart(2, '0')}
                    </span>
                    <h3>{l.company.name}</h3>
                    {l.company.domain && (
                      <a
                        className="company-link"
                        href={'https://' + l.company.domain}
                        target="_blank"
                        rel="noreferrer"
                      >
                        {l.company.domain}
                        <ArrowUpRight size={12} />
                      </a>
                    )}
                    <p className="reason">{l.reason}</p>
                    <div className="contact-line">
                      <Users size={17} />
                      <div>
                        <strong>
                          {l.contact?.name || 'Contato ainda não localizado'}
                        </strong>
                        <span>
                          {l.contact?.title || l.issue || 'Aguardando busca'}
                        </span>
                        {l.email && <span>{l.email}</span>}
                      </div>
                    </div>
                    <div className="lead-bottom">
                      <span
                        className={
                          'status ' + (l.status === 'sent' ? 'good' : '')
                        }
                      >
                        <i />
                        {
                          (
                            {
                              pending: 'Em preparação',
                              ready: 'Pronto',
                              sent: 'Enviado ao provedor',
                              skipped: 'Sem e-mail',
                              failed: 'Falha no envio',
                              uncertain: 'Verificar no Resend',
                              sending: 'Envio em andamento',
                            } as Record<string, string>
                          )[l.status]
                        }
                      </span>
                      {l.subject && (
                        <Button
                          variant="ghost"
                          size="sm"
                          disabled={busy}
                          onClick={() => {
                            setSelected(l.id);
                            setEdit({
                              subject: l.subject || '',
                              body: l.body || '',
                            });
                          }}
                        >
                          Ver e-mail <ArrowRight size={14} />
                        </Button>
                      )}
                    </div>
                    {l.issue && <p className="lead-issue">{l.issue}</p>}
                  </article>
                ))}
              </div>
              {lead && (
                <Dialog
                  open={Boolean(lead)}
                  onOpenChange={(open) => {
                    if (!open) setSelected(null);
                  }}
                >
                  <DialogContent className="email-editor max-h-[calc(100vh-2rem)] overflow-y-auto sm:max-w-2xl">
                    <DialogHeader>
                      <p className="eyebrow">MENSAGEM PERSONALIZADA</p>
                      <DialogTitle>Para {lead.contact?.name}</DialogTitle>
                      <DialogDescription>
                        {lead.email} · {lead.company.name}
                      </DialogDescription>
                    </DialogHeader>
                    <label htmlFor="subject">Assunto</label>
                    <Input
                      id="subject"
                      value={edit.subject}
                      maxLength={200}
                      readOnly={lead.status !== 'ready'}
                      onChange={(e) =>
                        setEdit((v) => ({ ...v, subject: e.target.value }))
                      }
                    />
                    <label htmlFor="body">E-mail</label>
                    <Textarea
                      id="body"
                      className="email-body"
                      value={edit.body}
                      maxLength={6000}
                      readOnly={lead.status !== 'ready'}
                      onChange={(e) =>
                        setEdit((v) => ({ ...v, body: e.target.value }))
                      }
                    />
                    {lead.status === 'ready' && (
                      <Button
                        disabled={busy}
                        onClick={() =>
                          void safe(async () => {
                            const d = await api({
                              action: 'edit',
                              id: active.id,
                              leadId: lead.id,
                              ...edit,
                            });
                            setActive(d.campaign);
                            setNotice('E-mail atualizado.');
                          })
                        }
                      >
                        Salvar alterações
                      </Button>
                    )}
                  </DialogContent>
                </Dialog>
              )}
            </>
          )}
        </TabsContent>
        <TabsContent value="history">
          <div className="page-heading">
            <div>
              <p className="eyebrow">CONVERSAS EM CONSTRUÇÃO</p>
              <h1>Suas campanhas</h1>
              <p>
                Resultados e mensagens ficam salvos para você continuar de onde
                parou.
              </p>
            </div>
          </div>
          <div className="history-list">
            {campaigns.map((c) => (
              <div
                className="panel history-item"
                key={c.id}
              >
                <button
                  className="history-main"
                  disabled={busy}
                  onClick={() => {
                    setActive(c);
                    setSelected(null);
                    setTab('campaign');
                  }}
                >
                  <span className="company-initial">
                    <Target />
                  </span>
                  <div>
                    <h3>{c.input.name}</h3>
                    <p>
                      {new Date(c.createdAt).toLocaleDateString('pt-BR')} ·{' '}
                      {c.input.market}
                    </p>
                  </div>
                  <span>{c.leads.length} empresas</span>
                  <span className="status">
                    {c.stage === 'done'
                      ? 'Concluída'
                      : c.stage === 'review'
                        ? 'Pronta para revisão'
                        : 'Em preparação'}
                  </span>
                  <ArrowRight size={18} />
                </button>
                <div className="history-actions">
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={busy}
                    onClick={() => {
                      setCampaignEdit(c);
                      setCampaignDraft({ ...c.input });
                    }}
                  >
                    <Pencil size={14} /> Editar
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={busy}
                    onClick={() => setCampaignToDelete(c)}
                  >
                    <Trash2 size={14} /> Excluir
                  </Button>
                </div>
              </div>
            ))}
            {!campaigns.length && (
              <div className="panel empty-history">
                <History size={30} />
                <h2>
                  {loading
                    ? 'Carregando campanhas…'
                    : 'Sua primeira campanha começa com uma ideia.'}
                </h2>
                <p>
                  Descreva seu software para encontrar as primeiras
                  oportunidades.
                </p>
                <Button onClick={() => setTab('campaign')}>
                  Criar campanha <ArrowRight size={16} />
                </Button>
              </div>
            )}
          </div>
          {campaignEdit && (
            <Dialog
              open
              onOpenChange={(open) => {
                if (!open) setCampaignEdit(null);
              }}
            >
              <DialogContent className="campaign-editor max-h-[calc(100vh-2rem)] overflow-y-auto sm:max-w-2xl">
                <DialogHeader>
                  <p className="eyebrow">CONFIGURAÇÃO DA CAMPANHA</p>
                  <DialogTitle>Editar campanha</DialogTitle>
                  <DialogDescription>
                    Atualize os dados usados para identificar a campanha e o
                    remetente dos e-mails.
                  </DialogDescription>
                </DialogHeader>
                <form
                  className="campaign-edit-form"
                  onSubmit={(event) => {
                    event.preventDefault();
                    void safe(async () => {
                      const data = await api({
                        action: 'edit-campaign',
                        id: campaignEdit.id,
                        input: campaignDraft,
                      });
                      setCampaigns(data.campaigns);
                      setActive((current) =>
                        current?.id === campaignEdit.id
                          ? data.campaign
                          : current,
                      );
                      setCampaignEdit(null);
                      setNotice('Campanha atualizada.');
                    });
                  }}
                >
                  <label htmlFor="campaign-edit-name">Nome do software</label>
                  <Input
                    id="campaign-edit-name"
                    required
                    maxLength={120}
                    value={campaignDraft.name}
                    onChange={(event) =>
                      campaignField('name', event.target.value)
                    }
                  />
                  <label htmlFor="campaign-edit-description">
                    Descrição do software
                  </label>
                  <Textarea
                    id="campaign-edit-description"
                    required
                    minLength={60}
                    maxLength={12000}
                    value={campaignDraft.description}
                    onChange={(event) =>
                      campaignField('description', event.target.value)
                    }
                  />
                  <label htmlFor="campaign-edit-market">
                    Mercado e região
                  </label>
                  <Input
                    id="campaign-edit-market"
                    required
                    maxLength={300}
                    value={campaignDraft.market}
                    onChange={(event) =>
                      campaignField('market', event.target.value)
                    }
                  />
                  <div className="two-columns">
                    <div>
                      <label htmlFor="campaign-edit-sender-name">
                        Nome do remetente
                      </label>
                      <Input
                        id="campaign-edit-sender-name"
                        required
                        maxLength={100}
                        value={campaignDraft.senderName}
                        onChange={(event) =>
                          campaignField('senderName', event.target.value)
                        }
                      />
                    </div>
                    <div>
                      <label htmlFor="campaign-edit-sender-email">
                        E-mail de envio
                      </label>
                      <Input
                        id="campaign-edit-sender-email"
                        type="email"
                        required
                        value={campaignDraft.senderEmail}
                        onChange={(event) =>
                          campaignField('senderEmail', event.target.value)
                        }
                      />
                    </div>
                  </div>
                  <label htmlFor="campaign-edit-signature">
                    Assinatura e convite
                  </label>
                  <Textarea
                    id="campaign-edit-signature"
                    required
                    maxLength={1500}
                    value={campaignDraft.signature}
                    onChange={(event) =>
                      campaignField('signature', event.target.value)
                    }
                  />
                  <div className="campaign-edit-footer">
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => setCampaignEdit(null)}
                    >
                      Cancelar
                    </Button>
                    <Button type="submit" disabled={busy}>
                      Salvar campanha
                    </Button>
                  </div>
                </form>
              </DialogContent>
            </Dialog>
          )}
          <AlertDialog
            open={Boolean(campaignToDelete)}
            onOpenChange={(open) => {
              if (!open) setCampaignToDelete(null);
            }}
          >
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Excluir campanha?</AlertDialogTitle>
                <AlertDialogDescription>
                  A campanha “{campaignToDelete?.input.name}”, seus contatos e
                  mensagens salvas serão removidos permanentemente.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancelar</AlertDialogCancel>
                <AlertDialogAction
                  variant="destructive"
                  disabled={busy}
                  onClick={() => {
                    if (!campaignToDelete) return;
                    const id = campaignToDelete.id;
                    void safe(async () => {
                      const data = await api({
                        action: 'delete-campaign',
                        id,
                      });
                      setCampaigns(data.campaigns);
                      if (active?.id === id) {
                        setActive(null);
                        setTab('campaign');
                      }
                      setCampaignToDelete(null);
                      setNotice('Campanha excluída.');
                    });
                  }}
                >
                  Excluir campanha
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </TabsContent>
        <TabsContent value="tracking">
          <div className="page-heading tracking-heading">
            <div>
              <p className="eyebrow">DO ENVIO À RESPOSTA</p>
              <h1>Acompanhamento dos e-mails</h1>
              <p>
                Veja a entrega e as interações registradas pelo Resend para cada
                contato.
              </p>
            </div>
            <div className="tracking-actions">
              <label htmlFor="tracking-campaign">Campanha</label>
              <select
                id="tracking-campaign"
                value={trackingCampaign?.id || ''}
                onChange={(event) => setTrackingCampaignId(event.target.value)}
              >
                {campaigns.map((campaign) => (
                  <option key={campaign.id} value={campaign.id}>
                    {campaign.input.name} ·{' '}
                    {new Date(campaign.createdAt).toLocaleDateString('pt-BR')}
                  </option>
                ))}
              </select>
              <Button
                variant="outline"
                size="sm"
                disabled={trackingLoading || !settings?.connected.resendKey}
                onClick={() => setTrackingRefresh((value) => value + 1)}
              >
                <RefreshCw
                  size={15}
                  className={trackingLoading ? 'spin' : undefined}
                />
                Atualizar
              </Button>
            </div>
          </div>
          {trackingCampaign && trackedLeads.length ? (
            <>
              {!trackingHasEvents && (
                <output className="tracking-pending">
                  <Activity size={18} />
                  <div>
                    <strong>Dados de entrega ainda não sincronizados</strong>
                    <p>
                      Os e-mails foram enviados, mas a aplicação ainda não
                      recebeu o histórico de eventos do Resend. Os traços abaixo
                      não significam falha na entrega.
                    </p>
                  </div>
                </output>
              )}
              <section className="tracking-summary" aria-label="Resumo">
                <article className="panel tracking-metric">
                  <Mail size={18} />
                  <span>Enviados</span>
                  <strong>{trackedLeads.length}</strong>
                </article>
                <article className="panel tracking-metric delivered">
                  <CheckCheck size={18} />
                  <span>Entregues</span>
                  <strong>
                    {trackingHasEvents ? trackingTotals.delivered : '—'}
                  </strong>
                </article>
                <article className="panel tracking-metric opened">
                  <Eye size={18} />
                  <span>Abertos</span>
                  <strong>
                    {trackingHasEvents ? trackingTotals.opened : '—'}
                  </strong>
                </article>
                <article className="panel tracking-metric clicked">
                  <MousePointerClick size={18} />
                  <span>Cliques</span>
                  <strong>
                    {trackingHasEvents ? trackingTotals.clicked : '—'}
                  </strong>
                </article>
                <article className="panel tracking-metric bounced">
                  <CircleX size={18} />
                  <span>Devolvidos</span>
                  <strong>
                    {trackingHasEvents ? trackingTotals.bounced : '—'}
                  </strong>
                </article>
              </section>
              <div className="tracking-list">
                {trackedLeads.map((item) => {
                  const flags = deliveryFlags(item.delivery);
                  const current = flags.bounced
                    ? 'Devolvido'
                    : flags.clicked
                      ? 'Clicou'
                      : flags.opened
                        ? 'Aberto'
                        : flags.delivered
                          ? 'Entregue'
                          : item.delivery?.lastEventAt
                            ? 'Enviado'
                            : 'Sem dados de entrega';
                  return (
                    <article className="panel tracking-row" key={item.id}>
                      <div className="tracking-person">
                        <span className="company-initial">
                          {item.company.name.slice(0, 2).toUpperCase()}
                        </span>
                        <div>
                          <span className="tracking-current">{current}</span>
                          <h3>{item.company.name}</h3>
                          <p>
                            {item.contact?.name || 'Contato'} · {item.email}
                          </p>
                          {item.subject && <small>{item.subject}</small>}
                        </div>
                      </div>
                      <div className="tracking-status-grid">
                        <div
                          className={
                            flags.delivered
                              ? 'tracking-event done'
                              : 'tracking-event'
                          }
                        >
                          <CheckCheck size={17} />
                          <span>Entregue</span>
                          <small>
                            {eventTime(
                              item.delivery?.deliveredAt ||
                                item.delivery?.openedAt ||
                                item.delivery?.clickedAt,
                            )}
                          </small>
                        </div>
                        <div
                          className={
                            flags.opened
                              ? 'tracking-event done'
                              : 'tracking-event'
                          }
                        >
                          <Eye size={17} />
                          <span>Aberto</span>
                          <small>
                            {eventTime(
                              item.delivery?.openedAt ||
                                item.delivery?.clickedAt,
                            )}
                          </small>
                        </div>
                        <div
                          className={
                            flags.clicked
                              ? 'tracking-event done'
                              : 'tracking-event'
                          }
                        >
                          <MousePointerClick size={17} />
                          <span>Clicou</span>
                          <small>{eventTime(item.delivery?.clickedAt)}</small>
                        </div>
                        <div
                          className={
                            flags.bounced
                              ? 'tracking-event danger'
                              : 'tracking-event'
                          }
                        >
                          <CircleX size={17} />
                          <span>Devolvido</span>
                          <small>
                            {eventTime(
                              item.delivery?.bouncedAt ||
                                item.delivery?.failedAt ||
                                item.delivery?.suppressedAt,
                            )}
                          </small>
                        </div>
                      </div>
                    </article>
                  );
                })}
              </div>
              <p className="tracking-footnote">
                “Entregue” confirma que o servidor do destinatário aceitou a
                mensagem. Aberturas podem ser estimadas por recursos de
                privacidade do e-mail.
              </p>
            </>
          ) : (
            <div className="panel empty-history tracking-empty">
              <Activity size={30} />
              <h2>Ainda não há e-mails enviados para acompanhar.</h2>
              <p>
                Quando uma campanha for enviada, cada contato aparecerá aqui.
              </p>
              <Button onClick={() => setTab('campaign')}>
                Ver campanha <ArrowRight size={16} />
              </Button>
            </div>
          )}
        </TabsContent>
        <TabsContent value="settings">
          <div className="page-heading">
            <div>
              <p className="eyebrow">TUDO CONECTADO</p>
              <h1>Prepare suas conexões</h1>
              <p>
                As chaves são protegidas no servidor e nunca retornam ao
                navegador.
              </p>
            </div>
            <span className="pill light">{connected} de 3 configuradas</span>
          </div>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void safe(async () => {
                const d = await api({ action: 'settings', ...credentials });
                setSettings(d.settings);
                setCredentials({});
                setNotice(
                  'Conexões salvas. As credenciais serão verificadas ao usar cada serviço.',
                );
              });
            }}
          >
            <div className="settings-grid">
              {connections.map((f, i) => (
                <section className="panel settings-card" key={f.key}>
                  <span className="number">0{i + 1}</span>
                  <h2>{f.name}</h2>
                  <p>{f.desc}</p>
                  <label htmlFor={f.key}>Chave de API</label>
                  <Input
                    id={f.key}
                    type="password"
                    autoComplete="new-password"
                    disabled={settings?.managed[f.key]}
                    value={credentials[f.key] || ''}
                    placeholder={
                      settings?.managed[f.key]
                        ? 'Configurada no Railway'
                        : settings?.connected[f.key]
                          ? 'Configurada · preencha para substituir'
                          : 'Cole sua chave aqui'
                    }
                    onChange={(e) =>
                      setCredentials((v) => ({ ...v, [f.key]: e.target.value }))
                    }
                  />
                  <a href={f.url} target="_blank" rel="noreferrer">
                    Obter minha chave <ArrowUpRight size={14} />
                  </a>
                  <span
                    className={
                      'status ' + (settings?.connected[f.key] ? 'good' : '')
                    }
                  >
                    <i />
                    {settings?.managed[f.key]
                      ? 'Variável do Railway'
                      : settings?.connected[f.key]
                        ? 'Chave salva'
                        : 'Configuração pendente'}
                  </span>
                </section>
              ))}
            </div>
            <div className="settings-bottom">
              <p>
                Para enviar, verifique seu domínio no Resend e use um endereço
                desse domínio como remetente. Buscar e revelar dados consome
                créditos da sua conta Lusha.
              </p>
              <Button
                type="submit"
                disabled={busy || !Object.values(credentials).some(Boolean)}
              >
                {busy ? <Loader2 className="spin" /> : <Check size={16} />}{' '}
                Salvar conexões
              </Button>
            </div>
          </form>
        </TabsContent>
      </Tabs>
      <footer className="footer">
        <span>
          órbita <span>·</span> Prospecção com contexto
        </span>
        <span>Dados Lusha · Inteligência Anthropic</span>
      </footer>
    </div>
  );
}
