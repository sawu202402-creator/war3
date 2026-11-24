import { SoundFX } from '../audio/SoundFX';
import { DIFFICULTIES, getHeroClassDef } from '../data/heroes';
import { ATHENA_POS, FOUNTAIN_POS, HERO_SPAWN_POS, PORTALS, TOWER_SLOTS, WORLD_HEIGHT, WORLD_WIDTH, ZONES } from '../data/worldMap';
import { SaveManager } from '../meta/SaveManager';
import { CoopManager } from '../net/CoopManager';
import { CoopNetMessage } from '../net/CoopProtocol';
import { DifficultyLevel, HeroClassId, TowerType, ZoneId } from '../types';
import {
  startWaveEarly,
  updateBotHeroes,
  updateEnemies,
  updateTelegraphsAndProjectiles,
  updateTowersAndSummons,
  updateWaveDirector,
} from './AiSystem';
import { handleEnemyDeathDrops, spawnEnemy, teleportHeroToZone, updateBranches } from './BranchSystem';
import {
  addFloatingText,
  applyDamageToEnemy,
  castActiveItemSkill,
  castFlashSkill,
  castHeroSkill,
  performBasicAttack,
  recalcHeroStats,
  startRecall,
  xpForLevel,
} from './CombatSystem';
import {
  buildOrUpgradeTower,
  buyItem,
  giftItemToAlly,
  giftResourceToAlly,
  pauseNextWave,
  sellItemInSlot,
  swapInvAndStash,
  synthesizeItem,
  triggerSanctuaryInvuln,
  upgradeItemInSlot,
  upgradeSanctuary,
  usePotionSlot,
} from './EconomySystem';
import { GameWorldState, HeroEntity } from './GameState';
import { InputManager } from './InputManager';
import { War3Renderer } from './War3Renderer';

export interface EngineCallbacks {
  onToggleShop: () => void;
  onToggleTeleport: () => void;
  onToggleBase: () => void;
  onTogglePause: () => void;
  onPromptAwakening: (hero: HeroEntity) => void;
  onShowSettlement: (victory: boolean) => void;
}

export class GameEngine {
  public world: GameWorldState | null = null;
  public paused = false;
  public landscapePaused = false;
  public camX = 1400;
  public camY = 1700;

  private renderer = new War3Renderer();
  private netSyncTimer = 0;

  constructor(
    private canvas: HTMLCanvasElement,
    private ctx: CanvasRenderingContext2D,
    public input: InputManager,
    private cbs: EngineCallbacks
  ) {
    this.input.bindActions({
      onCastSkill: (slot, dirX, dirY, distRatio) => this.handleCastSkillInput(slot, dirX, dirY, distRatio),
      onUsePotion: (slot) => this.handleUsePotionInput(slot),
      onFlash: (dirX, dirY) => this.handleFlashInput(dirX, dirY),
      onRecall: () => this.handleRecallInput(),
      onTeleport: () => this.cbs.onToggleTeleport(),
      onToggleShop: () => this.cbs.onToggleShop(),
      onToggleBase: () => this.cbs.onToggleBase(),
      onPing: () => this.handleSendPing(),
      onPause: () => this.cbs.onTogglePause(),
      onActiveItem: () => this.handleActiveItemInput(),
      onRightClickWorld: (sx, sy) => {
        this.input.moveTargetWorld = { x: this.camX + sx, y: this.camY + sy };
      },
    });
  }

