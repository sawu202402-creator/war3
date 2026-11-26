import { SoundFX } from '../audio/SoundFX';
import { DIFFICULTIES, getHeroClassDef } from '../data/heroes';
import { getWaveDef } from '../data/waves';
import {
  ATHENA_POS,
  CONVERGENCE_POS,
  HERO_COLLISION_RADIUS,
  HERO_FORMATION_OFFSETS,
  HERO_SPAWN_POS,
  WAVE_LANES,
  ZONES,
  clampToRect,
  moveWithBuildingSteering,
  resolveWorldCollision,
} from '../data/worldMap';
import { SaveManager } from '../meta/SaveManager';
import { EnemyKind } from '../types';
import { applyEnemyAffix, handleEnemyDeathDrops, spawnEnemy, teleportHeroToZone } from './BranchSystem';
import {
  addFloatingText,
  applyDamageToEnemy,
  applyDamageToHero,
  castHeroSkill,
  distPointToSegment,
  maybeTriggerOrbChain,
  performBasicAttack,
} from './CombatSystem';
import { buyItem, getQuickBuyOptions, synthesizeItem, upgradeItemInSlot, usePotionSlot } from './EconomySystem';
import { EnemyAffix, EnemyEntity, GameWorldState, HeroEntity } from './GameState';

export function startWave(world: GameWorldState, waveNum: number): void {
  world.wave = waveNum;
  world.waveState = 'fighting';
  const waveDef = getWaveDef(waveNum);
  const diff = DIFFICULTIES[world.difficulty];
  const coopCountScale = 1 + (world.playerCount - 1) * 0.35;

  const queue: { kind: EnemyKind; laneId: number; affix?: EnemyAffix }[] = [];
  for (const g of waveDef.groups) {
    const total = Math.max(1, Math.round(g.count * diff.countMult * coopCountScale));
    for (let i = 0; i < total; i++) {
      const laneId = i % Math.max(1, waveDef.lanes);
      queue.push({ kind: g.kind, laneId });
    }
  }

  let hasElites = false;
  if (waveNum >= 4 && queue.length > 0) {
    const affixes: EnemyAffix[] = ['bloodlust', 'armored', 'swift', 'blazing'];
    const eligible = queue
      .map((item, idx) => ({ item, idx }))
      .filter(({ item }) => item.kind !== 'bomb_golem' && item.kind !== 'shaman_healer' && item.kind !== 'split_slime');
    if (eligible.length > 0) {
      const targetCount = Math.min(eligible.length, waveNum >= 10 ? 3 : waveNum >= 7 ? 2 : 1);
      for (let k = 0; k < targetCount; k++) {
        const pickPos = Math.min(eligible.length - 1, Math.floor(((k + 1) * eligible.length) / (targetCount + 1)));
        eligible[pickPos].item.affix = affixes[(waveNum + k) % affixes.length];
        hasElites = true;
      }
    }
  }

  if (waveDef.boss) {
    const insertIdx = Math.max(0, Math.floor(queue.length * 0.65));
    const bosses: { kind: EnemyKind; laneId: number; affix?: EnemyAffix }[] = [{ kind: waveDef.boss, laneId: 1 }];
    if (waveNum >= 20 && diff.doubleBossOn20) {
      bosses.push({ kind: 'boss_frost_wyrm', laneId: 0 });
    }
    queue.splice(insertIdx, 0, ...bosses);
    SoundFX.playBossHorn();
    SoundFX.setBgmMode('boss');
  } else {
    SoundFX.setBgmMode('combat');
  }

  world.waveSpawnQueue = queue;
  world.waveSpawnCooldown = 0.2;
  world.bannerText = `⚔️ 第 ${waveNum} 波：${waveDef.title}${hasElites && !waveDef.boss ? ' · 精英词缀队长出没！' : ''}`;
  world.bannerColor = waveDef.boss ? '#f43f5e' : '#fbbf24';
  world.bannerTimer = 3.8;
}

export function startWaveEarly(world: GameWorldState, hero: HeroEntity): boolean {
  if (world.waveState !== 'prep') return false;
  const bonusGold = 80 + world.wave * 22;
  for (const h of world.heroes) {
    h.gold += bonusGold;
    if (world.wave >= 4) h.crystal += 1;
  }
  addFloatingText(world, hero.x, hero.y - 34, `提前出怪 +${bonusGold}G`, '#facc15', 14);
  startWave(world, world.wave + 1);
  return true;
}

export function updateWaveDirector(
  world: GameWorldState,
  dt: number,
  onStandardVictory: () => void
): void {
  if (world.ended) return;

  if (world.waveState === 'prep') {
    world.wavePrepTimer -= dt;
    if (world.wavePrepTimer <= 0) {
      startWave(world, world.wave + 1);
    }
    return;
  }

  if (world.waveState === 'fighting') {
    if (world.waveSpawnQueue.length > 0) {
      world.waveSpawnCooldown -= dt;
      if (world.waveSpawnCooldown <= 0) {
        const waveDef = getWaveDef(world.wave);
        const batch = Math.min(world.wave <= 2 ? 3 : 6, world.waveSpawnQueue.length);
        for (let i = 0; i < batch; i++) {
          const item = world.waveSpawnQueue.shift()!;
          const lane = WAVE_LANES[item.laneId % WAVE_LANES.length];
          const flank = i >= 3 ? -12 : 12;
          const sx = lane.spawn.x + flank + (Math.random() - 0.5) * 20;
          const sy = lane.spawn.y + (Math.random() - 0.5) * 26;
          const spawned = spawnEnemy(
            world,
            item.kind,
            'sanctuary',
            sx,
            sy,
            waveDef.hpMult,
            waveDef.dmgMult,
            1.0,
            lane.id
          );
          if (item.affix) {
            applyEnemyAffix(spawned, item.affix);
          }
        }
        world.waveSpawnCooldown = world.wave <= 3 ? 0.92 : world.wave >= 8 ? 0.62 : 0.72;
      }
    } else {
      const waveLeft = world.enemies.some(
        (e) =>
          e.zoneId === 'sanctuary' &&
          e.hp > 0 &&
          e.kind !== 'treasure_goblin' &&
          e.kind !== 'wandering_elite'
      );
      if (!waveLeft) {
        // Wave cleared!
        SaveManager.addDailyProgress('waves', 1);
        for (const h of world.heroes) {
          h.gold += 80 + world.wave * 18;
          if (world.wave % 3 === 0) h.crystal += 1;
        }
        if (world.wave === 20 && !world.endlessMode) {
          onStandardVictory();
          return;
        }
        const nextWave = getWaveDef(world.wave + 1);
        world.waveState = 'prep';
        world.wavePrepTimer = nextWave.prepSeconds;
        SoundFX.setBgmMode('combat');
        world.bannerText = `✅ 第 ${world.wave} 波守卫成功！休整 ${Math.round(world.wavePrepTimer)} 秒（可前往练功房/秘境）`;
        world.bannerColor = '#4ade80';
        world.bannerTimer = 3.5;
      }
    }
  }
}

