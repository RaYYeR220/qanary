import { custom, type EIP1193RequestFn } from 'viem';

export type RpcCall = { method: string; params: unknown[] };
export type RpcHandler = (params: unknown[]) => unknown;

/** In-memory EIP-1193 transport: answers from `handlers`, records every call, fails loudly otherwise. */
export function mockTransport(handlers: Record<string, RpcHandler>) {
  const calls: RpcCall[] = [];
  const request = (async ({ method, params }: { method: string; params?: unknown }) => {
    const args = (params ?? []) as unknown[];
    calls.push({ method, params: args });
    const handler = handlers[method];
    if (!handler) throw new Error(`unexpected RPC method ${method}`);
    return handler(args);
  }) as EIP1193RequestFn;
  return { transport: custom({ request }, { retryCount: 0 }), calls };
}
