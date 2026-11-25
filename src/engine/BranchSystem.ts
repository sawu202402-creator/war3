import { SoundFX } from '../audio/SoundFX';
import { DIFFICULTIES } from '../data/heroes';
import { getItemDef } from '../data/items';
import { ENEMY_ARCHETYPES } from '../data/waves';
import { FOUNTAIN_POS, WATER_ALTAR_POS, ZONES, clampToRect } from '../data/worldMap';
import { SaveManager } from '../meta/SaveManager';
import { EnemyKind, ZoneId } from '../types';
import { addFloatingText, grantHeroXp, recalcHeroStats } from './CombatSystem';
import { countOwnedItem } from './EconomySystem';
import { EnemyAffix, EnemyEntity, GameWorldState, HeroEntity } from './GameState';

export function applyEnemyAffix(e: EnemyEntity, affix: EnemyAffix): void {
  if (e.isBoss || e.affix) return;
  e.affix = affix;
  e.radius = Math.round(e.radius * 1.18);
  if (affix === 'bloodlust') {
    e.name = `【嗜血】${e.name}`;
    e.maxHp = Math.round(e.maxHp * 2.45);
    e.hp = e.maxHp;
    e.dmg = Math.round(e.dmg * 1.32);
    e.moveSpeed = Math.round(e.moveSpeed * 1.1);
    e.color = '#dc2626';
    e.accentColor = '#fca5a5';
  } else if (affix === 'armored') {
    e.name = `【铁壁】${e.name}`;
    e.maxHp = Math.round(e.maxHp * 2.85);
    e.hp = e.maxHp;
    e.armor += 10;
    e.dmg = Math.round(e.dmg * 1.18);
    e.color = '#d97706';
    e.accentColor = '#fde047';
  } else if (affix === 'swift') {
    e.name = `【疾风】${e.name}`;
    e.maxHp = Math.round(e.maxHp * 2.15);
    e.hp = e.maxHp;
    e.moveSpeed = Math.round(e.moveSpeed * 1.34);
    e.attackCd = Math.max(0.45, e.attackCd * 0.76);
    e.dmg = Math.round(e.dmg * 1.25);
    e.color = '#10b981';
    e.accentColor = '#6ee7b7';
  } else if (affix === 'blazing') {
    e.name = `【炽焰】${e.name}`;
    e.maxHp = Math.round(e.maxHp * 2.4);
    e.hp = e.maxHp;
    e.dmg = Math.round(e.dmg * 1.28);
    e.burnAuraTimer = 1.2;
    e.color = '#ea580c';
    e.accentColor = '#fdba74';
  }
  e.goldReward = Math.round(e.goldReward * 2.6);
  e.xpReward = Math.round(e.xpReward * 2.4);
}