export function applyDamageToSanctuary(world: GameWorldState, rawDmg: number, isSiege = false): void {
  if (world.ended || world.sanctuary.invulnTimer > 0) return;
  const armorMult = 100 / (100 + world.sanctuary.armor * 3);
  const fortifiedMult = isSiege ? 1.0 : 0.72;
  const dmg = Math.max(1, Math.round(rawDmg * armorMult * fortifiedMult));

  if (world.sanctuary.shield > 0) {
    const ab = Math.min(world.sanctuary.shield, dmg);
    world.sanctuary.shield -= ab;
    world.sanctuary.hp -= dmg - ab;
  } else {
    world.sanctuary.hp -= dmg;
  }
  world.sanctuary.underAttackFlash = 0.35;
  world.cameraShake = Math.max(world.cameraShake, rawDmg > 120 ? 4.5 : 2.0);
  SoundFX.playAthenaWarn();

  if (world.sanctuary.hp <= 0) {
    world.sanctuary.hp = 0;
  }
}

export function updateEnemies(world: GameWorldState, dt: number): void {
  const onKilled = (enemy: EnemyEntity, killer?: HeroEntity) => handleEnemyDeathDrops(world, enemy, killer);

  for (let i = world.enemies.length - 1; i >= 0; i--) {
    const e = world.enemies[i];
    if (e.hp <= 0) {
      world.enemies.splice(i, 1);
      continue;
    }

    if (e.hitFlash > 0) e.hitFlash -= dt;
    if (e.stunTimer > 0) e.stunTimer -= dt;
    if (e.slowTimer > 0) e.slowTimer -= dt;
    if (e.armorShredTimer > 0) e.armorShredTimer -= dt;
    if (e.tauntTimer > 0) e.tauntTimer -= dt;
    if (e.attackTimer > 0) e.attackTimer -= dt;

    if (e.burnTimer > 0) {
      e.burnTimer -= dt;
      e.hp -= e.burnDps * dt;
      if (e.hp <= 0) {
        onKilled(e);
        world.enemies.splice(i, 1);
        continue;
      }
    }

    if (e.kind === 'treasure_goblin') {
      e.fleeTimer -= dt;
      if (e.fleeTimer <= 0) {
        world.enemies.splice(i, 1);
        continue;
      }
    }

    if (e.stunTimer > 0) continue;

    // Blazing elite affix periodic fire ring aura
    if (e.affix === 'blazing') {
      e.burnAuraTimer = (e.burnAuraTimer ?? 1.2) - dt;
      if (e.burnAuraTimer <= 0) {
        e.burnAuraTimer = 1.4;
        world.vfx.push({ kind: 'ring', x: e.x, y: e.y, radius: 115, color: '#fb923c', life: 0.35, maxLife: 0.35 });
        const burnPulseDmg = Math.round(e.dmg * 0.45);
        for (const h of world.heroes) {
          if (!h.dead && h.zoneId === e.zoneId && Math.hypot(h.x - e.x, h.y - e.y) <= 115) {
            applyDamageToHero(world, h, burnPulseDmg, e);
          }
        }
      }
    }

    // Boss Phase 2 Enrage transition (<= 50% HP) & signature abilities
    if (e.isBoss) {
      if (e.bossPhase === 1 && e.hp <= e.maxHp * 0.5) {
        e.bossPhase = 2;
        e.moveSpeed = Math.round(e.moveSpeed * 1.22);
        e.attackCd = Math.max(0.55, e.attackCd * 0.78);
        e.shield = Math.max(e.shield, Math.round(e.maxHp * 0.12));
        e.bossAbilityTimer = Math.min(e.bossAbilityTimer, 0.8);
        world.vfx.push({ kind: 'explosion', x: e.x, y: e.y, radius: 170, color: '#f43f5e', life: 0.5, maxLife: 0.5 });
        world.cameraShake = Math.max(world.cameraShake, 7);
        SoundFX.playBossEnrage();
        addFloatingText(world, e.x, e.y - 46, '狂暴第二阶段！', '#f43f5e', 16);
        world.bannerText = `🔥 ${e.name} 血量跌破 50%，进入【狂暴 P2】！`;
        world.bannerColor = '#f43f5e';
        world.bannerTimer = 3.2;
      }
      e.bossAbilityTimer -= dt;
      if (e.bossAbilityTimer <= 0) {
        triggerBossAbility(world, e);
      }
    }

    // Healer Shaman periodic heal
    if (e.isHealer && e.attackTimer <= 0) {
      const injured = world.enemies.find(
        (other) => other.id !== e.id && other.zoneId === e.zoneId && other.hp > 0 && other.hp < other.maxHp && Math.hypot(other.x - e.x, other.y - e.y) <= 230
      );
      if (injured) {
        const heal = injured.maxHp * 0.12;
        injured.hp = Math.min(injured.maxHp, injured.hp + heal);
        e.attackTimer = e.attackCd;
        world.vfx.push({ kind: 'ring', x: injured.x, y: injured.y, radius: 34, color: '#4ade80', life: 0.35, maxLife: 0.35 });
        continue;
      }
    }

    // Treasure goblin runs away from nearby hero
    if (e.kind === 'treasure_goblin') {
      const nearestHero = findNearestHeroInZone(world, e.zoneId, e.x, e.y, 450);
      if (nearestHero) {
        const ang = Math.atan2(e.y - nearestHero.y, e.x - nearestHero.x);
        const spd = e.moveSpeed * (e.slowTimer > 0 ? 1 - e.slowFactor : 1);
        const stepped = moveWithBuildingSteering(
          e.zoneId,
          e.x,
          e.y,
          Math.cos(ang),
          Math.sin(ang),
          spd * dt,
          e.radius,
          e.id % 2 === 0 ? 1 : -1,
          world.towers,
          true
        );
        const cl = clampToRect(stepped.x, stepped.y, e.radius + 4, { x: 1450, y: 1450, w: 1300, h: 1300 });
        e.x = cl.x;
        e.y = cl.y;
        e.facing = ang;
      }
      continue;
    }

    // Select target within same zone ONLY (prevents dungeon/room mobs from ever leaking to Athena!)
    let targetX = e.spawnX;
    let targetY = e.spawnY;
    let targetHero: HeroEntity | null = null;
    let targetSummon = null as GameWorldState['summons'][number] | null;
    let targetAthena = false;

    const aggroRange = e.zoneId === 'sanctuary' ? (e.preferAthena ? 150 : 280) : 650;

    if (e.tauntTimer > 0 && e.tauntTargetId) {
      const th = world.heroes.find((h) => h.id === e.tauntTargetId && !h.dead && h.zoneId === e.zoneId);
      if (th) targetHero = th;
    }

    if (!targetHero) {
      targetSummon =
        world.summons.find(
          (s) => s.zoneId === e.zoneId && s.hp > 0 && Math.hypot(s.x - e.x, s.y - e.y) <= aggroRange
        ) || null;
      if (!targetSummon) {
        targetHero = findNearestHeroInZone(world, e.zoneId, e.x, e.y, aggroRange);
      }
    }

    if (targetHero) {
      targetX = targetHero.x;
      targetY = targetHero.y;
    } else if (targetSummon) {
      targetX = targetSummon.x;
      targetY = targetSummon.y;
    } else if (e.zoneId === 'sanctuary' && e.kind !== 'wandering_elite') {
      const lane = WAVE_LANES[e.laneId % WAVE_LANES.length];
      const wp = lane.waypoints[Math.min(e.waypointIdx, lane.waypoints.length - 1)];
      if (Math.hypot(wp.x - e.x, wp.y - e.y) < 42 && e.waypointIdx < lane.waypoints.length - 1) {
        e.waypointIdx += 1;
      }
      const curWp = lane.waypoints[Math.min(e.waypointIdx, lane.waypoints.length - 1)];
      targetX = curWp.x;
      targetY = curWp.y;
      if (Math.hypot(ATHENA_POS.x - e.x, ATHENA_POS.y - e.y) <= e.attackRange + ATHENA_POS.radius + 14) {
        targetAthena = true;
        targetX = ATHENA_POS.x;
        targetY = ATHENA_POS.y;
      }
    }

    const dx = targetX - e.x;
    const dy = targetY - e.y;
    const dist = Math.hypot(dx, dy) || 1;
    e.facing = Math.atan2(dy, dx);

    const effectiveRadius = targetAthena ? ATHENA_POS.radius : targetHero ? 18 : targetSummon ? targetSummon.radius : 0;
    const inRange = (targetHero || targetSummon || targetAthena) && dist <= e.attackRange + e.radius + effectiveRadius;

    if (inRange) {
      e.vx = 0;
      e.vy = 0;
      if (e.isSuicide) {
        // Explode on impact!
        world.vfx.push({ kind: 'explosion', x: e.x, y: e.y, radius: 110, color: '#f97316', life: 0.4, maxLife: 0.4 });
        if (targetHero) applyDamageToHero(world, targetHero, e.dmg, e);
        if (targetSummon) targetSummon.hp -= e.dmg;
        if (targetAthena) applyDamageToSanctuary(world, e.dmg * 1.15, true);
        world.enemies.splice(i, 1);
        continue;
      }

      if (e.attackTimer <= 0) {
        e.attackTimer = e.attackCd;
        e.attackAnim = 0.26;
        if (e.isRanged) {
          world.projectiles.push({
            id: world.nextEntityId++,
            fromEnemy: true,
            ownerId: `enemy_${e.id}`,
            zoneId: e.zoneId,
            x: e.x,
            y: e.y,
            vx: (dx / dist) * 420,
            vy: (dy / dist) * 420,
            radius: 7,
            damage: e.dmg,
            isMagic: e.kind.includes('mage'),
            isSiege: Boolean(e.preferAthena || e.isBoss),
            color: e.accentColor,
            pierceLeft: 0,
            hitIds: [],
            life: (e.attackRange + 90) / 420,
            targetAthena,
          });
        } else {
          if (targetHero) applyDamageToHero(world, targetHero, e.dmg, e);
          else if (targetSummon) targetSummon.hp -= e.dmg;
          else if (targetAthena) applyDamageToSanctuary(world, e.dmg, Boolean(e.preferAthena || e.isBoss));
        }
      }
    } else if (dist > 6 && e.attackAnim <= 0.08) {
      const spd = e.moveSpeed * (e.slowTimer > 0 ? 1 - e.slowFactor : 1);
      const stepped = moveWithBuildingSteering(
        e.zoneId,
        e.x,
        e.y,
        dx / dist,
        dy / dist,
        spd * dt,
        e.radius,
        e.id % 2 === 0 ? 1 : -1,
        world.towers,
        true
      );
      e.x = stepped.x;
      e.y = stepped.y;
    }
  }

  // Spatial hash separation (O(N) pooled buckets, zero per-frame bucket allocations)
  separateEnemiesSpatial(world);
}

