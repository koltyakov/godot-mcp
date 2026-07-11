type Scope = { projectPath: string; scenePath?: string };

type QueueEntry<T = unknown> = {
  scope: Scope;
  signal?: AbortSignal;
  operation: () => Promise<T>;
  resolve: (value: T) => void;
  reject: (error: unknown) => void;
  onAbort?: () => void;
};

type ProjectState = {
  queue: QueueEntry[];
  projectActive: boolean;
  activeScenes: Set<string>;
};

function abortError(): Error {
  const error = new Error("Operation cancelled");
  error.name = "AbortError";
  return error;
}

export class MutationScheduler {
  private readonly projects = new Map<string, ProjectState>();

  run<T>(scope: Scope, signal: AbortSignal | undefined, operation: () => Promise<T>): Promise<T> {
    if (signal?.aborted) {
      return Promise.reject(abortError());
    }
    const state = this.projects.get(scope.projectPath) ?? {
      queue: [],
      projectActive: false,
      activeScenes: new Set<string>(),
    };
    this.projects.set(scope.projectPath, state);

    return new Promise<T>((resolve, reject) => {
      const entry: QueueEntry<T> = { scope, signal, operation, resolve, reject };
      if (signal) {
        entry.onAbort = () => {
          const index = state.queue.indexOf(entry as QueueEntry);
          if (index >= 0) {
            state.queue.splice(index, 1);
            reject(abortError());
            this.drain(scope.projectPath, state);
          }
        };
        signal.addEventListener("abort", entry.onAbort, { once: true });
      }
      state.queue.push(entry as QueueEntry);
      this.drain(scope.projectPath, state);
    });
  }

  private drain(projectPath: string, state: ProjectState): void {
    if (state.projectActive) {
      return;
    }

    while (state.queue.length > 0) {
      const entry = state.queue[0];
      if (entry.signal?.aborted) {
        state.queue.shift();
        this.removeAbortListener(entry);
        entry.reject(abortError());
        continue;
      }
      if (!entry.scope.scenePath) {
        if (state.activeScenes.size > 0) {
          return;
        }
        state.queue.shift();
        state.projectActive = true;
        this.start(projectPath, state, entry);
        return;
      }
      if (state.activeScenes.has(entry.scope.scenePath)) {
        return;
      }
      state.queue.shift();
      state.activeScenes.add(entry.scope.scenePath);
      this.start(projectPath, state, entry);
    }

    this.cleanup(projectPath, state);
  }

  private start(projectPath: string, state: ProjectState, entry: QueueEntry): void {
    this.removeAbortListener(entry);
    void entry.operation().then(entry.resolve, entry.reject).finally(() => {
      if (entry.scope.scenePath) {
        state.activeScenes.delete(entry.scope.scenePath);
      } else {
        state.projectActive = false;
      }
      this.drain(projectPath, state);
    });
  }

  private cleanup(projectPath: string, state: ProjectState): void {
    if (!state.projectActive && state.activeScenes.size === 0 && state.queue.length === 0) {
      this.projects.delete(projectPath);
    }
  }

  private removeAbortListener(entry: QueueEntry): void {
    if (entry.signal && entry.onAbort) {
      entry.signal.removeEventListener("abort", entry.onAbort);
    }
  }
}
