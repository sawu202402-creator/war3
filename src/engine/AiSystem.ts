import { SoundFX } from '../audio/SoundFX';
import { DIFFICULTIES, getHeroClassDef } from '../data/heroes';
import { getWaveDef } from '../data/waves';
import { ATHENA_POS, CONVERGENCE_POS, HERO_FORMATION_OFFSETS, HERO_SPAWN_POS, WAVE_LANES, ZONES, clampToRect } from '../data/worldMap';
import { SaveManager } from '../meta/SaveManager';
import { EnemyKind } from '../types';
import { handleEnemyDeathDrops, spawnEnemy, teleportHeroToZone } from './BranchSystem';
import {
  addFloatingText,
  applyDamageToEnemy,
  applyDamageToHero,
  castHeroSkill,
  maybeTriggerOrbChain,
  performBasicAttack,
} from './CombatSystem';
import { buyItem, getQuickBuyOptions, synthesizeItem, upgradeItemInSlot, usePotionSlot } from './EconomySystem';
import { EnemyEntity, GameWorldState, HeroEntity } from './GameState';

export function startWave(world: GameWorldState, waveNum: number): void {
  world.wave = waveNum;
  world.waveState = 'fighting';
  const waveDef = getWaveDef(waveNum);
  const diff = DIFFICULTIES[world.difficulty];
  const coopCountScale = 1 + (world.playerCount - 1) * 0.35;

  const queue: { kind: EnemyKind; laneId: number }[] = [];
  for (const g of waveDef.groups) {
    const total = Math.max(1, Math.round(g.count * diff.countMult * coopCountScale));
    for (let i = 0; i < total; i++) {
      const laneId = i % Math.max(1, waveDef.lanes);
      queue.push({ kind: g.kind, laneId });
    }
  }
  if (waveDef.boss) {
    queue.push({ kind: waveDef.boss, laneId: 1 });
    if (waveNum >= 20 && diff.doubleBossOn20) {
      queue.push({ kind: 'boss_frost_wyrm', laneId: 0 });
    }
    SoundFX.playBossHorn();
    SoundFX.setBgmMode('boss');
  } else {
    SoundFX.setBgmMode('combat');
  }

  world.waveSpawnQueue = queue;
  world.waveSpawnCooldown = 0.2;
  world.bannerText = `⚔️ 第 ${waveNum} 波：${waveDef.title}`;
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
          spawnEnemy(
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
          world.victory = true;
          world.ended = true;
          world.waveState = 'ended';
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

export function applyDamageToSanctuary(world: GameWorldState, rawDmg: number): void {
  if (world.ended || world.sanctuary.invulnTimer > 0) return;
  const armorMult = 100 / (100 + world.sanctuary.armor * 3);
  const dmg = Math.max(1, Math.round(rawDmg * armorMult));

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
    world.victory = false;
    world.ended = true;
    world.waveState = 'ended';
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

    // Boss special abilities with ground warning telegraphs
    if (e.isBoss) {
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
        e.x += Math.cos(ang) * spd * dt;
        e.y += Math.sin(ang) * spd * dt;
        const cl = clampToRect(e.x, e.y, e.radius + 4, { x: 1450, y: 1450, w: 1300, h: 1300 });
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
      if (e.isSuicide) {
        // Explode on impact!
        world.vfx.push({ kind: 'explosion', x: e.x, y: e.y, radius: 110, color: '#f97316', life: 0.4, maxLife: 0.4 });
        if (targetHero) applyDamageToHero(world, targetHero, e.dmg, e);
        if (targetSummon) targetSummon.hp -= e.dmg;
        if (targetAthena) applyDamageToSanctuary(world, e.dmg * 1.15);
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
            color: e.accentColor,
            pierceLeft: 0,
            hitIds: [],
            life: (e.attackRange + 90) / 420,
            targetAthena,
          });
        } else {
          if (targetHero) applyDamageToHero(world, targetHero, e.dmg, e);
          else if (targetSummon) targetSummon.hp -= e.dmg;
          else if (targetAthena) applyDamageToSanctuary(world, e.dmg);
        }
      }
    } else if (dist > 6) {
      const spd = e.moveSpeed * (e.slowTimer > 0 ? 1 - e.slowFactor : 1);
      e.x += (dx / dist) * spd * dt;
      e.y += (dy / dist) * spd * dt;
      const cl = clampToRect(e.x, e.y, e.radius + 4, ZONES[e.zoneId].rect);
      e.x = cl.x;
      e.y = cl.y;
    }
  }

  // Pairwise soft separation so 3-column swarms fan out cleanly at convergence & combat
  const enemyCount = world.enemies.length;
  for (let i = 0; i < enemyCount; i++) {
    const a = world.enemies[i];
    if (a.hp <= 0) continue;
    for (let j = i + 1; j < enemyCount; j++) {
      const b = world.enemies[j];
      if (b.hp <= 0 || b.zoneId !== a.zoneId) continue;
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
      const clA = clampToRect(a.x - nx, a.y - ny, a.radius + 4, ZONES[a.zoneId].rect);
      a.x = clA.x;
      a.y = clA.y;
      const clB = clampToRect(b.x + nx, b.y + ny, b.radius + 4, ZONES[b.zoneId].rect);
      b.x = clB.x;
      b.y = clB.y;
    }
  }
}

