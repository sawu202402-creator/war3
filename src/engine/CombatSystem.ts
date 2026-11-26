import { ENEMY_ARCHETYPES } from '../data/waves';
import { getHeroClassDef } from '../data/heroes';
import { getItemDef, SET_BONUSES } from '../data/items';
import { ATHENA_POS, FOUNTAIN_POS, HERO_COLLISION_RADIUS, ZONES, resolveLinearDash, resolveWorldCollision } from '../data/worldMap';
import { SoundFX } from '../audio/SoundFX';
import { SaveManager } from '../meta/SaveManager';
import { StatBlock } from '../types';
import { EnemyEntity, GameWorldState, HeroEntity } from './GameState';

const STATIONARY_CAST_SKILLS = new Set([
  'am_flamewave',
  'am_frostnova',
  'am_blizzard',
  'rng_volley',
  'rng_starfall',
  'pr_holychain',
  'pr_treant',
  'pr_sanctuary',
]);

export function getHeroAttackLockDuration(hero: HeroEntity): number {
  const interval = 1 / Math.max(0.4, hero.stats.atkSpeed);
  return Math.max(0.11, Math.min(0.24, interval * 0.34));
}

export function xpForLevel(level: number): number {
  return Math.round(130 + Math.pow(level, 1.55) * 85);
}

export function recalcHeroStats(hero: HeroEntity): void {
  const def = getHeroClassDef(hero.classId);
  const save = SaveManager.get();
  const mastery = SaveManager.getHeroMasteryLevel(hero.classId).level;
  const talents = save.talents;

  const lv = hero.level - 1;
  const s: StatBlock = {
    maxHp: def.baseStats.maxHp + lv * def.growthPerLevel.maxHp + hero.bookBonuses.maxHp,
    maxMp: def.baseStats.maxMp + lv * def.growthPerLevel.maxMp + hero.bookBonuses.maxMp,
    hpRegen: def.baseStats.hpRegen + lv * 0.45,
    mpRegen: def.baseStats.mpRegen + lv * 0.25 + hero.bookBonuses.mpRegen,
    ad: def.baseStats.ad + lv * def.growthPerLevel.ad + hero.bookBonuses.ad,
    ap: def.baseStats.ap + lv * def.growthPerLevel.ap + hero.bookBonuses.ap,
    armor: def.baseStats.armor + lv * def.growthPerLevel.armor + hero.bookBonuses.armor,
    atkSpeed: def.baseStats.atkSpeed + lv * def.growthPerLevel.atkSpeed + hero.bookBonuses.atkSpeed,
    moveSpeed: def.baseStats.moveSpeed,
    critChance: def.baseStats.critChance + hero.bookBonuses.critChance,
    critMult: def.baseStats.critMult,
    lifesteal: def.baseStats.lifesteal,
    cdr: def.baseStats.cdr,
    attackRange: def.baseStats.attackRange,
    damageReduce: def.baseStats.damageReduce,
    thorns: def.baseStats.thorns,
    cleave: 0,
    splashRadius: 0,
    orbChainChance: 0,
  };

  // Hero Mastery & Sanctuary Talents
  s.ad *= 1 + talents.might * 0.04 + (mastery - 1) * 0.01;
  s.ap *= 1 + talents.might * 0.04 + (mastery - 1) * 0.01;
  s.maxHp *= 1 + talents.vitality * 0.05 + (mastery - 1) * 0.01;
  s.armor += talents.vitality * 1.5;
  s.cdr += talents.haste * 0.03;
  s.moveSpeed *= 1 + talents.haste * 0.02;

  // Equipped 6 items
  const setCount = new Map<string, number>();
  for (const itemId of hero.inventory) {
    if (!itemId) continue;
    const item = getItemDef(itemId);
    if (!item || !item.stats) continue;

    // Exclusive weapon grows Lv.1 -> Lv.5 (+35% per level beyond 1)
    const mult = item.heroExclusive === hero.classId ? 1 + (hero.exclusiveLevel - 1) * 0.35 : 1;
    const st = item.stats;
    if (st.maxHp) s.maxHp += st.maxHp * mult;
    if (st.maxMp) s.maxMp += st.maxMp * mult;
    if (st.hpRegen) s.hpRegen += st.hpRegen * mult;
    if (st.mpRegen) s.mpRegen += st.mpRegen * mult;
    if (st.ad) s.ad += st.ad * mult;
    if (st.ap) s.ap += st.ap * mult;
    if (st.armor) s.armor += st.armor * mult;
    if (st.atkSpeed) s.atkSpeed += st.atkSpeed * mult;
    if (st.moveSpeed) s.moveSpeed += st.moveSpeed;
    if (st.critChance) s.critChance += st.critChance * mult;
    if (st.critMult) s.critMult += st.critMult * mult;
    if (st.lifesteal) s.lifesteal += st.lifesteal * mult;
    if (st.cdr) s.cdr += st.cdr;
    if (st.attackRange) s.attackRange += st.attackRange;
    if (st.damageReduce) s.damageReduce += st.damageReduce;
    if (st.thorns) s.thorns += st.thorns * mult;
    if (st.cleave) {
      const cleaveMult = item.heroExclusive === hero.classId ? 1 + (hero.exclusiveLevel - 1) * 0.2 : 1;
      s.cleave = (s.cleave || 0) + st.cleave * cleaveMult;
    }
    if (st.splashRadius) {
      const spMult = item.heroExclusive === hero.classId ? 1 + (hero.exclusiveLevel - 1) * 0.12 : 1;
      s.splashRadius = Math.max(s.splashRadius || 0, st.splashRadius * spMult);
    }
    if (st.orbChainChance) {
      s.orbChainChance = (s.orbChainChance || 0) + st.orbChainChance;
    }

    if (item.setId) {
      setCount.set(item.setId, (setCount.get(item.setId) || 0) + 1);
    }
  }

  // Set bonuses
  for (const sb of SET_BONUSES) {
    const cnt = setCount.get(sb.id) || 0;
    const applyPart = (part: Partial<StatBlock>) => {
      if (part.maxHp) s.maxHp += part.maxHp;
      if (part.ad) s.ad += part.ad;
      if (part.ap) s.ap += part.ap;
      if (part.armor) s.armor += part.armor;
      if (part.mpRegen) s.mpRegen += part.mpRegen;
      if (part.critChance) s.critChance += part.critChance;
      if (part.critMult) s.critMult += part.critMult;
      if (part.lifesteal) s.lifesteal += part.lifesteal;
      if (part.cdr) s.cdr += part.cdr;
      if (part.damageReduce) s.damageReduce += part.damageReduce;
      if (part.thorns) s.thorns += part.thorns;
    };
    if (cnt >= 2) applyPart(sb.twoPieceStats);
    if (cnt >= (sb.id === 'set_aegis' ? 3 : 4)) applyPart(sb.fourPieceStats);
  }

  // Awakening branch bonuses
  if (hero.awakeningBranchId) {
    const branch = def.awakeningBranches.find((b) => b.id === hero.awakeningBranchId);
    if (branch) {
      const b = branch.bonuses;
      if (b.maxHp) s.maxHp += b.maxHp;
      if (b.maxMp) s.maxMp += b.maxMp;
      if (b.mpRegen) s.mpRegen += b.mpRegen;
      if (b.ad) s.ad += b.ad;
      if (b.ap) s.ap += b.ap;
      if (b.armor) s.armor += b.armor;
      if (b.atkSpeed) s.atkSpeed += b.atkSpeed;
      if (b.moveSpeed) s.moveSpeed += b.moveSpeed;
      if (b.critChance) s.critChance += b.critChance;
      if (b.critMult) s.critMult += b.critMult;
      if (b.lifesteal) s.lifesteal += b.lifesteal;
      if (b.cdr) s.cdr += b.cdr;
      if (b.attackRange) s.attackRange += b.attackRange;
      if (b.damageReduce) s.damageReduce += b.damageReduce;
      if (b.thorns) s.thorns += b.thorns;
    }
  }

  // Class Passives & Active Buffs
  if (hero.classId === 'paladin' && hero.passiveStacks > 0) {
    s.armor += hero.passiveStacks * 3;
    s.thorns += hero.passiveStacks * 12;
  }
  if (hero.classId === 'archmage' && hero.passiveStacks > 0) {
    s.ap *= 1 + hero.passiveStacks * 0.05;
    s.mpRegen += hero.passiveStacks * 2.5;
  }
  if (hero.avatarTimer > 0) {
    s.maxHp *= 1.5;
    s.armor += 35;
    s.ad *= 1.25;
    s.cleave = (s.cleave || 0) + 0.45;
  }
  if (hero.hawkeyeTimer > 0) {
    s.attackRange += 80;
    s.critChance += 0.25;
  }
  if (hero.stealthTimer > 0) {
    s.moveSpeed *= 1.55;
  }
  if (hero.windbootsTimer > 0) {
    s.moveSpeed *= 1.45;
  }
  if (hero.warsongTimer > 0) {
    s.ad *= 1.35;
    s.ap *= 1.35;
    s.atkSpeed += 0.4;
    s.lifesteal += 0.12;
  }
  if (hero.comboTier > 0) {
    const tierIdx = Math.min(3, hero.comboTier);
    const atkBonuses = [0, 0.14, 0.28, 0.45];
    const critBonuses = [0, 0.05, 0.1, 0.16];
    const spdBonuses = [1, 1.05, 1.1, 1.15];
    const cdrBonuses = [0, 0, 0.08, 0.14];
    s.atkSpeed += atkBonuses[tierIdx];
    s.critChance += critBonuses[tierIdx];
    s.moveSpeed *= spdBonuses[tierIdx];
    s.cdr += cdrBonuses[tierIdx];
  }

  // Sanctuary Stage Aura (Lv.5 Tier 1 / Lv.10 Tier 2)
  if (hero.sanctuaryAuraTier >= 2) {
    s.ad *= 1.22;
    s.ap *= 1.22;
    s.atkSpeed += 0.3;
    s.mpRegen += 14;
    s.damageReduce += 0.08;
  } else if (hero.sanctuaryAuraTier === 1) {
    s.ad *= 1.1;
    s.ap *= 1.1;
    s.atkSpeed += 0.14;
    s.mpRegen += 6;
  }

  s.critChance = Math.min(0.95, Math.max(0, s.critChance));
  s.cdr = Math.min(0.55, Math.max(0, s.cdr));
  s.damageReduce = Math.min(0.65, Math.max(0, s.damageReduce));
  s.lifesteal = Math.min(0.65, Math.max(0, s.lifesteal));
  s.atkSpeed = Math.min(4.2, Math.max(0.6, s.atkSpeed));
  s.moveSpeed = Math.min(540, Math.max(180, s.moveSpeed));
  s.cleave = Math.min(1.2, Math.max(0, s.cleave || 0));
  s.splashRadius = Math.min(150, Math.max(0, s.splashRadius || 0));
  s.orbChainChance = Math.min(0.75, Math.max(0, s.orbChainChance || 0));

  const prevMaxHp = hero.stats?.maxHp || s.maxHp;
  const hpRatio = prevMaxHp > 0 ? hero.hp / prevMaxHp : 1;
  hero.stats = s;
  hero.hp = Math.min(s.maxHp, Math.max(1, hero.dead ? 0 : hpRatio * s.maxHp));
  hero.mp = Math.min(s.maxMp, hero.mp);
}