const sepGridMap = new Map<number, EnemyEntity[]>();
const sepGridPool: EnemyEntity[][] = [];

function separateEnemiesSpatial(world: GameWorldState): void {
  const enemies = world.enemies;
  const count = enemies.length;
  if (count < 2) return;

  sepGridMap.clear();
  let poolIdx = 0;

  for (let i = 0; i < count; i++) {
    const e = enemies[i];
    if (e.hp <= 0) continue;
    const cx = Math.floor(e.x / 64);
    const cy = Math.floor(e.y / 64);
    const key = ((cy + 256) << 12) | ((cx + 256) & 0xfff);
    let bucket = sepGridMap.get(key);
    if (!bucket) {
      bucket = sepGridPool[poolIdx];
      if (!bucket) {
        bucket = [];
        sepGridPool.push(bucket);
      } else {
        bucket.length = 0;
      }
      poolIdx++;
      sepGridMap.set(key, bucket);
    }
    bucket.push(e);
  }

  for (let i = 0; i < count; i++) {
    const a = enemies[i];
    if (a.hp <= 0) continue;
    const acx = Math.floor(a.x / 64);
    const acy = Math.floor(a.y / 64);
    for (let oy = -1; oy <= 1; oy++) {
      for (let ox = -1; ox <= 1; ox++) {
        const bucket = sepGridMap.get(((acy + oy + 256) << 12) | ((acx + ox + 256) & 0xfff));
        if (!bucket) continue;
        for (let k = 0; k < bucket.length; k++) {
          const b = bucket[k];
          if (b.id <= a.id || b.hp <= 0 || b.zoneId !== a.zoneId) continue;
          const dx = b.x - a.x;
          const dy = b.y - a.y;
          const minDist = (a.radius + b.radius) * 0.78;
          if (Math.abs(dx) >= minDist || Math.abs(dy) >= minDist) continue;
          const d2 = dx * dx + dy * dy;
          if (d2 >= minDist * minDist) continue;
          const d = Math.sqrt(d2) || 0.01;
          const push = (minDist - d) * 0.36;
          const nx = (dx / d) * push;
          const ny = (dy / d) * push;
          const clA = resolveWorldCollision(a.zoneId, a.x - nx, a.y - ny, a.radius, world.towers, true);
          a.x = clA.x;
          a.y = clA.y;
          const clB = resolveWorldCollision(b.zoneId, b.x + nx, b.y + ny, b.radius, world.towers, true);
          b.x = clB.x;
          b.y = clB.y;
        }
      }
    }
  }
}