  public startNewMatch(opts: {
    difficulty: DifficultyLevel;
    localHero: HeroClassId;
    aiSquadCount: number;
    coopRoster?: { peerId: string; slot: number; callsign: string; heroClass: HeroClassId }[];
  }): void {
    const save = SaveManager.get();
    this.input.rightClickMoveEnabled = save.rightClickMove;
    this.paused = false;
    const isCoop = Boolean(opts.coopRoster && opts.coopRoster.length > 0);
    const playersCount = isCoop ? opts.coopRoster!.length : 1 + opts.aiSquadCount;

    const baseSanctuaryHp = Math.round(5200 * (1 + save.talents.reviveFast * 0.08) * (1 + (playersCount - 1) * 0.2));
    const heroes: HeroEntity[] = [];

    if (isCoop && opts.coopRoster) {
      for (const m of opts.coopRoster) {
        heroes.push(this.createHeroEntity({
          id: m.peerId,
          slot: m.slot,
          callsign: m.callsign,
          classId: m.heroClass,
          isLocal: m.peerId === CoopManager.myPeerId,
          isBot: false,
          difficulty: opts.difficulty,
        }));
      }
    } else {
      heroes.push(this.createHeroEntity({
        id: 'local',
        slot: 0,
        callsign: save.callsign,
        classId: opts.localHero,
        isLocal: true,
        isBot: false,
        difficulty: opts.difficulty,
      }));
      const aiClasses: HeroClassId[] = (['paladin', 'archmage', 'ranger', 'priest', 'blademaster'] as HeroClassId[]).filter(
        (c) => c !== opts.localHero
      );
      for (let i = 0; i < opts.aiSquadCount; i++) {
        const cls = aiClasses[i % aiClasses.length];
        heroes.push(this.createHeroEntity({
          id: `bot_${i + 1}`,
          slot: i + 1,
          callsign: `${getHeroClassDef(cls).name}(AI)`,
          classId: cls,
          isLocal: false,
          isBot: true,
          difficulty: opts.difficulty,
        }));
      }
    }

    this.world = {
      difficulty: opts.difficulty,
      playerCount: playersCount,
      wave: 0,
      maxWave: 20,
      endlessMode: false,
      waveState: 'prep',
      wavePrepTimer: 16,
      wavePauseCountUsed: 0,
      maxWavePauses: 3,
      waveSpawnQueue: [],
      waveSpawnCooldown: 0,
      victory: false,
      ended: false,
      elapsedSec: 0,
      sanctuary: {
        hp: baseSanctuaryHp,
        maxHp: baseSanctuaryHp,
        armor: 10,
        hpRegen: 6,
        shield: 0,
        level: 1,
        invulnTimer: 0,
        invulnCd: 0,
        underAttackFlash: 0,
      },
      trainingTiers: { gold_room: 1, xp_room: 1, crystal_room: 1 },
      trainingSpawnTimer: { gold_room: 0.4, xp_room: 0.4, crystal_room: 0.4, stone_mine: 0.8 },
      dungeonRespawns: {},
      hiddenAbyssUnlocked: false,
      quests: {
        banditCleared: false,
        shopDiscount: 0,
        randomEventCooldown: 55,
        lastEventBanner: '',
      },
      heroes,
      enemies: [],
      summons: [],
      towers: TOWER_SLOTS.map((ts) => ({
        slotId: ts.id,
        label: ts.label,
        x: ts.x,
        y: ts.y,
        type: null,
        level: 0,
        attackTimer: 0,
        facing: 0,
      })),
      projectiles: [],
      telegraphs: [],
      drops: [],
      floatingTexts: [],
      vfx: [],
      pings: [],
      bannerText: `🛡️ 第 1 波将于 16 秒后袭来！可先到铁匠铺买新手装或去圣泉接水！`,
      bannerColor: '#fde047',
      bannerTimer: 5.0,
      nextEntityId: 1,
    };

    const local = this.getLocalHero();
    if (local) {
      this.camX = local.x - (this.canvas.clientWidth || 1280) / 2;
      this.camY = local.y - (this.canvas.clientHeight || 720) / 2;
    }

    SoundFX.unlockAudio();
    SoundFX.setBgmMode('combat');

    if (CoopManager.isActiveCoop()) {
      CoopManager.bindEngine(
        (msg, fromId) => this.handleNetMessage(msg, fromId),
        (leftId) => {
          const left = this.world?.heroes.find((h) => h.id === leftId);
          if (left) {
            left.isBot = true;
            left.callsign = `${left.callsign}(托管)`;
          }
        }
      );
    }
  }

  private createHeroEntity(opts: {
    id: string;
    slot: number;
    callsign: string;
    classId: HeroClassId;
    isLocal: boolean;
    isBot: boolean;
    difficulty: DifficultyLevel;
  }): HeroEntity {
    const def = getHeroClassDef(opts.classId);
    const save = SaveManager.get();
    const startGold = 320 + save.talents.startGold * 120 + (opts.difficulty >= 3 ? 120 : 0);
    const h: HeroEntity = {
      id: opts.id,
      slot: opts.slot,
      callsign: opts.callsign,
      classId: opts.classId,
      isLocal: opts.isLocal,
      isBot: opts.isBot,
      aiMode: 'guard_base',
      color: def.color,
      x: HERO_SPAWN_POS.x + (opts.slot - 1) * 56,
      y: HERO_SPAWN_POS.y + (opts.slot % 2) * 32,
      vx: 0,
      vy: 0,
      facing: -Math.PI / 2,
      zoneId: 'sanctuary',
      level: 1,
      xp: 0,
      nextXp: xpForLevel(1),
      kills: 0,
      bossKills: 0,
      damageDealt: 0,
      gold: startGold,
      crystal: opts.difficulty >= 3 ? 1 : 0,
      stones: 0,
      ankhs: 0,
      potions: { hp: 'pot_hp_s', mp: 'pot_mp', tactical: 'pot_invuln' },
      potionCharges: { hp: 3, mp: 2, tactical: 0 },
      potionCds: { hp: 0, mp: 0, tactical: 0 },
      hp: def.baseStats.maxHp,
      mp: def.baseStats.maxMp,
      shield: 0,
      stats: { ...def.baseStats },
      bookBonuses: { maxHp: 0, maxMp: 0, mpRegen: 0, ad: 0, ap: 0, armor: 0, atkSpeed: 0, critChance: 0 },
      awakeningBranchId: null,
      awakeningUnlocked: false,
      awakeningPrompted: false,
      exclusiveUnlocked: false,
      exclusiveLevel: 1,
      exclusiveKills: 0,
      inventory: [null, null, null, null, null, null],
      stash: [null, null, null, null, null, null],
      pinnedRecipeId: null,
      skillCds: [0, 0, 0, 0],
      flashCd: 0,
      recallTimer: 0,
      activeItemCd: 0,
      attackCd: 0,
      attackCombo: 0,
      swingAnim: 0,
      hitFlash: 0,
      dead: false,
      reviveTimer: 0,
      reviveMax: 10,
      downedX: 0,
      downedY: 0,
      reviveAssistProgress: 0,
      invulnTimer: 0,
      stealthTimer: 0,
      bladestormTimer: 0,
      avatarTimer: 0,
      hawkeyeTimer: 0,
      warsongTimer: 0,
      windbootsTimer: 0,
      consecrateTimer: 0,
      omnislashTimer: 0,
      omnislashTargetX: 0,
      omnislashTargetY: 0,
      omnislashTicksLeft: 0,
      passiveStacks: 0,
      passiveTimer: 0,
      stunTimer: 0,
      carryingWater: false,
      waterDeliveriesDone: 0,
      botDecisionTimer: 1.0,
    };
    recalcHeroStats(h);
    h.hp = h.stats.maxHp;
    h.mp = h.stats.maxMp;
    return h;
  }