export function grantHeroXp(world: GameWorldState, hero: HeroEntity, amount: number): void {
  const save = SaveManager.get();
  const mult = 1 + save.talents.xpBoost * 0.06;
  hero.xp += Math.round(amount * mult);

  let leveled = false;
  while (hero.xp >= hero.nextXp && hero.level < 40) {
    hero.xp -= hero.nextXp;
    hero.level += 1;
    hero.nextXp = xpForLevel(hero.level);
    leveled = true;
  }
  if (leveled) {
    recalcHeroStats(hero);
    hero.hp = hero.stats.maxHp;
    hero.mp = hero.stats.maxMp;
    world.vfx.push({
      kind: 'levelup',
      x: hero.x,
      y: hero.y,
      radius: 56,
      color: '#fde047',
      life: 0.9,
      maxLife: 0.9,
    });
    addFloatingText(world, hero.x, hero.y - 42, `升级 Lv.${hero.level}!`, '#fde047', 16);
    if (hero.isLocal) SoundFX.playLevelUp();

    if (hero.level >= 15 && !hero.awakeningUnlocked && hero.exclusiveUnlocked && !hero.awakeningPrompted) {
      hero.awakeningPrompted = true;
    }
  }
}

export function addFloatingText(
  world: GameWorldState,
  x: number,
  y: number,
  text: string,
  color: string,
  size = 13
): void {
  if (world.floatingTexts.length > 95) world.floatingTexts.shift();
  world.floatingTexts.push({
    x: x + (Math.random() - 0.5) * 16,
    y,
    vy: -38,
    text,
    color,
    size,
    life: 0.85,
    maxLife: 0.85,
  });
}

function pushDashAfterimages(hero: HeroEntity, fromX: number, fromY: number, toX: number, toY: number, steps = 4): void {
  const flip = Math.cos(hero.facing) < 0 ? -1 : 1;
  for (let i = 0; i < steps; i++) {
    const t = i / steps;
    hero.afterimages.push({
      x: fromX + (toX - fromX) * t,
      y: fromY + (toY - fromY) * t,
      flip,
      pose: i === steps - 1 ? 'attack' : 'walk1',
      alpha: 0.22 + t * 0.22,
      color: hero.color,
    });
  }
  if (hero.afterimages.length > 10) hero.afterimages.splice(0, hero.afterimages.length - 10);
}