function pushBossProjectileFan(
  world: GameWorldState,
  boss: EnemyEntity,
  baseAngle: number,
  count: number,
  spread: number,
  speed: number,
  dmg: number,
  color: string,
  isMagic: boolean
): void {
  for (let k = 0; k < count; k++) {
    const offset = count <= 1 ? 0 : (k / (count - 1) - 0.5) * spread;
    const ang = baseAngle + offset;
    world.projectiles.push({
      id: world.nextEntityId++,
      fromEnemy: true,
      ownerId: `boss_${boss.id}`,
      zoneId: boss.zoneId,
      x: boss.x,
      y: boss.y,
      vx: Math.cos(ang) * speed,
      vy: Math.sin(ang) * speed,
      radius: 9,
      damage: dmg,
      isMagic,
      isSiege: true,
      color,
      pierceLeft: 0,
      hitIds: [],
      life: 1.65,
      targetAthena: false,
    });
  }
}

function pushBossLaser(
  world: GameWorldState,
  boss: EnemyEntity,
  targetX: number,
  targetY: number,
  range: number,
  width: number,
  dmg: number,
  color: string,
  chargeSec = 1.15
): void {
  SoundFX.playLaserCharge();
  const ang = Math.atan2(targetY - boss.y, targetX - boss.x);
  world.telegraphs.push({
    id: world.nextEntityId++,
    fromEnemy: true,
    ownerId: `boss_${boss.id}`,
    zoneId: boss.zoneId,
    kind: 'enemy_laser',
    x: boss.x,
    y: boss.y,
    tx: boss.x + Math.cos(ang) * range,
    ty: boss.y + Math.sin(ang) * range,
    width,
    radius: Math.max(60, width),
    timer: chargeSec,
    maxTimer: chargeSec,
    tickTimer: 99,
    fired: false,
    damage: dmg,
    color,
  });
}