  public getLocalHero(): HeroEntity | null {
    return this.world?.heroes.find((h) => h.isLocal) || null;
  }

  public continueEndless(): void {
    if (!this.world) return;
    this.world.endlessMode = true;
    this.world.ended = false;
    this.world.victory = false;
    this.world.waveState = 'prep';
    this.world.wavePrepTimer = 14;
    this.world.bannerText = '♾️ 已进入【无尽守卫模式】！每 5 波魔神再临，冲击极限排行榜！';
    this.world.bannerColor = '#c084fc';
    this.world.bannerTimer = 4.5;
    SoundFX.setBgmMode('combat');
  }

  public update(dt: number, viewW: number, viewH: number): void {
    const world = this.world;
    if (!world || this.paused || this.landscapePaused || world.ended) return;

    world.elapsedSec += dt;
    if (world.bannerTimer > 0) world.bannerTimer -= dt;

    // Sanctuary timers & regen
    if (world.sanctuary.invulnTimer > 0) world.sanctuary.invulnTimer -= dt;
    if (world.sanctuary.invulnCd > 0) world.sanctuary.invulnCd -= dt;
    if (world.sanctuary.underAttackFlash > 0) world.sanctuary.underAttackFlash -= dt;
    world.sanctuary.hp = Math.min(world.sanctuary.maxHp, world.sanctuary.hp + world.sanctuary.hpRegen * dt);

    // Update heroes cooldowns, buffs, passive aura, recall, revival
    const isClient = CoopManager.isActiveCoop() && CoopManager.role === 'client';
    this.updateHeroStates(world, dt);

    // Local hero movement & attack
    const local = this.getLocalHero();
    if (local && !local.dead) {
      this.updateLocalHeroInput(world, local, dt);
      if (local.awakeningPrompted && !local.awakeningUnlocked) {
        local.awakeningPrompted = false;
        this.cbs.onPromptAwakening(local);
      }
    }

    if (!isClient) {
      updateWaveDirector(world, dt, () => this.finishMatch(true));
      updateBranches(world, dt);
      updateEnemies(world, dt);
      updateTelegraphsAndProjectiles(world, dt);
      updateTowersAndSummons(world, dt);
      updateBotHeroes(world, dt);

      if (world.sanctuary.hp <= 0 && !world.ended) {
        this.finishMatch(false);
      }
    }

    // Visual effects & floating text decay
    for (let i = world.vfx.length - 1; i >= 0; i--) {
      world.vfx[i].life -= dt;
      if (world.vfx[i].life <= 0) world.vfx.splice(i, 1);
    }
    for (let i = world.floatingTexts.length - 1; i >= 0; i--) {
      const ft = world.floatingTexts[i];
      ft.life -= dt;
      ft.y += ft.vy * dt;
      if (ft.life <= 0) world.floatingTexts.splice(i, 1);
    }
    for (let i = world.pings.length - 1; i >= 0; i--) {
      world.pings[i].life -= dt;
      if (world.pings[i].life <= 0) world.pings.splice(i, 1);
    }

    // Camera smooth follow
    if (local) {
      const targetCamX = Math.max(0, Math.min(WORLD_WIDTH - viewW, local.x - viewW / 2));
      const targetCamY = Math.max(0, Math.min(WORLD_HEIGHT - viewH, local.y - viewH / 2));
      this.camX += (targetCamX - this.camX) * Math.min(1, dt * 10);
      this.camY += (targetCamY - this.camY) * Math.min(1, dt * 10);
    }

    // Co-op network sync
    if (CoopManager.isActiveCoop()) {
      this.netSyncTimer += dt;
      if (this.netSyncTimer >= 0.06) {
        this.netSyncTimer = 0;
        this.broadcastCoopSync();
      }
    }
  }