export function applyDamageToEnemy(
  world: GameWorldState,
  enemy: EnemyEntity,
  rawDamage: number,
  opts: {
    attacker?: HeroEntity;
    isMagic?: boolean;
    canCrit?: boolean;
    forceCrit?: boolean;
    lifestealMult?: number;
    trueDamage?: boolean;
    onEnemyKilled?: (enemy: EnemyEntity, killer?: HeroEntity) => void;
  }
): number {
  if (enemy.hp <= 0) return 0;

  let dmg = rawDamage;
  let isCrit = Boolean(opts.forceCrit);
  if (!isCrit && opts.canCrit && opts.attacker) {
    if (Math.random() < opts.attacker.stats.critChance) {
      isCrit = true;
    }
  }
  if (isCrit && opts.attacker) {
    dmg *= opts.attacker.stats.critMult;
  }

  if (!opts.trueDamage) {
    const effArmor = enemy.armorShredTimer > 0 ? Math.max(0, enemy.armor * 0.4) : enemy.armor;
    const armorMult = opts.isMagic ? 100 / (100 + effArmor * 2.5) : 100 / (100 + effArmor * 4);
    dmg *= armorMult;
  }

  if (opts.attacker && enemy.isBoss && opts.attacker.awakeningBranchId === 'rng_shadowhunter') {
    dmg *= 1.3;
  }
  if (opts.attacker && enemy.stunTimer > 0 && opts.attacker.awakeningBranchId === 'am_frostlord') {
    dmg *= 1.35;
  }

  const finalDmg = Math.max(1, Math.round(dmg));
  if (enemy.shield > 0) {
    const absorb = Math.min(enemy.shield, finalDmg);
    enemy.shield -= absorb;
    enemy.hp -= finalDmg - absorb;
  } else {
    enemy.hp -= finalDmg;
  }
  enemy.hitFlash = 0.12;
  if (world.vfx.length < 180) {
    world.vfx.push({
      kind: 'hit_spark',
      x: enemy.x + (Math.random() - 0.5) * 14,
      y: enemy.y - enemy.radius * 0.2,
      angle: Math.random() * Math.PI * 2,
      radius: isCrit ? 48 : 34,
      color: isCrit ? '#fde047' : opts.isMagic ? '#67e8f9' : '#fb923c',
      life: 0.16,
      maxLife: 0.16,
    });
  }

  if (opts.attacker) {
    const kx = enemy.x - opts.attacker.x;
    const ky = enemy.y - opts.attacker.y;
    const kd = Math.hypot(kx, ky) || 1;
    const push = enemy.isBoss ? 2.5 : enemy.isMiniBoss ? 5 : 9;
    enemy.knockX = (kx / kd) * push;
    enemy.knockY = (ky / kd) * push;

    opts.attacker.damageDealt += finalDmg;
    const ls = opts.attacker.stats.lifesteal * (opts.lifestealMult ?? 1);
    if (ls > 0 && !opts.attacker.dead) {
      opts.attacker.hp = Math.min(opts.attacker.stats.maxHp, opts.attacker.hp + finalDmg * ls);
    }
    if (isCrit && opts.attacker.isLocal) {
      world.cameraShake = Math.max(world.cameraShake, 2.5);
    }
  }

  if (isCrit) {
    addFloatingText(world, enemy.x, enemy.y - enemy.radius - 6, `${finalDmg}!`, '#facc15', 16);
    if (opts.attacker?.isLocal) SoundFX.playCritHit();
  } else if (finalDmg >= 40) {
    addFloatingText(
      world,
      enemy.x,
      enemy.y - enemy.radius - 2,
      `${finalDmg}`,
      opts.isMagic ? '#67e8f9' : '#f8fafc',
      12
    );
  }

  if (enemy.hp <= 0) {
    enemy.hp = 0;
    if (enemy.isBoss) world.cameraShake = Math.max(world.cameraShake, 7.0);
    opts.onEnemyKilled?.(enemy, opts.attacker);
  }
  return finalDmg;
}

export function applyDamageToHero(world: GameWorldState, hero: HeroEntity, rawDmg: number, attacker?: EnemyEntity): void {
  if (hero.dead || hero.invulnTimer > 0 || hero.omnislashTimer > 0) return;

  // Priest Sanctuary Ult death ward
  const inSanctuaryWard = world.telegraphs.some(
    (t) =>
      t.kind === 'sanctuary' &&
      t.zoneId === hero.zoneId &&
      Math.hypot(t.x - hero.x, t.y - hero.y) <= t.radius
  );

  const armorMult = 100 / (100 + hero.stats.armor * 4);
  const dmg = Math.max(1, Math.round(rawDmg * armorMult * (1 - hero.stats.damageReduce)));

  // Paladin passive stacks + thorns
  if (hero.classId === 'paladin') {
    hero.passiveStacks = Math.min(8, hero.passiveStacks + 1);
    hero.passiveTimer = 5.0;
  }
  if (hero.stats.thorns > 0 && attacker && Math.hypot(attacker.x - hero.x, attacker.y - hero.y) < 160) {
    const reflect = hero.stats.thorns + (hero.awakeningBranchId === 'pal_fortress' ? dmg * 0.4 : 0);
    attacker.hp -= Math.round(reflect);
    attacker.hitFlash = 0.08;
  }
  if (attacker && attacker.hp > 0 && attacker.affix === 'bloodlust') {
    const leech = Math.min(attacker.maxHp - attacker.hp, Math.max(10, Math.round(dmg * 0.45)));
    if (leech > 0) {
      attacker.hp += leech;
      addFloatingText(world, attacker.x, attacker.y - 24, `+${leech}`, '#f87171', 11);
    }
  }

  if (hero.shield > 0) {
    const ab = Math.min(hero.shield, dmg);
    hero.shield -= ab;
    const rem = dmg - ab;
    hero.hp -= rem;
  } else {
    hero.hp -= dmg;
  }
  hero.hitFlash = 0.14;

  if (hero.hp <= 0) {
    if (inSanctuaryWard) {
      hero.hp = 1;
      return;
    }
    if (hero.ankhs > 0) {
      hero.ankhs -= 1;
      hero.hp = hero.stats.maxHp;
      hero.mp = hero.stats.maxMp;
      hero.invulnTimer = 2.0;
      addFloatingText(world, hero.x, hero.y - 36, '重生十字章生效!', '#facc15', 16);
      world.vfx.push({ kind: 'levelup', x: hero.x, y: hero.y, radius: 75, color: '#facc15', life: 0.7, maxLife: 0.7 });
      if (hero.isLocal) SoundFX.playHolyChime();
      return;
    }

    hero.hp = 0;
    hero.dead = true;
    const save = SaveManager.get();
    const baseRevive = Math.min(24, 8 + world.wave * 0.65);
    const reviveTime = Math.max(4, baseRevive - save.talents.reviveFast * 1.2);
    hero.reviveTimer = reviveTime;
    hero.reviveMax = reviveTime;
    hero.downedX = hero.x;
    hero.downedY = hero.y;
    hero.reviveAssistProgress = 0;
    hero.carryingWater = false;
    addFloatingText(world, hero.x, hero.y - 24, '英雄阵亡!', '#ef4444', 15);
  }
}

