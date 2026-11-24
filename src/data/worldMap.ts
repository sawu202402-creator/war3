import { PortalDef, Rect, TowerSlotDef, WorldPropDef, ZoneDef, ZoneId } from '../types';

export const WORLD_WIDTH = 4200;
export const WORLD_HEIGHT = 4200;

export const ATHENA_POS = { x: 2100, y: 2100, radius: 56 };
export const FOUNTAIN_POS = { x: 2100, y: 2310, radius: 84 };
export const HERO_SPAWN_POS = { x: 2100, y: 2215 };
export const HERO_FORMATION_OFFSETS: { x: number; y: number }[] = [
  { x: 0, y: 26 },
  { x: -102, y: 12 },
  { x: 102, y: 12 },
  { x: 0, y: 54 },
];
export const WATER_ALTAR_POS = { x: 3540, y: 2150, radius: 66 };

// 3 路刷怪口与标准路径航点（确保绕开祭坛建筑直接朝圣殿推进）
export const WAVE_LANES: { id: number; name: string; spawn: { x: number; y: number }; waypoints: { x: number; y: number }[] }[] = [
  {
    id: 0,
    name: '北门圣道',
    spawn: { x: 2100, y: 1295 },
    waypoints: [
      { x: 2100, y: 1580 },
      { x: 2100, y: 1850 },
      { x: 2100, y: 2100 },
    ],
  },
  {
    id: 1,
    name: '西门荒原',
    spawn: { x: 1320, y: 2100 },
    waypoints: [
      { x: 1620, y: 2100 },
      { x: 1880, y: 2100 },
      { x: 2100, y: 2100 },
    ],
  },
  {
    id: 2,
    name: '南门前哨',
    spawn: { x: 2100, y: 2880 },
    waypoints: [
      { x: 2100, y: 2620 },
      { x: 2100, y: 2420 },
      { x: 2100, y: 2100 },
    ],
  },
];

// 4 座城防防御塔基座
export const TOWER_SLOTS: TowerSlotDef[] = [
  { id: 'tower_nw', label: '西北哨塔', x: 1870, y: 1870 },
  { id: 'tower_ne', label: '东北哨塔', x: 2330, y: 1870 },
  { id: 'tower_sw', label: '西南哨塔', x: 1870, y: 2330 },
  { id: 'tower_se', label: '东南哨塔', x: 2330, y: 2330 },
];

