interface ProviderCircuitState {
  consecutiveFailures: number;
  openUntil?: number;
}

interface ProviderCircuitSnapshot {
  state: 'open' | 'closed';
  openUntil?: string;
}

class ProviderCircuitBreaker {
  private readonly failureThreshold: number;
  private readonly openMs: number;
  private readonly stateByProvider: Map<string, ProviderCircuitState>;

  constructor(failureThreshold: number, openMs: number) {
    this.failureThreshold = Math.max(1, Math.floor(failureThreshold));
    this.openMs = Math.max(1000, Math.floor(openMs));
    this.stateByProvider = new Map<string, ProviderCircuitState>();
  }

  public canExecute(providerId: string): boolean {
    const state = this.stateByProvider.get(providerId);
    if (!state?.openUntil) {
      return true;
    }
    if (state.openUntil <= Date.now()) {
      state.openUntil = undefined;
      state.consecutiveFailures = 0;
      this.stateByProvider.set(providerId, state);
      return true;
    }
    return false;
  }

  public recordSuccess(providerId: string): void {
    this.stateByProvider.set(providerId, {
      consecutiveFailures: 0,
      openUntil: undefined,
    });
  }

  public recordFailure(providerId: string): void {
    const state = this.stateByProvider.get(providerId) ?? {
      consecutiveFailures: 0,
    };
    state.consecutiveFailures += 1;
    if (state.consecutiveFailures >= this.failureThreshold) {
      state.openUntil = Date.now() + this.openMs;
      state.consecutiveFailures = 0;
    }
    this.stateByProvider.set(providerId, state);
  }

  public snapshot(providerId: string): ProviderCircuitSnapshot {
    const state = this.stateByProvider.get(providerId);
    if (!state?.openUntil || state.openUntil <= Date.now()) {
      return { state: 'closed' };
    }
    return {
      state: 'open',
      openUntil: new Date(state.openUntil).toISOString(),
    };
  }
}

export { ProviderCircuitBreaker };