export function maybeTriggerOrbChain(
  world: GameWorldState,
  attacker: HeroEntity | undefined,
  anchor: EnemyEntity,
  onEnemyKilled?: (enemy: EnemyEntity, killer?: HeroEntity) => void
): void {
  if (!attacker || attacker.dead) return;
  const chance = attacker.stats.orbChainChance || 0;
  if (chance <= 0 || Math.random() > chance) return;

  const maxBounces = chance >= 0.4 ? 5 : 3;
  const orbDmg = attacker.stats.ad * 0.65 + attacker.stats.ap * 0.75;
  const pts: { x: number; y: number }[] = [{ x: anchor.x, y: anchor.y }];
  const hitIds = new Set<number>([anchor.id]);
  let curX = anchor.x;
  let curY = anchor.y;

  for (let hop = 0; hop < maxBounces; hop++) {
    let best: EnemyEntity | null = null;
    let bestDist = 260;
    for (const e of world.enemies) {
      if (e.zoneId !== attacker.zoneId || e.hp <= 0 || hitIds.has(e.id)) continue;
      const d = Math.hypot(e.x - curX, e.y - curY);
      if (d < bestDist) {
        bestDist = d;
        best = e;
      }
    }
    if (!best) break;
    hitIds.add(best.id);
    pts.push({ x: best.x, y: best.y });
    curX = best.x;
    curY = best.y;
    applyDamageToEnemy(world, best, orbDmg * Math.pow(0.88, hop), {
      attacker,
      isMagic: true,
      onEnemyKilled,
    });
  }

  if (pts.length > 1) {
    world.vfx.push({
      kind: 'chain',
      x: anchor.x,
      y: anchor.y,
      radius: 10,
      color: '#38bdf8',
      life: 0.34,
      maxLife: 0.34,
      points: pts,
    });
  } else {
    applyDamageToEnemy(world, anchor, orbDmg * 0.5, {
      attacker,
      isMagic: true,
      onEnemyKilled,
    });
  }
}

export function performBasicAttack(
  world: GameWorldState,
  hero: HeroEntity,
  dirX: number,
  dirY: number,
  onEnemyKilled: (enemy: EnemyEntity, killer?: HeroEntity) => void
): void {
  const def = getHeroClassDef(hero.classId);
  hero.facing = Math.atan2(dirY, dirX);
  hero.attackCd = 1 / hero.stats.atkSpeed;
  hero.attackLockTimer = getHeroAttackLockDuration(hero);
  hero.vx = 0;
  hero.vy = 0;
  hero.swingAnim = 0.28;
  hero.swingDuration = 0.28;
  hero.attackCombo = (hero.attackCombo + 1) % 3;

  const isStealthBreak = hero.classId === 'blademaster' && hero.stealthTimer > 0;
  if (isStealthBreak) hero.stealthTimer = 0;

  if (def.attackType === 'melee') {
    const range = hero.stats.attackRange + 16;
    const isBmThirdCombo = hero.classId === 'blademaster' && hero.attackCombo === 0;
    const forceCrit = isStealthBreak || isBmThirdCombo;
    const mult = isStealthBreak ? 2.15 : isBmThirdCombo ? 2.0 : 1.0;
    const cleaveRatio = hero.stats.cleave || 0;

    let primary: EnemyEntity | null = null;
    let bestScore = Infinity;
    for (const e of world.enemies) {
      if (e.zoneId !== hero.zoneId || e.hp <= 0) continue;
      const dx = e.x - hero.x;
      const dy = e.y - hero.y;
      const d = Math.hypot(dx, dy);
      if (d > range + e.radius) continue;
      const angDiff = Math.abs(
        Math.atan2(Math.sin(Math.atan2(dy, dx) - hero.facing), Math.cos(Math.atan2(dy, dx) - hero.facing))
      );
      const score = (angDiff <= Math.PI * 0.48 ? 0 : 1000) + d + angDiff * 36;
      if (score < bestScore) {
        bestScore = score;
        primary = e;
      }
    }

    const fxRadius = cleaveRatio > 0 ? range + 10 : Math.min(72, range * 0.7);
    world.vfx.push({
      kind: hero.classId === 'paladin' ? 'swing_holy' : 'swing_blade',
      x: hero.x + dirX * (cleaveRatio > 0 ? 28 : 22),
      y: hero.y + dirY * (cleaveRatio > 0 ? 28 : 22),
      angle: hero.facing,
      radius: fxRadius,
      color: forceCrit ? '#facc15' : hero.color,
      life: 0.2,
      maxLife: 0.2,
    });
    if (hero.isLocal) SoundFX.playSwordSlash();

    if (primary) {
      const primaryDealt = applyDamageToEnemy(world, primary, hero.stats.ad * mult, {
        attacker: hero,
        canCrit: true,
        forceCrit,
        onEnemyKilled,
      });

      if (cleaveRatio > 0 && primaryDealt > 0) {
        let cleaveHits = 0;
        const cleaveDmg = Math.max(1, primaryDealt * cleaveRatio);
        for (const e of world.enemies) {
          if (e.id === primary.id || e.zoneId !== hero.zoneId || e.hp <= 0) continue;
          const dx = e.x - hero.x;
          const dy = e.y - hero.y;
          const d = Math.hypot(dx, dy);
          if (d > range + e.radius + 14) continue;
          const angDiff = Math.abs(
            Math.atan2(Math.sin(Math.atan2(dy, dx) - hero.facing), Math.cos(Math.atan2(dy, dx) - hero.facing))
          );
          if (angDiff <= Math.PI * 0.65 || d < e.radius + 26) {
            applyDamageToEnemy(world, e, cleaveDmg, {
              attacker: hero,
              trueDamage: true,
              onEnemyKilled,
            });
            cleaveHits++;
            if (cleaveHits >= 10) break;
          }
        }
      }

      maybeTriggerOrbChain(world, hero, primary, onEnemyKilled);
    }
  } else {
    // Ranged Hero Projectiles (single target at Lv.1; unlocks Multishot / Orb Splash via level & gear)
    world.vfx.push({
      kind: 'cast_burst',
      x: hero.x + dirX * 22,
      y: hero.y - 6 + dirY * 14,
      angle: hero.facing,
      radius: 26,
      color: hero.color,
      life: 0.16,
      maxLife: 0.16,
    });
    if (hero.isLocal) {
      if (hero.classId === 'ranger') SoundFX.playBowShot();
      else SoundFX.playMagicCast();
    }

    const baseAng = hero.facing;
    let arrowCount = 1;
    if (hero.classId === 'ranger') {
      arrowCount =
        (hero.level >= 14 ? 4 : hero.level >= 8 ? 3 : hero.level >= 4 ? 2 : 1) +
        (hero.awakeningBranchId === 'rng_skybow' ? 2 : 0);
      arrowCount = Math.min(6, arrowCount);
    }

    const dmgBase = hero.classId === 'archmage' || hero.classId === 'priest'
      ? hero.stats.ap * 0.85 + hero.stats.ad * 0.35
      : hero.stats.ad;
    const isMagic = hero.classId === 'archmage' || hero.classId === 'priest';
    const spread = 0.16;
    const projAoe = hero.stats.splashRadius || 0;
    const pierce = hero.hawkeyeTimer > 0 ? (hero.classId === 'ranger' ? 2 : 1) : 0;

    for (let i = 0; i < arrowCount; i++) {
      const offset = arrowCount === 1 ? 0 : (i - (arrowCount - 1) / 2) * spread;
      const ang = baseAng + offset;
      const spd = hero.classId === 'ranger' ? 760 : 620;
      const splitMult = i === 0 ? 1 : hero.awakeningBranchId === 'rng_skybow' ? 0.85 : 0.68;
      world.projectiles.push({
        id: world.nextEntityId++,
        fromEnemy: false,
        ownerId: hero.id,
        zoneId: hero.zoneId,
        x: hero.x + Math.cos(ang) * 20,
        y: hero.y + Math.sin(ang) * 20,
        vx: Math.cos(ang) * spd,
        vy: Math.sin(ang) * spd,
        radius: hero.classId === 'ranger' ? 7 : 9,
        damage: dmgBase * splitMult,
        isMagic,
        color: hero.color,
        aoeRadius: projAoe,
        pierceLeft: pierce,
        canTriggerOrb: true,
        hitIds: [],
        life: hero.stats.attackRange / spd + 0.12,
      });
    }
  }
}

