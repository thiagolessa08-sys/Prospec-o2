import type { CampaignInput } from './types';

export class AppError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
  }
}
export function textValue(
  value: unknown,
  label: string,
  min = 1,
  max = 12000,
): string {
  if (
    typeof value !== 'string' ||
    value.trim().length < min ||
    value.trim().length > max
  )
    throw new AppError(`${label}: preencha entre ${min} e ${max} caracteres.`);
  return value.trim();
}
export function validEmail(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length <= 254 &&
    /^[A-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Z0-9](?:[A-Z0-9-]*[A-Z0-9])?(?:\.[A-Z0-9](?:[A-Z0-9-]*[A-Z0-9])?)+$/i.test(
      value,
    )
  );
}
export function campaignInput(raw: Record<string, unknown>): CampaignInput {
  const senderEmail = textValue(
    raw.senderEmail,
    'E-mail do remetente',
    3,
    254,
  ).toLowerCase();
  if (!validEmail(senderEmail))
    throw new AppError('Informe um e-mail válido para o remetente.');
  const senderName = textValue(raw.senderName, 'Seu nome', 2, 100);
  if (/[\r\n<>]/.test(senderName))
    throw new AppError(
      'O nome do remetente não pode conter quebras de linha ou sinais de menor/maior.',
    );
  if (typeof raw.autoSend !== 'boolean')
    throw new AppError('Selecione o modo de envio.');
  return {
    name: textValue(raw.name, 'Nome do software', 2, 120),
    description: textValue(raw.description, 'Descrição', 60, 12000),
    market: textValue(raw.market, 'Mercado', 2, 300),
    senderName,
    senderEmail,
    signature: textValue(raw.signature, 'Assinatura e convite', 2, 1500),
    autoSend: raw.autoSend,
  };
}
export function safeDomain(raw: unknown): string {
  if (typeof raw !== 'string') return '';
  const d = raw
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/^www\./, '')
    .replace(/\/$/, '');
  return /^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,63}$/.test(d) ? d : '';
}
