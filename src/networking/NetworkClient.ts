import type { ControlInput } from '../physics/PhysicsClient';
import type { ConnectionStatus, PlayerState } from './protocol';

/** Transport-agnostic multiplayer client interface (WebSocket implementation comes later). */
export interface NetworkClient {
  readonly status: ConnectionStatus;
  connect(url: string, room: string, name: string): Promise<void>;
  sendInput(seq: number, controls: ControlInput): void;
  onPlayers(cb: (players: PlayerState[]) => void): () => void;
  onStatus(cb: (status: ConnectionStatus) => void): () => void;
  close(): void;
}

/** Single-player stand-in: always offline, never reports remote players. */
export class OfflineNetworkClient implements NetworkClient {
  readonly status: ConnectionStatus = 'offline';
  connect(): Promise<void> {
    return Promise.reject(new Error('Multiplayer is not implemented yet'));
  }
  sendInput(): void {}
  onPlayers(): () => void {
    return () => {};
  }
  onStatus(): () => void {
    return () => {};
  }
  close(): void {}
}