  private updateHeroStates(world: GameWorldState, dt: number): void {
    const onKilled = (e: typeof world.enemies[number], k?: HeroEntity) => handleEnemyDeathDrops(world, e, k);

    for (const h of world.heroes) {
      if (h.dead) {
        h.reviveTimer -= dt;
        // Ally rescue assist
        const helper = world.heroes.find(
          (a) => a.id !== h.id && !a.dead && a.zoneId === h.zoneId && Math.hypot(a.x - h.x, a.y - h.y) <= 85
        );
        if (helper) {
          h.reviveTimer -= dt * 2.5;
        }
        if (h.reviveTimer <= 0) {
          h.dead = false;
          h.zoneId = 'sanctuary';
          h.x = FOUNTAIN_POS.x + (Math.random() - 0.5) * 40;
          h.y = FOUNTAIN_POS.y + (Math.random() - 0.5) * 40;
          h.hp = h.stats.maxHp;
          h.mp = h.stats.maxMp;
          h.invulnTimer = 2.0;
          addFloatingText(world, h.x, h.y - 34, '圣泉复活!', '#4ade80', 15);
        }
        continue;
      }

      for (let i = 0; i < 4; i++) {
        if (h.skillCds[i] > 0) h.skillCds[i] = Math.max(0, h.skillCds[i] - dt);
      }
      if (h.flashCd > 0) h.flashCd = Math.max(0, h.flashCd - dt);
      if (h.activeItemCd > 0) h.activeItemCd = Math.max(0, h.activeItemCd - dt);
      if (h.attackCd > 0) h.attackCd = Math.max(0, h.attackCd - dt);
      if (h.swingAnim > 0) h.swingAnim -= dt;
      if (h.hitFlash > 0) h.hitFlash -= dt;
      if (h.stunTimer > 0) h.stunTimer -= dt;
      if (h.invulnTimer > 0) h.invulnTimer -= dt;
      if (h.stealthTimer > 0) h.stealthTimer -= dt;
      if (h.windbootsTimer > 0) {
        h.windbootsTimer -= dt;
        if (h.windbootsTimer <= 0) recalcHeroStats(h);
      }
      if (h.avatarTimer > 0) {
        h.avatarTimer -= dt;
        if (h.avatarTimer <= 0) recalcHeroStats(h);
      }
      if (h.hawkeyeTimer > 0) {
        h.hawkeyeTimer -= dt;
        if (h.hawkeyeTimer <= 0) recalcHeroStats(h);
      }
      if (h.warsongTimer > 0) {
        h.warsongTimer -= dt;
        if (h.warsongTimer <= 0) recalcHeroStats(h);
      }
      if (h.passiveTimer > 0) {
        h.passiveTimer -= dt;
        if (h.passiveTimer <= 0 && h.passiveStacks > 0) {
          h.passiveStacks = 0;
          recalcHeroStats(h);
        }
      }

      // Priest aura bonus for nearby allies
      const priestNearby = world.heroes.some(
        (p) => !p.dead && p.classId === 'priest' && p.zoneId === h.zoneId && Math.hypot(p.x - h.x, p.y - h.y) <= 450
      );
      const mpReg = h.stats.mpRegen + (priestNearby ? 8 : 0);
      h.hp = Math.min(h.stats.maxHp, h.hp + h.stats.hpRegen * dt);
      h.mp = Math.min(h.stats.maxMp, h.mp + mpReg * dt);

      // Paladin Consecrate Aura tick
      if (h.consecrateTimer > 0) {
        const prev = Math.floor(h.consecrateTimer * 2);
        h.consecrateTimer -= dt;
        if (Math.floor(h.consecrateTimer * 2) !== prev) {
          const mult = h.awakeningBranchId === 'pal_retribution' ? 1.55 : 1.0;
          const dmg = (42 + h.level * 16 + h.stats.ap * 0.42 + h.stats.ad * 0.25) * mult;
          for (const e of world.enemies) {
            if (e.zoneId === h.zoneId && e.hp > 0 && Math.hypot(e.x - h.x, e.y - h.y) <= 240) {
              if (!e.isBoss) {
                e.tauntTargetId = h.id;
                e.tauntTimer = 1.6;
              }
              applyDamageToEnemy(world, e, dmg, { attacker: h, isMagic: true, onEnemyKilled: onKilled });
            }
          }
        }
      }

      // Blademaster Bladestorm tick
      if (h.bladestormTimer > 0) {
        const prev = Math.floor(h.bladestormTimer * 3);
        h.bladestormTimer -= dt;
        if (Math.floor(h.bladestormTimer * 3) !== prev) {
          const dmg = 52 + h.level * 20 + h.stats.ad * 0.68;
          for (const e of world.enemies) {
            if (e.zoneId === h.zoneId && e.hp > 0 && Math.hypot(e.x - h.x, e.y - h.y) <= 215 + e.radius) {
              applyDamageToEnemy(world, e, dmg, {
                attacker: h,
                canCrit: true,
                lifestealMult: h.awakeningBranchId === 'bm_bloodfury' ? 1.2 : 0.35,
                onEnemyKilled: onKilled,
              });
            }
          }
        }
      }

      // Blademaster Omnislash ticks
      if (h.omnislashTimer > 0 && h.omnislashTicksLeft > 0) {
        const prev = Math.floor(h.omnislashTimer * 5.5);
        h.omnislashTimer -= dt;
        if (Math.floor(h.omnislashTimer * 5.5) !== prev) {
          h.omnislashTicksLeft -= 1;
          const target = world.enemies.find(
            (e) =>
              e.zoneId === h.zoneId &&
              e.hp > 0 &&
              Math.hypot(e.x - h.omnislashTargetX, e.y - h.omnislashTargetY) <= 280
          );
          if (target) {
            h.x = target.x + (Math.random() - 0.5) * 30;
            h.y = target.y + (Math.random() - 0.5) * 30;
            const dmg = 165 + h.level * 68 + h.stats.ad * 1.15;
            applyDamageToEnemy(world, target, dmg, { attacker: h, forceCrit: true, onEnemyKilled: onKilled });
            world.vfx.push({ kind: 'slash', x: target.x, y: target.y, angle: Math.random() * Math.PI * 2, radius: 95, color: '#fb7185', life: 0.2, maxLife: 0.2 });
          }
        }
      }

      // Recall Channeling
      if (h.recallTimer > 0) {
        h.recallTimer -= dt;
        if (h.recallTimer <= 0) {
          h.zoneId = 'sanctuary';
          h.x = FOUNTAIN_POS.x;
          h.y = FOUNTAIN_POS.y;
          world.vfx.push({ kind: 'teleport', x: h.x, y: h.y, radius: 52, color: '#38bdf8', life: 0.5, maxLife: 0.5 });
          addFloatingText(world, h.x, h.y - 34, '已回城至圣泉', '#38bdf8', 14);
        }
      }
    }
  }