export function spawnEnemy(
  world: GameWorldState,
  kind: EnemyKind,
  zoneId: ZoneId,
  x: number,
  y: number,
  hpMult: number,
  dmgMult: number,
  tierMult = 1.0,
  laneId = 0,
  splitGen = 0
): EnemyEntity {
  const arch = ENEMY_ARCHETYPES[kind];
  const diff = DIFFICULTIES[world.difficulty];
  const isWaveMob = zoneId === 'sanctuary';
  const isStandardWaveCreep =
    isWaveMob && !arch.isBoss && !arch.isMiniBoss && kind !== 'treasure_goblin' && kind !== 'wandering_elite';
  const coopHpScale = 1 + (world.playerCount - 1) * 0.58;
  const coopDmgScale = 1 + (world.playerCount - 1) * 0.22;

  const finalHp = Math.round(
    arch.baseHp *
      hpMult *
      tierMult *
      diff.hpMult *
      (isWaveMob ? coopHpScale : 1 + (world.playerCount - 1) * 0.32) *
      (arch.isBoss ? 1.35 : isStandardWaveCreep ? 1.05 : 1.15) *
      (splitGen > 0 ? 0.48 : 1)
  );
  const finalDmg = Math.round(
    arch.baseDmg *
      dmgMult *
      Math.sqrt(tierMult) *
      diff.dmgMult *
      coopDmgScale *
      (arch.isBoss ? 1.3 : isStandardWaveCreep ? 1.0 : 1.15)
  );

  const e: EnemyEntity = {
    id: world.nextEntityId++,
    kind,
    name: splitGen > 0 ? `分裂${arch.name}` : arch.name,
    zoneId,
    isBoss: Boolean(arch.isBoss),
    isMiniBoss: Boolean(arch.isMiniBoss),
    isRanged: Boolean(arch.isRanged),
    isHealer: Boolean(arch.isHealer),
    isSuicide: Boolean(arch.isSuicide),
    isSplitter: Boolean(arch.isSplitter && splitGen === 0),
    preferAthena: Boolean(arch.preferAthena),
    x,
    y,
    vx: 0,
    vy: 0,
    radius: splitGen > 0 ? Math.max(14, arch.radius * 0.72) : arch.radius,
    facing: 0,
    hp: finalHp,
    maxHp: finalHp,
    shield: 0,
    dmg: finalDmg,
    armor: arch.baseArmor + Math.floor(world.wave * 0.4),
    moveSpeed: arch.moveSpeed * (isWaveMob ? diff.speedMult : 1.0),
    attackRange: arch.attackRange,
    attackCd: arch.attackCd,
    attackTimer: Math.random() * 0.4,
    goldReward: Math.max(
      2,
      Math.round(
        arch.goldReward *
          tierMult *
          diff.rewardMult *
          (isStandardWaveCreep ? 0.62 : 1) *
          (splitGen > 0 ? 0.35 : 1)
      )
    ),
    crystalReward: arch.crystalReward ? Math.round(arch.crystalReward * (tierMult >= 2 ? 1.5 : 1)) : 0,
    xpReward: Math.max(
      4,
      Math.round(arch.xpReward * tierMult * (isStandardWaveCreep ? 0.65 : 1) * (splitGen > 0 ? 0.35 : 1))
    ),
    color: arch.color,
    accentColor: arch.accentColor,
    laneId,
    waypointIdx: 0,
    spawnX: x,
    spawnY: y,
    tierMult,
    stunTimer: 0,
    slowTimer: 0,
    slowFactor: 0,
    burnTimer: 0,
    burnDps: 0,
    armorShredTimer: 0,
    tauntTargetId: null,
    tauntTimer: 0,
    hitFlash: 0,
    bossAbilityTimer: arch.isBoss ? 4.5 : 6.0,
    bossPhase: 1,
    fleeTimer: kind === 'treasure_goblin' ? 28 : 0,
    splitGeneration: splitGen,
    prevX: x,
    prevY: y,
    moveSpeedNorm: 0,
    animPhase: Math.random() * Math.PI * 2,
    attackAnim: 0,
    knockX: 0,
    knockY: 0,
  };
  world.enemies.push(e);
  return e;
}

