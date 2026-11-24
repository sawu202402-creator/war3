import { SoundFX } from '../audio/SoundFX';
import { getHeroRecommendedRecipeTargets, getItemDef, getUpgradesTo, ITEMS } from '../data/items';
import { SaveManager } from '../meta/SaveManager';
import { TowerType } from '../types';
import { addFloatingText, grantHeroXp, recalcHeroStats } from './CombatSystem';
import { GameWorldState, HeroEntity } from './GameState';

export interface QuickBuySuggestion {
  kind: 'synth' | 'upgrade' | 'buy';
  itemId: string;
  slotIdx?: number; // for upgrade
  label: string;
  subLabel: string;
  goldCost: number;
  crystalCost: number;
  stoneCost: number;
}

export function getDiscountedGold(world: GameWorldState, baseGold: number): number {
  return Math.max(1, Math.round(baseGold * (1 - world.quests.shopDiscount)));
}

export function countOwnedItem(hero: HeroEntity, itemId: string): number {
  let n = 0;
  for (const s of hero.inventory) if (s === itemId) n++;
  for (const s of hero.stash) if (s === itemId) n++;
  return n;
}

export interface SynthPlan {
  canDo: boolean;
  goldCost: number;
  crystalCost: number;
  stoneCost: number;
  consumeInvSlots: number[];
  consumeStashSlots: number[];
  missingAutoBuyNames: string[];
  missingHardReason?: string;
}

export function planSynthesis(world: GameWorldState, hero: HeroEntity, targetItemId: string): SynthPlan {
  const item = getItemDef(targetItemId);
  if (!item || !item.recipe) {
    return { canDo: false, goldCost: 0, crystalCost: 0, stoneCost: 0, consumeInvSlots: [], consumeStashSlots: [], missingAutoBuyNames: [], missingHardReason: '无合成配方' };
  }

  const invCopy = [...hero.inventory];
  const stashCopy = [...hero.stash];
  const consumeInvSlots: number[] = [];
  const consumeStashSlots: number[] = [];
  const missingAutoBuyNames: string[] = [];

  let extraGold = 0;
  let extraCrystal = 0;
  let extraStones = 0;

  // Recursive resolver so players can 1-click buy missing T1->T4 or component items if affordable!
  const resolveIngredient = (reqId: string, depth: number): string | null => {
    if (depth > 8) return '配方层级过深';
    const invIdx = invCopy.indexOf(reqId);
    if (invIdx >= 0) {
      invCopy[invIdx] = null;
      consumeInvSlots.push(invIdx);
      return null;
    }
    const stIdx = stashCopy.indexOf(reqId);
    if (stIdx >= 0) {
      stashCopy[stIdx] = null;
      consumeStashSlots.push(stIdx);
      return null;
    }

    const reqDef = getItemDef(reqId);
    if (!reqDef) return `未知物品 ${reqId}`;

    if (reqDef.category === 'material') {
      if (reqId === 'mat_stone') {
        extraStones += 1;
        return null;
      }
      return `缺少Boss材料【${reqDef.name}】`;
    }

    if (reqDef.upgradesFrom) {
      const err = resolveIngredient(reqDef.upgradesFrom, depth + 1);
      if (err) return err;
      extraGold += getDiscountedGold(world, reqDef.upgradeCostGold || 0);
      extraCrystal += reqDef.upgradeCostCrystal || 0;
      extraStones += reqDef.upgradeStones || 0;
      missingAutoBuyNames.push(reqDef.name);
      return null;
    }

    if (reqDef.shopVisible && reqDef.costGold !== undefined) {
      extraGold += getDiscountedGold(world, reqDef.costGold);
      extraCrystal += reqDef.costCrystal || 0;
      missingAutoBuyNames.push(reqDef.name);
      return null;
    }

    if (reqDef.recipe) {
      for (const sub of reqDef.recipe.items) {
        const err = resolveIngredient(sub, depth + 1);
        if (err) return err;
      }
      extraGold += getDiscountedGold(world, reqDef.recipe.gold || 0);
      extraCrystal += reqDef.recipe.crystal || 0;
      extraStones += reqDef.recipe.stones || 0;
      return null;
    }

    return `缺少【${reqDef.name}】`;
  };

  for (const reqId of item.recipe.items) {
    const err = resolveIngredient(reqId, 0);
    if (err) {
      return {
        canDo: false,
        goldCost: 0,
        crystalCost: 0,
        stoneCost: 0,
        consumeInvSlots: [],
        consumeStashSlots: [],
        missingAutoBuyNames: [],
        missingHardReason: err,
      };
    }
  }

  const totalGold = getDiscountedGold(world, item.recipe.gold || 0) + extraGold;
  const totalCrystal = (item.recipe.crystal || 0) + extraCrystal;
  const totalStones = (item.recipe.stones || 0) + extraStones;

  // After consuming items, is there a slot in inv or stash?
  const hasFreeInv = invCopy.some((x) => x === null);
  const hasFreeStash = stashCopy.some((x) => x === null);
  if (!hasFreeInv && !hasFreeStash) {
    return {
      canDo: false,
      goldCost: totalGold,
      crystalCost: totalCrystal,
      stoneCost: totalStones,
      consumeInvSlots,
      consumeStashSlots,
      missingAutoBuyNames,
      missingHardReason: '背包与储物箱已满',
    };
  }

  const affordable =
    hero.gold >= totalGold && hero.crystal >= totalCrystal && hero.stones >= totalStones;

  return {
    canDo: affordable,
    goldCost: totalGold,
    crystalCost: totalCrystal,
    stoneCost: totalStones,
    consumeInvSlots,
    consumeStashSlots,
    missingAutoBuyNames,
    missingHardReason: affordable ? undefined : '金币/灵晶/强化石不足',
  };
}

