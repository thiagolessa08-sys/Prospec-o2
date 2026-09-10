export type Stage =
  | 'analyze'
  | 'companies'
  | 'contacts'
  | 'drafts'
  | 'review'
  | 'send'
  | 'done';
export type CampaignInput = {
  name: string;
  description: string;
  market: string;
  senderName: string;
  senderEmail: string;
  signature: string;
  autoSend: boolean;
};
export type Company = {
  id: string;
  name: string;
  domain: string;
  description: string;
  industry: string;
  country: string;
  employees: string;
};
export type DeliveryTracking = {
  acceptedAt?: string;
  deliveredAt?: string;
  openedAt?: string;
  clickedAt?: string;
  bouncedAt?: string;
  failedAt?: string;
  delayedAt?: string;
  complainedAt?: string;
  suppressedAt?: string;
  lastEvent?: string;
  lastEventAt?: string;
};
export type Lead = {
  id: string;
  company: Company;
  score: number;
  reason: string;
  contact?: { id: string; name: string; title: string };
  email?: string;
  subject?: string;
  body?: string;
  status:
    | 'pending'
    | 'ready'
    | 'sent'
    | 'skipped'
    | 'failed'
    | 'uncertain'
    | 'sending';
  issue?: string;
  providerId?: string;
  delivery?: DeliveryTracking;
};
export type Campaign = {
  id: string;
  createdAt: string;
  input: CampaignInput;
  stage: Stage;
  cursor: number;
  note: string;
  profile?: {
    summary: string;
    industries: string[];
    titles: string[];
    country: string;
    industryIds: number[];
    minEmployees: number;
    maxEmployees: number;
  };
  broadSearch?: boolean;
  candidates?: Company[];
  leads: Lead[];
};
export type SettingsView = {
  connected: Record<string, boolean>;
  managed: Record<string, boolean>;
};