export function castHeroSkill(
  world: GameWorldState,
  hero: HeroEntity,
  slot: number,
  dirX: number,
  dirY: number,
  distRatio: number,
  onEnemyKilled: (enemy: EnemyEntity, killer?: HeroEntity) => void
): boolean {
  if (hero.dead || hero.stunTimer > 0) return false;
  const def = getHeroClassDef(hero.classId);
  const sk = def.skills[slot];
  if (!sk) return false;
  if (sk.unlockLevel && hero.level < sk.unlockLevel) {
    if (hero.isLocal) addFloatingText(world, hero.x, hero.y - 30, `需要 Lv.${sk.unlockLevel} 解锁大招`, '#f87171', 13);
    return false;
  }
  if (hero.skillCds[slot] > 0) return false;
  if (hero.mp < sk.manaCost) {
    if (hero.isLocal) addFloatingText(world, hero.x, hero.y - 30, '法力不足!', '#38bdf8', 13);
    return false;
  }

  hero.mp -= sk.manaCost;
  hero.skillCds[slot] = Math.max(1.2, sk.cooldown * (1 - hero.stats.cdr));
  hero.recallTimer = 0;
  hero.castAnim = 0.42;
  hero.swingDuration = 0.42;
  if (STATIONARY_CAST_SKILLS.has(sk.id)) {
    hero.attackLockTimer = Math.max(hero.attackLockTimer, 0.14);
    hero.vx = 0;
    hero.vy = 0;
  }

  if (hero.classId === 'archmage') {
    hero.passiveStacks = Math.min(5, hero.passiveStacks + 1);
    hero.passiveTimer = 7.0;
    recalcHeroStats(hero);
  }

  const len = Math.hypot(dirX, dirY) || 1;
  const nx = dirX / len;
  const ny = dirY / len;
  hero.facing = Math.atan2(ny, nx);
  world.vfx.push({
    kind: 'cast_burst',
    x: hero.x,
    y: hero.y - 8,
    radius: sk.isUlt ? 86 : 58,
    color: hero.color,
    life: 0.3,
    maxLife: 0.3,
  });
  if (hero.isLocal && sk.isUlt) {
    world.cameraShake = Math.max(world.cameraShake, 5.5);
  }

  const skillDmg =
    sk.damageBase +
    (hero.level - 1) * sk.damagePerLv +
    hero.stats.ad * sk.adScale +
    hero.stats.ap * sk.apScale;

  const targetX = hero.x + nx * Math.min(sk.range, Math.max(60, sk.range * Math.max(0.45, distRatio)));
  const targetY = hero.y + ny * Math.min(sk.range, Math.max(60, sk.range * Math.max(0.45, distRatio)));

  // Dispatch exact 5x4 hero skill logic
  switch (sk.id) {
    // PALADIN
    case 'pal_charge': {
      const dest = resolveLinearDash(hero.zoneId, hero.x, hero.y, hero.x + nx * sk.range, hero.y + ny * sk.range, HERO_COLLISION_RADIUS, world.towers);
      const mult = hero.awakeningBranchId === 'pal_retribution' ? 1.55 : 1.0;
      for (const e of world.enemies) {
        if (e.zoneId !== hero.zoneId || e.hp <= 0) continue;
        if (distPointToSegment(e.x, e.y, hero.x, hero.y, dest.x, dest.y) <= sk.radius + e.radius) {
          e.stunTimer = Math.max(e.stunTimer, 1.5);
          applyDamageToEnemy(world, e, skillDmg * mult, { attacker: hero, isMagic: true, onEnemyKilled });
        }
      }
      world.vfx.push({ kind: 'beam', x: hero.x, y: hero.y, tx: dest.x, ty: dest.y, radius: 34, color: '#facc15', life: 0.35, maxLife: 0.35 });
      pushDashAfterimages(hero, hero.x, hero.y, dest.x, dest.y);
      hero.x = dest.x;
      hero.y = dest.y;
      hero.attackLockTimer = 0;
      if (hero.isLocal) {
        world.cameraShake = Math.max(world.cameraShake, 3.2);
        SoundFX.playSwordSlash();
      }
      return true;
    }
    case 'pal_consecrate': {
      hero.consecrateTimer = 5.0;
      world.vfx.push({ kind: 'ring', x: hero.x, y: hero.y, radius: sk.radius, color: '#fde047', life: 0.65, maxLife: 0.65 });
      if (hero.isLocal) SoundFX.playHolyChime();
      return true;
    }
    case 'pal_shield': {
      const shAmt = skillDmg * (hero.awakeningBranchId === 'pal_fortress' ? 1.45 : 1.0);
      for (const ally of world.heroes) {
        if (!ally.dead && ally.zoneId === hero.zoneId && Math.hypot(ally.x - hero.x, ally.y - hero.y) <= sk.radius) {
          ally.shield += shAmt;
          addFloatingText(world, ally.x, ally.y - 30, `+${Math.round(shAmt)} 圣盾`, '#fde047', 13);
        }
      }
      if (hero.zoneId === 'sanctuary' && Math.hypot(ATHENA_POS.x - hero.x, ATHENA_POS.y - hero.y) <= sk.radius + 140) {
        world.sanctuary.shield += shAmt * 1.4;
        addFloatingText(world, ATHENA_POS.x, ATHENA_POS.y - 60, `圣殿护盾 +${Math.round(shAmt * 1.4)}`, '#fde047', 14);
      }
      world.vfx.push({ kind: 'ring', x: hero.x, y: hero.y, radius: sk.radius, color: '#fef08a', life: 0.55, maxLife: 0.55 });
      if (hero.isLocal) SoundFX.playHolyChime();
      return true;
    }
    case 'pal_avatar': {
      hero.avatarTimer = 10.0;
      hero.stunTimer = 0;
      recalcHeroStats(hero);
      hero.hp = Math.min(hero.stats.maxHp, hero.hp + hero.stats.maxHp * 0.35);
      for (const e of world.enemies) {
        if (e.zoneId === hero.zoneId && e.hp > 0 && Math.hypot(e.x - hero.x, e.y - hero.y) <= sk.radius + e.radius) {
          e.stunTimer = Math.max(e.stunTimer, 1.2);
          applyDamageToEnemy(world, e, skillDmg, { attacker: hero, isMagic: true, onEnemyKilled });
        }
      }
      world.vfx.push({ kind: 'explosion', x: hero.x, y: hero.y, radius: sk.radius, color: '#facc15', life: 0.6, maxLife: 0.6 });
      if (hero.isLocal) SoundFX.playBossHorn();
      return true;
    }

    // BLADEMASTER
    case 'bm_windwalk': {
      hero.stealthTimer = 4.0;
      recalcHeroStats(hero);
      world.vfx.push({ kind: 'ring', x: hero.x, y: hero.y, radius: 65, color: '#f43f5e', life: 0.35, maxLife: 0.35 });
      if (hero.isLocal) SoundFX.playTeleport();
      return true;
    }
    case 'bm_bladestorm': {
      hero.bladestormTimer = 4.0;
      hero.stunTimer = 0;
      if (hero.isLocal) SoundFX.playSwordSlash();
      return true;
    }
    case 'bm_mirror': {
      hero.stunTimer = 0;
      const count = hero.awakeningBranchId === 'bm_phantom' ? 3 : 2;
      const inherit = hero.awakeningBranchId === 'bm_phantom' ? 0.65 : 0.45;
      for (let i = 0; i < count; i++) {
        const ang = (Math.PI * 2 * i) / count;
        const p = resolveWorldCollision(hero.zoneId, hero.x + Math.cos(ang) * 55, hero.y + Math.sin(ang) * 55, 18, world.towers, false);
        world.summons.push({
          id: world.nextEntityId++,
          ownerId: hero.id,
          kind: 'illusion',
          name: '剑圣幻象',
          zoneId: hero.zoneId,
          x: p.x,
          y: p.y,
          radius: 18,
          facing: hero.facing,
          hp: hero.stats.maxHp * 0.7,
          maxHp: hero.stats.maxHp * 0.7,
          ad: hero.stats.ad * inherit,
          atkSpeed: hero.stats.atkSpeed,
          attackTimer: 0,
          moveSpeed: hero.stats.moveSpeed,
          life: 14,
          maxLife: 14,
          color: '#fb7185',
        });
      }
      world.vfx.push({ kind: 'ring', x: hero.x, y: hero.y, radius: 90, color: '#fb7185', life: 0.4, maxLife: 0.4 });
      if (hero.isLocal) SoundFX.playMagicCast();
      return true;
    }
    case 'bm_omnislash': {
      hero.omnislashTimer = 1.6;
      hero.omnislashTargetX = targetX;
      hero.omnislashTargetY = targetY;
      hero.omnislashTicksLeft = hero.awakeningBranchId === 'bm_phantom' ? 10 : 7;
      if (hero.isLocal) SoundFX.playCritHit();
      return true;
    }

    // ARCHMAGE
    case 'am_flamewave': {
      const angles = hero.awakeningBranchId === 'am_pyromancer' ? [-0.26, 0, 0.26] : [0];
      for (const off of angles) {
        const a = hero.facing + off;
        world.projectiles.push({
          id: world.nextEntityId++,
          fromEnemy: false,
          ownerId: hero.id,
          zoneId: hero.zoneId,
          x: hero.x,
          y: hero.y,
          vx: Math.cos(a) * 560,
          vy: Math.sin(a) * 560,
          radius: 26,
          damage: skillDmg,
          isMagic: true,
          color: '#fb923c',
          pierceLeft: 99,
          hitIds: [],
          life: sk.range / 560,
          burnDps: skillDmg * 0.22,
        });
      }
      if (hero.isLocal) SoundFX.playMagicCast();
      return true;
    }
    case 'am_frostnova': {
      const rad = sk.radius * (hero.awakeningBranchId === 'am_frostlord' ? 1.3 : 1);
      for (const e of world.enemies) {
        if (e.zoneId === hero.zoneId && e.hp > 0 && Math.hypot(e.x - targetX, e.y - targetY) <= rad + e.radius) {
          e.stunTimer = Math.max(e.stunTimer, e.isBoss ? 0.65 : 1.6);
          e.slowTimer = Math.max(e.slowTimer, 4.0);
          e.slowFactor = 0.5;
          applyDamageToEnemy(world, e, skillDmg, { attacker: hero, isMagic: true, onEnemyKilled });
        }
      }
      world.vfx.push({ kind: 'explosion', x: targetX, y: targetY, radius: rad, color: '#38bdf8', life: 0.5, maxLife: 0.5 });
      if (hero.isLocal) SoundFX.playFrostShatter();
      return true;
    }
    case 'am_blink': {
      const dest = resolveWorldCollision(hero.zoneId, targetX, targetY, HERO_COLLISION_RADIUS, world.towers, false);
      const pts = [
        { x: hero.x, y: hero.y },
        { x: dest.x, y: dest.y },
      ];
      for (const p of pts) {
        for (const e of world.enemies) {
          if (e.zoneId === hero.zoneId && e.hp > 0 && Math.hypot(e.x - p.x, e.y - p.y) <= sk.radius + e.radius) {
            applyDamageToEnemy(world, e, skillDmg, { attacker: hero, isMagic: true, onEnemyKilled });
          }
        }
        world.vfx.push({ kind: 'teleport', x: p.x, y: p.y, radius: sk.radius, color: '#38bdf8', life: 0.45, maxLife: 0.45 });
      }
      hero.x = dest.x;
      hero.y = dest.y;
      hero.attackLockTimer = 0;
      pushDashAfterimages(hero, pts[0].x, pts[0].y, dest.x, dest.y);
      hero.mp = Math.min(hero.stats.maxMp, hero.mp + hero.stats.maxMp * 0.15);
      if (hero.isLocal) SoundFX.playTeleport();
      return true;
    }
    case 'am_blizzard': {
      const rad = sk.radius * (hero.awakeningBranchId === 'am_frostlord' ? 1.3 : 1);
      const dur = hero.awakeningBranchId === 'am_frostlord' ? 5.2 : 4.0;
      world.telegraphs.push({
        id: world.nextEntityId++,
        fromEnemy: false,
        ownerId: hero.id,
        zoneId: hero.zoneId,
        kind: 'blizzard',
        x: targetX,
        y: targetY,
        radius: rad,
        timer: dur,
        maxTimer: dur,
        tickTimer: 0.05,
        damage: skillDmg,
        slowPct: 0.45,
        freezeSec: 0.45,
        color: '#38bdf8',
      });
      if (hero.isLocal) SoundFX.playFrostShatter();
      return true;
    }

    // RANGER
    case 'rng_volley': {
      const count = 7;
      const spread = sk.coneAngle || Math.PI / 3;
      const forceCrit = hero.awakeningBranchId === 'rng_shadowhunter';
      for (let i = 0; i < count; i++) {
        const ang = hero.facing + (i / (count - 1) - 0.5) * spread;
        world.projectiles.push({
          id: world.nextEntityId++,
          fromEnemy: false,
          ownerId: hero.id,
          zoneId: hero.zoneId,
          x: hero.x,
          y: hero.y,
          vx: Math.cos(ang) * 740,
          vy: Math.sin(ang) * 740,
          radius: 10,
          damage: forceCrit ? skillDmg * 1.4 : skillDmg,
          isMagic: false,
          color: '#4ade80',
          pierceLeft: 6,
          hitIds: [],
          life: sk.range / 740,
          slowPct: 0.4,
        });
      }
      if (hero.isLocal) SoundFX.playBowShot();
      return true;
    }
    case 'rng_leap': {
      const dest = resolveWorldCollision(hero.zoneId, hero.x + nx * sk.range, hero.y + ny * sk.range, HERO_COLLISION_RADIUS, world.towers, false);
      for (const e of world.enemies) {
        if (e.zoneId === hero.zoneId && e.hp > 0 && Math.hypot(e.x - hero.x, e.y - hero.y) <= 130) {
          e.slowTimer = Math.max(e.slowTimer, 3.0);
          e.slowFactor = 0.45;
          applyDamageToEnemy(world, e, skillDmg, { attacker: hero, canCrit: true, onEnemyKilled });
        }
      }
      world.vfx.push({ kind: 'beam', x: hero.x, y: hero.y, tx: dest.x, ty: dest.y, radius: 16, color: '#4ade80', life: 0.25, maxLife: 0.25 });
      pushDashAfterimages(hero, hero.x, hero.y, dest.x, dest.y);
      hero.x = dest.x;
      hero.y = dest.y;
      hero.attackLockTimer = 0;
      hero.warsongTimer = Math.max(hero.warsongTimer, 3.5);
      recalcHeroStats(hero);
      if (hero.isLocal) SoundFX.playTeleport();
      return true;
    }
    case 'rng_hawkeye': {
      hero.hawkeyeTimer = 6.0;
      recalcHeroStats(hero);
      world.vfx.push({ kind: 'ring', x: hero.x, y: hero.y, radius: 85, color: '#a3e635', life: 0.45, maxLife: 0.45 });
      if (hero.isLocal) SoundFX.playMagicCast();
      return true;
    }
    case 'rng_starfall': {
      world.telegraphs.push({
        id: world.nextEntityId++,
        fromEnemy: false,
        ownerId: hero.id,
        zoneId: hero.zoneId,
        kind: 'starfall',
        x: targetX,
        y: targetY,
        radius: sk.radius,
        timer: 4.5,
        maxTimer: 4.5,
        tickTimer: 0.05,
        damage: skillDmg,
        slowPct: 0.45,
        color: '#4ade80',
      });
      if (hero.isLocal) SoundFX.playBowShot();
      return true;
    }

    // PRIEST
    case 'pr_holychain': {
      const healMult = hero.awakeningBranchId === 'pr_lifemaiden' ? 2.0 : 1.0;
      const healAmt = (skillDmg * 1.15) * healMult;
      const pts: { x: number; y: number }[] = [{ x: hero.x, y: hero.y }];
      for (const ally of world.heroes) {
        if (ally.zoneId === hero.zoneId && Math.hypot(ally.x - targetX, ally.y - targetY) <= sk.radius + 90) {
          if (ally.dead && hero.awakeningBranchId === 'pr_lifemaiden') {
            ally.dead = false;
            ally.hp = ally.stats.maxHp * 0.6;
            ally.mp = ally.stats.maxMp * 0.5;
            addFloatingText(world, ally.x, ally.y - 36, '圣光复活!', '#4ade80', 15);
          } else if (!ally.dead) {
            ally.hp = Math.min(ally.stats.maxHp, ally.hp + healAmt);
            addFloatingText(world, ally.x, ally.y - 26, `+${Math.round(healAmt)}`, '#4ade80', 14);
          }
          pts.push({ x: ally.x, y: ally.y });
        }
      }
      if (hero.zoneId === 'sanctuary' && Math.hypot(ATHENA_POS.x - targetX, ATHENA_POS.y - targetY) <= sk.radius + 140) {
        const baseHeal = healAmt * (hero.awakeningBranchId === 'pr_lifemaiden' ? 1.5 : 0.75);
        world.sanctuary.hp = Math.min(world.sanctuary.maxHp, world.sanctuary.hp + baseHeal);
        addFloatingText(world, ATHENA_POS.x, ATHENA_POS.y - 50, `圣殿 +${Math.round(baseHeal)}`, '#4ade80', 14);
        pts.push({ x: ATHENA_POS.x, y: ATHENA_POS.y });
      }
      for (const e of world.enemies) {
        if (e.zoneId === hero.zoneId && e.hp > 0 && Math.hypot(e.x - targetX, e.y - targetY) <= sk.radius) {
          applyDamageToEnemy(world, e, skillDmg, { attacker: hero, isMagic: true, onEnemyKilled });
        }
      }
      if (pts.length > 1) {
        world.vfx.push({ kind: 'chain', x: hero.x, y: hero.y, radius: 10, color: '#fef08a', life: 0.45, maxLife: 0.45, points: pts });
      }
      world.vfx.push({ kind: 'ring', x: targetX, y: targetY, radius: sk.radius, color: '#fde047', life: 0.45, maxLife: 0.45 });
      if (hero.isLocal) SoundFX.playHolyChime();
      return true;
    }
    case 'pr_treant': {
      const count = hero.awakeningBranchId === 'pr_druid' ? 3 : 2;
      const dur = hero.awakeningBranchId === 'pr_druid' ? 32 : 22;
      const mult = hero.awakeningBranchId === 'pr_druid' ? 1.65 : 1.0;
      for (let i = 0; i < count; i++) {
        const ang = (Math.PI * 2 * i) / count;
        const p = resolveWorldCollision(hero.zoneId, targetX + Math.cos(ang) * 44, targetY + Math.sin(ang) * 44, 24, world.towers, false);
        world.summons.push({
          id: world.nextEntityId++,
          ownerId: hero.id,
          kind: 'treant',
          name: '圣殿古树',
          zoneId: hero.zoneId,
          x: p.x,
          y: p.y,
          radius: 24,
          facing: hero.facing,
          hp: (hero.stats.maxHp * 1.15 + hero.stats.ap * 3.2) * mult,
          maxHp: (hero.stats.maxHp * 1.15 + hero.stats.ap * 3.2) * mult,
          ad: (skillDmg * 0.65) * mult,
          atkSpeed: 1.0,
          attackTimer: 0,
          moveSpeed: 210,
          life: dur,
          maxLife: dur,
          color: '#22c55e',
        });
      }
      world.vfx.push({ kind: 'ring', x: targetX, y: targetY, radius: 95, color: '#4ade80', life: 0.5, maxLife: 0.5 });
      if (hero.isLocal) SoundFX.playMagicCast();
      return true;
    }
    case 'pr_warsong': {
      for (const ally of world.heroes) {
        if (!ally.dead && ally.zoneId === hero.zoneId && Math.hypot(ally.x - hero.x, ally.y - hero.y) <= sk.radius) {
          ally.warsongTimer = 7.0;
          recalcHeroStats(ally);
          addFloatingText(world, ally.x, ally.y - 32, '战歌祝福!', '#c084fc', 14);
        }
      }
      world.vfx.push({ kind: 'ring', x: hero.x, y: hero.y, radius: sk.radius, color: '#c084fc', life: 0.55, maxLife: 0.55 });
      if (hero.isLocal) SoundFX.playHolyChime();
      return true;
    }
    case 'pr_sanctuary': {
      world.telegraphs.push({
        id: world.nextEntityId++,
        fromEnemy: false,
        ownerId: hero.id,
        zoneId: hero.zoneId,
        kind: 'sanctuary',
        x: targetX,
        y: targetY,
        radius: sk.radius,
        timer: 6.0,
        maxTimer: 6.0,
        tickTimer: 0.05,
        damage: skillDmg * 0.5,
        healPerSec: hero.stats.ap * 0.85 + 140,
        slowPct: 0.5,
        color: '#e879f9',
      });
      if (hero.isLocal) SoundFX.playHolyChime();
      return true;
    }
  }
  return false;
}