export function synthesizeItem(world: GameWorldState, hero: HeroEntity, targetItemId: string): boolean {
  const plan = planSynthesis(world, hero, targetItemId);
  if (!plan.canDo) {
    if (hero.isLocal && plan.missingHardReason) {
      addFloatingText(world, hero.x, hero.y - 30, plan.missingHardReason, '#f87171', 13);
    }
    return false;
  }

  hero.gold -= plan.goldCost;
  hero.crystal -= plan.crystalCost;
  hero.stones -= plan.stoneCost;
  for (const idx of plan.consumeInvSlots) hero.inventory[idx] = null;
  for (const idx of plan.consumeStashSlots) hero.stash[idx] = null;

  const freeInv = hero.inventory.indexOf(null);
  if (freeInv >= 0) hero.inventory[freeInv] = targetItemId;
  else {
    const freeSt = hero.stash.indexOf(null);
    if (freeSt >= 0) hero.stash[freeSt] = targetItemId;
  }

  const item = getItemDef(targetItemId)!;
  recalcHeroStats(hero);
  if (hero.isLocal) {
    SoundFX.playSynthesize();
    SaveManager.addDailyProgress('syntheses', 1);
    SaveManager.recordRunResult({
      hero: hero.classId,
      difficulty: world.difficulty,
      maxWave: world.wave,
      victory: false,
      kills: 0,
      honorEarned: 0,
      discoveredItems: [targetItemId],
      defeatedBosses: [],
    });
  }
  addFloatingText(world, hero.x, hero.y - 38, `合成神装【${item.name}】!`, '#fb923c', 16);
  if (hero.pinnedRecipeId === targetItemId) hero.pinnedRecipeId = null;
  return true;
}

