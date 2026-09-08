import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { advance, sendLead } from '../lib/pipeline.ts';
import { campaignInput, safeDomain } from '../lib/validation.ts';
import { workEmail } from '../lib/providers.ts';
import { encrypt, decrypt } from '../lib/crypto.ts';

const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
});
const input = {
  name: 'Estoque Teste',
  description:
    'Software de gestão de estoques que integra lojas e centros de distribuição para organizar a reposição de produtos.',
  market: 'Brasil, varejo',
  senderName: 'Pessoa Teste',
  senderEmail: 'sender@example.com',
  signature: 'Empresa Teste. Podemos conversar por 15 minutos?',
  autoSend: false,
};
const makeCampaign = () => ({
  id: crypto.randomUUID(),
  createdAt: new Date().toISOString(),
  input: { ...input },
  stage: 'analyze',
  cursor: 0,
  note: '',
  leads: [],
});
function memoryStore() {
  const receipts = new Map();
  return {
    receipts,
    async claim(id) {
      if (receipts.has(id)) return false;
      receipts.set(id, { status: 'sending' });
      return true;
    },
    async get(id) {
      return receipts.get(id) || null;
    },
    async finish(id, status, providerId) {
      receipts.set(id, { status, providerId });
    },
  };
}
function mockProviders(options = {}) {
  const calls = [];
  globalThis.fetch = async (url, init) => {
    const body = init.body ? JSON.parse(init.body) : {};
    calls.push({ url, body, headers: init.headers });
    const reply = (value) => Response.json(value);
    if (url.endsWith('industriesLabels'))
      return reply({
        values: [
          {
            id: 22,
            name: 'Retail',
            subIndustries: [{ id: 23, name: 'Retail Groceries' }],
          },
        ],
      });
    if (url.endsWith('/companies/prospecting')) {
      assert.deepEqual(body.filters.companies.include.mainIndustriesIds, [22]);
      assert.equal(
        body.filters.companies.include.locations[0].country,
        'Brazil',
      );
      return reply({
        results: Array.from({ length: options.companyCount ?? 12 }, (_, i) => ({
          id: `co${i}`,
          name: `Empresa Teste ${i}`,
          domain: `empresa${i}.example.com`,
          industry: 'Retail',
          location: { country: 'Brazil' },
        })),
      });
    }
    if (url.endsWith('/companies/enrich'))
      return reply({
        results: body.ids.map((id, i) => ({
          id,
          name: `Empresa Teste ${i}`,
          domain: `empresa${i}.example.com`,
          industry: 'Retail',
          description: 'Rede de varejo com lojas físicas.',
          location: { country: 'Brazil' },
        })),
      });
    if (url.endsWith('/contacts/prospecting')) {
      const id = body.filters.companies.include.ids[0];
      return reply({
        results: [
          {
            id: `person-${id}`,
            firstName: 'Pessoa',
            lastName: id,
            jobTitle: { title: 'Diretora de Operações' },
            company: { id },
          },
        ],
      });
    }
    if (url.endsWith('/contacts/enrich'))
      return reply({
        results: body.ids.map((id) => ({
          id,
          fullName: `Pessoa ${id}`,
          jobTitle: { title: 'Diretora de Operações' },
          company: { id: id.replace('person-', '') },
          emails: [
            {
              email: `${id}@example.com`,
              type: options.privateEmail ? 'private' : 'work',
              confidence: 'A+',
            },
          ],
        })),
      });
    if (url.endsWith('/responses')) {
      const prompt = JSON.parse(body.input);
      assert.equal(body.store, false);
      let value;
      switch (body.text.format.name) {
        case 'perfil_cliente':
          value = {
            summary: 'Varejistas com operação de estoque.',
            industries: ['Retail'],
            titles: ['Operations Director', 'Diretor de Operações'],
            country: 'Brazil',
            industryIds: [options.invalidIndustry ? 99999 : 22],
            minEmployees: 0,
            maxEmployees: 0,
          };
          break;
        case 'empresas_compativeis':
          value = {
            choices: prompt.companies
              .slice(0, 10)
              .map((c) => ({
                id: c.id,
                score: 80,
                reason:
                  'A operação de varejo pode se beneficiar da integração dos estoques.',
              })),
          };
          break;
        case 'contato_relevante':
          value = { ids: prompt.candidates.slice(0, 1).map((c) => c.id) };
          break;
        case 'email_personalizado':
          value = {
            subject: `Estoques na ${prompt.company.name}`,
            body: `Olá, ${prompt.contact.name}. A operação de varejo da ${prompt.company.name} pode se beneficiar da integração de estoques do ${prompt.software.name}. Podemos conversar?`,
          };
          break;
        default:
          throw new Error('Unexpected AI request');
      }
      return reply({
        status: 'completed',
        output: [
          {
            type: 'message',
            content: [{ type: 'output_text', text: JSON.stringify(value) }],
          },
        ],
      });
    }
    if (url.endsWith('/emails')) return reply({ id: 'mail-' + calls.length });
    throw new Error('Unexpected provider URL');
  };
  return calls;
}
const keys = {
  lushaKey: 'test-lusha',
  openaiKey: 'test-openai',
  resendKey: 'test-resend',
};
async function untilPaused(c, store) {
  for (let i = 0; i < 80 && !['review', 'done'].includes(c.stage); i++)
    c = await advance(c, keys, store);
  return c;
}

