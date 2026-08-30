export type ConnectorExecutionStatus = "submitted" | "succeeded" | "failed" | "unknown";

export type ActionExecutionInput = {
  idempotencyKey: string;
  actionType: string;
  fanId?: string;
  amountMinor?: number;
  maxSpendMinor?: number;
  payload: Record<string, unknown>;
};

export type ActionExecutionResult = { status: ConnectorExecutionStatus; providerOperationId?: string; result?: Record<string, unknown> };

export type ActionConnector = {
  execute(input: ActionExecutionInput): Promise<ActionExecutionResult>;
  reconcile(providerOperationId: string): Promise<ActionExecutionResult>;
};

export function createUnprovisionedConnector(name: string): ActionConnector {
  return {
    async execute() { throw new Error(`connector_unprovisioned:${name}`); },
    async reconcile() { throw new Error(`connector_unprovisioned:${name}`); },
  };
}