export function teleportHeroToZone(
  world: GameWorldState,
  hero: HeroEntity,
  toZone: ZoneId,
  trainingTier?: 1 | 2 | 3
): boolean {
  if (hero.dead) return false;
  const zone = ZONES[toZone];
  if (!zone) return false;

  if (toZone === 'hidden_abyss' && !world.hiddenAbyssUnlocked) {
    // Require 3 mat_shard across local hero's inventory+stash
    const shardsOwned = countOwnedItem(hero, 'mat_shard');
    if (shardsOwned < 3) {
      if (hero.isLocal) {
        addFloatingText(world, hero.x, hero.y - 30, `需要 3 枚【神秘时空碎片】开启 (${shardsOwned}/3)`, '#f43f5e', 13);
      }
      return false;
    }
    let left = 3;
    for (let i = 0; i < hero.inventory.length && left > 0; i++) {
      if (hero.inventory[i] === 'mat_shard') {
        hero.inventory[i] = null;
        left--;
      }
    }
    for (let i = 0; i < hero.stash.length && left > 0; i++) {
      if (hero.stash[i] === 'mat_shard') {
        hero.stash[i] = null;
        left--;
      }
    }
    world.hiddenAbyssUnlocked = true;
    world.bannerText = `🌀 ${hero.callsign} 集齐时空碎片，开启了【隐藏深渊祭坛】！`;
    world.bannerColor = '#f43f5e';
    world.bannerTimer = 4.0;
  }

  if (trainingTier && (toZone === 'gold_room' || toZone === 'xp_room' || toZone === 'crystal_room')) {
    world.trainingTiers[toZone] = trainingTier;
  }

  if (hero.carryingWater && toZone !== 'sanctuary') {
    hero.carryingWater = false;
    if (hero.isLocal) addFloatingText(world, hero.x, hero.y - 26, '传送导致圣水洒出，任务中断', '#fbbf24', 12);
  }

  world.vfx.push({ kind: 'teleport', x: hero.x, y: hero.y, radius: 42, color: zone.color, life: 0.4, maxLife: 0.4 });
  hero.zoneId = toZone;
  hero.x = zone.spawnPoint.x + (Math.random() - 0.5) * 32;
  hero.y = zone.spawnPoint.y + (Math.random() - 0.5) * 32;
  hero.recallTimer = 0;
  world.vfx.push({ kind: 'teleport', x: hero.x, y: hero.y, radius: 46, color: zone.color, life: 0.45, maxLife: 0.45 });
  if (hero.isLocal) SoundFX.playTeleport();
  addFloatingText(world, hero.x, hero.y - 34, `传送至 ${zone.name}`, zone.color, 14);
  return true;
}

