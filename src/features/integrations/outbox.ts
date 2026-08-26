export type IntegrationInboxEnvelope = {
  id: string;
  organizationId: string;
  clinicId: string | null;
  connectionId: string | null;
  provider: string;
  externalEventId: string;
  eventType: string;
  payload: unknown;
  attempts: number;
};

export type IntegrationOutboxEnvelope = {
  id: string;
  organizationId: string;
  clinicId: string | null;
  topic: string;
  eventType: string;
  aggregateType: string | null;
  aggregateId: string | null;
  payload: unknown;
  attempts: number;
};

export type IntegrationOutboxTransport = (
  event: IntegrationOutboxEnvelope,
) => Promise<void>;

export type OutboxDispatchResult = {
  claimed: number;
  sent: number;
  retried: number;
  failed: number;
};
