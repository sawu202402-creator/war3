export type HeroClassId = 'paladin' | 'blademaster' | 'archmage' | 'ranger' | 'priest';

export type HudMode = 'auto' | 'touch' | 'pc';

export type DifficultyLevel = 1 | 2 | 3 | 4 | 5;

export type SkillAimType = 'direction' | 'ground_aoe' | 'cone' | 'self' | 'target_ally';

export type TargetPriority = 'nearest' | 'boss' | 'low_hp';

export interface SkillDef {
  slot: 0 | 1 | 2 | 3; // Q/1, E/2, R/3, F/Ult
  keyLabel: string;
  id: string;
  name: string;
  iconKey: string;
  aimType: SkillAimType;
  cooldown: number;
  manaCost: number;
  range: number;
  radius: number;
  coneAngle?: number;
  damageBase: number;
  damagePerLv: number;
  adScale: number;
  apScale: number;
  isUlt?: boolean;
  unlockLevel?: number;
  desc: string;
}

export interface AwakeningBranchDef {
  id: string;
  name: string;
  tag: string;
  color: string;
  desc: string;
  bonuses: Partial<StatBlock>;
  specialEffect: string;
}

export interface HeroClassDef {
  id: HeroClassId;
  name: string;
  title: string;
  roleTag: string;
  attackType: 'melee' | 'ranged';
  color: string;
  auraColor: string;
  unlockCost: number; // 0 = unlocked by default
  baseStats: StatBlock;
  growthPerLevel: {
    maxHp: number;
    maxMp: number;
    ad: number;
    ap: number;
    armor: number;
    atkSpeed: number;
  };
  passiveName: string;
  passiveDesc: string;
  skills: [SkillDef, SkillDef, SkillDef, SkillDef];
  awakeningBranches: [AwakeningBranchDef, AwakeningBranchDef];
  exclusiveItemId: string;
  recommendedBuild: string[];
}

export interface StatBlock {
  maxHp: number;
  maxMp: number;
  hpRegen: number;
  mpRegen: number;
  ad: number;
  ap: number;
  armor: number;
  atkSpeed: number; // attacks per second
  moveSpeed: number; // px/s
  critChance: number; // 0..1
  critMult: number; // e.g. 2.0
  lifesteal: number; // 0..1
  cdr: number; // 0..0.55
  attackRange: number;
  damageReduce: number; // 0..0.65
  thorns: number; // flat/pct reflected damage
  cleave?: number; // War3 Cleaving Attack ratio (0 = single-target)
  splashRadius?: number; // War3 Orb/caster AoE splash radius in px (0 = single-target)
  orbChainChance?: number; // War3 Orb of Lightning chain trigger probability (0..0.75)
}

export type ItemRarity = 'common' | 'uncommon' | 'rare' | 'epic' | 'legendary' | 'mythic';

export type ItemCategory =
  | 'weapon'
  | 'armor'
  | 'accessory'
  | 'boots'
  | 'artifact'
  | 'consumable'
  | 'material'
  | 'book';

export interface ItemRecipe {
  items: string[];
  gold?: number;
  crystal?: number;
  stones?: number;
}

export interface ItemActiveSkill {
  id: string;
  name: string;
  cooldown: number;
  desc: string;
}

export interface ItemDef {
  id: string;
  name: string;
  rarity: ItemRarity;
  category: ItemCategory;
  iconKey: string;
  desc: string;
  costGold?: number;
  costCrystal?: number;
  shopVisible?: boolean;
  stats?: Partial<StatBlock>;
  upgradesFrom?: string;
  upgradeCostGold?: number;
  upgradeCostCrystal?: number;
  upgradeStones?: number;
  recipe?: ItemRecipe;
  setId?: string;
  activeSkill?: ItemActiveSkill;
  heroExclusive?: HeroClassId;
  // Consumable / Book payloads
  healHp?: number;
  healHpPct?: number;
  healMp?: number;
  healMpPct?: number;
  buffDuration?: number;
  buffKind?: 'invuln' | 'rage' | 'repair_base' | 'rebirth';
  bookStats?: Partial<{
    str: number;
    agi: number;
    int: number;
    all: number;
    xp: number;
  }>;
  potionSlot?: 'hp' | 'mp' | 'tactical';
}

export interface SetBonusDef {
  id: string;
  name: string;
  itemIds: string[];
  twoPieceDesc: string;
  fourPieceDesc: string;
  twoPieceStats: Partial<StatBlock>;
  fourPieceStats: Partial<StatBlock>;
}