export function castFlashSkill(world: GameWorldState, hero: HeroEntity, dirX: number, dirY: number): boolean {
  if (hero.dead || hero.flashCd > 0) return false;
  const len = Math.hypot(dirX, dirY) || 1;
  const nx = dirX / len;
  const ny = dirY / len;
  const dest = resolveWorldCollision(hero.zoneId, hero.x + nx * 270, hero.y + ny * 270, HERO_COLLISION_RADIUS, world.towers, false);
  world.vfx.push({ kind: 'teleport', x: hero.x, y: hero.y, radius: 38, color: '#fbbf24', life: 0.35, maxLife: 0.35 });
  pushDashAfterimages(hero, hero.x, hero.y, dest.x, dest.y);
  hero.castAnim = 0.25;
  hero.x = dest.x;
  hero.y = dest.y;
  hero.attackLockTimer = 0;
  hero.teleportSeq = (hero.teleportSeq || 0) + 1;
  hero.flashCd = 18;
  hero.stunTimer = 0;
  world.vfx.push({ kind: 'teleport', x: dest.x, y: dest.y, radius: 44, color: '#fbbf24', life: 0.35, maxLife: 0.35 });
  if (hero.isLocal) SoundFX.playTeleport();
  return true;
}

export function startRecall(world: GameWorldState, hero: HeroEntity): boolean {
  if (hero.dead || hero.recallTimer > 0) return false;
  if (hero.carryingWater) {
    addFloatingText(world, hero.x, hero.y - 32, '运水任务中禁止回城/传送!', '#f87171', 13);
    return false;
  }
  if (hero.zoneId === 'sanctuary' && Math.hypot(hero.x - FOUNTAIN_POS.x, hero.y - FOUNTAIN_POS.y) < 120) {
    return false;
  }
  hero.recallTimer = 1.6;
  if (hero.isLocal) SoundFX.playTeleport();
  return true;
}