export const ZONES: Record<ZoneId, ZoneDef> = {
  sanctuary: {
    id: 'sanctuary',
    name: '中心圣殿广场',
    subtitle: '守卫圣殿女神 · 圣泉回血 · 铁匠铺 & 运水东道',
    biome: 'sanctuary',
    rect: { x: 1220, y: 1220, w: 2480, h: 1760 }, // 涵盖广场及东部运水通道至 (3700, 2980)
    spawnPoint: { x: 2100, y: 2215 },
    isSanctuaryRoad: true,
    allowTeleportOut: true,
    color: '#eab308',
  },
  gold_room: {
    id: 'gold_room',
    name: '练功房 · 金币矿厅',
    subtitle: '持续刷出黄金宝箱怪（支持 初/中/高 三档切换）',
    biome: 'gold',
    rect: { x: 140, y: 1220, w: 860, h: 520 },
    spawnPoint: { x: 570, y: 1480 },
    hasTiers: true,
    allowTeleportOut: true,
    color: '#facc15',
  },
  xp_room: {
    id: 'xp_room',
    name: '练功房 · 奥术经验厅',
    subtitle: '持续刷出高经验灵侍，快速冲刺 15 级觉醒！',
    biome: 'xp',
    rect: { x: 140, y: 1860, w: 860, h: 520 },
    spawnPoint: { x: 570, y: 2120 },
    hasTiers: true,
    allowTeleportOut: true,
    color: '#38bdf8',
  },
  crystal_room: {
    id: 'crystal_room',
    name: '练功房 · 灵晶圣苑',
    subtitle: '稳定刷出灵晶树妖，刷取木头合成顶级装备与停怪',
    biome: 'crystal',
    rect: { x: 140, y: 2500, w: 860, h: 520 },
    spawnPoint: { x: 570, y: 2760 },
    hasTiers: true,
    allowTeleportOut: true,
    color: '#4ade80',
  },
  dungeon_fire: {
    id: 'dungeon_fire',
    name: '秘境 · 炎魔窟',
    subtitle: '击败「烈焰魔君」掉落【炎魔之核】与强化石',
    biome: 'fire',
    rect: { x: 180, y: 180, w: 840, h: 740 },
    spawnPoint: { x: 380, y: 550 },
    recommendedWave: 6,
    bossKind: 'boss_fire_lord',
    bossRespawnSec: 25,
    allowTeleportOut: true,
    color: '#ef4444',
  },
  dungeon_ice: {
    id: 'dungeon_ice',
    name: '秘境 · 寒冰谷',
    subtitle: '击败「极寒冰凰」掉落【冰龙逆鳞】与强化石',
    biome: 'ice',
    rect: { x: 1160, y: 180, w: 840, h: 740 },
    spawnPoint: { x: 1360, y: 550 },
    recommendedWave: 8,
    bossKind: 'boss_ice_phoenix',
    bossRespawnSec: 25,
    allowTeleportOut: true,
    color: '#38bdf8',
  },
  dungeon_thunder: {
    id: 'dungeon_thunder',
    name: '秘境 · 雷霆峰',
    subtitle: '击败「暴雷苍鹰」掉落【雷鹰之羽】与强化石',
    biome: 'thunder',
    rect: { x: 2140, y: 180, w: 840, h: 740 },
    spawnPoint: { x: 2340, y: 550 },
    recommendedWave: 7,
    bossKind: 'boss_thunder_roc',
    bossRespawnSec: 25,
    allowTeleportOut: true,
    color: '#818cf8',
  },
  dungeon_forest: {
    id: 'dungeon_forest',
    name: '秘境 · 圣树林',
    subtitle: '击败「古树长老」掉落【圣树之心】与神秘碎片',
    biome: 'forest',
    rect: { x: 3120, y: 180, w: 880, h: 740 },
    spawnPoint: { x: 3320, y: 550 },
    recommendedWave: 9,
    bossKind: 'boss_ancient_treant',
    bossRespawnSec: 25,
    allowTeleportOut: true,
    color: '#22c55e',
  },
  stone_mine: {
    id: 'stone_mine',
    name: '支线 · 强化石矿洞',
    subtitle: '刷新晶石傀儡，稳定产出装备升阶石',
    biome: 'mine',
    rect: { x: 1220, y: 3160, w: 860, h: 760 },
    spawnPoint: { x: 1450, y: 3540 },
    recommendedWave: 4,
    allowTeleportOut: true,
    color: '#94a3b8',
  },
  bandit_camp: {
    id: 'bandit_camp',
    name: '支线 · 黑石盗贼营地',
    subtitle: '清剿盗贼头目，全队永久解锁商店 85 折！',
    biome: 'bandit',
    rect: { x: 2220, y: 3160, w: 860, h: 760 },
    spawnPoint: { x: 2440, y: 3540 },
    recommendedWave: 3,
    bossKind: 'bandit_chief',
    bossRespawnSec: 40,
    allowTeleportOut: true,
    color: '#f97316',
  },
  trial_tower: {
    id: 'trial_tower',
    name: '支线 · 职业试炼塔',
    subtitle: '击败心魔守卫解锁【职业专属神器】与 Lv.15 觉醒！',
    biome: 'trial',
    rect: { x: 3200, y: 3160, w: 840, h: 760 },
    spawnPoint: { x: 3420, y: 3540 },
    recommendedWave: 7,
    bossKind: 'boss_trial_mirror',
    bossRespawnSec: 35,
    allowTeleportOut: true,
    color: '#c084fc',
  },
  hidden_abyss: {
    id: 'hidden_abyss',
    name: '隐藏秘境 · 深渊祭坛',
    subtitle: '消耗 3 枚神秘碎片开启，击败混沌泰坦爆「混沌本源」',
    biome: 'abyss',
    rect: { x: 180, y: 3160, w: 860, h: 760 },
    spawnPoint: { x: 400, y: 3540 },
    recommendedWave: 15,
    bossKind: 'boss_hidden_chaos',
    bossRespawnSec: 45,
    allowTeleportOut: true,
    color: '#f43f5e',
  },
};