export function buyItem(world: GameWorldState, hero: HeroEntity, itemId: string): boolean {
  const item = getItemDef(itemId);
  if (!item) return false;
  const goldCost = getDiscountedGold(world, item.costGold || 0);
  const crystalCost = item.costCrystal || 0;
  if (hero.gold < goldCost || hero.crystal < crystalCost) {
    if (hero.isLocal) addFloatingText(world, hero.x, hero.y - 26, '金币或灵晶不足!', '#f87171', 12);
    return false;
  }

  // Materials / Consumables / Books
  if (item.id === 'mat_stone') {
    hero.gold -= goldCost;
    hero.crystal -= crystalCost;
    hero.stones += 1;
    if (hero.isLocal) SoundFX.playGold();
    addFloatingText(world, hero.x, hero.y - 26, '+1 强化石', '#38bdf8', 13);
    return true;
  }

  if (item.category === 'consumable') {
    if (item.buffKind === 'rebirth') {
      if (hero.ankhs >= 2) {
        if (hero.isLocal) addFloatingText(world, hero.x, hero.y - 26, '最多同时携带 2 枚重生十字章', '#fbbf24', 12);
        return false;
      }
      hero.gold -= goldCost;
      hero.crystal -= crystalCost;
      hero.ankhs += 1;
      if (hero.isLocal) SoundFX.playGold();
      addFloatingText(world, hero.x, hero.y - 28, '获得 重生十字章', '#facc15', 14);
      return true;
    }
    if (item.buffKind === 'repair_base') {
      hero.gold -= goldCost;
      hero.crystal -= crystalCost;
      const heal = world.sanctuary.maxHp * 0.25;
      world.sanctuary.hp = Math.min(world.sanctuary.maxHp, world.sanctuary.hp + heal);
      if (hero.isLocal) SoundFX.playHolyChime();
      addFloatingText(world, hero.x, hero.y - 28, `圣殿恢复 +${Math.round(heal)}`, '#4ade80', 14);
      return true;
    }
    if (item.potionSlot) {
      hero.gold -= goldCost;
      hero.crystal -= crystalCost;
      hero.potions[item.potionSlot] = item.id;
      hero.potionCharges[item.potionSlot] = Math.min(9, hero.potionCharges[item.potionSlot] + 3);
      if (hero.isLocal) SoundFX.playGold();
      addFloatingText(world, hero.x, hero.y - 26, `${item.name} +3`, '#4ade80', 13);
      return true;
    }
  }

  if (item.category === 'book' && item.bookStats) {
    hero.gold -= goldCost;
    hero.crystal -= crystalCost;
    const b = item.bookStats;
    if (b.str) {
      hero.bookBonuses.maxHp += 180;
      hero.bookBonuses.ad += 16;
      hero.bookBonuses.armor += 1.2;
    }
    if (b.agi) {
      hero.bookBonuses.ad += 18;
      hero.bookBonuses.atkSpeed += 0.06;
      hero.bookBonuses.critChance += 0.012;
    }
    if (b.int) {
      hero.bookBonuses.ap += 26;
      hero.bookBonuses.maxMp += 90;
      hero.bookBonuses.mpRegen += 1.5;
    }
    if (b.all) {
      hero.bookBonuses.maxHp += 650;
      hero.bookBonuses.ad += 65;
      hero.bookBonuses.ap += 65;
      hero.bookBonuses.armor += 5;
      hero.bookBonuses.critChance += 0.02;
    }
    if (b.xp) {
      grantHeroXp(world, hero, b.xp);
    }
    recalcHeroStats(hero);
    if (hero.isLocal) SoundFX.playLevelUp();
    addFloatingText(world, hero.x, hero.y - 30, `阅读 ${item.name}`, '#c084fc', 14);
    return true;
  }

  // Equipment into inventory or stash
  const freeInv = hero.inventory.indexOf(null);
  const freeStash = hero.stash.indexOf(null);
  if (freeInv < 0 && freeStash < 0) {
    if (hero.isLocal) addFloatingText(world, hero.x, hero.y - 26, '背包已满!', '#f87171', 12);
    return false;
  }
  hero.gold -= goldCost;
  hero.crystal -= crystalCost;
  if (freeInv >= 0) hero.inventory[freeInv] = item.id;
  else hero.stash[freeStash] = item.id;

  recalcHeroStats(hero);
  if (hero.isLocal) SoundFX.playGold();
  addFloatingText(world, hero.x, hero.y - 28, `购入 ${item.name}`, '#fde047', 13);
  return true;
}

export function upgradeItemInSlot(world: GameWorldState, hero: HeroEntity, inInventory: boolean, slotIdx: number): boolean {
  const arr = inInventory ? hero.inventory : hero.stash;
  const curId = arr[slotIdx];
  if (!curId) return false;
  const next = getUpgradesTo(curId);
  if (!next) return false;
  const goldCost = getDiscountedGold(world, next.upgradeCostGold || 0);
  const crysCost = next.upgradeCostCrystal || 0;
  const stoneCost = next.upgradeStones || 0;
  if (hero.gold < goldCost || hero.crystal < crysCost || hero.stones < stoneCost) {
    if (hero.isLocal) addFloatingText(world, hero.x, hero.y - 28, '升阶所需货币/强化石不足', '#f87171', 12);
    return false;
  }

  hero.gold -= goldCost;
  hero.crystal -= crysCost;
  hero.stones -= stoneCost;
  arr[slotIdx] = next.id;
  recalcHeroStats(hero);
  if (hero.isLocal) SoundFX.playSynthesize();
  addFloatingText(world, hero.x, hero.y - 34, `锻造升阶 → ${next.name}!`, '#38bdf8', 15);
  return true;
}