function triggerBossAbility(world: GameWorldState, boss: EnemyEntity): void {
  const nearest = findNearestHeroInZone(world, boss.zoneId, boss.x, boss.y, 560);
  const tx = nearest ? nearest.x : boss.zoneId === 'sanctuary' ? ATHENA_POS.x : boss.x;
  const ty = nearest ? nearest.y : boss.zoneId === 'sanctuary' ? ATHENA_POS.y : boss.y;
  const aimAng = Math.atan2(ty - boss.y, tx - boss.x);
  const isP2 = boss.bossPhase >= 2;

  if (boss.kind === 'boss_skeleton_king') {
    boss.bossAbilityTimer = isP2 ? 3.8 : 4.8;
    boss.shield = Math.max(boss.shield, Math.round(boss.maxHp * (isP2 ? 0.14 : 0.08)));
    addFloatingText(world, boss.x, boss.y - 38, '骸骨旋风斩 + 骨盾！', '#38bdf8', 13);
    world.telegraphs.push({
      id: world.nextEntityId++,
      fromEnemy: true,
      ownerId: `boss_${boss.id}`,
      zoneId: boss.zoneId,
      kind: 'enemy_aoe',
      x: boss.x,
      y: boss.y,
      radius: 180,
      timer: 1.0,
      maxTimer: 1.0,
      tickTimer: 99,
      damage: boss.dmg * (isP2 ? 2.8 : 2.35),
      color: '#38bdf8',
    });
    if (world.enemies.filter((x) => x.zoneId === boss.zoneId).length < 24) {
      const sumCount = isP2 ? 4 : 3;
      for (let s = 0; s < sumCount; s++) {
        const ang = (s / sumCount) * Math.PI * 2;
        const pos = resolveWorldCollision(boss.zoneId, boss.x + Math.cos(ang) * 75, boss.y + Math.sin(ang) * 65, 22, world.towers, true);
        spawnEnemy(world, 'skeleton_archer', boss.zoneId, pos.x, pos.y, Math.max(1.2, world.wave * 0.35), 1.15);
      }
    }
  } else if (boss.kind === 'boss_abyss_lord') {
    boss.bossAbilityTimer = isP2 ? 3.4 : 4.2;
    addFloatingText(world, boss.x, boss.y - 38, '虚空毒沼 + 暗影齐射！', '#a855f7', 13);
    world.telegraphs.push({
      id: world.nextEntityId++,
      fromEnemy: true,
      ownerId: `boss_${boss.id}`,
      zoneId: boss.zoneId,
      kind: 'poison_pool',
      x: tx,
      y: ty,
      radius: 160,
      timer: 4.8,
      maxTimer: 4.8,
      tickTimer: 0.35,
      damage: boss.dmg * 0.76,
      color: '#a855f7',
    });
    pushBossProjectileFan(world, boss, aimAng, isP2 ? 7 : 5, 1.35, 360, boss.dmg * 1.15, '#a855f7', true);
  } else if (boss.kind === 'boss_frost_wyrm') {
    boss.bossAbilityTimer = isP2 ? 3.3 : 4.1;
    boss.shield = Math.max(boss.shield, Math.round(boss.maxHp * 0.12));
    addFloatingText(world, boss.x, boss.y - 38, '极寒吐息射线！', '#67e8f9', 13);
    pushBossLaser(world, boss, tx, ty, 480, 64, boss.dmg * (isP2 ? 2.85 : 2.35), '#38bdf8', 1.15);
    const novaCount = isP2 ? 3 : 2;
    for (let k = 0; k < novaCount; k++) {
      world.telegraphs.push({
        id: world.nextEntityId++,
        fromEnemy: true,
        ownerId: `boss_${boss.id}`,
        zoneId: boss.zoneId,
        kind: 'enemy_aoe',
        x: tx + (k === 0 ? 0 : (Math.random() - 0.5) * 230),
        y: ty + (k === 0 ? 0 : (Math.random() - 0.5) * 210),
        radius: 140,
        timer: 1.15,
        maxTimer: 1.15,
        tickTimer: 99,
        damage: boss.dmg * 2.25,
        color: '#67e8f9',
      });
    }
  } else if (boss.kind === 'boss_doom_overlord' || boss.kind === 'boss_hidden_chaos') {
    boss.bossAbilityTimer = isP2 ? 3.0 : 4.0;
    addFloatingText(world, boss.x, boss.y - 38, isP2 ? '混沌末日 · 狱火射线！' : '末日陨星轰击！', '#f43f5e', 14);
    pushBossLaser(world, boss, tx, ty, 520, 68, boss.dmg * (isP2 ? 3.0 : 2.5), '#ef4444', 1.1);
    const meteorCount = isP2 ? 5 : 3;
    for (let k = 0; k < meteorCount; k++) {
      world.telegraphs.push({
        id: world.nextEntityId++,
        fromEnemy: true,
        ownerId: `boss_${boss.id}`,
        zoneId: boss.zoneId,
        kind: 'enemy_aoe',
        x: tx + (k === 0 ? 0 : (Math.random() - 0.5) * 280),
        y: ty + (k === 0 ? 0 : (Math.random() - 0.5) * 260),
        radius: 145,
        timer: 1.05,
        maxTimer: 1.05,
        tickTimer: 99,
        damage: boss.dmg * 2.45,
        color: '#f43f5e',
      });
    }
    if (isP2) {
      pushBossProjectileFan(world, boss, aimAng, 8, Math.PI * 1.75, 330, boss.dmg * 1.1, '#fb923c', true);
      if (world.enemies.filter((x) => x.zoneId === boss.zoneId).length < 24) {
        const gPos = resolveWorldCollision(boss.zoneId, tx + 55, ty + 45, 22, world.towers, true);
        spawnEnemy(world, 'orc_berserker', boss.zoneId, gPos.x, gPos.y, Math.max(1.4, world.wave * 0.4), 1.2);
      }
    }
  } else if (boss.kind === 'boss_fire_lord') {
    boss.bossAbilityTimer = isP2 ? 3.4 : 4.3;
    addFloatingText(world, boss.x, boss.y - 38, '焚天烈焰弹幕！', '#fb923c', 13);
    world.telegraphs.push({
      id: world.nextEntityId++,
      fromEnemy: true,
      ownerId: `boss_${boss.id}`,
      zoneId: boss.zoneId,
      kind: 'enemy_aoe',
      x: tx,
      y: ty,
      radius: 150,
      timer: 1.0,
      maxTimer: 1.0,
      tickTimer: 99,
      damage: boss.dmg * (isP2 ? 2.55 : 2.2),
      color: '#fb923c',
    });
    pushBossProjectileFan(world, boss, aimAng, isP2 ? 8 : 5, isP2 ? 1.9 : 1.35, 360, boss.dmg * 1.15, '#fb923c', true);
  } else if (boss.kind === 'boss_ice_phoenix') {
    boss.bossAbilityTimer = isP2 ? 3.4 : 4.2;
    addFloatingText(world, boss.x, boss.y - 38, '冰凤霜环绽放！', '#67e8f9', 13);
    const ringCount = isP2 ? 12 : 8;
    pushBossProjectileFan(world, boss, aimAng, ringCount, Math.PI * 2 * ((ringCount - 1) / ringCount), 320, boss.dmg * 1.1, '#67e8f9', true);
    world.telegraphs.push({
      id: world.nextEntityId++,
      fromEnemy: true,
      ownerId: `boss_${boss.id}`,
      zoneId: boss.zoneId,
      kind: 'enemy_aoe',
      x: tx,
      y: ty,
      radius: 140,
      timer: 1.0,
      maxTimer: 1.0,
      tickTimer: 99,
      damage: boss.dmg * 2.25,
      color: '#38bdf8',
    });
  } else if (boss.kind === 'boss_thunder_roc') {
    boss.bossAbilityTimer = isP2 ? 3.3 : 4.2;
    addFloatingText(world, boss.x, boss.y - 38, '瞬雷突袭 · 天罚激光！', '#a855f7', 13);
    if (nearest) {
      world.vfx.push({ kind: 'teleport', x: boss.x, y: boss.y, radius: 58, color: '#a855f7', life: 0.4, maxLife: 0.4 });
      const bPos = resolveWorldCollision(boss.zoneId, tx - Math.cos(aimAng) * 95, ty - Math.sin(aimAng) * 95, boss.radius + 4, world.towers, true);
      boss.x = bPos.x;
      boss.y = bPos.y;
      world.vfx.push({ kind: 'teleport', x: boss.x, y: boss.y, radius: 58, color: '#38bdf8', life: 0.4, maxLife: 0.4 });
    }
    pushBossLaser(world, boss, tx, ty, 460, 56, boss.dmg * (isP2 ? 2.75 : 2.3), '#a855f7', 1.0);
  } else if (boss.kind === 'boss_ancient_treant') {
    boss.bossAbilityTimer = isP2 ? 3.8 : 4.6;
    if (boss.hp < boss.maxHp) {
      const healAmt = Math.min(boss.maxHp - boss.hp, Math.round(boss.maxHp * (isP2 ? 0.07 : 0.05)));
      if (healAmt > 0) {
        boss.hp += healAmt;
        world.vfx.push({ kind: 'ring', x: boss.x, y: boss.y, radius: 95, color: '#4ade80', life: 0.5, maxLife: 0.5 });
        addFloatingText(world, boss.x, boss.y - 38, `自然再生 +${healAmt}`, '#4ade80', 13);
      }
    }
    world.telegraphs.push({
      id: world.nextEntityId++,
      fromEnemy: true,
      ownerId: `boss_${boss.id}`,
      zoneId: boss.zoneId,
      kind: 'poison_pool',
      x: tx,
      y: ty,
      radius: 145,
      timer: 4.2,
      maxTimer: 4.2,
      tickTimer: 0.4,
      damage: boss.dmg * 0.68,
      color: '#4ade80',
    });
  } else if (boss.kind === 'boss_trial_mirror') {
    boss.bossAbilityTimer = isP2 ? 3.2 : 4.0;
    addFloatingText(world, boss.x, boss.y - 38, '幻影鬼步 · 剑刃扇斩！', '#fde047', 13);
    if (nearest) {
      world.vfx.push({ kind: 'teleport', x: boss.x, y: boss.y, radius: 54, color: '#fde047', life: 0.35, maxLife: 0.35 });
      const bPos = resolveWorldCollision(boss.zoneId, tx + Math.cos(aimAng) * 78, ty + Math.sin(aimAng) * 78, boss.radius + 4, world.towers, true);
      boss.x = bPos.x;
      boss.y = bPos.y;
    }
    const postAng = Math.atan2(ty - boss.y, tx - boss.x);
    pushBossProjectileFan(world, boss, postAng, isP2 ? 7 : 5, 1.3, 410, boss.dmg * 1.15, '#fde047', false);
    world.telegraphs.push({
      id: world.nextEntityId++,
      fromEnemy: true,
      ownerId: `boss_${boss.id}`,
      zoneId: boss.zoneId,
      kind: 'enemy_aoe',
      x: tx,
      y: ty,
      radius: 135,
      timer: 0.95,
      maxTimer: 0.95,
      tickTimer: 99,
      damage: boss.dmg * 2.25,
      color: boss.accentColor,
    });
  } else {
    boss.bossAbilityTimer = 4.5;
    world.telegraphs.push({
      id: world.nextEntityId++,
      fromEnemy: true,
      ownerId: `boss_${boss.id}`,
      zoneId: boss.zoneId,
      kind: 'enemy_aoe',
      x: tx,
      y: ty,
      radius: 145,
      timer: 1.0,
      maxTimer: 1.0,
      tickTimer: 99,
      damage: boss.dmg * 2.35,
      color: boss.accentColor,
    });
    pushBossProjectileFan(world, boss, aimAng, 3, 0.85, 340, boss.dmg * 1.1, boss.accentColor, true);
  }
}