export const ZONE_LIST: ZoneDef[] = Object.values(ZONES);

// 主城周边直达传送阵（同时 HUD 也支持一键传送）
export const PORTALS: PortalDef[] = [
  { id: 'p_gold', fromZone: 'sanctuary', toZone: 'gold_room', x: 1750, y: 1960, radius: 34, label: '金币练功房', color: '#facc15' },
  { id: 'p_xp', fromZone: 'sanctuary', toZone: 'xp_room', x: 1750, y: 2100, radius: 34, label: '经验练功房', color: '#38bdf8' },
  { id: 'p_crys', fromZone: 'sanctuary', toZone: 'crystal_room', x: 1750, y: 2240, radius: 34, label: '灵晶圣苑', color: '#4ade80' },
  { id: 'p_fire', fromZone: 'sanctuary', toZone: 'dungeon_fire', x: 1930, y: 1690, radius: 34, label: '炎魔窟', color: '#ef4444' },
  { id: 'p_ice', fromZone: 'sanctuary', toZone: 'dungeon_ice', x: 2270, y: 1690, radius: 34, label: '寒冰谷', color: '#38bdf8' },
  { id: 'p_trial', fromZone: 'sanctuary', toZone: 'trial_tower', x: 2450, y: 2240, radius: 34, label: '职业试炼塔', color: '#c084fc' },
];