export function handleEnemyDeathDrops(world: GameWorldState, enemy: EnemyEntity, killer?: HeroEntity): void {
  // Credit kills, mana siphon, Musou combo & exclusive growth
  if (killer) {
    killer.kills += 1;
    killer.mp = Math.min(killer.stats.maxMp, killer.mp + (enemy.isBoss ? 8 : 1.5));
    killer.comboCount += 1;
    killer.comboTimer = 5.2;
    if (killer.comboCount > killer.comboPeak) killer.comboPeak = killer.comboCount;
    const prevTier = killer.comboTier;
    const nextTier = killer.comboCount >= 60 ? 3 : killer.comboCount >= 30 ? 2 : killer.comboCount >= 10 ? 1 : 0;
    if (nextTier !== prevTier) {
      killer.comboTier = nextTier;
      recalcHeroStats(killer);
    }
    const c = killer.comboCount;
    if (c === 10 || c === 25 || c === 50 || c === 80 || c === 120 || (c > 120 && c % 50 === 0)) {
      addFloatingText(
        world,
        killer.x,
        killer.y - 54,
        `${c} 连斩!`,
        nextTier >= 3 ? '#f43f5e' : '#facc15',
        nextTier >= 2 ? 18 : 15
      );
      if (killer.isLocal) SoundFX.playKillStreak(nextTier);
    }

    if (enemy.isBoss) killer.bossKills += 1;
    if (killer.exclusiveUnlocked && killer.exclusiveLevel < 5) {
      killer.exclusiveKills += enemy.isBoss ? 15 : 1;
      const thresholds = [0, 35, 90, 180, 320];
      const nextLv = killer.exclusiveLevel;
      if (killer.exclusiveKills >= thresholds[nextLv]) {
        killer.exclusiveLevel += 1;
        recalcHeroStats(killer);
        addFloatingText(world, killer.x, killer.y - 42, `专属神器升至 Lv.${killer.exclusiveLevel}!`, '#f43f5e', 16);
        if (killer.isLocal) SoundFX.playLevelUp();
      }
    }
  }

  // Death burst VFX & boss camera shake
  world.vfx.push({
    kind: enemy.isBoss ? 'explosion' : 'hit_spark',
    x: enemy.x,
    y: enemy.y,
    radius: enemy.isBoss ? 92 : 28,
    color: enemy.isBoss ? '#f97316' : enemy.accentColor,
    life: enemy.isBoss ? 0.45 : 0.22,
    maxLife: enemy.isBoss ? 0.45 : 0.22,
  });
  if (enemy.isBoss) {
    world.vfx.push({
      kind: 'ring',
      x: enemy.x,
      y: enemy.y,
      radius: 135,
      color: '#facc15',
      life: 0.42,
      maxLife: 0.42,
    });
    world.cameraShake = Math.max(world.cameraShake, 8.5);
  }

  // Distribute gold, crystal & XP across heroes in same zone (65% instant + 35% magnetic drop for creeps)
  const recipients = world.heroes.filter(
    (h) => !h.dead && (enemy.isBoss || h.zoneId === enemy.zoneId)
  );
  const targets = recipients.length > 0 ? recipients : world.heroes.filter((h) => !h.dead);
  const splitGold = Math.max(1, Math.round(enemy.goldReward / Math.max(1, targets.length * 0.72)));
  const splitXp = Math.max(1, Math.round(enemy.xpReward / Math.max(1, targets.length * 0.78)));
  const instantGold = enemy.isBoss ? splitGold : Math.max(1, Math.round(splitGold * 0.65));
  const dropGold = enemy.isBoss ? 0 : Math.max(1, splitGold - instantGold);

  for (const h of targets) {
    h.gold += instantGold;
    if (enemy.crystalReward > 0) h.crystal += enemy.crystalReward;
    grantHeroXp(world, h, splitXp);
  }
  if (dropGold > 0 && world.drops.length < 180) {
    world.drops.push({
      id: world.nextEntityId++,
      zoneId: enemy.zoneId,
      x: enemy.x + (Math.random() - 0.5) * 26,
      y: enemy.y + (Math.random() - 0.5) * 26,
      kind: 'gold',
      amount: dropGold,
      life: 24,
    });
  }
  if (killer?.isLocal) {
    SaveManager.addDailyProgress('kills', 1);
    if (enemy.isBoss) SaveManager.addDailyProgress('bosses', 1);
  }

  // Material drops (shared personal drop into inventory/stash or on ground for Boss!)
  const arch = ENEMY_ARCHETYPES[enemy.kind];
  if (arch.dropItems) {
    for (const d of arch.dropItems) {
      if (Math.random() <= d.chance) {
        if (enemy.isBoss || enemy.isMiniBoss) {
          // Give directly to each living hero in zone (or all players for Stage Boss) so co-op doesn't fight over loot!
          for (const h of targets) {
            if (d.itemId === 'mat_stone') {
              h.stones += 1;
              addFloatingText(world, h.x, h.y - 30, '+1 强化石', '#38bdf8', 13);
            } else {
              const freeInv = h.inventory.indexOf(null);
              const freeSt = h.stash.indexOf(null);
              const def = getItemDef(d.itemId);
              if (freeInv >= 0) h.inventory[freeInv] = d.itemId;
              else if (freeSt >= 0) h.stash[freeSt] = d.itemId;
              else {
                world.drops.push({
                  id: world.nextEntityId++,
                  zoneId: enemy.zoneId,
                  x: enemy.x + (Math.random() - 0.5) * 40,
                  y: enemy.y + (Math.random() - 0.5) * 40,
                  kind: 'item',
                  amount: 1,
                  itemId: d.itemId,
                  life: 45,
                });
              }
              if (def) addFloatingText(world, h.x, h.y - 38, `获得【${def.name}】`, '#fb923c', 14);
            }
          }
        } else {
          world.drops.push({
            id: world.nextEntityId++,
            zoneId: enemy.zoneId,
            x: enemy.x,
            y: enemy.y,
            kind: d.itemId === 'mat_stone' ? 'stone' : 'item',
            amount: 1,
            itemId: d.itemId,
            life: 30,
          });
        }
      }
    }
  }
  if (enemy.affix && Math.random() < 0.42 && world.drops.length < 180) {
    world.drops.push({
      id: world.nextEntityId++,
      zoneId: enemy.zoneId,
      x: enemy.x + (Math.random() - 0.5) * 18,
      y: enemy.y + (Math.random() - 0.5) * 18,
      kind: 'stone',
      amount: 1,
      itemId: 'mat_stone',
      life: 32,
    });
  }

  // Special Branch Boss Clear Hooks
  if (enemy.kind === 'bandit_chief' && !world.quests.banditCleared) {
    world.quests.banditCleared = true;
    world.quests.shopDiscount = 0.15;
    world.bannerText = '🏴‍☠️ 盗贼营地已清剿！全队商店永久享 85 折优惠！';
    world.bannerColor = '#4ade80';
    world.bannerTimer = 4.0;
    SaveManager.addDailyProgress('quests', 1);
  }

  if (enemy.kind === 'boss_trial_mirror') {
    for (const h of targets) {
      if (!h.exclusiveUnlocked) {
        h.exclusiveUnlocked = true;
        h.exclusiveLevel = 1;
        const exId = `ex_${h.classId}`;
        const freeInv = h.inventory.indexOf(null);
        const freeSt = h.stash.indexOf(null);
        if (freeInv >= 0) h.inventory[freeInv] = exId;
        else if (freeSt >= 0) h.stash[freeSt] = exId;
        recalcHeroStats(h);
        addFloatingText(world, h.x, h.y - 44, '解锁【职业专属神器】!', '#f43f5e', 16);
        if (h.level >= 15 && !h.awakeningUnlocked) {
          h.awakeningPrompted = true;
        }
        SaveManager.addDailyProgress('quests', 1);
      }
    }
  }

  // Respawn timer for dungeon bosses
  const zone = ZONES[enemy.zoneId];
  if (zone && zone.bossKind === enemy.kind && zone.bossRespawnSec) {
    world.dungeonRespawns[enemy.zoneId] = zone.bossRespawnSec;
  }

  // Splitter Slime spawns 2 mini slimes
  if (enemy.isSplitter && enemy.splitGeneration === 0) {
    for (let i = 0; i < 2; i++) {
      const child = spawnEnemy(
        world,
        'split_slime',
        enemy.zoneId,
        enemy.x + (i === 0 ? -24 : 24),
        enemy.y + 12,
        Math.max(1, enemy.maxHp / ENEMY_ARCHETYPES.split_slime.baseHp),
        Math.max(1, enemy.dmg / ENEMY_ARCHETYPES.split_slime.baseDmg),
        enemy.tierMult,
        enemy.laneId,
        1
      );
      child.waypointIdx = enemy.waypointIdx;
    }
  }
}