export function updateTelegraphsAndProjectiles(world: GameWorldState, dt: number): void {
  const onKilled = (enemy: EnemyEntity, killer?: HeroEntity) => handleEnemyDeathDrops(world, enemy, killer);

  // Projectiles
  for (let i = world.projectiles.length - 1; i >= 0; i--) {
    const p = world.projectiles[i];
    p.life -= dt;
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    if (p.life <= 0) {
      world.projectiles.splice(i, 1);
      continue;
    }

    if (p.fromEnemy) {
      if (p.targetAthena && p.zoneId === 'sanctuary' && Math.hypot(p.x - ATHENA_POS.x, p.y - ATHENA_POS.y) <= ATHENA_POS.radius + p.radius) {
        applyDamageToSanctuary(world, p.damage, Boolean(p.isSiege));
        world.projectiles.splice(i, 1);
        continue;
      }
      const hitHero = world.heroes.find(
        (h) => !h.dead && h.zoneId === p.zoneId && Math.hypot(h.x - p.x, h.y - p.y) <= 18 + p.radius
      );
      if (hitHero) {
        applyDamageToHero(world, hitHero, p.damage);
        world.projectiles.splice(i, 1);
        continue;
      }
      const hitSum = world.summons.find(
        (s) => s.zoneId === p.zoneId && s.hp > 0 && Math.hypot(s.x - p.x, s.y - p.y) <= s.radius + p.radius
      );
      if (hitSum) {
        hitSum.hp -= p.damage;
        world.projectiles.splice(i, 1);
      }
    } else {
      const attacker = world.heroes.find((h) => h.id === p.ownerId);
      let consumed = false;
      for (const e of world.enemies) {
        if (e.zoneId !== p.zoneId || e.hp <= 0 || p.hitIds.includes(e.id)) continue;
        if (Math.hypot(e.x - p.x, e.y - p.y) <= e.radius + p.radius) {
          p.hitIds.push(e.id);
          if (p.slowPct) {
            e.slowTimer = Math.max(e.slowTimer, 2.5);
            e.slowFactor = Math.max(e.slowFactor, p.slowPct);
          }
          if (p.burnDps) {
            e.burnTimer = Math.max(e.burnTimer, 3.0);
            e.burnDps = Math.max(e.burnDps, p.burnDps);
          }
          if (attacker?.hawkeyeTimer && attacker.hawkeyeTimer > 0) {
            e.armorShredTimer = Math.max(e.armorShredTimer, 4.0);
          }

          if (p.aoeRadius && p.aoeRadius > 0) {
            for (const sub of world.enemies) {
              if (sub.zoneId === p.zoneId && sub.hp > 0 && Math.hypot(sub.x - p.x, sub.y - p.y) <= p.aoeRadius) {
                if (p.slowPct) {
                  sub.slowTimer = Math.max(sub.slowTimer, 2.5);
                  sub.slowFactor = Math.max(sub.slowFactor, p.slowPct);
                }
                applyDamageToEnemy(world, sub, p.damage, { attacker, isMagic: p.isMagic, canCrit: true, onEnemyKilled: onKilled });
              }
            }
            world.vfx.push({ kind: 'explosion', x: p.x, y: p.y, radius: p.aoeRadius, color: p.color, life: 0.3, maxLife: 0.3 });
            if (p.canTriggerOrb) maybeTriggerOrbChain(world, attacker, e, onKilled);
            consumed = true;
            break;
          } else {
            const extraTrue =
              attacker && attacker.hawkeyeTimer > 0 ? Math.min(e.maxHp * 0.025, attacker.stats.ad * 1.8) : 0;
            applyDamageToEnemy(world, e, p.damage + extraTrue, {
              attacker,
              isMagic: p.isMagic,
              canCrit: true,
              onEnemyKilled: onKilled,
            });
            if (p.canTriggerOrb && p.hitIds.length === 1) {
              maybeTriggerOrbChain(world, attacker, e, onKilled);
            }
            if (p.pierceLeft <= 0) {
              consumed = true;
              break;
            }
            p.pierceLeft -= 1;
          }
        }
      }
      if (consumed) world.projectiles.splice(i, 1);
    }
  }

  // Telegraphs
  for (let i = world.telegraphs.length - 1; i >= 0; i--) {
    const t = world.telegraphs[i];
    t.timer -= dt;
    if (t.fromEnemy) {
      if (t.kind === 'enemy_aoe' && t.timer <= 0) {
        world.vfx.push({ kind: 'explosion', x: t.x, y: t.y, radius: t.radius, color: t.color, life: 0.45, maxLife: 0.45 });
        for (const h of world.heroes) {
          if (!h.dead && h.zoneId === t.zoneId && Math.hypot(h.x - t.x, h.y - t.y) <= t.radius) {
            applyDamageToHero(world, h, t.damage);
          }
        }
        if (t.zoneId === 'sanctuary' && Math.hypot(ATHENA_POS.x - t.x, ATHENA_POS.y - t.y) <= t.radius + ATHENA_POS.radius) {
          applyDamageToSanctuary(world, t.damage * 0.7, true);
        }
        world.telegraphs.splice(i, 1);
        continue;
      } else if (t.kind === 'enemy_laser') {
        if (t.timer <= 0.22 && !t.fired) {
          t.fired = true;
          const ex = t.tx ?? t.x;
          const ey = t.ty ?? t.y;
          const halfW = (t.width || 54) * 0.5;
          for (const h of world.heroes) {
            if (!h.dead && h.zoneId === t.zoneId && distPointToSegment(h.x, h.y, t.x, t.y, ex, ey) <= halfW + 18) {
              applyDamageToHero(world, h, t.damage);
            }
          }
          if (t.zoneId === 'sanctuary' && distPointToSegment(ATHENA_POS.x, ATHENA_POS.y, t.x, t.y, ex, ey) <= halfW + ATHENA_POS.radius) {
            applyDamageToSanctuary(world, t.damage * 0.65, true);
          }
          world.vfx.push({ kind: 'explosion', x: ex, y: ey, radius: halfW * 1.8, color: t.color, life: 0.35, maxLife: 0.35 });
          world.cameraShake = Math.max(world.cameraShake, 6);
        }
        if (t.timer <= 0) world.telegraphs.splice(i, 1);
        continue;
      } else if (t.kind === 'poison_pool') {
        t.tickTimer -= dt;
        if (t.tickTimer <= 0) {
          t.tickTimer = 0.5;
          for (const h of world.heroes) {
            if (!h.dead && h.zoneId === t.zoneId && Math.hypot(h.x - t.x, h.y - t.y) <= t.radius) {
              applyDamageToHero(world, h, t.damage);
            }
          }
        }
        if (t.timer <= 0) world.telegraphs.splice(i, 1);
        continue;
      }
    } else {
      // Friendly AOE zones (blizzard, starfall, sanctuary)
      t.tickTimer -= dt;
      const owner = world.heroes.find((h) => h.id === t.ownerId);
      if (t.tickTimer <= 0) {
        t.tickTimer = 0.65;
        for (const e of world.enemies) {
          if (e.zoneId === t.zoneId && e.hp > 0 && Math.hypot(e.x - t.x, e.y - t.y) <= t.radius + e.radius) {
            if (t.slowPct) {
              e.slowTimer = Math.max(e.slowTimer, 1.5);
              e.slowFactor = Math.max(e.slowFactor, t.slowPct);
            }
            if (t.freezeSec && Math.random() < 0.32) {
              e.stunTimer = Math.max(e.stunTimer, e.isBoss ? 0.25 : t.freezeSec);
            }
            applyDamageToEnemy(world, e, t.damage, {
              attacker: owner,
              isMagic: t.kind !== 'starfall',
              canCrit: true,
              onEnemyKilled: onKilled,
            });
          }
        }
        if (t.healPerSec) {
          for (const ally of world.heroes) {
            if (!ally.dead && ally.zoneId === t.zoneId && Math.hypot(ally.x - t.x, ally.y - t.y) <= t.radius) {
              ally.hp = Math.min(ally.stats.maxHp, ally.hp + t.healPerSec * 0.65);
            }
          }
        }
      }
      if (t.timer <= 0) world.telegraphs.splice(i, 1);
    }
  }
}