export function sellItemInSlot(world: GameWorldState, hero: HeroEntity, inInventory: boolean, slotIdx: number): boolean {
  const arr = inInventory ? hero.inventory : hero.stash;
  const curId = arr[slotIdx];
  if (!curId) return false;
  const def = getItemDef(curId);
  if (!def || def.heroExclusive) {
    if (hero.isLocal) addFloatingText(world, hero.x, hero.y - 26, '职业专属神器不可出售', '#fbbf24', 12);
    return false;
  }
  const refund = Math.max(80, Math.round((def.costGold || def.upgradeCostGold || 300) * 0.6));
  hero.gold += refund;
  arr[slotIdx] = null;
  recalcHeroStats(hero);
  if (hero.isLocal) SoundFX.playGold();
  addFloatingText(world, hero.x, hero.y - 26, `出售 +${refund}G`, '#facc15', 13);
  return true;
}

export function swapInvAndStash(hero: HeroEntity, fromInv: boolean, idxA: number, toInv: boolean, idxB: number): void {
  const arrA = fromInv ? hero.inventory : hero.stash;
  const arrB = toInv ? hero.inventory : hero.stash;
  const tmp = arrA[idxA];
  arrA[idxA] = arrB[idxB];
  arrB[idxB] = tmp;
  recalcHeroStats(hero);
}

export function usePotionSlot(world: GameWorldState, hero: HeroEntity, slot: 'hp' | 'mp' | 'tactical'): boolean {
  if (hero.dead || hero.potionCharges[slot] <= 0 || hero.potionCds[slot] > 0) return false;
  const def = getItemDef(hero.potions[slot]);
  if (!def) return false;

  hero.potionCharges[slot] -= 1;
  hero.potionCds[slot] = slot === 'tactical' ? 14 : 7;

  if (def.healHp || def.healHpPct) {
    const heal = (def.healHp || 0) + hero.stats.maxHp * (def.healHpPct || 0);
    hero.hp = Math.min(hero.stats.maxHp, hero.hp + heal);
    addFloatingText(world, hero.x, hero.y - 30, `+${Math.round(heal)} HP`, '#4ade80', 14);
  }
  if (def.healMp || def.healMpPct) {
    const mpGain = (def.healMp || 0) + hero.stats.maxMp * (def.healMpPct || 0);
    hero.mp = Math.min(hero.stats.maxMp, hero.mp + mpGain);
    addFloatingText(world, hero.x, hero.y - 20, `+${Math.round(mpGain)} MP`, '#38bdf8', 13);
  }
  if (def.buffKind === 'invuln') {
    hero.invulnTimer = Math.max(hero.invulnTimer, def.buffDuration || 3.5);
    addFloatingText(world, hero.x, hero.y - 36, '无敌神盾 3.5s!', '#facc15', 15);
  }
  if (hero.isLocal) SoundFX.playPotion();
  return true;
}

