import {
  DifficultyLevel,
  EnemyKind,
  HeroClassId,
  StatBlock,
  TowerType,
  ZoneId,
} from '../types';

export type HeroAnimPose = 'idle' | 'walk1' | 'walk2' | 'attack';

export interface HeroAfterimage {
  x: number;
  y: number;
  flip: number;
  pose: HeroAnimPose;
  alpha: number;
  color: string;
}

export interface HeroEntity {
  id: string;
  slot: number;
  callsign: string;
  classId: HeroClassId;
  isLocal: boolean;
  isBot: boolean;
  aiMode: 'guard_base' | 'follow_player';
  color: string;
  x: number;
  y: number;
  vx: number;
  vy: number;
  facing: number;
  zoneId: ZoneId;

  level: number;
  xp: number;
  nextXp: number;
  kills: number;
  bossKills: number;
  damageDealt: number;
  revives: number;
  sanctuaryAuraTier: number;

  gold: number;
  crystal: number;
  stones: number;
  ankhs: number;
  potions: {
    hp: string; // itemId
    mp: string;
    tactical: string;
  };
  potionCharges: {
    hp: number;
    mp: number;
    tactical: number;
  };
  potionCds: {
    hp: number;
    mp: number;
    tactical: number;
  };

  hp: number;
  mp: number;
  shield: number;
  stats: StatBlock;

  // Progression inside match
  bookBonuses: {
    maxHp: number;
    maxMp: number;
    mpRegen: number;
    ad: number;
    ap: number;
    armor: number;
    atkSpeed: number;
    critChance: number;
  };
  awakeningBranchId: string | null;
  awakeningUnlocked: boolean;
  awakeningPrompted: boolean;
  exclusiveUnlocked: boolean;
  exclusiveLevel: number; // 1..5
  exclusiveKills: number;

  // Inventory
  inventory: (string | null)[]; // 6 main slots
  stash: (string | null)[]; // 6 stash slots
  pinnedRecipeId: string | null;

  // Combat & States
  skillCds: [number, number, number, number];
  flashCd: number;
  recallTimer: number; // >0 means channeling recall
  activeItemCd: number;
  attackCd: number;
  attackLockTimer: number;
  attackCombo: number;
  swingAnim: number;
  hitFlash: number;

  dead: boolean;
  reviveTimer: number;
  reviveMax: number;
  downedX: number;
  downedY: number;
  reviveAssistProgress: number;

  // Temporary Buffs
  invulnTimer: number;
  stealthTimer: number;
  bladestormTimer: number;
  avatarTimer: number;
  hawkeyeTimer: number;
  warsongTimer: number;
  windbootsTimer: number;
  consecrateTimer: number;
  omnislashTimer: number;
  omnislashTargetX: number;
  omnislashTargetY: number;
  omnislashTicksLeft: number;
  passiveStacks: number;
  passiveTimer: number;
  stunTimer: number;

  // Water Delivery Side Quest
  carryingWater: boolean;
  waterDeliveriesDone: number;

  // Musou Kill-Streak Combo
  comboCount: number;
  comboTimer: number;
  comboTier: number;
  comboPeak: number;

  // Animation & Kinematics
  prevX: number;
  prevY: number;
  moveSpeedNorm: number;
  animPhase: number;
  flipVisual: number;
  castAnim: number;
  swingDuration: number;
  stepDustTimer: number;
  afterimages: HeroAfterimage[];

  // Interpolation / AI / Co-op
  botDecisionTimer: number;
  netTx?: number;
  netTy?: number;
  netVx?: number;
  netVy?: number;
  netAngle?: number;
  extrapAge?: number;
  lastSeq?: number;
  teleportSeq?: number;
  takeoverOriginCallsign?: string;
}

export type EnemyAffix = 'bloodlust' | 'armored' | 'swift' | 'blazing';

export interface EnemyEntity {
  id: number;
  kind: EnemyKind;
  name: string;
  zoneId: ZoneId;
  isBoss: boolean;
  isMiniBoss: boolean;
  isRanged: boolean;
  isHealer: boolean;
  isSuicide: boolean;
  isSplitter: boolean;
  preferAthena: boolean;

  x: number;
  y: number;
  vx: number;
  vy: number;
  radius: number;
  facing: number;

  hp: number;
  maxHp: number;
  shield: number;
  dmg: number;
  armor: number;
  moveSpeed: number;
  attackRange: number;
  attackCd: number;
  attackTimer: number;

  goldReward: number;
  crystalReward: number;
  xpReward: number;
  color: string;
  accentColor: string;

  laneId: number;
  waypointIdx: number;
  spawnX: number;
  spawnY: number;
  tierMult: number;

  // Status effects
  stunTimer: number;
  slowTimer: number;
  slowFactor: number;
  burnTimer: number;
  burnDps: number;
  armorShredTimer: number;
  tauntTargetId: string | null;
  tauntTimer: number;
  hitFlash: number;

