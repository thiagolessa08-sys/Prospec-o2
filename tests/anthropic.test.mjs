import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { ai, lusha, obj } from '../lib/providers.ts';

const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
});
const schema = obj({ score: { type: 'integer', minimum: 0, maximum: 100 } });
const analyze = () =>
  ai('test-anthropic', 'ranking', schema, 'Avalie os dados.', {
    company: 'Fixture',
  });

test('Anthropic request uses its headers, supported schema and text-block response', async () => {
  globalThis.fetch = async (url, init) => {
    assert.equal(url, 'https://api.anthropic.com/v1/messages');
    assert.equal(init.headers['x-api-key'], 'test-anthropic');
    assert.equal(init.headers['anthropic-version'], '2023-06-01');
    assert.equal(init.headers.Authorization, undefined);
    const body = JSON.parse(init.body);
    const score = body.output_config.format.schema.properties.score;
    assert.equal(score.minimum, undefined);
    assert.equal(score.maximum, undefined);
    assert.match(score.description, /maximum: 100/);
    assert.deepEqual(JSON.parse(body.messages[0].content), {
      company: 'Fixture',
    });
    assert.ok(body.system.includes('Avalie os dados.'));
    return Response.json({
      stop_reason: 'end_turn',
      content: [
        { type: 'thinking', thinking: 'ignored' },
        { type: 'text', text: '{"score":80}' },
      ],
    });
  };
  assert.deepEqual(await analyze(), { score: 80 });
  assert.equal(schema.properties.score.maximum, 100);
});

test('Anthropic refusals and token truncation stop the campaign', async () => {
  for (const stop_reason of ['refusal', 'max_tokens', 'pause_turn']) {
    globalThis.fetch = async () =>
      Response.json({
        stop_reason,
        content: [{ type: 'text', text: '{"score":80}' }],
      });
    await assert.rejects(analyze, /não concluiu/);
  }
});

test('model JSON must satisfy the original schema including bounds and required properties', async () => {
  for (const text of [
    '{"score":101}',
    '{"score":-1}',
    '{"score":"80"}',
    '{}',
    '{"score":80,"extra":true}',
    'not json',
  ]) {
    globalThis.fetch = async () =>
      Response.json({
        stop_reason: 'end_turn',
        content: [{ type: 'text', text }],
      });
    await assert.rejects(analyze, /análise válida/);
  }
});

test('Anthropic credential errors identify the correct provider without exposing a key', async () => {
  globalThis.fetch = async () =>
    Response.json(
      { error: { message: 'credential details' } },
      { status: 401 },
    );
  await assert.rejects(
    analyze,
    (error) =>
      error.message.includes('Anthropic') &&
      error.message.includes('chave inválida') &&
      !error.message.includes('test-anthropic'),
  );
});

test('Lusha 403 explains plan-restricted DNC without exposing provider details', async () => {
  globalThis.fetch = async () =>
    Response.json(
      {
        statusCode: 403,
        message:
          'Exclude DNC is not supported on your current plan. Internal trace 123.',
      },
      { status: 403 },
    );
  await assert.rejects(
    () => lusha('test-lusha', 'contacts/prospecting', {}),
    (error) =>
      error.message.includes('Lusha') &&
      error.message.includes('filtro DNC') &&
      !error.message.includes('Internal trace'),
  );
});