  private updateLocalHeroInput(world: GameWorldState, hero: HeroEntity, dt: number): void {
    if (hero.stunTimer > 0 || hero.omnislashTimer > 0) return;

    const mv = this.input.getMoveVector();
    let dx = mv.x;
    let dy = mv.y;

    // Optional right-click move target
    if (dx === 0 && dy === 0 && this.input.moveTargetWorld) {
      const tx = this.input.moveTargetWorld.x - hero.x;
      const ty = this.input.moveTargetWorld.y - hero.y;
      const dist = Math.hypot(tx, ty);
      if (dist > 12) {
        dx = tx / dist;
        dy = ty / dist;
      } else {
        this.input.moveTargetWorld = null;
      }
    }

    if (dx !== 0 || dy !== 0) {
      hero.recallTimer = 0;
      const priestAura = world.heroes.some(
        (p) => !p.dead && p.classId === 'priest' && p.zoneId === hero.zoneId && Math.hypot(p.x - hero.x, p.y - hero.y) <= 450
      );
      const spd = hero.stats.moveSpeed * (priestAura ? 1.15 : 1.0);
      hero.x += dx * spd * dt;
      hero.y += dy * spd * dt;
      hero.facing = Math.atan2(dy, dx);
    }

    // Basic Attack (Hold Space / Left Click / Touch Main Attack Button)
    if (this.input.isAttackPressed() && hero.attackCd <= 0) {
      hero.recallTimer = 0;
      const target = this.pickSmartTarget(world, hero, hero.stats.attackRange + 95);
      let ax = Math.cos(hero.facing);
      let ay = Math.sin(hero.facing);

      if (target) {
        const tx = target.x - hero.x;
        const ty = target.y - hero.y;
        const d = Math.hypot(tx, ty) || 1;
        ax = tx / d;
        ay = ty / d;
        // If slightly out of range on touch hold, step toward enemy automatically (Honor of Kings feel!)
        if (this.input.attackHeld && d > hero.stats.attackRange + target.radius) {
          hero.x += ax * hero.stats.moveSpeed * 0.85 * dt;
          hero.y += ay * hero.stats.moveSpeed * 0.85 * dt;
          hero.facing = Math.atan2(ay, ax);
          return;
        }
      } else if (!this.input.usingTouch && this.input.mouseDown) {
        const mx = this.camX + this.input.mouseScreenX - hero.x;
        const my = this.camY + this.input.mouseScreenY - hero.y;
        const md = Math.hypot(mx, my) || 1;
        ax = mx / md;
        ay = my / md;
      }

      const onKilled = (e: typeof world.enemies[number], k?: HeroEntity) => handleEnemyDeathDrops(world, e, k);
      performBasicAttack(world, hero, ax, ay, onKilled);
      if (CoopManager.isActiveCoop() && CoopManager.role === 'client') {
        CoopManager.sendToHost({ type: 'cmd_attack', ownerId: hero.id, dirX: ax, dirY: ay });
      }
    }
  }

  public pickSmartTarget(world: GameWorldState, hero: HeroEntity, maxDist: number) {
    const candidates = world.enemies.filter(
      (e) => e.zoneId === hero.zoneId && e.hp > 0 && Math.hypot(e.x - hero.x, e.y - hero.y) <= maxDist + e.radius
    );
    if (candidates.length === 0) return null;
    if (this.input.targetPriority === 'boss') {
      const boss = candidates.find((c) => c.isBoss || c.isMiniBoss);
      if (boss) return boss;
    } else if (this.input.targetPriority === 'low_hp') {
      return candidates.sort((a, b) => a.hp / a.maxHp - b.hp / b.maxHp)[0];
    }
    return candidates.sort((a, b) => Math.hypot(a.x - hero.x, a.y - hero.y) - Math.hypot(b.x - hero.x, b.y - hero.y))[0];
  }

  public getSmartAimVector(hero: HeroEntity, range: number): { dx: number; dy: number; distRatio: number } {
    if (!this.world) return { dx: Math.cos(hero.facing), dy: Math.sin(hero.facing), distRatio: 0.7 };
    const target = this.pickSmartTarget(this.world, hero, Math.max(range, 420));
    if (target) {
      const tx = target.x - hero.x;
      const ty = target.y - hero.y;
      const d = Math.hypot(tx, ty) || 1;
      return { dx: tx / d, dy: ty / d, distRatio: Math.min(1, d / Math.max(1, range)) };
    }
    if (!this.input.usingTouch) {
      const mx = this.camX + this.input.mouseScreenX - hero.x;
      const my = this.camY + this.input.mouseScreenY - hero.y;
      const d = Math.hypot(mx, my) || 1;
      return { dx: mx / d, dy: my / d, distRatio: Math.min(1, d / Math.max(1, range)) };
    }
    return { dx: Math.cos(hero.facing), dy: Math.sin(hero.facing), distRatio: 0.65 };
  }

