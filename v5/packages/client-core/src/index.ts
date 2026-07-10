export type ClientState =
  | 'idle'
  | 'authenticating'
  | 'booking'
  | 'checking-in'
  | 'connecting'
  | 'synchronizing'
  | 'ready'
  | 'reconnecting'
  | 'closed';

const allowedTransitions: Readonly<Record<ClientState, ReadonlySet<ClientState>>> = {
  idle: new Set(['authenticating', 'closed']),
  authenticating: new Set(['booking', 'closed']),
  booking: new Set(['checking-in', 'closed']),
  'checking-in': new Set(['connecting', 'closed']),
  connecting: new Set(['synchronizing', 'reconnecting', 'closed']),
  synchronizing: new Set(['ready', 'reconnecting', 'closed']),
  ready: new Set(['reconnecting', 'closed']),
  reconnecting: new Set(['booking', 'connecting', 'closed']),
  closed: new Set(),
};

export class ClientStateMachine {
  private currentState: ClientState = 'idle';

  public get state(): ClientState {
    return this.currentState;
  }

  public transition(next: ClientState): void {
    if (!allowedTransitions[this.currentState].has(next)) {
      throw new Error(`Invalid client state transition: ${this.currentState} -> ${next}`);
    }
    this.currentState = next;
  }
}