// 王者荣耀式左侧快捷出装推荐（最多返回 2 个可立刻购买/升阶/合成的动作）
export function getQuickBuyOptions(world: GameWorldState, hero: HeroEntity): QuickBuySuggestion[] {
  const out: QuickBuySuggestion[] = [];
  const targets = hero.pinnedRecipeId
    ? [hero.pinnedRecipeId, ...getHeroRecommendedRecipeTargets(hero.classId)]
    : getHeroRecommendedRecipeTargets(hero.classId);

  // 1. Check any pinned or recommended synthesis recipe ready right now
  for (const tid of targets) {
    if (out.some((o) => o.itemId === tid)) continue;
    const item = getItemDef(tid);
    if (!item || countOwnedItem(hero, tid) > 0) continue;
    const plan = planSynthesis(world, hero, tid);
    if (plan.canDo) {
      out.push({
        kind: 'synth',
        itemId: tid,
        label: `合成 ${item.name}`,
        subLabel: `${plan.goldCost}G${plan.crystalCost > 0 ? ` · ${plan.crystalCost}木` : ''}`,
        goldCost: plan.goldCost,
        crystalCost: plan.crystalCost,
        stoneCost: plan.stoneCost,
      });
      if (out.length >= 2) return out;
    }
  }

  // 2. Check in-place upgrades in inventory
  for (let i = 0; i < hero.inventory.length; i++) {
    const id = hero.inventory[i];
    if (!id) continue;
    const next = getUpgradesTo(id);
    if (!next) continue;
    const gCost = getDiscountedGold(world, next.upgradeCostGold || 0);
    const cCost = next.upgradeCostCrystal || 0;
    const sCost = next.upgradeStones || 0;
    if (hero.gold >= gCost && hero.crystal >= cCost && hero.stones >= sCost) {
      out.push({
        kind: 'upgrade',
        itemId: next.id,
        slotIdx: i,
        label: `升阶 ${next.name}`,
        subLabel: `${gCost}G${cCost > 0 ? ` · ${cCost}木` : ''}${sCost > 0 ? ` · ${sCost}石` : ''}`,
        goldCost: gCost,
        crystalCost: cCost,
        stoneCost: sCost,
      });
      if (out.length >= 2) return out;
    }
  }

  // 3. Suggest starter gear if free inventory slot exists
  if (hero.inventory.some((x) => x === null)) {
    const starterOrder =
      hero.classId === 'archmage' || hero.classId === 'priest'
        ? ['acc_t1', 'boot_t1', 'arm_t1', 'comp_frost', 'comp_mana']
        : hero.classId === 'paladin'
          ? ['arm_t1', 'boot_t1', 'wep_t1', 'comp_pendant', 'comp_thorn']
          : ['wep_t1', 'boot_t1', 'comp_vamp', 'arm_t1', 'comp_claw'];
    for (const sid of starterOrder) {
      if (countOwnedItem(hero, sid) > 0) continue;
      // Also don't recommend T1 if already holding T2/T3/T4 of same line
      if (sid === 'wep_t1' && ['wep_t2', 'wep_t3', 'wep_t4'].some((x) => countOwnedItem(hero, x) > 0)) continue;
      if (sid === 'arm_t1' && ['arm_t2', 'arm_t3', 'arm_t4'].some((x) => countOwnedItem(hero, x) > 0)) continue;
      if (sid === 'acc_t1' && ['acc_t2', 'acc_t3', 'acc_t4'].some((x) => countOwnedItem(hero, x) > 0)) continue;
      if (sid === 'boot_t1' && ['boot_t2', 'boot_t3'].some((x) => countOwnedItem(hero, x) > 0)) continue;
      const item = getItemDef(sid);
      if (!item) continue;
      const gCost = getDiscountedGold(world, item.costGold || 0);
      if (hero.gold >= gCost) {
        out.push({
          kind: 'buy',
          itemId: sid,
          label: `购买 ${item.name}`,
          subLabel: `${gCost} 金币`,
          goldCost: gCost,
          crystalCost: 0,
          stoneCost: 0,
        });
        if (out.length >= 2) return out;
      }
    }
  }

  return out;
}

// ==================== 基地操作 & 城防塔 & 队友赠送 ====================
export function upgradeSanctuary(world: GameWorldState, hero: HeroEntity): boolean {
  const lv = world.sanctuary.level;
  const goldCost = 260 + lv * 140;
  const crysCost = lv >= 4 ? 1 : 0;
  if (hero.gold < goldCost || hero.crystal < crysCost) {
    if (hero.isLocal) addFloatingText(world, hero.x, hero.y - 26, `升级圣殿需 ${goldCost}G${crysCost ? ` + ${crysCost}木` : ''}`, '#f87171', 12);
    return false;
  }
  hero.gold -= goldCost;
  hero.crystal -= crysCost;
  world.sanctuary.level += 1;
  world.sanctuary.maxHp += 1400;
  world.sanctuary.hp = Math.min(world.sanctuary.maxHp, world.sanctuary.hp + 1600);
  world.sanctuary.armor += 4;
  world.sanctuary.hpRegen += 8;
  if (hero.isLocal) SoundFX.playHolyChime();
  world.bannerText = `🏰 ${hero.callsign} 升级了圣殿（Lv.${world.sanctuary.level}）：血量/护甲/回血提升！`;
  world.bannerColor = '#fde047';
  world.bannerTimer = 3.0;
  return true;
}

export function triggerSanctuaryInvuln(world: GameWorldState, hero: HeroEntity): boolean {
  if (world.sanctuary.invulnCd > 0) return false;
  world.sanctuary.invulnTimer = 15.0;
  world.sanctuary.invulnCd = 110.0;
  if (hero.isLocal) SoundFX.playHolyChime();
  world.bannerText = `🛡️ ${hero.callsign} 激活了【圣殿神圣无敌】15 秒！`;
  world.bannerColor = '#facc15';
  world.bannerTimer = 3.5;
  return true;
}