  public handleCastSkillInput(slot: number, dirX?: number, dirY?: number, distRatio?: number): void {
    if (!this.world || this.paused) return;
    const local = this.getLocalHero();
    if (!local) return;
    const def = getHeroClassDef(local.classId);
    const sk = def.skills[slot];
    if (!sk) return;

    const smart = this.getSmartAimVector(local, sk.range);
    const dx = dirX ?? smart.dx;
    const dy = dirY ?? smart.dy;
    const ratio = distRatio ?? smart.distRatio;

    if (CoopManager.isActiveCoop() && CoopManager.role === 'client') {
      CoopManager.sendToHost({ type: 'cmd_skill', ownerId: local.id, slot, dirX: dx, dirY: dy, distRatio: ratio });
      return;
    }
    castHeroSkill(this.world, local, slot, dx, dy, ratio, (e, k) => handleEnemyDeathDrops(this.world!, e, k));
  }

  public handleFlashInput(dirX?: number, dirY?: number): void {
    if (!this.world || this.paused) return;
    const local = this.getLocalHero();
    if (!local) return;
    const mv = this.input.getMoveVector();
    const dx = dirX ?? (mv.x !== 0 || mv.y !== 0 ? mv.x : Math.cos(local.facing));
    const dy = dirY ?? (mv.x !== 0 || mv.y !== 0 ? mv.y : Math.sin(local.facing));
    if (CoopManager.isActiveCoop() && CoopManager.role === 'client') {
      CoopManager.sendToHost({ type: 'cmd_flash', ownerId: local.id, dirX: dx, dirY: dy });
      return;
    }
    castFlashSkill(this.world, local, dx, dy);
  }

  public handleRecallInput(): void {
    if (!this.world || this.paused) return;
    const local = this.getLocalHero();
    if (!local) return;
    if (CoopManager.isActiveCoop() && CoopManager.role === 'client') {
      CoopManager.sendToHost({ type: 'cmd_recall', ownerId: local.id });
      return;
    }
    startRecall(this.world, local);
  }

  public handleUsePotionInput(slot: 'hp' | 'mp' | 'tactical'): void {
    if (!this.world || this.paused) return;
    const local = this.getLocalHero();
    if (!local) return;
    if (CoopManager.isActiveCoop() && CoopManager.role === 'client') {
      CoopManager.sendToHost({ type: 'cmd_potion', ownerId: local.id, slot });
      return;
    }
    usePotionSlot(this.world, local, slot);
  }

  public handleActiveItemInput(): void {
    if (!this.world || this.paused) return;
    const local = this.getLocalHero();
    if (!local) return;
    castActiveItemSkill(this.world, local, (e, k) => handleEnemyDeathDrops(this.world!, e, k));
  }

  public handleSendPing(label = '请求支援!', x?: number, y?: number): void {
    if (!this.world) return;
    const local = this.getLocalHero();
    if (!local) return;
    const px = x ?? local.x;
    const py = y ?? local.y;
    this.world.pings.push({ x: px, y: py, color: '#facc15', label: `${local.callsign}: ${label}`, life: 3.0 });
    SoundFX.playAthenaWarn();
    if (CoopManager.isActiveCoop()) {
      CoopManager.sendGameMessage({ type: 'cmd_ping', ownerId: local.id, x: px, y: py, color: '#facc15', label: `${local.callsign}: ${label}` });
    }
  }

  // Economy & Branch Actions exposed cleanly for UI + Co-op forwarding
  public actionBuy(itemId: string): boolean {
    if (!this.world) return false;
    const local = this.getLocalHero();
    if (!local) return false;
    if (CoopManager.isActiveCoop() && CoopManager.role === 'client') {
      CoopManager.sendToHost({ type: 'cmd_buy', ownerId: local.id, itemId });
      return true;
    }
    return buyItem(this.world, local, itemId);
  }

  public actionSynthesize(itemId: string): boolean {
    if (!this.world) return false;
    const local = this.getLocalHero();
    if (!local) return false;
    if (CoopManager.isActiveCoop() && CoopManager.role === 'client') {
      CoopManager.sendToHost({ type: 'cmd_synthesize', ownerId: local.id, itemId });
      return true;
    }
    return synthesizeItem(this.world, local, itemId);
  }

  public actionUpgradeSlot(inInv: boolean, slotIdx: number): boolean {
    if (!this.world) return false;
    const local = this.getLocalHero();
    if (!local) return false;
    if (CoopManager.isActiveCoop() && CoopManager.role === 'client') {
      CoopManager.sendToHost({ type: 'cmd_upgrade_slot', ownerId: local.id, inInv, slotIdx });
      return true;
    }
    return upgradeItemInSlot(this.world, local, inInv, slotIdx);
  }

  public actionSellSlot(inInv: boolean, slotIdx: number): boolean {
    if (!this.world) return false;
    const local = this.getLocalHero();
    if (!local) return false;
    if (CoopManager.isActiveCoop() && CoopManager.role === 'client') {
      CoopManager.sendToHost({ type: 'cmd_sell_slot', ownerId: local.id, inInv, slotIdx });
      return true;
    }
    return sellItemInSlot(this.world, local, inInv, slotIdx);
  }

  public actionSwapSlot(fromInv: boolean, idxA: number, toInv: boolean, idxB: number): void {
    const local = this.getLocalHero();
    if (!local) return;
    swapInvAndStash(local, fromInv, idxA, toInv, idxB);
  }

  public actionTeleport(zoneId: ZoneId, tier?: 1 | 2 | 3): boolean {
    if (!this.world) return false;
    const local = this.getLocalHero();
    if (!local) return false;
    if (CoopManager.isActiveCoop() && CoopManager.role === 'client') {
      CoopManager.sendToHost({ type: 'cmd_teleport', ownerId: local.id, zoneId, tier });
      return true;
    }
    return teleportHeroToZone(this.world, local, zoneId, tier);
  }