test('full campaign: 10 real provider records, unique contacts, personalized drafts, review before send, resumable sends', async () => {
  const calls = mockProviders();
  const store = memoryStore();
  let c = await untilPaused(makeCampaign(), store);
  assert.equal(c.stage, 'review');
  assert.equal(c.leads.length, 10);
  assert.equal(new Set(c.leads.map((l) => l.email)).size, 10);
  assert.equal(calls.filter((x) => x.url.endsWith('/emails')).length, 0);
  for (const lead of c.leads) {
    assert.equal(lead.status, 'ready');
    assert.ok(lead.body.includes(lead.company.name));
    assert.ok(lead.body.includes(input.name));
    assert.ok(lead.body.includes(input.senderName));
  }
  c = JSON.parse(JSON.stringify(c));
  c.stage = 'send';
  c = await untilPaused(c, store);
  assert.equal(c.stage, 'done');
  assert.equal(c.leads.filter((l) => l.status === 'sent').length, 10);
  const sends = calls.filter((x) => x.url.endsWith('/emails'));
  assert.equal(sends.length, 10);
  assert.ok(sends.every((s) => s.headers['Idempotency-Key']));
  c.leads[0].status = 'ready';
  await sendLead(c, c.leads[0], keys.resendKey, store);
  assert.equal(calls.filter((x) => x.url.endsWith('/emails')).length, 10);
});
test('automatic mode completes without a review pause', async () => {
  const calls = mockProviders({ companyCount: 2 });
  const c = makeCampaign();
  c.input.autoSend = true;
  const done = await untilPaused(c, memoryStore());
  assert.equal(done.stage, 'done');
  assert.equal(done.leads.length, 2);
  assert.equal(calls.filter((x) => x.url.endsWith('/emails')).length, 2);
});
test('personal-only email results are never sent or replaced with invented addresses', async () => {
  const calls = mockProviders({ privateEmail: true, companyCount: 1 });
  const done = await untilPaused(makeCampaign(), memoryStore());
  assert.equal(done.stage, 'done');
  assert.equal(done.leads[0].status, 'skipped');
  assert.equal(done.leads[0].email, undefined);
  assert.equal(calls.filter((x) => x.url.endsWith('/emails')).length, 0);
});
test('unknown industry identifiers stop before any paid company search', async () => {
  const calls = mockProviders({ invalidIndustry: true });
  await assert.rejects(
    () => advance(makeCampaign(), keys, memoryStore()),
    /setor inválido/,
  );
  assert.equal(
    calls.some((x) => x.url.endsWith('/companies/prospecting')),
    false,
  );
});
test('empty company search is an honest terminal result', async () => {
  mockProviders({ companyCount: 0 });
  const c = await untilPaused(makeCampaign(), memoryStore());
  assert.equal(c.stage, 'done');
  assert.deepEqual(c.leads, []);
  assert.match(c.note, /não retornou/);
});
test('unknown delivery outcome never triggers a duplicate even after reload or concurrent calls', async () => {
  let calls = 0;
  globalThis.fetch = async () => {
    calls++;
    throw new Error('connection lost after acceptance');
  };
  const c = makeCampaign();
  const lead = {
    id: 'lead-1',
    company: { name: 'Example' },
    email: 'person@example.com',
    subject: 'Hello',
    body: 'Message body',
    status: 'ready',
  };
  const store = memoryStore();
  await Promise.all([
    sendLead(c, { ...lead }, keys.resendKey, store),
    sendLead(c, { ...lead }, keys.resendKey, store),
  ]);
  assert.equal(calls, 1);
  await sendLead(c, lead, keys.resendKey, store);
  assert.equal(lead.status, 'uncertain');
  assert.equal(calls, 1);
});
test('provider rejects a sender: failure is preserved and is not marked sent', async () => {
  globalThis.fetch = async () =>
    Response.json({ error: 'invalid sender' }, { status: 403 });
  const c = makeCampaign();
  const lead = {
    id: 'lead-1',
    company: { name: 'Example' },
    email: 'person@example.com',
    subject: 'Hello',
    body: 'Message body',
    status: 'ready',
  };
  await sendLead(c, lead, keys.resendKey, memoryStore());
  assert.equal(lead.status, 'failed');
  assert.equal(lead.providerId, undefined);
});
test('input rejects malformed emails and email header injection', () => {
  assert.throws(
    () => campaignInput({ ...input, senderEmail: 'bad@' }),
    /válido/,
  );
  assert.throws(
    () =>
      campaignInput({ ...input, senderName: 'Name\r\nBcc:other@example.com' }),
    /quebras/,
  );
  assert.equal(safeDomain('https://evil.com/@else'), '');
  assert.equal(safeDomain('https://www.example.com/'), 'example.com');
  assert.equal(
    workEmail({
      emails: [
        { type: 'private', email: 'p@example.com' },
        { type: 'work', email: 'not-an-email' },
      ],
    }),
    undefined,
  );
});
test('stored credentials are encrypted and authenticated to their provider context', async () => {
  const key = 'a'.repeat(64);
  const value = await encrypt('secret-never-returned', key, 'lushaKey');
  assert.ok(!value.includes('secret'));
  assert.equal(await decrypt(value, key, 'lushaKey'), 'secret-never-returned');
  await assert.rejects(() => decrypt(value, key, 'resendKey'));
});