export function pauseNextWave(world: GameWorldState, hero: HeroEntity): boolean {
  if (world.wavePauseCountUsed >= world.maxWavePauses) return false;
  const crysCost = 1 + world.wavePauseCountUsed;
  if (hero.crystal < crysCost) {
    if (hero.isLocal) addFloatingText(world, hero.x, hero.y - 26, `停怪需要 ${crysCost} 灵晶`, '#f87171', 12);
    return false;
  }
  hero.crystal -= crysCost;
  world.wavePauseCountUsed += 1;
  world.wavePrepTimer += 60;
  if (hero.isLocal) SoundFX.playTeleport();
  world.bannerText = `⏳ ${hero.callsign} 发动停怪：下波推迟 60 秒（剩余 ${world.maxWavePauses - world.wavePauseCountUsed} 次）`;
  world.bannerColor = '#38bdf8';
  world.bannerTimer = 3.5;
  return true;
}

export function buildOrUpgradeTower(
  world: GameWorldState,
  hero: HeroEntity,
  slotId: string,
  towerType: TowerType
): boolean {
  const tower = world.towers.find((t) => t.slotId === slotId);
  if (!tower) return false;
  if (tower.type && tower.type !== towerType && tower.level > 0) return false;
  if (tower.level >= 5) return false;

  const goldCost = tower.level === 0 ? 320 : 380 + tower.level * 220;
  const crysCost = tower.level >= 2 ? 1 : 0;
  if (hero.gold < goldCost || hero.crystal < crysCost) {
    if (hero.isLocal) addFloatingText(world, hero.x, hero.y - 26, `建塔/升塔需 ${goldCost}G${crysCost ? ` + ${crysCost}木` : ''}`, '#f87171', 12);
    return false;
  }
  hero.gold -= goldCost;
  hero.crystal -= crysCost;
  tower.type = towerType;
  tower.level += 1;
  if (hero.isLocal) SoundFX.playSynthesize();
  addFloatingText(world, tower.x, tower.y - 30, `${tower.label} Lv.${tower.level}`, '#4ade80', 14);
  return true;
}

export function giftResourceToAlly(
  world: GameWorldState,
  from: HeroEntity,
  toHeroId: string,
  kind: 'gold' | 'crystal',
  amount: number
): boolean {
  const target = world.heroes.find((h) => h.id === toHeroId);
  if (!target || target.id === from.id) return false;
  if (kind === 'gold') {
    const amt = Math.min(from.gold, amount);
    if (amt <= 0) return false;
    from.gold -= amt;
    target.gold += amt;
    addFloatingText(world, target.x, target.y - 30, `收到 ${from.callsign} +${amt}G`, '#facc15', 13);
  } else {
    const amt = Math.min(from.crystal, amount);
    if (amt <= 0) return false;
    from.crystal -= amt;
    target.crystal += amt;
    addFloatingText(world, target.x, target.y - 30, `收到 ${from.callsign} +${amt}木`, '#4ade80', 13);
  }
  if (from.isLocal) SoundFX.playGold();
  return true;
}

export function giftItemToAlly(
  world: GameWorldState,
  from: HeroEntity,
  toHeroId: string,
  inInventory: boolean,
  slotIdx: number
): boolean {
  const target = world.heroes.find((h) => h.id === toHeroId);
  if (!target || target.id === from.id) return false;
  const arr = inInventory ? from.inventory : from.stash;
  const itemId = arr[slotIdx];
  if (!itemId) return false;
  const def = getItemDef(itemId);
  if (!def || def.heroExclusive) return false;

  const freeIdx = target.inventory.indexOf(null);
  const freeSt = target.stash.indexOf(null);
  if (freeIdx < 0 && freeSt < 0) return false;

  arr[slotIdx] = null;
  if (freeIdx >= 0) target.inventory[freeIdx] = itemId;
  else target.stash[freeSt] = itemId;

  recalcHeroStats(from);
  recalcHeroStats(target);
  if (from.isLocal) SoundFX.playGold();
  addFloatingText(world, target.x, target.y - 34, `${from.callsign} 赠予【${def.name}】`, '#fb923c', 13);
  return true;
}