  public actionBase(kind: 'upgrade' | 'invuln' | 'pause_wave' | 'early_wave'): boolean {
    if (!this.world) return false;
    const local = this.getLocalHero();
    if (!local) return false;
    if (CoopManager.isActiveCoop() && CoopManager.role === 'client') {
      CoopManager.sendToHost({ type: 'cmd_base', ownerId: local.id, kind });
      return true;
    }
    if (kind === 'upgrade') return upgradeSanctuary(this.world, local);
    if (kind === 'invuln') return triggerSanctuaryInvuln(this.world, local);
    if (kind === 'pause_wave') return pauseNextWave(this.world, local);
    return startWaveEarly(this.world, local);
  }

  public actionTower(slotId: string, towerType: TowerType): boolean {
    if (!this.world) return false;
    const local = this.getLocalHero();
    if (!local) return false;
    if (CoopManager.isActiveCoop() && CoopManager.role === 'client') {
      CoopManager.sendToHost({ type: 'cmd_tower', ownerId: local.id, slotId, towerType });
      return true;
    }
    return buildOrUpgradeTower(this.world, local, slotId, towerType);
  }

  public actionGiftResource(toHeroId: string, kind: 'gold' | 'crystal', amount: number): boolean {
    if (!this.world) return false;
    const local = this.getLocalHero();
    if (!local) return false;
    return giftResourceToAlly(this.world, local, toHeroId, kind, amount);
  }

  public actionGiftItem(toHeroId: string, inInv: boolean, slotIdx: number): boolean {
    if (!this.world) return false;
    const local = this.getLocalHero();
    if (!local) return false;
    return giftItemToAlly(this.world, local, toHeroId, inInv, slotIdx);
  }

  public actionSelectAwakening(branchId: string): void {
    const local = this.getLocalHero();
    if (!local || local.awakeningUnlocked) return;
    local.awakeningBranchId = branchId;
    local.awakeningUnlocked = true;
    recalcHeroStats(local);
    local.hp = local.stats.maxHp;
    local.mp = local.stats.maxMp;
    SoundFX.playLevelUp();
    if (this.world) {
      this.world.vfx.push({ kind: 'levelup', x: local.x, y: local.y, radius: 90, color: '#facc15', life: 1.0, maxLife: 1.0 });
      addFloatingText(this.world, local.x, local.y - 46, '英雄觉醒成功!', '#fde047', 18);
    }
    if (CoopManager.isActiveCoop() && CoopManager.role === 'client') {
      CoopManager.sendToHost({ type: 'cmd_awaken', ownerId: local.id, branchId });
    }
  }

  public toggleAllBotsMode(): 'guard_base' | 'follow_player' {
    if (!this.world) return 'guard_base';
    const bots = this.world.heroes.filter((h) => h.isBot);
    const next = bots[0]?.aiMode === 'guard_base' ? 'follow_player' : 'guard_base';
    for (const b of bots) b.aiMode = next;
    return next;
  }

  private finishMatch(victory: boolean): void {
    if (!this.world) return;
    this.world.victory = victory;
    this.world.ended = true;
    this.world.waveState = 'ended';
    if (victory) SoundFX.playVictory();
    else SoundFX.playDefeat();
    SoundFX.setBgmMode('hub');

    const local = this.getLocalHero();
    if (local) {
      const diff = DIFFICULTIES[this.world.difficulty];
      const honor = Math.max(30, Math.round((this.world.wave * 18 + (victory ? 220 : 0) + local.kills * 0.35) * diff.honorMultiplier));
      const discovered = local.inventory.filter((x): x is string => Boolean(x));
      SaveManager.recordRunResult({
        hero: local.classId,
        difficulty: this.world.difficulty,
        maxWave: this.world.wave,
        victory,
        kills: local.kills,
        honorEarned: honor,
        discoveredItems: discovered,
        defeatedBosses: [],
      });
    }
    this.cbs.onShowSettlement(victory);
  }

  public render(viewW: number, viewH: number): void {
    if (!this.world) return;
    this.renderer.renderWorld(this.ctx, this.world, this.input, this.camX, this.camY, viewW, viewH);
  }

  public renderMinimap(minimapCanvas: HTMLCanvasElement): void {
    if (!this.world) return;
    const mctx = minimapCanvas.getContext('2d');
    if (!mctx) return;
    this.renderer.renderMinimap(mctx, this.world, minimapCanvas.width, minimapCanvas.height);
  }

  // Co-op Host/Client handling
  private broadcastCoopSync(): void {
    if (!this.world) return;
    const local = this.getLocalHero();
    if (CoopManager.role === 'client' && local) {
      CoopManager.sendToHost({
        type: 'client_pos',
        ownerId: local.id,
        x: Math.round(local.x),
        y: Math.round(local.y),
        facing: +local.facing.toFixed(2),
      });
    } else if (CoopManager.role === 'host') {
      CoopManager.broadcastFromHost({
        type: 'world_snap',
        wave: this.world.wave,
        prep: Math.round(this.world.wavePrepTimer),
        waveState: this.world.waveState,
        sancHp: Math.round(this.world.sanctuary.hp),
        sancMaxHp: Math.round(this.world.sanctuary.maxHp),
        sancLv: this.world.sanctuary.level,
        heroes: this.world.heroes.map((h) => [
          h.id,
          Math.round(h.x),
          Math.round(h.y),
          Math.round(h.hp),
          Math.round(h.stats.maxHp),
          Math.round(h.mp),
          Math.round(h.stats.maxMp),
          h.level,
          Math.round(h.gold),
          h.crystal,
          h.stones,
          h.zoneId,
          h.dead ? 1 : 0,
          +h.facing.toFixed(2),
        ]),
        enemies: this.world.enemies.slice(0, 120).map((e) => [
          e.id,
          e.kind,
          e.zoneId,
          Math.round(e.x),
          Math.round(e.y),
          Math.round(e.hp),
          Math.round(e.maxHp),
          +e.facing.toFixed(2),
        ]),
      });
    }
  }