export function updateTowersAndSummons(world: GameWorldState, dt: number): void {
  const onKilled = (enemy: EnemyEntity, killer?: HeroEntity) => handleEnemyDeathDrops(world, enemy, killer);

  for (const t of world.towers) {
    if (!t.type || t.level <= 0) continue;
    if (t.attackTimer > 0) t.attackTimer -= dt;

    if (t.type === 'holy') {
      if (t.attackTimer <= 0) {
        t.attackTimer = 2.0;
        const healAmt = 55 * t.level;
        for (const h of world.heroes) {
          if (!h.dead && h.zoneId === 'sanctuary' && Math.hypot(h.x - t.x, h.y - t.y) <= 320) {
            h.hp = Math.min(h.stats.maxHp, h.hp + healAmt);
          }
        }
        world.sanctuary.hp = Math.min(world.sanctuary.maxHp, world.sanctuary.hp + healAmt * 0.7);
        world.vfx.push({ kind: 'ring', x: t.x, y: t.y, radius: 190, color: '#fde047', life: 0.4, maxLife: 0.4 });
      }
      continue;
    }

    if (t.attackTimer <= 0) {
      const target = findNearestEnemyInRange(world, 'sanctuary', t.x, t.y, 440);
      if (target) {
        const ang = Math.atan2(target.y - t.y, target.x - t.x);
        t.facing = ang;
        t.attackTimer = t.type === 'arrow' ? Math.max(0.32, 0.72 - t.level * 0.08) : 1.15;
        world.projectiles.push({
          id: world.nextEntityId++,
          fromEnemy: false,
          ownerId: world.heroes[0]?.id || 'tower',
          zoneId: 'sanctuary',
          x: t.x,
          y: t.y,
          vx: Math.cos(ang) * 700,
          vy: Math.sin(ang) * 700,
          radius: t.type === 'frost' ? 12 : 7,
          damage: (t.type === 'arrow' ? 95 : 75) * Math.pow(1.65, t.level - 1),
          isMagic: t.type === 'frost',
          color: t.type === 'frost' ? '#38bdf8' : '#4ade80',
          pierceLeft: 0,
          hitIds: [],
          life: 0.7,
          slowPct: t.type === 'frost' ? 0.48 : 0,
          aoeRadius: t.type === 'frost' ? 115 : 0,
        });
      }
    }
  }

  // Summons
  for (let i = world.summons.length - 1; i >= 0; i--) {
    const s = world.summons[i];
    s.life -= dt;
    if (s.life <= 0 || s.hp <= 0) {
      world.summons.splice(i, 1);
      continue;
    }
    if (s.attackTimer > 0) s.attackTimer -= dt;
    const owner = world.heroes.find((h) => h.id === s.ownerId);
    const enemy = findNearestEnemyInRange(world, s.zoneId, s.x, s.y, 380);
    if (enemy) {
      const dx = enemy.x - s.x;
      const dy = enemy.y - s.y;
      const d = Math.hypot(dx, dy) || 1;
      s.facing = Math.atan2(dy, dx);
      if (d <= enemy.radius + s.radius + 36) {
        if (s.attackTimer <= 0) {
          s.attackTimer = 1 / s.atkSpeed;
          applyDamageToEnemy(world, enemy, s.ad, { attacker: owner, canCrit: true, onEnemyKilled: onKilled });
          if (s.kind === 'treant') {
            enemy.tauntTargetId = owner?.id || null;
            enemy.tauntTimer = 1.8;
          }
        }
      } else {
        const stepped = moveWithBuildingSteering(
          s.zoneId,
          s.x,
          s.y,
          dx / d,
          dy / d,
          s.moveSpeed * dt,
          s.radius,
          s.id % 2 === 0 ? 1 : -1,
          world.towers,
          false
        );
        s.x = stepped.x;
        s.y = stepped.y;
      }
    } else if (owner && owner.zoneId === s.zoneId) {
      const dx = owner.x - s.x;
      const dy = owner.y - s.y;
      const d = Math.hypot(dx, dy);
      if (d > 95) {
        const stepped = moveWithBuildingSteering(
          s.zoneId,
          s.x,
          s.y,
          dx / d,
          dy / d,
          s.moveSpeed * dt,
          s.radius,
          s.id % 2 === 0 ? 1 : -1,
          world.towers,
          false
        );
        s.x = stepped.x;
        s.y = stepped.y;
      }
    }
  }
}

