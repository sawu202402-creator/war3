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
  isPublic?: boolean;
  matchSeq?: number;
  inGame: boolean;
  members: LobbyMember[];
}

export interface PublicRoomAd {
  roomCode: string;
  hostName: string;
  difficulty: DifficultyLevel;
  memberCount: number;
  maxMembers: number;
  inGame: boolean;
  wave: number;
  updatedAt: number;
}

// Fast 30Hz hero kinematics + vitals
export type HeroFastTuple = [
  id: string,
  x: number,
  y: number,
  vx: number,
  vy: number,
  facing: number,
  zoneId: ZoneId,
  hp: number,
  maxHp: number,
  mp: number,
  maxMp: number,
  shield: number,
  flags: number, // bit0: dead, bit1: recalling, bit2: swing/cast, bit3: stealth, bit4: bladestorm
  reviveTimerTenths: number,
];

// Lower-freq hero build / bag / cooldowns / teleport epoch
export type HeroEconTuple = [
  id: string,
  level: number,
  gold: number,
  crystal: number,
  stones: number,
  kills: number,
  tpSeq: number,
  inv: (string | null)[],
  stash: (string | null)[],
  cds: [number, number, number, number],
  flashCd: number,
  pots: [number, number, number],
  awakenId: string | null,
  comboCount: number,
  comboTier: number,
  moveSpeed: number,
];

export type EnemySnapTuple = [
  id: number,
  kind: EnemyKind,
  zoneId: ZoneId,
  x: number,
  y: number,
  vx: number,
  vy: number,
  hp: number,
  maxHp: number,
  facing: number,
  shield: number,
  flags: number, // bit0: hitFlash, bit1: stun, bit2: slow, bit3: burn, bit4: bossPhase>=2
  affixCode: number, // 0:none, 1:bloodlust, 2:armored, 3:swift, 4:blazing
];

export type ProjSnapTuple = [
  x: number,
  y: number,
  vx: number,
  vy: number,
  radius: number,
  flags: number, // bit0: isMagic, bit1: fromEnemy
  color: string,
  zoneId: ZoneId,
];

export type TelegraphSnapTuple = [
  id: number,
  kindCode: number, // 0:enemy_aoe, 1:enemy_laser, 2:blizzard, 3:starfall, 4:sanctuary, 5:poison_pool
  zoneId: ZoneId,
  x: number,
  y: number,
  tx: number,
  ty: number,
  width: number,
  radius: number,
  timerTenths: number,
  maxTimerTenths: number,
  color: string,
];

export type TowerSnapTuple = [
  slotId: string,
  typeCode: number, // 0:null, 1:arrow, 2:frost, 3:holy
  level: number,
  facing: number,
];

export type DropSnapTuple = [
  id: number,
  zoneId: ZoneId,
  x: number,
  y: number,
  kindCode: number, // 0:gold, 1:crystal, 2:stone, 3:item
  amount: number,
  itemId?: string,
];

export type CoopNetMessage =
  | { type: 'join_req'; callsign: string; heroClass: HeroClassId }
  | { type: 'join_ack'; ok: boolean; reason?: string; assignedPeerId?: string; slot?: number; lobby?: LobbyState }
  | { type: 'lobby_state'; lobby: LobbyState }
  | { type: 'member_update'; ready: boolean; callsign: string; heroClass: HeroClassId }
  | { type: 'start_game'; lobby: LobbyState; matchSeq?: number }
  | {
      type: 'client_pos';
      seq?: number;
      mSeq?: number;
      ownerId: string;
      x: number;
      y: number;
      vx: number;
      vy: number;
      facing: number;
      tpSeq?: number;
    }
  | { type: 'heroes_fast'; seq: number; mSeq?: number; list: HeroFastTuple[] }
  | {
      type: 'world_snap';
      seq: number;
      mSeq?: number;
      wave: number;
      prep: number;
      waveState: 'prep' | 'fighting' | 'ended';
      endless?: boolean;
      sancHp: number;
      sancMaxHp: number;
      sancLv: number;
      sancInvuln: number;
      heroes: HeroFastTuple[];
      econs?: HeroEconTuple[];
      enemies: EnemySnapTuple[];
      projs?: ProjSnapTuple[];
      telegraphs?: TelegraphSnapTuple[];
      towers?: TowerSnapTuple[];
      drops?: DropSnapTuple[];
    }
  | { type: 'cmd_attack'; ownerId: string; dirX: number; dirY: number; mSeq?: number }
  | { type: 'cmd_skill'; ownerId: string; slot: number; dirX: number; dirY: number; distRatio: number; mSeq?: number }
  | { type: 'cmd_flash'; ownerId: string; dirX: number; dirY: number; mSeq?: number }
  | { type: 'cmd_recall'; ownerId: string }
  | { type: 'cmd_potion'; ownerId: string; slot: 'hp' | 'mp' | 'tactical' }
  | { type: 'cmd_active_item'; ownerId: string }
  | { type: 'cmd_buy'; ownerId: string; itemId: string }
  | { type: 'cmd_synthesize'; ownerId: string; itemId: string }
  | { type: 'cmd_upgrade_slot'; ownerId: string; inInv: boolean; slotIdx: number }
  | { type: 'cmd_sell_slot'; ownerId: string; inInv: boolean; slotIdx: number }
  | { type: 'cmd_swap_slot'; ownerId: string; fromInv: boolean; idxA: number; toInv: boolean; idxB: number }
  | { type: 'cmd_teleport'; ownerId: string; zoneId: ZoneId; tier?: 1 | 2 | 3 }
  | { type: 'cmd_base'; ownerId: string; kind: 'upgrade' | 'invuln' | 'pause_wave' | 'early_wave' }
  | { type: 'cmd_tower'; ownerId: string; slotId: string; towerType: TowerType }
  | { type: 'cmd_awaken'; ownerId: string; branchId: string }
  | { type: 'cmd_gift_res'; ownerId: string; toHeroId: string; kind: 'gold' | 'crystal'; amount: number }
  | { type: 'cmd_gift_item'; ownerId: string; toHeroId: string; inInv: boolean; slotIdx: number }
  | { type: 'cmd_ping'; ownerId: string; x: number; y: number; color: string; label: string }
  | {
      type: 'evt_fx';
      kind: 'banner' | 'floating' | 'vfx';
      zoneId?: ZoneId;
      x?: number;
      y?: number;
      radius?: number;
      color?: string;
      text?: string;
      vfxKind?: string;
      dur?: number;
      mSeq?: number;
    }
  | { type: 'evt_run_finished'; victory: boolean; mSeq?: number };
