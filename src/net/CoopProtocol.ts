import { DifficultyLevel, EnemyKind, HeroClassId, TowerType, ZoneId } from '../types';

export const SQUAD_COLORS = ['#facc15', '#38bdf8', '#4ade80', '#c084fc'];

export interface LobbyMember {
  peerId: string;
  slot: number;
  callsign: string;
  heroClass: HeroClassId;
  color: string;
  ready: boolean;
  isHost: boolean;
}

export interface LobbyState {
  roomCode: string;
  difficulty: DifficultyLevel;
  inGame: boolean;
  members: LobbyMember[];
}

export type HeroSnapTuple = [
  id: string,
  x: number,
  y: number,
  hp: number,
  maxHp: number,
  mp: number,
  maxMp: number,
  level: number,
  gold: number,
  crystal: number,
  stones: number,
  zoneId: ZoneId,
  dead: number,
  facing: number,
];

export type EnemySnapTuple = [
  id: number,
  kind: EnemyKind,
  zoneId: ZoneId,
  x: number,
  y: number,
  hp: number,
  maxHp: number,
  facing: number,
];

export type CoopNetMessage =
  | { type: 'join_req'; callsign: string; heroClass: HeroClassId }
  | { type: 'join_ack'; ok: boolean; reason?: string; slot?: number; lobby?: LobbyState }
  | { type: 'lobby_state'; lobby: LobbyState }
  | { type: 'member_update'; ready: boolean; callsign: string; heroClass: HeroClassId }
  | { type: 'start_game'; lobby: LobbyState }
  | { type: 'client_pos'; ownerId: string; x: number; y: number; facing: number }
  | {
      type: 'world_snap';
      wave: number;
      prep: number;
      waveState: 'prep' | 'fighting' | 'ended';
      sancHp: number;
      sancMaxHp: number;
      sancLv: number;
      heroes: HeroSnapTuple[];
      enemies: EnemySnapTuple[];
    }
  | { type: 'cmd_attack'; ownerId: string; dirX: number; dirY: number }
  | { type: 'cmd_skill'; ownerId: string; slot: number; dirX: number; dirY: number; distRatio: number }
  | { type: 'cmd_flash'; ownerId: string; dirX: number; dirY: number }
  | { type: 'cmd_recall'; ownerId: string }
  | { type: 'cmd_potion'; ownerId: string; slot: 'hp' | 'mp' | 'tactical' }
  | { type: 'cmd_buy'; ownerId: string; itemId: string }
  | { type: 'cmd_synthesize'; ownerId: string; itemId: string }
  | { type: 'cmd_upgrade_slot'; ownerId: string; inInv: boolean; slotIdx: number }
  | { type: 'cmd_sell_slot'; ownerId: string; inInv: boolean; slotIdx: number }
  | { type: 'cmd_teleport'; ownerId: string; zoneId: ZoneId; tier?: 1 | 2 | 3 }
  | { type: 'cmd_base'; ownerId: string; kind: 'upgrade' | 'invuln' | 'pause_wave' | 'early_wave' }
  | { type: 'cmd_tower'; ownerId: string; slotId: string; towerType: TowerType }
  | { type: 'cmd_awaken'; ownerId: string; branchId: string }
  | { type: 'cmd_ping'; ownerId: string; x: number; y: number; color: string; label: string };