export type ZoneId =
  | 'sanctuary'
  | 'gold_room'
  | 'xp_room'
  | 'crystal_room'
  | 'dungeon_fire'
  | 'dungeon_ice'
  | 'dungeon_thunder'
  | 'dungeon_forest'
  | 'bandit_camp'
  | 'trial_tower'
  | 'stone_mine'
  | 'hidden_abyss';

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface ZoneDef {
  id: ZoneId;
  name: string;
  subtitle: string;
  biome: 'sanctuary' | 'gold' | 'xp' | 'crystal' | 'fire' | 'ice' | 'thunder' | 'forest' | 'bandit' | 'trial' | 'mine' | 'abyss';
  rect: Rect;
  spawnPoint: { x: number; y: number };
  isSanctuaryRoad?: boolean;
  teleportCostGold?: number;
  recommendedWave?: number;
  bossKind?: EnemyKind;
  bossRespawnSec?: number;
  hasTiers?: boolean;
  allowTeleportOut?: boolean;
  color: string;
}

export interface PortalDef {
  id: string;
  fromZone: ZoneId;
  toZone: ZoneId;
  x: number;
  y: number;
  radius: number;
  label: string;
  color: string;
}

export interface TowerSlotDef {
  id: string;
  label: string;
  x: number;
  y: number;
}

export type TowerType = 'arrow' | 'frost' | 'holy';

export interface WorldPropDef {
  id: string;
  kind: 'tree' | 'brazier' | 'pillar' | 'banner' | 'crystal' | 'ruin' | 'tent' | 'anvil';
  x: number;
  y: number;
  radius: number;
  color?: string;
}

export type EnemyKind =
  | 'goblin'
  | 'wolf_rider'
  | 'skeleton_archer'
  | 'skeleton_mage'
  | 'orc_berserker'
  | 'bomb_golem'
  | 'shaman_healer'
  | 'shadow_assassin'
  | 'siege_catapult'
  | 'frost_giant'
  | 'thunder_mage'
  | 'split_slime'
  | 'doom_guard'
  | 'infernal_titan'
  // Stage Bosses (Wave 5, 10, 15, 20)
  | 'boss_skeleton_king'
  | 'boss_abyss_lord'
  | 'boss_frost_wyrm'
  | 'boss_doom_overlord'
  // Branch / Dungeon / Event monsters & bosses
  | 'train_gold_mob'
  | 'train_xp_mob'
  | 'train_crystal_mob'
  | 'mine_golem'
  | 'bandit_grunt'
  | 'bandit_chief'
  | 'boss_fire_lord'
  | 'boss_ice_phoenix'
  | 'boss_thunder_roc'
  | 'boss_ancient_treant'
  | 'boss_trial_mirror'
  | 'boss_hidden_chaos'
  | 'treasure_goblin'
  | 'wandering_elite';

export interface EnemyArchetype {
  kind: EnemyKind;
  name: string;
  isBoss?: boolean;
  isMiniBoss?: boolean;
  isRanged?: boolean;
  isHealer?: boolean;
  isSuicide?: boolean;
  isSplitter?: boolean;
  preferAthena?: boolean;
  radius: number;
  baseHp: number;
  baseDmg: number;
  baseArmor: number;
  moveSpeed: number;
  attackRange: number;
  attackCd: number;
  goldReward: number;
  crystalReward?: number;
  xpReward: number;
  color: string;
  accentColor: string;
  dropItems?: { itemId: string; chance: number }[];
}

export interface WaveGroupDef {
  kind: EnemyKind;
  count: number;
}

export interface WaveDef {
  wave: number;
  title: string;
  lanes: number; // 1, 2, or 3
  groups: WaveGroupDef[];
  boss?: EnemyKind;
  hpMult: number;
  dmgMult: number;
  prepSeconds: number;
}

export interface DifficultyConfig {
  level: DifficultyLevel;
  name: string;
  shortName: string;
  color: string;
  hpMult: number;
  dmgMult: number;
  speedMult: number;
  countMult: number;
  rewardMult: number;
  doubleBossOn20: boolean;
  honorMultiplier: number;
  desc: string;
}

export interface TalentTrackDef {
  key: keyof TalentLevels;
  name: string;
  desc: string;
  maxLevel: number;
  baseCost: number;
  costStep: number;
  valueText: (lv: number) => string;
}

export interface TalentLevels {
  startGold: number;
  xpBoost: number;
  might: number;
  vitality: number;
  haste: number;
  reviveFast: number;
}

export interface DailyMissionDef {
  id: string;
  kind: 'kills' | 'waves' | 'bosses' | 'syntheses' | 'quests' | 'clears';
  target: number;
  rewardHonor: number;
  title: string;
}

export interface SaveData {
  callsign: string;
  honorCoins: number;
  selectedHero: HeroClassId;
  unlockedHeroes: HeroClassId[];
  maxClearedDifficulty: number; // 0..5
  bestEndlessWave: Record<string, number>; // `${hero}_${diff}` -> wave
  heroMasteryXp: Record<HeroClassId, number>;
  talents: TalentLevels;
  discoveredItems: string[];
  defeatedBosses: string[];
  careerKills: number;
  totalClears: number;
  rightClickMove: boolean;
  hudMode?: HudMode;
  aiSquadCount: number; // 0..3
  daily: {
    dateKey: string;
    lastSignDate: string;
    signStreak: number;
    missionProgress: Record<string, number>;
    claimedIds: string[];
  };
}