// 中心圣殿的碰撞圆环/装饰物（确保不堵住兵线与运水东道）
export const WORLD_PROPS: WorldPropDef[] = [
  // 圣殿广场四角火盆
  { id: 'braz_1', kind: 'brazier', x: 1960, y: 1960, radius: 18, color: '#fb923c' },
  { id: 'braz_2', kind: 'brazier', x: 2240, y: 1960, radius: 18, color: '#fb923c' },
  { id: 'braz_3', kind: 'brazier', x: 1960, y: 2240, radius: 18, color: '#fb923c' },
  { id: 'braz_4', kind: 'brazier', x: 2240, y: 2240, radius: 18, color: '#fb923c' },
  // 铁匠铺砧台装饰与圣殿雕柱/晶簇/旌旗
  { id: 'anvil_1', kind: 'anvil', x: 2295, y: 2040, radius: 22, color: '#94a3b8' },
  { id: 'ban_s1', kind: 'banner', x: 2015, y: 2035, radius: 14, color: '#eab308' },
  { id: 'ban_s2', kind: 'banner', x: 2185, y: 2035, radius: 14, color: '#eab308' },
  { id: 'crys_f1', kind: 'crystal', x: 1995, y: 2325, radius: 18, color: '#38bdf8' },
  { id: 'crys_f2', kind: 'crystal', x: 2205, y: 2325, radius: 18, color: '#38bdf8' },
  { id: 'pil_n1', kind: 'pillar', x: 1995, y: 1745, radius: 20, color: '#eab308' },
  { id: 'pil_n2', kind: 'pillar', x: 2205, y: 1745, radius: 20, color: '#eab308' },
  { id: 'pil_w1', kind: 'pillar', x: 1835, y: 2010, radius: 20, color: '#eab308' },
  { id: 'pil_w2', kind: 'pillar', x: 1835, y: 2190, radius: 20, color: '#eab308' },
  { id: 'pil_s1', kind: 'pillar', x: 1995, y: 2455, radius: 20, color: '#eab308' },
  { id: 'pil_s2', kind: 'pillar', x: 2205, y: 2455, radius: 20, color: '#eab308' },
  // 圣殿外围古树
  { id: 'tree_1', kind: 'tree', x: 1510, y: 1530, radius: 28 },
  { id: 'tree_2', kind: 'tree', x: 1510, y: 1730, radius: 28 },
  { id: 'tree_3', kind: 'tree', x: 1510, y: 2460, radius: 28 },
  { id: 'tree_4', kind: 'tree', x: 1510, y: 2660, radius: 28 },
  { id: 'tree_5', kind: 'tree', x: 2680, y: 1530, radius: 28 },
  { id: 'tree_6', kind: 'tree', x: 2680, y: 1730, radius: 28 },
  { id: 'tree_7', kind: 'tree', x: 2680, y: 2460, radius: 28 },
  { id: 'tree_8', kind: 'tree', x: 2680, y: 2660, radius: 28 },
  { id: 'tree_c1', kind: 'tree', x: 1640, y: 1440, radius: 28 },
  { id: 'tree_c2', kind: 'tree', x: 2560, y: 1440, radius: 28 },
  { id: 'tree_c3', kind: 'tree', x: 1640, y: 2760, radius: 28 },
  { id: 'tree_c4', kind: 'tree', x: 2560, y: 2760, radius: 28 },
  // 运水东道两旁哨旗与古树
  { id: 'ban_1', kind: 'banner', x: 2850, y: 2020, radius: 16, color: '#eab308' },
  { id: 'ban_2', kind: 'banner', x: 3180, y: 2020, radius: 16, color: '#eab308' },
  { id: 'ban_3', kind: 'banner', x: 2850, y: 2280, radius: 16, color: '#eab308' },
  { id: 'ban_4', kind: 'banner', x: 3180, y: 2280, radius: 16, color: '#eab308' },
  { id: 'tree_e1', kind: 'tree', x: 2980, y: 1910, radius: 28 },
  { id: 'tree_e2', kind: 'tree', x: 3340, y: 1910, radius: 28 },
  { id: 'tree_e3', kind: 'tree', x: 2980, y: 2390, radius: 28 },
  { id: 'tree_e4', kind: 'tree', x: 3340, y: 2390, radius: 28 },
  // 四大副本装饰柱
  { id: 'pil_f1', kind: 'pillar', x: 460, y: 310, radius: 22, color: '#ef4444' },
  { id: 'pil_f2', kind: 'pillar', x: 460, y: 780, radius: 22, color: '#ef4444' },
  { id: 'crys_i1', kind: 'crystal', x: 1440, y: 310, radius: 22, color: '#38bdf8' },
  { id: 'crys_i2', kind: 'crystal', x: 1440, y: 780, radius: 22, color: '#38bdf8' },
  { id: 'pil_t1', kind: 'pillar', x: 2420, y: 310, radius: 22, color: '#818cf8' },
  { id: 'pil_t2', kind: 'pillar', x: 2420, y: 780, radius: 22, color: '#818cf8' },
  { id: 'tree_fr1', kind: 'tree', x: 3380, y: 310, radius: 28 },
  { id: 'tree_fr2', kind: 'tree', x: 3380, y: 780, radius: 28 },
  // 盗贼营地帐篷
  { id: 'tent_1', kind: 'tent', x: 2560, y: 3300, radius: 26 },
  { id: 'tent_2', kind: 'tent', x: 2560, y: 3780, radius: 26 },
];

export function clampToRect(x: number, y: number, r: number, rect: Rect): { x: number; y: number } {
  return {
    x: Math.max(rect.x + r, Math.min(rect.x + rect.w - r, x)),
    y: Math.max(rect.y + r, Math.min(rect.y + rect.h - r, y)),
  };
}