export function updateBotHeroes(world: GameWorldState, dt: number): void {
  const localHero = world.heroes.find((h) => h.isLocal);
  const onKilled = (enemy: EnemyEntity, killer?: HeroEntity) => handleEnemyDeathDrops(world, enemy, killer);

  for (const bot of world.heroes) {
    if (!bot.isBot || bot.dead) continue;

    // Auto-use HP/MP potions
    if (bot.hp < bot.stats.maxHp * 0.42 && bot.potionCharges.hp > 0 && bot.potionCds.hp <= 0) {
      usePotionSlot(world, bot, 'hp');
    }
    if (bot.mp < bot.stats.maxMp * 0.25 && bot.potionCharges.mp > 0 && bot.potionCds.mp <= 0) {
      usePotionSlot(world, bot, 'mp');
    }

    bot.botDecisionTimer -= dt;
    if (bot.botDecisionTimer <= 0) {
      bot.botDecisionTimer = 2.4;
      // Auto upgrade / synthesize / buy gear
      const quick = getQuickBuyOptions(world, bot);
      if (quick.length > 0) {
        const pick = quick[0];
        if (pick.kind === 'synth') synthesizeItem(world, bot, pick.itemId);
        else if (pick.kind === 'upgrade' && pick.slotIdx !== undefined) upgradeItemInSlot(world, bot, true, pick.slotIdx);
        else buyItem(world, bot, pick.itemId);
      }

      // Sync zone based on aiMode
      if (bot.aiMode === 'follow_player' && localHero && !localHero.dead && bot.zoneId !== localHero.zoneId) {
        teleportHeroToZone(world, bot, localHero.zoneId);
      } else if (bot.aiMode === 'guard_base' && bot.zoneId !== 'sanctuary') {
        teleportHeroToZone(world, bot, 'sanctuary');
      }
    }

    if (bot.attackLockTimer > 0) {
      bot.vx = 0;
      bot.vy = 0;
      const lockedPos = resolveWorldCollision(bot.zoneId, bot.x, bot.y, HERO_COLLISION_RADIUS, world.towers, false);
      bot.x = lockedPos.x;
      bot.y = lockedPos.y;
      continue;
    }

    // Combat AI
    const searchCenterX = bot.aiMode === 'guard_base' ? CONVERGENCE_POS.x : bot.x;
    const searchCenterY = bot.aiMode === 'guard_base' ? CONVERGENCE_POS.y : bot.y;
    const target =
      findNearestEnemyInRange(world, bot.zoneId, bot.x, bot.y, 460) ||
      findNearestEnemyInRange(world, bot.zoneId, searchCenterX, searchCenterY, 980) ||
      (bot.aiMode === 'guard_base' ? findNearestEnemyInRange(world, bot.zoneId, ATHENA_POS.x, ATHENA_POS.y, 680) : null);

    if (target) {
      const dx = target.x - bot.x;
      const dy = target.y - bot.y;
      const d = Math.hypot(dx, dy) || 1;
      const def = getHeroClassDef(bot.classId);

      // Cast ready skills (staggered so bots don't insta-wipe early waves)
      if (bot.castAnim <= 0) {
        for (let s = 3; s >= 0; s--) {
          const sk = def.skills[s];
          if (bot.skillCds[s] <= 0 && bot.mp >= sk.manaCost && (!sk.unlockLevel || bot.level >= sk.unlockLevel)) {
            if (d <= sk.range + 40) {
              if (castHeroSkill(world, bot, s, dx / d, dy / d, Math.min(1, d / Math.max(1, sk.range)), onKilled)) {
                bot.castAnim = 1.2;
                break;
              }
            }
          }
        }
      }

      if (bot.attackLockTimer > 0) {
        bot.vx = 0;
        bot.vy = 0;
        continue;
      }

      if (d <= bot.stats.attackRange + target.radius + 10) {
        bot.vx = 0;
        bot.vy = 0;
        if (bot.attackCd <= 0 && bot.bladestormTimer <= 0) {
          performBasicAttack(world, bot, dx / d, dy / d, onKilled);
        }
      } else {
        bot.facing = Math.atan2(dy, dx);
        const stepped = moveWithBuildingSteering(
          bot.zoneId,
          bot.x,
          bot.y,
          dx / d,
          dy / d,
          bot.stats.moveSpeed * dt,
          HERO_COLLISION_RADIUS,
          bot.slot % 2 === 0 ? 1 : -1,
          world.towers,
          false
        );
        bot.x = stepped.x;
        bot.y = stepped.y;
      }
    } else {
      // Idle position in spread formation near Athena or flanking player
      const fOff = HERO_FORMATION_OFFSETS[bot.slot % HERO_FORMATION_OFFSETS.length];
      const followOff = [
        { x: 0, y: 0 },
        { x: -78, y: 36 },
        { x: 78, y: 36 },
        { x: 0, y: 74 },
      ][bot.slot % 4];
      const anchorX = bot.aiMode === 'follow_player' && localHero ? localHero.x + followOff.x : HERO_SPAWN_POS.x + fOff.x;
      const anchorY = bot.aiMode === 'follow_player' && localHero ? localHero.y + followOff.y : HERO_SPAWN_POS.y + fOff.y;
      const dx = anchorX - bot.x;
      const dy = anchorY - bot.y;
      const d = Math.hypot(dx, dy);
      if (d > 48) {
        bot.facing = Math.atan2(dy, dx);
        const stepped = moveWithBuildingSteering(
          bot.zoneId,
          bot.x,
          bot.y,
          dx / d,
          dy / d,
          bot.stats.moveSpeed * dt,
          HERO_COLLISION_RADIUS,
          bot.slot % 2 === 0 ? 1 : -1,
          world.towers,
          false
        );
        bot.x = stepped.x;
        bot.y = stepped.y;
      }
    }
  }
}

export function findNearestHeroInZone(
  world: GameWorldState,
  zoneId: string,
  x: number,
  y: number,
  maxDist: number
): HeroEntity | null {
  let best: HeroEntity | null = null;
  let bestDist = maxDist;
  for (const h of world.heroes) {
    if (h.dead || h.stealthTimer > 0 || h.zoneId !== zoneId) continue;
    const d = Math.hypot(h.x - x, h.y - y);
    if (d < bestDist) {
      bestDist = d;
      best = h;
    }
  }
  return best;
}

export function findNearestEnemyInRange(
  world: GameWorldState,
  zoneId: string,
  x: number,
  y: number,
  maxDist: number
): EnemyEntity | null {
  let best: EnemyEntity | null = null;
  let bestDist = maxDist;
  for (const e of world.enemies) {
    if (e.zoneId !== zoneId || e.hp <= 0) continue;
    const d = Math.hypot(e.x - x, e.y - y);
    if (d < bestDist) {
      bestDist = d;
      best = e;
    }
  }
  return best;
}