export function castActiveItemSkill(
  world: GameWorldState,
  hero: HeroEntity,
  onEnemyKilled: (enemy: EnemyEntity, killer?: HeroEntity) => void
): boolean {
  if (hero.dead || hero.activeItemCd > 0) return false;
  const activeItem = hero.inventory
    .map((id) => (id ? getItemDef(id) : undefined))
    .find((it) => it?.activeSkill);
  if (!activeItem || !activeItem.activeSkill) return false;

  const act = activeItem.activeSkill;
  hero.activeItemCd = act.cooldown * (1 - hero.stats.cdr * 0.5);

  if (act.id === 'act_windboots') {
    hero.windbootsTimer = 4.0;
    recalcHeroStats(hero);
    addFloatingText(world, hero.x, hero.y - 32, '神行疾步!', '#38bdf8', 14);
    if (hero.isLocal) SoundFX.playTeleport();
  } else if (act.id === 'act_aegis') {
    hero.shield += hero.stats.maxHp * 0.35;
    hero.hp = Math.min(hero.stats.maxHp, hero.hp + hero.stats.maxHp * 0.25);
    world.sanctuary.shield += 1200;
    world.vfx.push({ kind: 'ring', x: hero.x, y: hero.y, radius: 180, color: '#facc15', life: 0.55, maxLife: 0.55 });
    if (hero.isLocal) SoundFX.playHolyChime();
  } else if (act.id === 'act_thunderfury') {
    const pts: { x: number; y: number }[] = [{ x: hero.x, y: hero.y }];
    for (const e of world.enemies) {
      if (e.zoneId === hero.zoneId && e.hp > 0 && Math.hypot(e.x - hero.x, e.y - hero.y) <= 320 && pts.length < 7) {
        pts.push({ x: e.x, y: e.y });
        applyDamageToEnemy(world, e, hero.stats.ad * 1.6 + hero.stats.ap * 0.9, {
          attacker: hero,
          isMagic: true,
          onEnemyKilled,
        });
      }
    }
    world.vfx.push({ kind: 'chain', x: hero.x, y: hero.y, radius: 12, color: '#38bdf8', life: 0.4, maxLife: 0.4, points: pts });
    if (hero.isLocal) SoundFX.playMagicCast();
  } else if (act.id === 'act_wintersoul' || act.id === 'act_frostmourne') {
    const rad = 250;
    for (const e of world.enemies) {
      if (e.zoneId === hero.zoneId && e.hp > 0 && Math.hypot(e.x - hero.x, e.y - hero.y) <= rad) {
        e.stunTimer = Math.max(e.stunTimer, e.isBoss ? 0.7 : 2.0);
        applyDamageToEnemy(world, e, hero.stats.ad * 1.4 + hero.stats.ap * 1.5, {
          attacker: hero,
          isMagic: true,
          onEnemyKilled,
        });
      }
    }
    world.vfx.push({ kind: 'explosion', x: hero.x, y: hero.y, radius: rad, color: '#67e8f9', life: 0.5, maxLife: 0.5 });
    if (hero.isLocal) SoundFX.playFrostShatter();
  } else if (act.id === 'act_apocalypse') {
    const target = world.enemies.find((e) => e.zoneId === hero.zoneId && e.hp > 0 && Math.hypot(e.x - hero.x, e.y - hero.y) <= 460);
    const tx = target ? target.x : hero.x + Math.cos(hero.facing) * 200;
    const ty = target ? target.y : hero.y + Math.sin(hero.facing) * 200;
    for (const e of world.enemies) {
      if (e.zoneId === hero.zoneId && e.hp > 0 && Math.hypot(e.x - tx, e.y - ty) <= 230) {
        e.stunTimer = Math.max(e.stunTimer, 1.2);
        applyDamageToEnemy(world, e, hero.stats.ap * 2.6 + 600, {
          attacker: hero,
          isMagic: true,
          canCrit: true,
          onEnemyKilled,
        });
      }
    }
    world.vfx.push({ kind: 'explosion', x: tx, y: ty, radius: 230, color: '#f43f5e', life: 0.55, maxLife: 0.55 });
    if (hero.isLocal) SoundFX.playCritHit();
  }
  return true;
}

export function distPointToSegment(px: number, py: number, x1: number, y1: number, x2: number, y2: number): number {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const len2 = dx * dx + dy * dy;
  if (len2 <= 0.001) return Math.hypot(px - x1, py - y1);
  const t = Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / len2));
  return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy));
}
