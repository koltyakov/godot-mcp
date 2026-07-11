type Waiter = {
  resolve: () => void;
  reject: (error: Error) => void;
  signal?: AbortSignal;
  onAbort?: () => void;
};

function abortError(): Error {
  const error = new Error("Operation cancelled");
  error.name = "AbortError";
  return error;
}

export class FifoSemaphore {
  private active = 0;
  private readonly queue: Waiter[] = [];
  private closedError: Error | null = null;

  constructor(private readonly limit: number) {
    if (!Number.isInteger(limit) || limit < 1) {
      throw new Error("Semaphore limit must be a positive integer");
    }
  }

  async run<T>(signal: AbortSignal | undefined, operation: () => Promise<T>): Promise<T> {
    await this.acquire(signal);
    try {
      return await operation();
    } finally {
      this.active -= 1;
      this.drain();
    }
  }

  close(reason = new Error("Executor is shutting down")): void {
    this.closedError = reason;
    for (const waiter of this.queue.splice(0)) {
      this.removeAbortListener(waiter);
      waiter.reject(reason);
    }
  }

  private acquire(signal?: AbortSignal): Promise<void> {
    if (this.closedError) {
      return Promise.reject(this.closedError);
    }
    if (signal?.aborted) {
      return Promise.reject(abortError());
    }
    if (this.active < this.limit && this.queue.length === 0) {
      this.active += 1;
      return Promise.resolve();
    }

    return new Promise<void>((resolve, reject) => {
      const waiter: Waiter = { resolve, reject, signal };
      if (signal) {
        waiter.onAbort = () => {
          const index = this.queue.indexOf(waiter);
          if (index >= 0) {
            this.queue.splice(index, 1);
            reject(abortError());
          }
        };
        signal.addEventListener("abort", waiter.onAbort, { once: true });
      }
      this.queue.push(waiter);
    });
  }

  private drain(): void {
    while (!this.closedError && this.active < this.limit && this.queue.length > 0) {
      const waiter = this.queue.shift()!;
      this.removeAbortListener(waiter);
      if (waiter.signal?.aborted) {
        waiter.reject(abortError());
        continue;
      }
      this.active += 1;
      waiter.resolve();
    }
  }

  private removeAbortListener(waiter: Waiter): void {
    if (waiter.signal && waiter.onAbort) {
      waiter.signal.removeEventListener("abort", waiter.onAbort);
    }
  }
}