function triggerBossAbility(world: GameWorldState, boss: EnemyEntity): void {
  const nearest = findNearestHeroInZone(world, boss.zoneId, boss.x, boss.y, 480);
  const tx = nearest ? nearest.x : boss.zoneId === 'sanctuary' ? ATHENA_POS.x : boss.x;
  const ty = nearest ? nearest.y : boss.zoneId === 'sanctuary' ? ATHENA_POS.y : boss.y;

  if (boss.kind === 'boss_skeleton_king') {
    boss.bossAbilityTimer = 5.0;
    world.telegraphs.push({
      id: world.nextEntityId++,
      fromEnemy: true,
      ownerId: `boss_${boss.id}`,
      zoneId: boss.zoneId,
      kind: 'enemy_aoe',
      x: boss.x,
      y: boss.y,
      radius: 175,
      timer: 1.05,
      maxTimer: 1.05,
      tickTimer: 99,
      damage: boss.dmg * 2.4,
      color: '#38bdf8',
    });
    if (world.enemies.filter((x) => x.zoneId === boss.zoneId).length < 24) {
      spawnEnemy(world, 'skeleton_archer', boss.zoneId, boss.x - 65, boss.y + 40, Math.max(1.2, world.wave * 0.35), 1.15);
      spawnEnemy(world, 'skeleton_archer', boss.zoneId, boss.x + 65, boss.y + 40, Math.max(1.2, world.wave * 0.35), 1.15);
      spawnEnemy(world, 'skeleton_archer', boss.zoneId, boss.x, boss.y + 70, Math.max(1.2, world.wave * 0.35), 1.15);
    }
  } else if (boss.kind === 'boss_abyss_lord') {
    boss.bossAbilityTimer = 4.2;
    world.telegraphs.push({
      id: world.nextEntityId++,
      fromEnemy: true,
      ownerId: `boss_${boss.id}`,
      zoneId: boss.zoneId,
      kind: 'poison_pool',
      x: tx,
      y: ty,
      radius: 155,
      timer: 4.5,
      maxTimer: 4.5,
      tickTimer: 0.35,
      damage: boss.dmg * 0.72,
      color: '#a855f7',
    });
  } else if (boss.kind === 'boss_frost_wyrm') {
    boss.bossAbilityTimer = 4.0;
    boss.shield = Math.max(boss.shield, boss.maxHp * 0.1);
    for (let k = 0; k < 3; k++) {
      world.telegraphs.push({
        id: world.nextEntityId++,
        fromEnemy: true,
        ownerId: `boss_${boss.id}`,
        zoneId: boss.zoneId,
        kind: 'enemy_aoe',
        x: tx + (k === 0 ? 0 : (Math.random() - 0.5) * 220),
        y: ty + (k === 0 ? 0 : (Math.random() - 0.5) * 220),
        radius: 145,
        timer: 1.15,
        maxTimer: 1.15,
        tickTimer: 99,
        damage: boss.dmg * 2.5,
        color: '#67e8f9',
      });
    }
  } else if (boss.kind === 'boss_doom_overlord' || boss.kind === 'boss_hidden_chaos') {
    boss.bossAbilityTimer = boss.hp < boss.maxHp * 0.5 ? 3.2 : 4.2;
    for (let k = 0; k < 4; k++) {
      world.telegraphs.push({
        id: world.nextEntityId++,
        fromEnemy: true,
        ownerId: `boss_${boss.id}`,
        zoneId: boss.zoneId,
        kind: 'enemy_aoe',
        x: tx + (Math.random() - 0.5) * 260,
        y: ty + (Math.random() - 0.5) * 260,
        radius: 150,
        timer: 1.05,
        maxTimer: 1.05,
        tickTimer: 99,
        damage: boss.dmg * 2.6,
        color: '#f43f5e',
      });
    }
  } else {
    // Elemental dungeon bosses
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
        applyDamageToSanctuary(world, p.damage);
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
          applyDamageToSanctuary(world, t.damage * 0.7);
        }
        world.telegraphs.splice(i, 1);
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
        s.x += (dx / d) * s.moveSpeed * dt;
        s.y += (dy / d) * s.moveSpeed * dt;
      }
    } else if (owner && owner.zoneId === s.zoneId) {
      const dx = owner.x - s.x;
      const dy = owner.y - s.y;
      const d = Math.hypot(dx, dy);
      if (d > 95) {
        s.x += (dx / d) * s.moveSpeed * dt;
        s.y += (dy / d) * s.moveSpeed * dt;
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

      if (d <= bot.stats.attackRange + target.radius + 10) {
        if (bot.attackCd <= 0) {
          performBasicAttack(world, bot, dx / d, dy / d, onKilled);
        }
      } else {
        bot.facing = Math.atan2(dy, dx);
        bot.x += (dx / d) * bot.stats.moveSpeed * dt;
        bot.y += (dy / d) * bot.stats.moveSpeed * dt;
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
        bot.x += (dx / d) * bot.stats.moveSpeed * dt;
        bot.y += (dy / d) * bot.stats.moveSpeed * dt;
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
