import type { Quat, Vec3 } from '../core/math';
import type { ControlInput } from '../physics/PhysicsClient';

/**
 * Wire protocol draft for the future multiplayer server (server-authoritative).
 * The client sends *inputs*; the server runs the same Rust physics and broadcasts state.
 * Nothing in the single-player build depends on this file yet.
 */
export interface PlayerState {
  id: string;
  /** Server simulation time in seconds. */
  time: number;
  position: Vec3;
  orientation: Quat;
  velocity: Vec3;
}

export type ClientMessage =
  | { t: 'join'; room: string; name: string; aircraftId: number }
  | { t: 'input'; seq: number; controls: ControlInput }
  | { t: 'leave' };

export type ServerMessage =
  | { t: 'welcome'; playerId: string; tickHz: number }
  | { t: 'state'; tick: number; ackSeq: number; players: PlayerState[] }
  | { t: 'player-left'; playerId: string }
  | { t: 'error'; message: string };

export type ConnectionStatus = 'offline' | 'connecting' | 'online' | 'reconnecting';