  private handleNetMessage(msg: CoopNetMessage, _fromId: string): void {
    if (!this.world) return;
    const onKilled = (e: typeof this.world.enemies[number], k?: HeroEntity) => handleEnemyDeathDrops(this.world!, e, k);

    if (msg.type === 'cmd_ping') {
      this.world.pings.push({ x: msg.x, y: msg.y, color: msg.color, label: msg.label, life: 3.0 });
      SoundFX.playAthenaWarn();
      return;
    }

    if (CoopManager.role === 'host') {
      if (!('ownerId' in msg)) return;
      const actor = this.world.heroes.find((h) => h.id === msg.ownerId);
      if (!actor) return;
      if (msg.type === 'client_pos') {
        actor.x = msg.x;
        actor.y = msg.y;
        actor.facing = msg.facing;
      } else if (msg.type === 'cmd_attack') {
        if (actor.attackCd <= 0) performBasicAttack(this.world, actor, msg.dirX, msg.dirY, onKilled);
      } else if (msg.type === 'cmd_skill') {
        castHeroSkill(this.world, actor, msg.slot, msg.dirX, msg.dirY, msg.distRatio, onKilled);
      } else if (msg.type === 'cmd_flash') {
        castFlashSkill(this.world, actor, msg.dirX, msg.dirY);
      } else if (msg.type === 'cmd_recall') {
        startRecall(this.world, actor);
      } else if (msg.type === 'cmd_potion') {
        usePotionSlot(this.world, actor, msg.slot);
      } else if (msg.type === 'cmd_buy') {
        buyItem(this.world, actor, msg.itemId);
      } else if (msg.type === 'cmd_synthesize') {
        synthesizeItem(this.world, actor, msg.itemId);
      } else if (msg.type === 'cmd_upgrade_slot') {
        upgradeItemInSlot(this.world, actor, msg.inInv, msg.slotIdx);
      } else if (msg.type === 'cmd_sell_slot') {
        sellItemInSlot(this.world, actor, msg.inInv, msg.slotIdx);
      } else if (msg.type === 'cmd_teleport') {
        teleportHeroToZone(this.world, actor, msg.zoneId, msg.tier);
      } else if (msg.type === 'cmd_base') {
        if (msg.kind === 'upgrade') upgradeSanctuary(this.world, actor);
        else if (msg.kind === 'invuln') triggerSanctuaryInvuln(this.world, actor);
        else if (msg.kind === 'pause_wave') pauseNextWave(this.world, actor);
        else startWaveEarly(this.world, actor);
      } else if (msg.type === 'cmd_tower') {
        buildOrUpgradeTower(this.world, actor, msg.slotId, msg.towerType);
      } else if (msg.type === 'cmd_awaken') {
        actor.awakeningBranchId = msg.branchId;
        actor.awakeningUnlocked = true;
        recalcHeroStats(actor);
      }
    } else if (CoopManager.role === 'client' && msg.type === 'world_snap') {
      this.world.wave = msg.wave;
      this.world.wavePrepTimer = msg.prep;
      this.world.waveState = msg.waveState;
      this.world.sanctuary.hp = msg.sancHp;
      this.world.sanctuary.maxHp = msg.sancMaxHp;
      this.world.sanctuary.level = msg.sancLv;
      for (const hTuple of msg.heroes) {
        const [id, x, y, hp, maxHp, mp, maxMp, lv, gold, crystal, stones, zoneId, dead, facing] = hTuple;
        const h = this.world.heroes.find((xHero) => xHero.id === id);
        if (!h) continue;
        if (!h.isLocal) {
          h.x = x;
          h.y = y;
          h.facing = facing;
          h.zoneId = zoneId;
        }
        h.hp = hp;
        h.stats.maxHp = maxHp;
        h.mp = mp;
        h.stats.maxMp = maxMp;
        h.level = lv;
        h.gold = gold;
        h.crystal = crystal;
        h.stones = stones;
        h.dead = dead === 1;
      }
      // Sync enemies snapshot cleanly
      const nextEnemies = [];
      for (const et of msg.enemies) {
        const [id, kind, zoneId, x, y, hp, maxHp, facing] = et;
        const existing = this.world.enemies.find((oe) => oe.id === id);
        if (existing) {
          existing.x = x;
          existing.y = y;
          existing.hp = hp;
          existing.maxHp = maxHp;
          existing.facing = facing;
          existing.zoneId = zoneId;
          nextEnemies.push(existing);
        } else {
          const spawned = spawnEnemy(this.world, kind, zoneId, x, y, 1, 1);
          spawned.id = id;
          spawned.hp = hp;
          spawned.maxHp = maxHp;
          spawned.facing = facing;
          nextEnemies.push(spawned);
        }
      }
      this.world.enemies = nextEnemies;
    }
  }
}