export function updateBranches(world: GameWorldState, dt: number): void {
  // 1. Dungeon boss respawn timers
  for (const zid of Object.keys(world.dungeonRespawns)) {
    if (world.dungeonRespawns[zid] > 0) {
      world.dungeonRespawns[zid] = Math.max(0, world.dungeonRespawns[zid] - dt);
    }
  }

  // 2. Training Rooms & Stone Mine spawns (strictly only when a living hero is inside)
  const trainingZones: ('gold_room' | 'xp_room' | 'crystal_room' | 'stone_mine')[] = [
    'gold_room',
    'xp_room',
    'crystal_room',
    'stone_mine',
  ];
  for (const zid of trainingZones) {
    const heroInside = world.heroes.some((h) => !h.dead && h.zoneId === zid);
    if (!heroInside) continue;

    world.trainingSpawnTimer[zid] -= dt;
    if (world.trainingSpawnTimer[zid] <= 0) {
      world.trainingSpawnTimer[zid] = zid === 'stone_mine' ? 2.8 : 1.25;
      const existing = world.enemies.filter((e) => e.zoneId === zid && e.hp > 0).length;
      const cap = zid === 'stone_mine' ? 4 : 11;
      const spawnBatch = Math.min(cap - existing, zid === 'stone_mine' ? 1 : 2);
      for (let s = 0; s < spawnBatch; s++) {
        const rect = ZONES[zid].rect;
        const sx = rect.x + 220 + Math.random() * (rect.w - 300);
        const sy = rect.y + 100 + Math.random() * (rect.h - 200);
        const tier = zid === 'stone_mine' ? 1 : world.trainingTiers[zid];
        const tierMult = tier === 1 ? 1.0 : tier === 2 ? 3.5 : 9.2;
        const kind: EnemyKind =
          zid === 'gold_room'
            ? 'train_gold_mob'
            : zid === 'xp_room'
              ? 'train_xp_mob'
              : zid === 'crystal_room'
                ? 'train_crystal_mob'
                : 'mine_golem';
        spawnEnemy(world, kind, zid, sx, sy, 1.45 + world.wave * 0.34, 1.45 + world.wave * 0.22, tierMult);
      }
    }
  }

  // 3. Dungeon / Bandit / Trial / Hidden Boss spawns when player visits and respawn ready
  const bossZones: ZoneId[] = [
    'dungeon_fire',
    'dungeon_ice',
    'dungeon_thunder',
    'dungeon_forest',
    'bandit_camp',
    'trial_tower',
    'hidden_abyss',
  ];
  for (const zid of bossZones) {
    const z = ZONES[zid];
    if (!z.bossKind) continue;
    const heroInside = world.heroes.some((h) => !h.dead && h.zoneId === zid);
    if (!heroInside) continue;
    const bossAlive = world.enemies.some((e) => e.zoneId === zid && e.kind === z.bossKind && e.hp > 0);
    if (!bossAlive && (world.dungeonRespawns[zid] || 0) <= 0) {
      const bx = z.rect.x + z.rect.w * 0.68;
      const by = z.rect.y + z.rect.h * 0.5;
      spawnEnemy(world, z.bossKind, zid, bx, by, 1 + world.wave * 0.08, 1 + world.wave * 0.05, 1.0);
      if (zid === 'bandit_camp') {
        for (let i = 0; i < 4; i++) {
          spawnEnemy(world, 'bandit_grunt', zid, bx - 90 + i * 35, by + (i % 2 === 0 ? -70 : 70), 1, 1);
        }
      }
    }
  }

  // 4. Water Delivery Quest & Fountain Healing
  for (const h of world.heroes) {
    if (h.dead || h.zoneId !== 'sanctuary') continue;
    // Fountain fast regen
    if (Math.hypot(h.x - FOUNTAIN_POS.x, h.y - FOUNTAIN_POS.y) <= FOUNTAIN_POS.radius) {
      h.hp = Math.min(h.stats.maxHp, h.hp + h.stats.maxHp * 0.18 * dt);
      h.mp = Math.min(h.stats.maxMp, h.mp + h.stats.maxMp * 0.24 * dt);

      if (!h.carryingWater && h.waterDeliveriesDone < 5 && h.isLocal) {
        h.carryingWater = true;
        addFloatingText(world, h.x, h.y - 40, '接满圣泉之水！沿东路送往祭坛 →', '#38bdf8', 14);
      }
    }

    if (h.carryingWater && Math.hypot(h.x - WATER_ALTAR_POS.x, h.y - WATER_ALTAR_POS.y) <= WATER_ALTAR_POS.radius) {
      h.carryingWater = false;
      h.waterDeliveriesDone += 1;
      h.gold += 260;
      h.crystal += 1;
      grantHeroXp(world, h, 260);
      if (h.waterDeliveriesDone === 1) {
        const freeInv = h.inventory.indexOf(null);
        if (freeInv >= 0 && countOwnedItem(h, 'boot_t2') === 0) {
          h.inventory[freeInv] = 'boot_t2';
          recalcHeroStats(h);
          addFloatingText(world, h.x, h.y - 54, '首运赠礼：迅捷战靴!', '#4ade80', 14);
        }
      }
      addFloatingText(world, h.x, h.y - 34, `运水成功 (${h.waterDeliveriesDone}/5) +260G +1木`, '#fde047', 15);
      if (h.isLocal) {
        SoundFX.playHolyChime();
        SaveManager.addDailyProgress('quests', 1);
      }
    }
  }

  // 5. Magnetic Auto-Vacuum Drop Pickups
  for (let i = world.drops.length - 1; i >= 0; i--) {
    const drop = world.drops[i];
    drop.life -= dt;
    if (drop.life <= 0) {
      world.drops.splice(i, 1);
      continue;
    }
    let nearestHero: HeroEntity | undefined;
    let nearestDist = Infinity;
    for (const h of world.heroes) {
      if (h.dead || h.zoneId !== drop.zoneId) continue;
      if (drop.kind === 'item' && h.inventory.indexOf(null) < 0 && h.stash.indexOf(null) < 0) continue;
      const d = Math.hypot(h.x - drop.x, h.y - drop.y);
      if (d < nearestDist) {
        nearestDist = d;
        nearestHero = h;
      }
    }
    if (nearestHero && nearestDist > 38 && (nearestDist <= 260 || (drop.kind !== 'item' && drop.life < 8))) {
      const pullSpd = drop.life < 8 ? 820 : 620;
      const step = Math.min(nearestDist - 12, pullSpd * dt);
      drop.x += ((nearestHero.x - drop.x) / nearestDist) * step;
      drop.y += ((nearestHero.y - drop.y) / nearestDist) * step;
      nearestDist = Math.hypot(nearestHero.x - drop.x, nearestHero.y - drop.y);
    }
    if (nearestHero && nearestDist <= 46) {
      const picker = nearestHero;
      if (drop.kind === 'gold') picker.gold += drop.amount;
      else if (drop.kind === 'crystal') picker.crystal += drop.amount;
      else if (drop.kind === 'stone') picker.stones += drop.amount;
      else if (drop.kind === 'item' && drop.itemId) {
        const fi = picker.inventory.indexOf(null);
        const fs = picker.stash.indexOf(null);
        if (fi >= 0) picker.inventory[fi] = drop.itemId;
        else if (fs >= 0) picker.stash[fs] = drop.itemId;
        else continue; // inventory full
        recalcHeroStats(picker);
        const def = getItemDef(drop.itemId);
        if (def) addFloatingText(world, picker.x, picker.y - 30, `拾取【${def.name}】`, '#fb923c', 13);
      }
      if (picker.isLocal) SoundFX.playGold();
      world.drops.splice(i, 1);
    }
  }

  // 6. Random Events (Treasure Goblin / Wandering Elite)
  if (world.wave >= 2 && world.waveState === 'fighting') {
    world.quests.randomEventCooldown -= dt;
    if (world.quests.randomEventCooldown <= 0) {
      world.quests.randomEventCooldown = 72;
      const isGoblin = Math.random() < 0.65;
      const sx = 1780 + Math.random() * 640;
      const sy = 1860 + Math.random() * 640;
      if (isGoblin) {
        spawnEnemy(world, 'treasure_goblin', 'sanctuary', sx, sy, 1 + world.wave * 0.25, 1);
        world.bannerText = '💰 奇遇事件：盗宝地精潜入圣殿广场，快追杀夺取金币与宝石！';
      } else {
        spawnEnemy(world, 'wandering_elite', 'sanctuary', sx, sy, 1 + world.wave * 0.25, 1 + world.wave * 0.1);
        world.bannerText = '⚠️ 奇遇事件：深渊巡逻官空降外围，击败可获得强化石与灵晶！';
      }
      world.bannerColor = '#facc15';
      world.bannerTimer = 4.0;
    }
  }

  // 7. Clamp all entities safely inside their zone rect
  for (const h of world.heroes) {
    const rect = ZONES[h.zoneId].rect;
    const cl = clampToRect(h.x, h.y, 18, rect);
    h.x = cl.x;
    h.y = cl.y;
  }
}
