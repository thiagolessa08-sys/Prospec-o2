'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import {
  ArrowRight,
  ArrowUpRight,
  Building2,
  Check,
  CircleDot,
  Cpu,
  History,
  Loader2,
  Mail,
  Orbit,
  Play,
  Plus,
  Settings2,
  Sparkles,
  Target,
  Users,
  X,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Switch } from '@/components/ui/switch';
import { Progress } from '@/components/ui/progress';
import type { Campaign, SettingsView } from '@/lib/types';

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
  const [edit, setEdit] = useState({ subject: '', body: '' });
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
  const field = (key: keyof typeof blank, value: string | boolean) =>
    setForm((f) => ({ ...f, [key]: value }));
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
                <section className="panel email-editor">
                  <div className="progress-top">
                    <div>
                      <p className="eyebrow">MENSAGEM PERSONALIZADA</p>
                      <h2>Para {lead.contact?.name}</h2>
                      <p>
                        {lead.email} · {lead.company.name}
                      </p>
                    </div>
                    <Button
                      variant="ghost"
                      aria-label="Fechar e-mail"
                      onClick={() => setSelected(null)}
                    >
                      <X />
                    </Button>
                  </div>
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
                </section>
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
              <button
                className="panel history-item"
                key={c.id}
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
