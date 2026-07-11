import { AsyncLocalStorage } from "node:async_hooks";

type ExecutionContext = {
  signal?: AbortSignal;
  requestId?: string | number;
};

const executionContext = new AsyncLocalStorage<ExecutionContext>();

export function runWithExecutionContext<T>(context: ExecutionContext, operation: () => Promise<T>): Promise<T> {
  return executionContext.run(context, operation);
}

export function getExecutionSignal(): AbortSignal | undefined {
  return executionContext.getStore()?.signal;
}