  // Boss AI & Kinematics
  bossAbilityTimer: number;
  bossPhase: number;
  affix?: EnemyAffix;
  burnAuraTimer?: number;
  fleeTimer: number; // for treasure goblin
  splitGeneration: number;
  prevX: number;
  prevY: number;
  moveSpeedNorm: number;
  animPhase: number;
  attackAnim: number;
  knockX: number;
  knockY: number;
  netTx?: number;
  netTy?: number;
  netVx?: number;
  netVy?: number;
  netFacing?: number;
  extrapAge?: number;
}

export interface SummonEntity {
  id: number;
  ownerId: string;
  kind: 'illusion' | 'treant';
  name: string;
  zoneId: ZoneId;
  x: number;
  y: number;
  radius: number;
  facing: number;
  hp: number;
  maxHp: number;
  ad: number;
  atkSpeed: number;
  attackTimer: number;
  moveSpeed: number;
  life: number;
  maxLife: number;
  color: string;
}

export interface TowerEntity {
  slotId: string;
  label: string;
  x: number;
  y: number;
  type: TowerType | null;
  level: number; // 0 if empty, 1..5
  attackTimer: number;
  facing: number;
}

export interface Projectile {
  id: number;
  fromEnemy: boolean;
  ownerId: string;
  zoneId: ZoneId;
  x: number;
  y: number;
  vx: number;
  vy: number;
  radius: number;
  damage: number;
  isMagic: boolean;
  color: string;
  pierceLeft: number;
  hitIds: number[];
  life: number;
  slowPct?: number;
  burnDps?: number;
  aoeRadius?: number;
  canTriggerOrb?: boolean;
  isSiege?: boolean;
  targetAthena?: boolean;
}

export interface TelegraphZone {
  id: number;
  fromEnemy: boolean;
  ownerId: string;
  zoneId: ZoneId;
  kind: 'enemy_aoe' | 'enemy_laser' | 'blizzard' | 'starfall' | 'sanctuary' | 'poison_pool';
  x: number;
  y: number;
  tx?: number;
  ty?: number;
  width?: number;
  radius: number;
  timer: number;
  maxTimer: number;
  tickTimer: number;
  damage: number;
  fired?: boolean;
  healPerSec?: number;
  slowPct?: number;
  freezeSec?: number;
  color: string;
}

export interface DropItem {
  id: number;
  zoneId: ZoneId;
  x: number;
  y: number;
  kind: 'gold' | 'crystal' | 'stone' | 'item';
  amount: number;
  itemId?: string;
  ownerHeroId?: string; // if set, reserved for that player or visible clearly
  life: number;
}

export interface FloatingText {
  x: number;
  y: number;
  vy: number;
  text: string;
  color: string;
  size: number;
  life: number;
  maxLife: number;
}

export interface VisualEffect {
  kind:
    | 'ring'
    | 'slash'
    | 'beam'
    | 'chain'
    | 'levelup'
    | 'explosion'
    | 'teleport'
    | 'dust'
    | 'hit_spark'
    | 'cast_burst'
    | 'swing_holy'
    | 'swing_blade';
  x: number;
  y: number;
  tx?: number;
  ty?: number;
  angle?: number;
  radius: number;
  color: string;
  life: number;
  maxLife: number;
  points?: { x: number; y: number }[];
}

export interface PingMarker {
  x: number;
  y: number;
  color: string;
  label: string;
  life: number;
}

export interface GameWorldState {
  difficulty: DifficultyLevel;
  playerCount: number;
  wave: number;
  maxWave: number; // 20 in standard; endless sets endlessMode = true
  endlessMode: boolean;
  waveState: 'prep' | 'fighting' | 'ended';
  wavePrepTimer: number;
  wavePauseCountUsed: number;
  maxWavePauses: number;
  waveSpawnQueue: { kind: EnemyKind; laneId: number; affix?: EnemyAffix }[];
  waveSpawnCooldown: number;
  victory: boolean;
  ended: boolean;
  elapsedSec: number;

  sanctuary: {
    hp: number;
    maxHp: number;
    armor: number;
    hpRegen: number;
    shield: number;
    level: number;
    invulnTimer: number;
    invulnCd: number;
    underAttackFlash: number;
  };

  trainingTiers: {
    gold_room: 1 | 2 | 3;
    xp_room: 1 | 2 | 3;
    crystal_room: 1 | 2 | 3;
  };
  trainingSpawnTimer: Record<'gold_room' | 'xp_room' | 'crystal_room' | 'stone_mine', number>;
  dungeonRespawns: Record<string, number>; // zoneId -> seconds until boss respawn
  hiddenAbyssUnlocked: boolean;

  quests: {
    banditCleared: boolean;
    shopDiscount: number; // 0 or 0.15
    randomEventCooldown: number;
    lastEventBanner: string;
  };

  heroes: HeroEntity[];
  enemies: EnemyEntity[];
  summons: SummonEntity[];
  towers: TowerEntity[];
  projectiles: Projectile[];
  telegraphs: TelegraphZone[];
  drops: DropItem[];
  floatingTexts: FloatingText[];
  vfx: VisualEffect[];
  pings: PingMarker[];

  bannerText: string;
  bannerColor: string;
  bannerTimer: number;
  cameraShake: number;
  nextEntityId: number;
  defeatedBosses: EnemyKind[];
  doubleGoldTimer: number;
}
