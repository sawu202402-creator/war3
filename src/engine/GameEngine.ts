import { SoundFX } from '../audio/SoundFX';
import { DIFFICULTIES, getHeroClassDef } from '../data/heroes';
import {
  ATHENA_POS,
  FOUNTAIN_POS,
  FOUNTAIN_SPAWN_POS,
  HERO_COLLISION_RADIUS,
  HERO_FORMATION_OFFSETS,
  HERO_SPAWN_POS,
  PORTALS,
  TOWER_SLOTS,
  WORLD_HEIGHT,
  WORLD_WIDTH,
  ZONES,
  resolveWorldCollision,
} from '../data/worldMap';
import { SaveManager } from '../meta/SaveManager';
import { CoopManager } from '../net/CoopManager';
import {
  CoopNetMessage,
  DropSnapTuple,
  EnemySnapTuple,
  HeroEconTuple,
  HeroFastTuple,
  LobbyMember,
  ProjSnapTuple,
  SquadMvpEntry,
  SummonSnapTuple,
  TelegraphSnapTuple,
  TowerSnapTuple,
} from '../net/CoopProtocol';
import { DifficultyLevel, HeroClassId, TowerType, ZoneId } from '../types';
import {
  startWaveEarly,
  updateBotHeroes,
  updateEnemies,
  updateTelegraphsAndProjectiles,
  updateTowersAndSummons,
  updateWaveDirector,
} from './AiSystem';
import { applyEnemyAffix, handleEnemyDeathDrops, spawnEnemy, teleportHeroToZone, updateBranches } from './BranchSystem';
import {
  addFloatingText,
  applyDamageToEnemy,
  castActiveItemSkill,
  castFlashSkill,
  castHeroSkill,
  getHeroAttackLockDuration,
  getScaledSkillDamage,
  performBasicAttack,
  recalcHeroStats,
  startRecall,
  upgradeHeroSkill,
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
import { DropItem, EnemyAffix, EnemyEntity, GameWorldState, HeroEntity, TelegraphZone } from './GameState';
import { InputManager } from './InputManager';
import { War3Renderer } from './War3Renderer';

const AFFIX_TABLE: (EnemyAffix | undefined)[] = [undefined, 'bloodlust', 'armored', 'swift', 'blazing'];
const TELEGRAPH_KIND_TABLE: TelegraphZone['kind'][] = [
  'enemy_aoe',
  'enemy_laser',
  'blizzard',
  'starfall',
  'sanctuary',
  'poison_pool',
];
const TOWER_TYPE_TABLE: (TowerType | null)[] = [null, 'arrow', 'frost', 'holy'];
const DROP_KIND_TABLE: DropItem['kind'][] = ['gold', 'crystal', 'stone', 'item'];

export interface EngineCallbacks {
  onToggleShop: () => void;
  onToggleTeleport: () => void;
  onToggleBase: () => void;
  onTogglePause: () => void;
  onPromptAwakening: (hero: HeroEntity) => void;
  onShowSettlement: (victory: boolean) => void;
  onCloseSettlement?: () => void;
  onNetUiRefresh?: () => void;
}

export class GameEngine {
  public world: GameWorldState | null = null;
  public paused = false;
  public landscapePaused = false;
  public camX = 1400;
  public camY = 1700;
  public worldZoom = 1.0;
  public lockedTargetId: number | null = null;
  public lastRunHonor = 0;
  public lastSquadStats: SquadMvpEntry[] = [];

  private renderer = new War3Renderer();
  private netWorldSyncTimer = 0;
  private netHeroSyncTimer = 0;
  private netClientPosTimer = 0;
  private netClientPosSeq = 0;
  private netHostSeq = 0;
  private lastClientWorldSeq = 0;
  private lastClientHeroFastSeq = 0;
  private lastAppliedLocalTpSeq = 0;
  private econSyncCounter = 0;
  private hostEconDirty = true;
  private lastSentBannerText = '';
  private clientEnemyMap = new Map<number, EnemyEntity>();
  private clientDropMap = new Map<number, DropItem>();
  private settlementTriggered = false;

  constructor(
    private canvas: HTMLCanvasElement,
    private ctx: CanvasRenderingContext2D,
    public input: InputManager,
    private cbs: EngineCallbacks
  ) {
    this.input.bindActions({
      onCastSkill: (slot, dirX, dirY, distRatio) => this.handleCastSkillInput(slot, dirX, dirY, distRatio),
      onUpgradeSkill: (slot) => this.handleUpgradeSkillInput(slot),
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
        this.input.moveTargetWorld = { x: this.camX + sx / this.worldZoom, y: this.camY + sy / this.worldZoom };
      },
    });
  }

  private computeWorldZoom(viewW: number, viewH: number): number {
    return viewH < 620 || viewW < 960
      ? Math.max(0.68, Math.min(1.0, Math.min(viewW / 1040, viewH / 525)))
      : 1.0;
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
    this.settlementTriggered = false;
    this.lastRunHonor = 0;
    this.netWorldSyncTimer = 0;
    this.netHeroSyncTimer = 0;
    this.netClientPosTimer = 0;
    this.netClientPosSeq = 0;
    this.netHostSeq = 0;
    this.lastClientWorldSeq = 0;
    this.lastClientHeroFastSeq = 0;
    this.lastAppliedLocalTpSeq = 0;
    this.econSyncCounter = 0;
    this.hostEconDirty = true;
    this.lastSentBannerText = '';
    this.lastSquadStats = [];
    this.clientEnemyMap.clear();
    this.clientDropMap.clear();
    CoopManager.clearMatchSnapshots();
    const isCoop = Boolean(opts.coopRoster && opts.coopRoster.length > 0);
    const playersCount = isCoop ? opts.coopRoster!.length : 1 + opts.aiSquadCount;

    const baseSanctuaryHp = Math.round(8500 * (1 + save.talents.reviveFast * 0.08) * (1 + (playersCount - 1) * 0.16));
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
      wavePrepTimer: 26,
      wavePauseCountUsed: 0,
      maxWavePauses: 4,
      waveSpawnQueue: [],
      waveSpawnCooldown: 0,
      victory: false,
      ended: false,
      elapsedSec: 0,
      sanctuary: {
        hp: baseSanctuaryHp,
        maxHp: baseSanctuaryHp,
        armor: 18,
        hpRegen: 16,
        shield: 0,
        level: 1,
        invulnTimer: 0,
        invulnCd: 0,
        underAttackFlash: 0,
        attackTimer: 0.6,
        autoAegisCd: 0,
        deathWardCd: 0,
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
      bannerText: `第 1 波 16s 后袭来 · 可先购装或去圣泉接水`,
      bannerColor: '#fde047',
      bannerTimer: 3.2,
      cameraShake: 0,
      nextEntityId: 1,
      defeatedBosses: [],
      doubleGoldTimer: 0,
    };

    const local = this.getLocalHero();
    if (local) {
      const vw = this.canvas.clientWidth || 1280;
      const vh = this.canvas.clientHeight || 720;
      this.worldZoom = this.computeWorldZoom(vw, vh);
      this.camX = local.x - (vw / this.worldZoom) / 2;
      this.camY = local.y - (vh / this.worldZoom) / 2;
    }

    SoundFX.unlockAudio();
    SoundFX.setBgmMode('combat');

    if (CoopManager.isActiveCoop()) {
      CoopManager.bindEngine(
        (msg, fromId) => this.handleNetMessage(msg, fromId),
        (leftId) => {
          const w = this.world;
          if (!w || w.ended) return;
          if (leftId === 'host' && CoopManager.role === 'client') {
            w.bannerText = '与房主断开连接，战局结束';
            w.bannerColor = '#f43f5e';
            w.bannerTimer = 4.0;
            this.finishMatch(false);
            return;
          }
          const left = w.heroes.find((h) => h.id === leftId);
          if (left && CoopManager.role === 'host') {
            const origin = left.takeoverOriginCallsign || left.callsign;
            left.takeoverOriginCallsign = origin;
            left.isBot = true;
            left.vx = 0;
            left.vy = 0;
            left.callsign = `🤖${origin.slice(0, 8)}`;
            const msg = `🤖 ${origin} 暂离，AI 已接管守城（重连即归还）`;
            w.bannerText = msg;
            w.bannerColor = '#38bdf8';
            w.bannerTimer = 3.4;
            CoopManager.broadcastFromHost({
              type: 'evt_fx',
              kind: 'banner',
              text: msg,
              color: '#38bdf8',
              dur: 3.4,
              mSeq: CoopManager.currentMatchSeq,
            });
            this.hostEconDirty = true;
          }
        },
        (member) => this.handlePeerHotJoin(member)
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
    const startGold = 360 + save.talents.startGold * 120 + (opts.difficulty >= 3 ? 120 : 0);
    const spawnOff = HERO_FORMATION_OFFSETS[opts.slot % HERO_FORMATION_OFFSETS.length];
    const spawnPos = resolveWorldCollision(
      'sanctuary',
      HERO_SPAWN_POS.x + spawnOff.x,
      HERO_SPAWN_POS.y + spawnOff.y,
      HERO_COLLISION_RADIUS
    );
    const h: HeroEntity = {
      id: opts.id,
      slot: opts.slot,
      callsign: opts.callsign,
      classId: opts.classId,
      isLocal: opts.isLocal,
      isBot: opts.isBot,
      aiMode: 'guard_base',
      color: def.color,
      x: spawnPos.x,
      y: spawnPos.y,
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
      revives: 0,
      sanctuaryAuraTier: 0,
      gold: startGold,
      crystal: opts.difficulty >= 3 ? 1 : 0,
      stones: 0,
      ankhs: 0,
      potions: { hp: 'pot_hp_s', mp: 'pot_mp', tactical: 'pot_invuln' },
      potionCharges: { hp: 2, mp: 1, tactical: 0 },
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
      skillLevels: [0, 0, 0, 0],
      skillPoints: 1,
      skillCds: [0, 0, 0, 0],
      flashCd: 0,
      recallTimer: 0,
      activeItemCd: 0,
      attackCd: 0,
      attackLockTimer: 0,
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
      comboCount: 0,
      comboTimer: 0,
      comboTier: 0,
      comboPeak: 0,
      prevX: spawnPos.x,
      prevY: spawnPos.y,
      moveSpeedNorm: 0,
      animPhase: opts.slot * 1.1,
      flipVisual: 1,
      castAnim: 0,
      swingDuration: 0.28,
      stepDustTimer: 0,
      afterimages: [],
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
    this.settlementTriggered = false;
    this.world.waveState = 'prep';
    this.world.wavePrepTimer = 22;
    this.world.bannerText = '♾️ 已进入【无尽守卫模式】！每 5 波魔神再临，冲击极限排行榜！';
    this.world.bannerColor = '#c084fc';
    this.world.bannerTimer = 4.5;
    SoundFX.setBgmMode('combat');
    if (CoopManager.isActiveCoop() && CoopManager.role === 'host') {
      CoopManager.broadcastFromHost({
        type: 'evt_continue_endless',
        mSeq: CoopManager.currentMatchSeq,
      });
    }
  }

  public update(dt: number, viewW: number, viewH: number): void {
    const world = this.world;
    if (!world || this.paused || this.landscapePaused || world.ended) return;

    world.elapsedSec += dt;
    if (world.bannerTimer > 0) world.bannerTimer -= dt;

    // Drain latest buffered WebRTC frames once per render tick & interpolate remote entities smoothly
    const isCoop = CoopManager.isActiveCoop();
    const isClient = isCoop && CoopManager.role === 'client';
    if (isCoop) {
      CoopManager.flushCoalescedSnapshots();
      this.interpolateCoopEntities(world, dt, isClient);
    }

    // Sanctuary timers & regen
    if (world.sanctuary.invulnTimer > 0) world.sanctuary.invulnTimer -= dt;
    if (world.sanctuary.invulnCd > 0) world.sanctuary.invulnCd -= dt;
    if (world.sanctuary.autoAegisCd > 0) world.sanctuary.autoAegisCd = Math.max(0, world.sanctuary.autoAegisCd - dt);
    if (world.sanctuary.deathWardCd > 0) world.sanctuary.deathWardCd = Math.max(0, world.sanctuary.deathWardCd - dt);
    if (world.sanctuary.underAttackFlash > 0) world.sanctuary.underAttackFlash -= dt;
    if (!isClient && world.sanctuary.hp > 0) {
      world.sanctuary.hp = Math.min(world.sanctuary.maxHp, world.sanctuary.hp + world.sanctuary.hpRegen * dt);
    }

    // Update heroes cooldowns, buffs, passive aura, recall, revival
    this.updateHeroStates(world, dt, isClient);

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

      if (world.sanctuary.hp <= 0 && !this.settlementTriggered) {
        this.finishMatch(false);
        return;
      }
    } else {
      // Client-side smooth projectile + telegraph motion between snapshots
      for (let i = world.projectiles.length - 1; i >= 0; i--) {
        const p = world.projectiles[i];
        p.life -= dt;
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        if (p.life <= 0) world.projectiles.splice(i, 1);
      }
      for (let i = world.telegraphs.length - 1; i >= 0; i--) {
        const t = world.telegraphs[i];
        t.timer = Math.max(0, t.timer - dt);
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

    this.updateKinematics(world, dt);

    // Adaptive mobile camera zoom & target lock
    this.worldZoom = this.computeWorldZoom(viewW, viewH);
    const worldW = viewW / this.worldZoom;
    const worldH = viewH / this.worldZoom;

    if (local && !local.dead) {
      const lt = this.pickSmartTarget(world, local, Math.max(local.stats.attackRange + 220, 380));
      this.lockedTargetId = lt ? lt.id : null;
    } else {
      this.lockedTargetId = null;
    }

    // Camera smooth follow (spectates living teammate when local hero is down in co-op)
    if (local) {
      let camGoalX = local.x;
      let camGoalY = local.y;
      if (local.dead && isCoop) {
        const aliveMate = world.heroes.find((h) => !h.dead && h.hp > 0);
        if (aliveMate) {
          camGoalX = aliveMate.x;
          camGoalY = aliveMate.y;
        }
      }
      const targetCamX = Math.max(0, Math.min(WORLD_WIDTH - worldW, camGoalX - worldW / 2));
      const targetCamY = Math.max(0, Math.min(WORLD_HEIGHT - worldH, camGoalY - worldH / 2));
      this.camX += (targetCamX - this.camX) * Math.min(1, dt * 10);
      this.camY += (targetCamY - this.camY) * Math.min(1, dt * 10);
    }

    // Dual-rate congestion-aware Co-op sync
    if (isCoop) {
      const directP2P = CoopManager.hasDirectP2P();
      if (isClient && local) {
        this.netClientPosTimer -= dt;
        if (this.netClientPosTimer <= 0 && !CoopManager.isCongested()) {
          this.netClientPosTimer = directP2P ? 0.033 : 0.045;
          this.sendClientPos(local);
        }
      } else if (CoopManager.role === 'host') {
        CoopManager.setHostWaveForDirectory(world.wave);
        this.netWorldSyncTimer -= dt;
        this.netHeroSyncTimer -= dt;
        if (!CoopManager.isCongested()) {
          const wInterval = directP2P ? 0.05 : 0.072;
          const hInterval = directP2P ? 0.033 : 0.045;
          if (this.netWorldSyncTimer <= 0) {
            this.netWorldSyncTimer = wInterval;
            this.netHeroSyncTimer = hInterval;
            this.broadcastWorldSnapshot();
          } else if (this.netHeroSyncTimer <= 0) {
            this.netHeroSyncTimer = hInterval;
            this.broadcastHeroesFast();
          }
        }
      }
    }
  }

  private updateHeroStates(world: GameWorldState, dt: number, isClient = false): void {
    const onKilled = (e: typeof world.enemies[number], k?: HeroEntity) => handleEnemyDeathDrops(world, e, k);

    for (const h of world.heroes) {
      if (h.dead) {
        h.reviveTimer = Math.max(0, h.reviveTimer - dt);
        if (!isClient) {
          // Ally rescue assist
          const helper = world.heroes.find(
            (a) => a.id !== h.id && !a.dead && a.zoneId === h.zoneId && Math.hypot(a.x - h.x, a.y - h.y) <= 85
          );
          if (helper) {
            h.reviveTimer -= dt * 2.5;
          }
          if (h.reviveTimer <= 0) {
            if (helper) helper.revives += 1;
            h.dead = false;
            h.omnislashTimer = 0;
            h.omnislashTicksLeft = 0;
            h.bladestormTimer = 0;
            h.attackLockTimer = 0;
            h.stunTimer = 0;
            h.zoneId = 'sanctuary';
            const revPos = resolveWorldCollision(
              'sanctuary',
              FOUNTAIN_SPAWN_POS.x + (Math.random() - 0.5) * 40,
              FOUNTAIN_SPAWN_POS.y + (Math.random() - 0.5) * 24,
              HERO_COLLISION_RADIUS,
              world.towers,
              false
            );
            h.x = revPos.x;
            h.y = revPos.y;
            h.teleportSeq = (h.teleportSeq || 0) + 1;
            h.hp = h.stats.maxHp;
            h.mp = h.stats.maxMp;
            h.invulnTimer = 2.0;
            this.hostEconDirty = true;
            addFloatingText(world, h.x, h.y - 34, '圣泉复活!', '#4ade80', 15);
          }
        }
        continue;
      }

      for (let i = 0; i < 4; i++) {
        if (h.skillCds[i] > 0) h.skillCds[i] = Math.max(0, h.skillCds[i] - dt);
      }
      if (h.flashCd > 0) h.flashCd = Math.max(0, h.flashCd - dt);
      if (h.activeItemCd > 0) h.activeItemCd = Math.max(0, h.activeItemCd - dt);
      if (h.attackCd > 0) h.attackCd = Math.max(0, h.attackCd - dt);
      if (h.attackLockTimer > 0) h.attackLockTimer = Math.max(0, h.attackLockTimer - dt);
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
      if (h.comboTimer > 0) {
        h.comboTimer -= dt;
        if (h.comboTimer <= 0 && (h.comboCount > 0 || h.comboTier > 0)) {
          h.comboCount = 0;
          h.comboTier = 0;
          recalcHeroStats(h);
        }
      }

      // Host-authoritative auras, regen, recall & multi-tick ults
      if (isClient) {
        if (h.consecrateTimer > 0) h.consecrateTimer = Math.max(0, h.consecrateTimer - dt);
        if (h.bladestormTimer > 0) h.bladestormTimer = Math.max(0, h.bladestormTimer - dt);
        if (h.omnislashTimer > 0) h.omnislashTimer = Math.max(0, h.omnislashTimer - dt);
        if (h.recallTimer > 0) h.recallTimer = Math.max(0, h.recallTimer - dt);
        continue;
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
          const cRank = Math.max(1, h.skillLevels[1] || 0);
          const dmg = (28 + h.level * 13 + h.stats.ap * 0.34 + h.stats.ad * 0.2) * mult * (0.78 + cRank * 0.22);
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
          const bRank = Math.max(1, h.skillLevels[1] || 0);
          const dmg = (34 + h.level * 15 + h.stats.ad * 0.48) * (0.78 + bRank * 0.22);
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

      // Blademaster Omnislash ticks (always drains timer and exits cleanly when out of ticks or targets)
      if (h.omnislashTimer > 0) {
        if (h.omnislashTicksLeft <= 0) {
          h.omnislashTimer = 0;
          h.attackLockTimer = 0;
        } else {
          const prev = Math.floor(h.omnislashTimer * 5.5);
          h.omnislashTimer = Math.max(0, h.omnislashTimer - dt);
          if (Math.floor(h.omnislashTimer * 5.5) !== prev) {
            h.omnislashTicksLeft -= 1;
            const target =
              world.enemies.find(
                (e) =>
                  e.zoneId === h.zoneId &&
                  e.hp > 0 &&
                  Math.hypot(e.x - h.omnislashTargetX, e.y - h.omnislashTargetY) <= 300
              ) ||
              world.enemies.find(
                (e) => e.zoneId === h.zoneId && e.hp > 0 && Math.hypot(e.x - h.x, e.y - h.y) <= 340
              );
            if (target) {
              h.omnislashTargetX = target.x;
              h.omnislashTargetY = target.y;
              const oPos = resolveWorldCollision(
                h.zoneId,
                target.x + (Math.random() - 0.5) * 30,
                target.y + (Math.random() - 0.5) * 30,
                HERO_COLLISION_RADIUS,
                world.towers,
                false
              );
              h.x = oPos.x;
              h.y = oPos.y;
              h.teleportSeq = (h.teleportSeq || 0) + 1;
              const ultDef = getHeroClassDef(h.classId).skills[3];
              const dmg = getScaledSkillDamage(h, ultDef, Math.max(1, h.skillLevels[3] || 0));
              applyDamageToEnemy(world, target, dmg, { attacker: h, forceCrit: true, onEnemyKilled: onKilled });
              world.vfx.push({
                kind: 'slash',
                x: target.x,
                y: target.y,
                angle: Math.random() * Math.PI * 2,
                radius: 95,
                color: '#fb7185',
                life: 0.2,
                maxLife: 0.2,
              });
              if (h.omnislashTicksLeft <= 0) {
                h.omnislashTimer = 0;
                h.attackLockTimer = 0;
              }
            } else {
              h.omnislashTicksLeft = 0;
              h.omnislashTimer = 0;
              h.attackLockTimer = 0;
            }
          }
        }
      }

      // Recall Channeling
      if (h.recallTimer > 0) {
        h.recallTimer -= dt;
        if (h.recallTimer <= 0) {
          h.zoneId = 'sanctuary';
          const rcPos = resolveWorldCollision(
            'sanctuary',
            FOUNTAIN_SPAWN_POS.x,
            FOUNTAIN_SPAWN_POS.y,
            HERO_COLLISION_RADIUS,
            world.towers,
            false
          );
          h.x = rcPos.x;
          h.y = rcPos.y;
          h.teleportSeq = (h.teleportSeq || 0) + 1;
          this.hostEconDirty = true;
          world.vfx.push({ kind: 'teleport', x: h.x, y: h.y, radius: 52, color: '#38bdf8', life: 0.5, maxLife: 0.5 });
          addFloatingText(world, h.x, h.y - 34, '已回城至圣泉', '#38bdf8', 14);
        }
      }
    }
  }

  private updateLocalHeroInput(world: GameWorldState, hero: HeroEntity, dt: number): void {
    if (hero.stunTimer > 0 || hero.omnislashTimer > 0) {
      hero.vx = 0;
      hero.vy = 0;
      return;
    }

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

    const hasMoveInput = Math.hypot(dx, dy) > 0.05;
    const manualAttack = this.input.isAttackPressed();
    hero.vx = 0;
    hero.vy = 0;

    // Strictly plant hero during active attack/cast windup (no run-and-gun sliding)
    if (hero.attackLockTimer > 0) {
      const lockedPos = resolveWorldCollision(hero.zoneId, hero.x, hero.y, HERO_COLLISION_RADIUS, world.towers, false);
      hero.x = lockedPos.x;
      hero.y = lockedPos.y;
      return;
    }

    const resolveAimVector = (target: typeof world.enemies[number] | null) => {
      if (target) {
        const tx = target.x - hero.x;
        const ty = target.y - hero.y;
        const d = Math.hypot(tx, ty) || 1;
        return { ax: tx / d, ay: ty / d };
      }
      if (!this.input.usingTouch && this.input.mouseDown) {
        const mx = this.camX + this.input.mouseScreenX / this.worldZoom - hero.x;
        const my = this.camY + this.input.mouseScreenY / this.worldZoom - hero.y;
        const md = Math.hypot(mx, my) || 1;
        return { ax: mx / md, ay: my / md };
      }
      return { ax: Math.cos(hero.facing), ay: Math.sin(hero.facing) };
    };

    const triggerLocalBasicAttack = (ax: number, ay: number) => {
      hero.recallTimer = 0;
      hero.vx = 0;
      hero.vy = 0;
      hero.attackLockTimer = getHeroAttackLockDuration(hero);
      if (CoopManager.isActiveCoop() && CoopManager.role === 'client') {
        hero.attackCd = 1 / Math.max(0.4, hero.stats.atkSpeed);
        hero.swingAnim = 0.28;
        hero.swingDuration = 0.28;
        hero.facing = Math.atan2(ay, ax);
        CoopManager.sendToHost({
          type: 'cmd_attack',
          ownerId: hero.id,
          dirX: ax,
          dirY: ay,
          mSeq: CoopManager.currentMatchSeq,
        });
      } else {
        const onKilled = (e: typeof world.enemies[number], k?: HeroEntity) => handleEnemyDeathDrops(world, e, k);
        performBasicAttack(world, hero, ax, ay, onKilled);
      }
    };

    // Manual Attack / Hold-Attack Chase (commits to stationary swing when firing)
    if (manualAttack && hero.bladestormTimer <= 0) {
      if (!hasMoveInput && this.input.attackHeld) {
        const inRangeTarget = this.pickSmartTarget(world, hero, hero.stats.attackRange + 28);
        if (!inRangeTarget) {
          const chaseTarget = this.pickSmartTarget(world, hero, Math.max(hero.stats.attackRange + 240, 360));
          if (chaseTarget) {
            const tx = chaseTarget.x - hero.x;
            const ty = chaseTarget.y - hero.y;
            const d = Math.hypot(tx, ty) || 1;
            if (d > hero.stats.attackRange + chaseTarget.radius) {
              hero.recallTimer = 0;
              hero.vx = (tx / d) * hero.stats.moveSpeed * 0.92;
              hero.vy = (ty / d) * hero.stats.moveSpeed * 0.92;
              const nextPos = resolveWorldCollision(
                hero.zoneId,
                hero.x + hero.vx * dt,
                hero.y + hero.vy * dt,
                HERO_COLLISION_RADIUS,
                world.towers,
                false
              );
              hero.x = nextPos.x;
              hero.y = nextPos.y;
              hero.facing = Math.atan2(ty, tx);
              return;
            }
          }
        }
      }
      if (hero.attackCd <= 0) {
        const target = this.pickSmartTarget(world, hero, hero.stats.attackRange + 95);
        const { ax, ay } = resolveAimVector(target);
        triggerLocalBasicAttack(ax, ay);
        const settled = resolveWorldCollision(hero.zoneId, hero.x, hero.y, HERO_COLLISION_RADIUS, world.towers, false);
        hero.x = settled.x;
        hero.y = settled.y;
        return;
      }
    }

    // Movement Phase: moving cancels any auto-attack this frame (no firing while walking)
    if (hasMoveInput) {
      hero.recallTimer = 0;
      const priestAura = world.heroes.some(
        (p) => !p.dead && p.classId === 'priest' && p.zoneId === hero.zoneId && Math.hypot(p.x - hero.x, p.y - hero.y) <= 450
      );
      const spd = hero.stats.moveSpeed * (priestAura ? 1.15 : 1.0);
      hero.vx = dx * spd;
      hero.vy = dy * spd;
      const moved = resolveWorldCollision(
        hero.zoneId,
        hero.x + hero.vx * dt,
        hero.y + hero.vy * dt,
        HERO_COLLISION_RADIUS,
        world.towers,
        false
      );
      hero.x = moved.x;
      hero.y = moved.y;
      if (hero.swingAnim <= 0.08) {
        hero.facing = Math.atan2(dy, dx);
      }
      return;
    }

    // Stationary Auto-Attack Phase (fires ONLY when standing still and unlocked)
    const basePos = resolveWorldCollision(hero.zoneId, hero.x, hero.y, HERO_COLLISION_RADIUS, world.towers, false);
    hero.x = basePos.x;
    hero.y = basePos.y;

    const canAutoAttack = hero.recallTimer <= 0 && hero.stealthTimer <= 0 && hero.bladestormTimer <= 0;
    if (hero.attackCd <= 0 && canAutoAttack) {
      const target = this.pickSmartTarget(world, hero, hero.stats.attackRange + 28);
      if (target) {
        const { ax, ay } = resolveAimVector(target);
        triggerLocalBasicAttack(ax, ay);
      }
    }
  }

  public pickSmartTarget(world: GameWorldState, hero: HeroEntity, maxDist: number) {
    const prio = this.input.targetPriority;
    let best: typeof world.enemies[number] | null = null;
    let bestScore = Infinity;
    let bestBoss: typeof world.enemies[number] | null = null;
    let bestBossDist = Infinity;
    const hZone = hero.zoneId;
    const hx = hero.x;
    const hy = hero.y;

    for (let i = 0; i < world.enemies.length; i++) {
      const e = world.enemies[i];
      if (e.zoneId !== hZone || e.hp <= 0) continue;
      const dx = e.x - hx;
      const dy = e.y - hy;
      const limit = maxDist + e.radius;
      if (Math.abs(dx) > limit || Math.abs(dy) > limit) continue;
      const dist = Math.hypot(dx, dy);
      if (dist > limit) continue;

      if (prio === 'boss' && (e.isBoss || e.isMiniBoss)) {
        if (dist < bestBossDist) {
          bestBossDist = dist;
          bestBoss = e;
        }
      }
      const score = prio === 'low_hp' ? e.hp / e.maxHp : dist;
      if (score < bestScore) {
        bestScore = score;
        best = e;
      }
    }
    return bestBoss || best;
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
      const mx = this.camX + this.input.mouseScreenX / this.worldZoom - hero.x;
      const my = this.camY + this.input.mouseScreenY / this.worldZoom - hero.y;
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

  public handleUpgradeSkillInput(slot: number): boolean {
    if (!this.world || this.paused) return false;
    const local = this.getLocalHero();
    if (!local) return false;
    if (CoopManager.isActiveCoop() && CoopManager.role === 'client') {
      CoopManager.sendToHost({ type: 'cmd_upgrade_skill', ownerId: local.id, slot });
      return true;
    }
    return upgradeHeroSkill(this.world, local, slot);
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
    if (CoopManager.isActiveCoop() && CoopManager.role === 'client') {
      CoopManager.sendToHost({ type: 'cmd_active_item', ownerId: local.id });
      return;
    }
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
    if (CoopManager.isActiveCoop() && CoopManager.role === 'client') {
      CoopManager.sendToHost({ type: 'cmd_swap_slot', ownerId: local.id, fromInv, idxA, toInv, idxB });
    }
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
    if (CoopManager.isActiveCoop() && CoopManager.role === 'client') {
      CoopManager.sendToHost({ type: 'cmd_gift_res', ownerId: local.id, toHeroId, kind, amount });
      return true;
    }
    return giftResourceToAlly(this.world, local, toHeroId, kind, amount);
  }

  public actionGiftItem(toHeroId: string, inInv: boolean, slotIdx: number): boolean {
    if (!this.world) return false;
    const local = this.getLocalHero();
    if (!local) return false;
    if (CoopManager.isActiveCoop() && CoopManager.role === 'client') {
      CoopManager.sendToHost({ type: 'cmd_gift_item', ownerId: local.id, toHeroId, inInv, slotIdx });
      return true;
    }
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
    if (!this.world || this.settlementTriggered) return;
    this.settlementTriggered = true;
    this.world.victory = victory;
    this.world.ended = true;
    this.world.waveState = 'ended';
    if (victory) SoundFX.playVictory();
    else SoundFX.playDefeat();
    SoundFX.setBgmMode('hub');

    const local = this.getLocalHero();
    const squadList: SquadMvpEntry[] = this.world.heroes
      .map((h) => ({
        peerId: h.id,
        callsign: h.callsign,
        classId: h.classId,
        color: h.color,
        kills: h.kills,
        bossKills: h.bossKills,
        damageDealt: Math.round(h.damageDealt),
        comboPeak: h.comboPeak,
        revives: h.revives,
      }))
      .sort(
        (a, b) =>
          b.damageDealt + b.kills * 120 + b.bossKills * 2500 + b.revives * 1200 -
          (a.damageDealt + a.kills * 120 + a.bossKills * 2500 + a.revives * 1200)
      );
    if (CoopManager.role !== 'client' || this.lastSquadStats.length === 0) {
      this.lastSquadStats = squadList;
    }

    if (local) {
      const diff = DIFFICULTIES[this.world.difficulty];
      const honor = Math.max(30, Math.round((this.world.wave * 18 + (victory ? 220 : 0) + local.kills * 0.35) * diff.honorMultiplier));
      this.lastRunHonor = honor;
      const discovered = local.inventory.filter((x): x is string => Boolean(x));
      SaveManager.recordRunResult({
        hero: local.classId,
        difficulty: this.world.difficulty,
        maxWave: this.world.wave,
        victory,
        kills: local.kills,
        honorEarned: honor,
        discoveredItems: discovered,
        defeatedBosses: this.world.defeatedBosses,
      });
    }
    if (CoopManager.isActiveCoop() && CoopManager.role === 'host') {
      CoopManager.markHostMatchEnded();
      this.hostEconDirty = true;
      this.broadcastWorldSnapshot();
      CoopManager.broadcastFromHost({
        type: 'evt_run_finished',
        victory,
        squadStats: this.lastSquadStats,
        defeatedBosses: this.world.defeatedBosses,
        mSeq: CoopManager.currentMatchSeq,
      });
    }
    this.cbs.onShowSettlement(victory);
  }

  public render(viewW: number, viewH: number): void {
    if (!this.world) return;
    const shake = this.world.cameraShake > 0.1 ? this.world.cameraShake : 0;
    const sx = shake > 0 ? (Math.random() - 0.5) * 2 * shake : 0;
    const sy = shake > 0 ? (Math.random() - 0.5) * 2 * shake : 0;
    this.renderer.renderWorld(
      this.ctx,
      this.world,
      this.input,
      this.camX + sx,
      this.camY + sy,
      viewW,
      viewH,
      this.worldZoom,
      this.lockedTargetId
    );
  }

  private updateKinematics(world: GameWorldState, dt: number): void {
    const safeDt = Math.max(0.001, dt);
    const heroSmoothing = Math.min(1, dt * 12);
    const flipSmoothing = Math.min(1, dt * 16);

    for (const h of world.heroes) {
      if (h.dead) {
        h.prevX = h.x;
        h.prevY = h.y;
        h.moveSpeedNorm = 0;
        h.afterimages.length = 0;
        continue;
      }

      let dd = Math.hypot(h.x - h.prevX, h.y - h.prevY);
      if (dd > 500) {
        h.prevX = h.x;
        h.prevY = h.y;
        dd = 0;
      }

      const rawNorm = Math.min(1, dd / safeDt / Math.max(120, h.stats.moveSpeed));
      h.moveSpeedNorm += (rawNorm - h.moveSpeedNorm) * heroSmoothing;
      if (h.attackLockTimer > 0 && dd < 0.5) {
        h.moveSpeedNorm = Math.max(0, h.moveSpeedNorm - dt * 18);
      }
      h.animPhase += dt * (2.6 + h.moveSpeedNorm * 9.8);

      const cosF = Math.cos(h.facing);
      const targetFlip = cosF < -0.08 ? -1 : cosF > 0.08 ? 1 : h.flipVisual >= 0 ? 1 : -1;
      h.flipVisual += (targetFlip - h.flipVisual) * flipSmoothing;

      if (h.castAnim > 0) h.castAnim = Math.max(0, h.castAnim - dt);

      h.stepDustTimer -= dt;
      if (h.moveSpeedNorm > 0.35 && h.stepDustTimer <= 0 && world.vfx.length < 180) {
        h.stepDustTimer = 0.24;
        world.vfx.push({
          kind: 'dust',
          x: h.x - Math.cos(h.facing) * 10 + (Math.random() - 0.5) * 10,
          y: h.y + 8,
          angle: Math.random() * Math.PI * 2,
          radius: 24,
          color: '#d6b47c',
          life: 0.34,
          maxLife: 0.34,
        });
      }

      if ((dd > 26 && dd < 460) || h.bladestormTimer > 0 || h.stealthTimer > 0) {
        if (h.afterimages.length < 10) {
          h.afterimages.push({
            x: h.x,
            y: h.y,
            flip: h.flipVisual >= 0 ? 1 : -1,
            pose: h.bladestormTimer > 0 ? 'attack' : 'walk1',
            alpha: h.stealthTimer > 0 ? 0.28 : 0.42,
            color: h.color,
          });
        }
      }
      for (let i = h.afterimages.length - 1; i >= 0; i--) {
        h.afterimages[i].alpha -= dt * 3.4;
        if (h.afterimages[i].alpha <= 0.03) h.afterimages.splice(i, 1);
      }

      h.prevX = h.x;
      h.prevY = h.y;
    }

    const isClient = CoopManager.isActiveCoop() && CoopManager.role === 'client';
    const enemySmooth = Math.min(1, dt * 10);
    const knockDamp = Math.pow(0.001, dt);
    for (const e of world.enemies) {
      let edd = Math.hypot(e.x - e.prevX, e.y - e.prevY);
      if (edd > 500) {
        e.prevX = e.x;
        e.prevY = e.y;
        edd = 0;
      }
      if (!isClient) {
        e.vx = edd > 0 && edd < 400 ? (e.x - e.prevX) / safeDt : 0;
        e.vy = edd > 0 && edd < 400 ? (e.y - e.prevY) / safeDt : 0;
      }
      const eraw = Math.min(1, edd / safeDt / Math.max(60, e.moveSpeed));
      e.moveSpeedNorm += (eraw - e.moveSpeedNorm) * enemySmooth;
      e.animPhase += dt * (2.2 + e.moveSpeedNorm * 7.8);
      if (e.attackAnim > 0) e.attackAnim = Math.max(0, e.attackAnim - dt);
      e.knockX *= knockDamp;
      e.knockY *= knockDamp;
      e.prevX = e.x;
      e.prevY = e.y;
    }

    if (world.cameraShake > 0) {
      world.cameraShake = Math.max(0, world.cameraShake - dt * 18);
    }
  }

  public renderMinimap(minimapCanvas: HTMLCanvasElement): void {
    if (!this.world) return;
    const mctx = minimapCanvas.getContext('2d');
    if (!mctx) return;
    this.renderer.renderMinimap(mctx, this.world, minimapCanvas.width, minimapCanvas.height);
  }

  // ==================== WebRTC P2P + 云中继 1–4 人平滑同步层 ====================
  private lerpAngle(cur: number, target: number, alpha: number): number {
    let diff = target - cur;
    while (diff > Math.PI) diff -= Math.PI * 2;
    while (diff < -Math.PI) diff += Math.PI * 2;
    return cur + diff * alpha;
  }

  private interpolateCoopEntities(world: GameWorldState, dt: number, isClient: boolean): void {
    const isHost = CoopManager.role === 'host';
    const angLerp = 1 - Math.exp(-20 * dt);

    for (const h of world.heroes) {
      if (h.isLocal || h.dead) continue;
      if (isHost && h.isBot) continue;
      if (h.netTx === undefined || h.netTy === undefined) continue;

      const nvx = h.netVx || 0;
      const nvy = h.netVy || 0;
      const age = h.extrapAge ?? 0;
      if ((nvx !== 0 || nvy !== 0) && age < 0.13) {
        const step = Math.min(dt, 0.13 - age);
        const damp = age <= 0.075 ? 1 : Math.max(0, 1 - (age - 0.075) * 14);
        h.extrapAge = age + step;
        const solvedTx = resolveWorldCollision(
          h.zoneId,
          h.netTx + nvx * damp * step,
          h.netTy + nvy * damp * step,
          HERO_COLLISION_RADIUS,
          world.towers,
          false
        );
        h.netTx = solvedTx.x;
        h.netTy = solvedTx.y;
      }

      const err = Math.hypot(h.netTx - h.x, h.netTy - h.y);
      if (err > 280) {
        const snapPos = resolveWorldCollision(h.zoneId, h.netTx, h.netTy, HERO_COLLISION_RADIUS, world.towers, false);
        h.x = snapPos.x;
        h.y = snapPos.y;
      } else {
        const posLerp = 1 - Math.exp(-(err > 65 ? 24 : 18) * dt);
        const solvedLerp = resolveWorldCollision(
          h.zoneId,
          h.x + (h.netTx - h.x) * posLerp,
          h.y + (h.netTy - h.y) * posLerp,
          HERO_COLLISION_RADIUS,
          world.towers,
          false
        );
        h.x = solvedLerp.x;
        h.y = solvedLerp.y;
      }
      if (h.netAngle !== undefined) {
        h.facing = this.lerpAngle(h.facing, h.netAngle, angLerp);
      }
    }

    if (!isClient) return;

    const eBaseLerp = 1 - Math.exp(-18 * dt);
    const eFastLerp = 1 - Math.exp(-25 * dt);
    for (const e of world.enemies) {
      if (e.netTx === undefined || e.netTy === undefined) continue;
      const evx = e.netVx || 0;
      const evy = e.netVy || 0;
      const age = e.extrapAge ?? 0;
      if ((evx !== 0 || evy !== 0) && age < 0.13 && e.stunTimer <= 0) {
        const step = Math.min(dt, 0.13 - age);
        const damp = age <= 0.075 ? 1 : Math.max(0, 1 - (age - 0.075) * 14);
        e.extrapAge = age + step;
        const zr = ZONES[e.zoneId]?.rect;
        const nx = e.netTx + evx * damp * step;
        const ny = e.netTy + evy * damp * step;
        e.netTx = zr ? Math.max(zr.x + e.radius, Math.min(zr.x + zr.w - e.radius, nx)) : nx;
        e.netTy = zr ? Math.max(zr.y + e.radius, Math.min(zr.y + zr.h - e.radius, ny)) : ny;
      }
      const err = Math.hypot(e.netTx - e.x, e.netTy - e.y);
      if (err > 320) {
        e.x = e.netTx;
        e.y = e.netTy;
      } else {
        const zLerp = err > 65 ? eFastLerp : eBaseLerp;
        e.x += (e.netTx - e.x) * zLerp;
        e.y += (e.netTy - e.y) * zLerp;
      }
      if (e.netFacing !== undefined) {
        e.facing = this.lerpAngle(e.facing, e.netFacing, angLerp);
      }
    }
  }

  private handlePeerHotJoin(member: LobbyMember): void {
    const world = this.world;
    if (!world || CoopManager.role !== 'host' || world.ended) return;

    // Prioritize reclaiming an AI-managed disconnected teammate hero (preserves exact level/items/zone)
    const reclaimTarget =
      world.heroes.find((h) => h.isBot && h.takeoverOriginCallsign === member.callsign) ||
      world.heroes.find((h) => h.isBot && h.slot === member.slot);
    if (reclaimTarget) {
      reclaimTarget.id = member.peerId;
      reclaimTarget.slot = member.slot;
      reclaimTarget.callsign = member.callsign;
      reclaimTarget.classId = member.heroClass;
      reclaimTarget.isBot = false;
      reclaimTarget.takeoverOriginCallsign = undefined;
      reclaimTarget.lastSeq = 0;
      reclaimTarget.invulnTimer = 3.0;
      reclaimTarget.teleportSeq = (reclaimTarget.teleportSeq || 0) + 1;
      recalcHeroStats(reclaimTarget);
      this.hostEconDirty = true;
      const msg = `🔄 ${member.callsign} 重连归队，已取回原英雄控制权！`;
      world.bannerText = msg;
      world.bannerColor = '#4ade80';
      world.bannerTimer = 3.5;
      CoopManager.broadcastFromHost({
        type: 'evt_fx',
        kind: 'banner',
        text: msg,
        color: '#4ade80',
        dur: 3.5,
        mSeq: CoopManager.currentMatchSeq,
      });
      return;
    }

    if (!world.heroes.some((h) => h.id === member.peerId)) {
      const h = this.createHeroEntity({
        id: member.peerId,
        slot: member.slot,
        callsign: member.callsign,
        classId: member.heroClass,
        isLocal: false,
        isBot: false,
        difficulty: world.difficulty,
      });
      const avgLv = Math.max(
        1,
        Math.round(world.heroes.reduce((sum, x) => sum + x.level, 0) / Math.max(1, world.heroes.length))
      );
      const avgGold = Math.round(
        world.heroes.reduce((sum, x) => sum + x.gold, 0) / Math.max(1, world.heroes.length)
      );
      h.level = Math.max(1, avgLv - 1);
      h.nextXp = xpForLevel(h.level);
      h.skillPoints = Math.min(18, h.level);
      h.gold = Math.max(h.gold, Math.round(avgGold * 0.75 + Math.max(0, world.wave - 1) * 140));
      h.crystal = Math.max(h.crystal, Math.floor(world.wave / 4));
      recalcHeroStats(h);
      h.hp = h.stats.maxHp;
      h.mp = h.stats.maxMp;
      h.invulnTimer = 3.5;
      h.teleportSeq = 1;
      world.heroes.push(h);
      world.heroes.sort((a, b) => a.slot - b.slot);
      world.playerCount = world.heroes.length;
      this.hostEconDirty = true;
      const msg = `⚔️ ${member.callsign} 中途空降参战（Lv.${h.level}）！`;
      world.bannerText = msg;
      world.bannerColor = '#38bdf8';
      world.bannerTimer = 3.5;
      CoopManager.broadcastFromHost({
        type: 'evt_fx',
        kind: 'banner',
        text: msg,
        color: '#38bdf8',
        dur: 3.5,
        mSeq: CoopManager.currentMatchSeq,
      });
    }
  }

  private packHeroFast(h: HeroEntity): HeroFastTuple {
    const flags =
      (h.dead ? 1 : 0) |
      (h.recallTimer > 0 ? 2 : 0) |
      (h.swingAnim > 0 || h.castAnim > 0 ? 4 : 0) |
      (h.stealthTimer > 0 ? 8 : 0) |
      (h.bladestormTimer > 0 ? 16 : 0) |
      (h.carryingWater ? 32 : 0) |
      (h.awakeningPrompted ? 64 : 0) |
      (h.exclusiveUnlocked ? 128 : 0);
    return [
      h.id,
      Math.round(h.x),
      Math.round(h.y),
      Math.round(h.vx),
      Math.round(h.vy),
      +h.facing.toFixed(2),
      h.zoneId,
      Math.round(h.hp),
      Math.round(h.stats.maxHp),
      Math.round(h.mp),
      Math.round(h.stats.maxMp),
      Math.round(h.shield),
      flags,
      Math.max(0, Math.round(h.reviveTimer * 10)),
    ];
  }

  private packHeroEcon(h: HeroEntity): HeroEconTuple {
    return [
      h.id,
      h.level,
      Math.round(h.gold),
      h.crystal,
      h.stones,
      h.kills,
      h.teleportSeq || 0,
      h.inventory.slice(),
      h.stash.slice(),
      [
        +h.skillCds[0].toFixed(1),
        +h.skillCds[1].toFixed(1),
        +h.skillCds[2].toFixed(1),
        +h.skillCds[3].toFixed(1),
      ],
      +h.flashCd.toFixed(1),
      [h.potionCharges.hp, h.potionCharges.mp, h.potionCharges.tactical],
      h.awakeningBranchId,
      h.comboCount,
      h.comboTier,
      Math.round(h.stats.moveSpeed),
      h.waterDeliveriesDone,
      h.exclusiveLevel,
      Math.round(h.damageDealt),
      h.revives,
      Math.round(h.xp),
      h.sanctuaryAuraTier,
      [h.skillLevels[0], h.skillLevels[1], h.skillLevels[2], h.skillLevels[3]],
      h.skillPoints,
    ];
  }

  private sendClientPos(local: HeroEntity): void {
    this.netClientPosSeq += 1;
    CoopManager.sendToHost({
      type: 'client_pos',
      seq: this.netClientPosSeq,
      mSeq: CoopManager.currentMatchSeq,
      ownerId: local.id,
      x: Math.round(local.x),
      y: Math.round(local.y),
      vx: Math.round(local.vx),
      vy: Math.round(local.vy),
      facing: +local.facing.toFixed(2),
      tpSeq: this.lastAppliedLocalTpSeq,
    });
  }

  private broadcastHeroesFast(): void {
    if (!this.world || CoopManager.role !== 'host') return;
    this.netHostSeq += 1;
    CoopManager.broadcastFromHost({
      type: 'heroes_fast',
      seq: this.netHostSeq,
      mSeq: CoopManager.currentMatchSeq,
      list: this.world.heroes.map((h) => this.packHeroFast(h)),
    });
  }

  private broadcastWorldSnapshot(): void {
    if (!this.world || CoopManager.role !== 'host') return;
    const w = this.world;
    this.netHostSeq += 1;
    this.econSyncCounter += 1;
    const includeEcon = this.hostEconDirty || this.econSyncCounter % 3 === 0 || w.waveState === 'ended';
    this.hostEconDirty = false;

    const sortedEnemies = w.enemies
      .slice()
      .sort((a, b) => {
        const aPri = (a.isBoss ? 4 : a.affix ? 2 : 0) + (a.zoneId === 'sanctuary' ? 1 : 0);
        const bPri = (b.isBoss ? 4 : b.affix ? 2 : 0) + (b.zoneId === 'sanctuary' ? 1 : 0);
        return bPri - aPri;
      })
      .slice(0, 120);

    const enemyTuples: EnemySnapTuple[] = sortedEnemies.map((e) => {
      const flags =
        (e.hitFlash > 0 ? 1 : 0) |
        (e.stunTimer > 0 ? 2 : 0) |
        (e.slowTimer > 0 ? 4 : 0) |
        (e.burnTimer > 0 ? 8 : 0) |
        (e.bossPhase >= 2 ? 16 : 0);
      const affixCode = e.affix ? Math.max(0, AFFIX_TABLE.indexOf(e.affix)) : 0;
      return [
        e.id,
        e.kind,
        e.zoneId,
        Math.round(e.x),
        Math.round(e.y),
        Math.round(e.vx),
        Math.round(e.vy),
        Math.round(e.hp),
        Math.round(e.maxHp),
        +e.facing.toFixed(2),
        Math.round(e.shield),
        flags,
        affixCode,
      ];
    });

    const projs: ProjSnapTuple[] = w.projectiles.slice(0, 70).map((p) => [
      Math.round(p.x),
      Math.round(p.y),
      Math.round(p.vx),
      Math.round(p.vy),
      Math.round(p.radius),
      (p.isMagic ? 1 : 0) | (p.fromEnemy ? 2 : 0),
      p.color,
      p.zoneId,
    ]);

    const telegraphs: TelegraphSnapTuple[] = w.telegraphs.slice(0, 28).map((t) => [
      t.id,
      Math.max(0, TELEGRAPH_KIND_TABLE.indexOf(t.kind)),
      t.zoneId,
      Math.round(t.x),
      Math.round(t.y),
      Math.round(t.tx ?? t.x),
      Math.round(t.ty ?? t.y),
      Math.round(t.width || t.radius),
      Math.round(t.radius),
      Math.max(0, Math.round(t.timer * 10)),
      Math.max(1, Math.round(t.maxTimer * 10)),
      t.color,
    ]);

    const towers: TowerSnapTuple[] = w.towers.map((t) => [
      t.slotId,
      t.type ? Math.max(0, TOWER_TYPE_TABLE.indexOf(t.type)) : 0,
      t.level,
      +t.facing.toFixed(2),
    ]);

    const drops: DropSnapTuple[] = w.drops.slice(0, 80).map((d): DropSnapTuple =>
      d.itemId
        ? [d.id, d.zoneId, Math.round(d.x), Math.round(d.y), Math.max(0, DROP_KIND_TABLE.indexOf(d.kind)), d.amount, d.itemId]
        : [d.id, d.zoneId, Math.round(d.x), Math.round(d.y), Math.max(0, DROP_KIND_TABLE.indexOf(d.kind)), d.amount]
    );

    const summons: SummonSnapTuple[] = w.summons.slice(0, 20).map((s) => [
      s.id,
      s.ownerId,
      s.kind === 'treant' ? 1 : 0,
      s.zoneId,
      Math.round(s.x),
      Math.round(s.y),
      Math.round(s.hp),
      Math.round(s.maxHp),
      +s.facing.toFixed(2),
      Math.round(s.radius),
    ]);

    let syncBanner: [string, string, number] | undefined;
    if (w.bannerTimer > 0 && w.bannerText) {
      if (w.bannerText !== this.lastSentBannerText) {
        this.lastSentBannerText = w.bannerText;
        syncBanner = [w.bannerText, w.bannerColor, Math.max(10, Math.round(w.bannerTimer * 10))];
      }
    } else if (this.lastSentBannerText) {
      this.lastSentBannerText = '';
    }

    CoopManager.broadcastFromHost({
      type: 'world_snap',
      seq: this.netHostSeq,
      mSeq: CoopManager.currentMatchSeq,
      wave: w.wave,
      prep: Math.round(w.wavePrepTimer),
      waveState: w.waveState,
      endless: w.endlessMode,
      sancHp: Math.round(w.sanctuary.hp),
      sancMaxHp: Math.round(w.sanctuary.maxHp),
      sancLv: w.sanctuary.level,
      sancInvuln: Math.max(0, +w.sanctuary.invulnTimer.toFixed(1)),
      sancUnderAtk: w.sanctuary.underAttackFlash > 0 ? +w.sanctuary.underAttackFlash.toFixed(2) : 0,
      banditCleared: w.quests.banditCleared,
      doubleGoldSec: w.doubleGoldTimer > 0 ? Math.ceil(w.doubleGoldTimer) : 0,
      ...(includeEcon ? { respawns: { ...w.dungeonRespawns } } : {}),
      ...(syncBanner ? { banner: syncBanner } : {}),
      heroes: w.heroes.map((h) => this.packHeroFast(h)),
      ...(includeEcon ? { econs: w.heroes.map((h) => this.packHeroEcon(h)) } : {}),
      summons,
      enemies: enemyTuples,
      projs,
      telegraphs,
      towers,
      drops,
    });
  }

  private applyHeroFastTuple(h: HeroEntity, tup: HeroFastTuple, isClientSelf: boolean): void {
    const [, x, y, vx, vy, facing, zoneId, hp, maxHp, mp, maxMp, shield, flags, revTenths] = tup;
    const wasDead = h.dead;
    const wasWater = h.carryingWater;
    const isDead = Boolean(flags & 1);
    const isRecalling = Boolean(flags & 2);
    const isSwinging = Boolean(flags & 4);
    const isStealth = Boolean(flags & 8);
    const isBladestorm = Boolean(flags & 16);
    const isCarryingWater = Boolean(flags & 32);
    const isAwakeningPrompted = Boolean(flags & 64);
    const isExclusiveUnlocked = Boolean(flags & 128);

    h.hp = hp;
    h.stats.maxHp = maxHp;
    h.mp = mp;
    h.stats.maxMp = maxMp;
    h.shield = shield;
    h.dead = isDead;
    h.reviveTimer = revTenths / 10;
    h.carryingWater = isCarryingWater;
    if (isExclusiveUnlocked) h.exclusiveUnlocked = true;

    if (isClientSelf) {
      if (!isRecalling) h.recallTimer = 0;
      if (isStealth && h.stealthTimer <= 0) h.stealthTimer = 0.25;
      if (isBladestorm && h.bladestormTimer <= 0) h.bladestormTimer = 0.25;
      if (!wasWater && isCarryingWater && this.world) {
        addFloatingText(this.world, h.x, h.y - 40, '接满圣泉之水！沿东路送往祭坛 →', '#38bdf8', 14);
        SoundFX.playHolyChime();
      }
      if (isAwakeningPrompted && !h.awakeningUnlocked) {
        h.awakeningPrompted = true;
      }
      if (h.zoneId !== zoneId || (wasDead && !isDead)) {
        h.zoneId = zoneId;
        h.x = x;
        h.y = y;
      }
      return;
    }

    if (h.zoneId !== zoneId || (wasDead && !isDead)) {
      h.zoneId = zoneId;
      h.x = x;
      h.y = y;
    }
    h.netTx = x;
    h.netTy = y;
    h.netVx = vx;
    h.netVy = vy;
    h.netAngle = facing;
    h.vx = vx;
    h.vy = vy;
    h.extrapAge = 0;
    if (isSwinging && h.swingAnim <= 0) h.swingAnim = 0.2;
    h.recallTimer = isRecalling ? Math.max(h.recallTimer, 0.2) : 0;
    h.stealthTimer = isStealth ? Math.max(h.stealthTimer, 0.25) : 0;
    h.bladestormTimer = isBladestorm ? Math.max(h.bladestormTimer, 0.25) : 0;
  }

  private handleNetMessage(msg: CoopNetMessage, fromId: string): void {
    const world = this.world;
    if (!world) return;
    const curMSeq = CoopManager.currentMatchSeq;
    if ('mSeq' in msg && msg.mSeq && curMSeq > 0 && msg.mSeq !== curMSeq) return;

    const onKilled = (e: EnemyEntity, k?: HeroEntity) => handleEnemyDeathDrops(world, e, k);

    if (msg.type === 'cmd_ping') {
      world.pings.push({ x: msg.x, y: msg.y, color: msg.color, label: msg.label, life: 3.0 });
      SoundFX.playAthenaWarn();
      if (CoopManager.role === 'host' && fromId) {
        CoopManager.broadcastFromHost(msg, fromId);
      }
      return;
    }

    if (CoopManager.role === 'host') {
      if (!('ownerId' in msg)) return;
      const actor = world.heroes.find((h) => h.id === msg.ownerId);
      if (!actor) return;

      if (msg.type === 'client_pos') {
        if (msg.seq && actor.lastSeq && msg.seq < actor.lastSeq) {
          if (actor.lastSeq - msg.seq > 40) actor.lastSeq = 0;
          else return;
        }
        if (msg.seq && actor.lastSeq && msg.seq <= actor.lastSeq) return;
        if (msg.seq) actor.lastSeq = msg.seq;

        // Reject stale position packets sent before a Host teleport / recall / revive / flash!
        if ((msg.tpSeq ?? 0) < (actor.teleportSeq || 0)) return;
        if (actor.dead || actor.omnislashTimer > 0) return;

        const resolvedClientPos = resolveWorldCollision(
          actor.zoneId,
          msg.x,
          msg.y,
          HERO_COLLISION_RADIUS,
          world.towers,
          false
        );
        actor.netTx = resolvedClientPos.x;
        actor.netTy = resolvedClientPos.y;
        actor.netVx = msg.vx;
        actor.netVy = msg.vy;
        actor.vx = msg.vx;
        actor.vy = msg.vy;
        actor.netAngle = msg.facing;
        actor.extrapAge = 0;
        if (msg.vx !== 0 || msg.vy !== 0) actor.recallTimer = 0;
        if (Math.hypot(resolvedClientPos.x - actor.x, resolvedClientPos.y - actor.y) > 260) {
          actor.x = resolvedClientPos.x;
          actor.y = resolvedClientPos.y;
        }
      } else if (msg.type === 'cmd_attack') {
        if (actor.attackCd <= 0 && !actor.dead && actor.stunTimer <= 0 && actor.bladestormTimer <= 0) {
          performBasicAttack(world, actor, msg.dirX, msg.dirY, onKilled);
        }
      } else if (msg.type === 'cmd_skill') {
        castHeroSkill(world, actor, msg.slot, msg.dirX, msg.dirY, msg.distRatio, onKilled);
        this.hostEconDirty = true;
      } else if (msg.type === 'cmd_upgrade_skill') {
        upgradeHeroSkill(world, actor, msg.slot);
        this.hostEconDirty = true;
      } else if (msg.type === 'cmd_flash') {
        castFlashSkill(world, actor, msg.dirX, msg.dirY);
        this.hostEconDirty = true;
      } else if (msg.type === 'cmd_recall') {
        startRecall(world, actor);
      } else if (msg.type === 'cmd_potion') {
        usePotionSlot(world, actor, msg.slot);
        this.hostEconDirty = true;
      } else if (msg.type === 'cmd_active_item') {
        castActiveItemSkill(world, actor, onKilled);
        this.hostEconDirty = true;
      } else if (msg.type === 'cmd_buy') {
        buyItem(world, actor, msg.itemId);
        this.hostEconDirty = true;
      } else if (msg.type === 'cmd_synthesize') {
        synthesizeItem(world, actor, msg.itemId);
        this.hostEconDirty = true;
      } else if (msg.type === 'cmd_upgrade_slot') {
        upgradeItemInSlot(world, actor, msg.inInv, msg.slotIdx);
        this.hostEconDirty = true;
      } else if (msg.type === 'cmd_sell_slot') {
        sellItemInSlot(world, actor, msg.inInv, msg.slotIdx);
        this.hostEconDirty = true;
      } else if (msg.type === 'cmd_swap_slot') {
        swapInvAndStash(actor, msg.fromInv, msg.idxA, msg.toInv, msg.idxB);
        this.hostEconDirty = true;
      } else if (msg.type === 'cmd_teleport') {
        teleportHeroToZone(world, actor, msg.zoneId, msg.tier);
        this.hostEconDirty = true;
      } else if (msg.type === 'cmd_base') {
        if (msg.kind === 'upgrade') upgradeSanctuary(world, actor);
        else if (msg.kind === 'invuln') triggerSanctuaryInvuln(world, actor);
        else if (msg.kind === 'pause_wave') pauseNextWave(world, actor);
        else startWaveEarly(world, actor);
        this.hostEconDirty = true;
      } else if (msg.type === 'cmd_tower') {
        buildOrUpgradeTower(world, actor, msg.slotId, msg.towerType);
        this.hostEconDirty = true;
      } else if (msg.type === 'cmd_awaken') {
        actor.awakeningBranchId = msg.branchId;
        actor.awakeningUnlocked = true;
        recalcHeroStats(actor);
        this.hostEconDirty = true;
      } else if (msg.type === 'cmd_gift_res') {
        giftResourceToAlly(world, actor, msg.toHeroId, msg.kind, msg.amount);
        this.hostEconDirty = true;
      } else if (msg.type === 'cmd_gift_item') {
        giftItemToAlly(world, actor, msg.toHeroId, msg.inInv, msg.slotIdx);
        this.hostEconDirty = true;
      }
      return;
    }

    if (CoopManager.role !== 'client') return;

    if (msg.type === 'evt_fx') {
      if (msg.kind === 'banner' && msg.text) {
        world.bannerText = msg.text;
        world.bannerColor = msg.color || '#fde047';
        world.bannerTimer = msg.dur || 3.2;
      } else if (msg.kind === 'floating' && msg.text && msg.x !== undefined && msg.y !== undefined) {
        addFloatingText(world, msg.x, msg.y, msg.text, msg.color || '#fde047', 14);
      }
      return;
    }

    if (msg.type === 'evt_run_finished') {
      if (msg.squadStats) this.lastSquadStats = msg.squadStats;
      if (msg.defeatedBosses) world.defeatedBosses = msg.defeatedBosses;
      if (!this.settlementTriggered) this.finishMatch(msg.victory);
      return;
    }

    if (msg.type === 'evt_continue_endless') {
      this.continueEndless();
      this.cbs.onCloseSettlement?.();
      return;
    }

    if (msg.type === 'heroes_fast') {
      if (msg.seq < this.lastClientHeroFastSeq) {
        if (this.lastClientHeroFastSeq - msg.seq > 40) this.lastClientHeroFastSeq = 0;
        else return;
      }
      this.lastClientHeroFastSeq = msg.seq;
      for (const ht of msg.list) {
        const h = world.heroes.find((xh) => xh.id === ht[0]);
        if (h) this.applyHeroFastTuple(h, ht, h.isLocal);
      }
      return;
    }

    if (msg.type === 'world_snap') {
      if (msg.seq < this.lastClientWorldSeq) {
        if (this.lastClientWorldSeq - msg.seq > 40) this.lastClientWorldSeq = 0;
        else return;
      }
      this.lastClientWorldSeq = msg.seq;

      world.wave = msg.wave;
      world.wavePrepTimer = msg.prep;
      world.waveState = msg.waveState;
      if (msg.endless !== undefined) world.endlessMode = msg.endless;
      world.sanctuary.hp = msg.sancHp;
      world.sanctuary.maxHp = msg.sancMaxHp;
      world.sanctuary.level = msg.sancLv;
      world.sanctuary.invulnTimer = msg.sancInvuln;
      if (msg.sancUnderAtk !== undefined && msg.sancUnderAtk > 0) {
        world.sanctuary.underAttackFlash = Math.max(world.sanctuary.underAttackFlash, msg.sancUnderAtk);
      }
      if (msg.banditCleared) {
        world.quests.banditCleared = true;
        world.quests.shopDiscount = 0.15;
      }
      if (msg.doubleGoldSec !== undefined) {
        world.doubleGoldTimer = msg.doubleGoldSec;
      }
      if (msg.respawns) {
        world.dungeonRespawns = msg.respawns;
      }
      if (msg.banner) {
        world.bannerText = msg.banner[0];
        world.bannerColor = msg.banner[1];
        world.bannerTimer = msg.banner[2] / 10;
      }
      if ((msg.waveState === 'ended' || msg.sancHp <= 0) && !this.settlementTriggered) {
        this.finishMatch(msg.sancHp > 0);
      }

      // Sync heroes (also dynamically spawn hot-joined heroes if client didn't see them in lobby!)
      const fastMap = new Map<string, HeroFastTuple>();
      for (const ht of msg.heroes) {
        fastMap.set(ht[0], ht);
        let h = world.heroes.find((xh) => xh.id === ht[0]);
        if (!h && CoopManager.lobby) {
          const mem = CoopManager.lobby.members.find((m) => m.peerId === ht[0]);
          if (mem) {
            h = this.createHeroEntity({
              id: mem.peerId,
              slot: mem.slot,
              callsign: mem.callsign,
              classId: mem.heroClass,
              isLocal: mem.peerId === CoopManager.myPeerId,
              isBot: false,
              difficulty: world.difficulty,
            });
            world.heroes.push(h);
            world.heroes.sort((a, b) => a.slot - b.slot);
            world.playerCount = world.heroes.length;
          }
        }
        if (h) this.applyHeroFastTuple(h, ht, h.isLocal);
      }

      if (msg.econs) {
        let localUiChanged = false;
        for (const et of msg.econs) {
          const [id, lv, gold, crystal, stones, kills, tpSeq, inv, stash, cds, flashCd, pots, awakenId, comboC, comboT, moveSpd, waterDone, exLv, dmgDealt, revives, xpVal, auraTier, skillLvs, skillPts] = et;
          const h = world.heroes.find((xh) => xh.id === id);
          if (!h) continue;

          const invChanged =
            h.inventory.some((x, idx) => x !== inv[idx]) || h.stash.some((x, idx) => x !== stash[idx]);
          const skillChanged =
            (skillLvs && h.skillLevels.some((lv0, idx) => lv0 !== skillLvs[idx])) ||
            (skillPts !== undefined && h.skillPoints !== skillPts);
          const statDirty =
            invChanged ||
            h.level !== lv ||
            h.awakeningBranchId !== awakenId ||
            h.sanctuaryAuraTier !== auraTier ||
            h.exclusiveLevel !== exLv;
          if (h.isLocal && (invChanged || skillChanged || h.gold !== gold || h.crystal !== crystal || h.stones !== stones || h.waterDeliveriesDone !== waterDone)) {
            localUiChanged = true;
          }

          h.level = lv;
          h.xp = xpVal;
          h.nextXp = xpForLevel(lv);
          if (skillLvs) h.skillLevels = [skillLvs[0] || 0, skillLvs[1] || 0, skillLvs[2] || 0, skillLvs[3] || 0];
          if (skillPts !== undefined) h.skillPoints = skillPts;
          h.gold = gold;
          h.crystal = crystal;
          h.stones = stones;
          h.kills = kills;
          h.damageDealt = dmgDealt;
          h.revives = revives;
          h.waterDeliveriesDone = waterDone;
          h.exclusiveLevel = exLv;
          h.sanctuaryAuraTier = auraTier;
          h.inventory = inv.slice();
          h.stash = stash.slice();
          h.skillCds = [cds[0], cds[1], cds[2], cds[3]];
          h.flashCd = flashCd;
          h.potionCharges = { hp: pots[0], mp: pots[1], tactical: pots[2] };
          if (awakenId) {
            h.awakeningBranchId = awakenId;
            h.awakeningUnlocked = true;
          }
          h.comboCount = comboC;
          h.comboTier = comboT;
          if (statDirty) {
            const keepHp = h.hp;
            const keepMp = h.mp;
            const keepMaxHp = h.stats.maxHp;
            const keepMaxMp = h.stats.maxMp;
            recalcHeroStats(h);
            h.stats.maxHp = keepMaxHp;
            h.stats.maxMp = keepMaxMp;
            h.hp = Math.min(keepMaxHp, keepHp);
            h.mp = Math.min(keepMaxMp, keepMp);
          }
          h.stats.moveSpeed = moveSpd;

          if (h.isLocal && tpSeq > this.lastAppliedLocalTpSeq) {
            this.lastAppliedLocalTpSeq = tpSeq;
            const ft = fastMap.get(id);
            if (ft) {
              h.x = ft[1];
              h.y = ft[2];
              h.zoneId = ft[6];
            }
          }
        }
        if (localUiChanged) {
          this.cbs.onNetUiRefresh?.();
        }
      }

      if (msg.summons) {
        world.summons = msg.summons.map(([sid, ownerId, kCode, sZone, sx, sy, shp, smaxHp, sFacing, sRad]) => ({
          id: sid,
          ownerId,
          kind: kCode === 1 ? 'treant' : 'illusion',
          name: kCode === 1 ? '自然树人' : '疾风幻象',
          zoneId: sZone,
          x: sx,
          y: sy,
          radius: sRad,
          facing: sFacing,
          hp: shp,
          maxHp: smaxHp,
          ad: 0,
          atkSpeed: 1,
          attackTimer: 0,
          moveSpeed: 300,
          life: 10,
          maxLife: 10,
          color: kCode === 1 ? '#4ade80' : '#f43f5e',
        }));
      }

      // Sync enemies with velocity dead-reckoning & death bursts
      const prevEnemies = this.clientEnemyMap;
      prevEnemies.clear();
      for (const oe of world.enemies) prevEnemies.set(oe.id, oe);

      const incomingEnemyIds = new Set<number>();
      const nextEnemies: EnemyEntity[] = [];
      for (const et of msg.enemies) {
        const [id, kind, zoneId, x, y, vx, vy, hp, maxHp, facing, shield, flags, affixCode] = et;
        incomingEnemyIds.add(id);
        const affix = AFFIX_TABLE[affixCode];
        let e = prevEnemies.get(id);
        if (!e) {
          e = spawnEnemy(world, kind, zoneId, x, y, 1, 1);
          world.enemies.pop();
          e.id = id;
          if (affix) applyEnemyAffix(e, affix);
        }
        e.zoneId = zoneId;
        e.netTx = x;
        e.netTy = y;
        e.netVx = vx;
        e.netVy = vy;
        e.netFacing = facing;
        e.extrapAge = 0;
        if (Math.hypot(x - e.x, y - e.y) > 320) {
          e.x = x;
          e.y = y;
        }
        e.hp = hp;
        e.maxHp = maxHp;
        e.shield = shield;
        e.hitFlash = flags & 1 ? 0.08 : Math.max(0, e.hitFlash);
        e.stunTimer = flags & 2 ? 0.25 : 0;
        e.slowTimer = flags & 4 ? 0.25 : 0;
        e.burnTimer = flags & 8 ? 0.25 : 0;
        e.bossPhase = flags & 16 ? 2 : 1;
        nextEnemies.push(e);
      }

      // Spawn death sparks for eliminated enemies
      for (const [oldId, oldE] of prevEnemies) {
        if (!incomingEnemyIds.has(oldId) && world.vfx.length < 180) {
          world.vfx.push({
            kind: 'hit_spark',
            x: oldE.x,
            y: oldE.y,
            radius: Math.max(28, oldE.radius * 1.4),
            color: oldE.accentColor,
            life: 0.24,
            maxLife: 0.24,
          });
        }
      }
      world.enemies = nextEnemies;

      if (msg.projs) {
        const prevProjs = world.projectiles;
        world.projectiles = msg.projs.map(([px, py, pvx, pvy, pr, pf, pCol, pZone], idx) => {
          const isMagic = Boolean(pf & 1);
          const fromEnemy = Boolean(pf & 2);
          const match = prevProjs.find(
            (op) =>
              op.zoneId === pZone &&
              op.fromEnemy === fromEnemy &&
              Math.abs(op.x - px) < 55 &&
              Math.abs(op.y - py) < 55 &&
              op.vx * pvx + op.vy * pvy > 0
          );
          return {
            id: idx + 1,
            fromEnemy,
            ownerId: fromEnemy ? 'enemy' : 'ally',
            zoneId: pZone,
            x: match ? match.x + (px - match.x) * 0.35 : px,
            y: match ? match.y + (py - match.y) * 0.35 : py,
            vx: pvx,
            vy: pvy,
            radius: pr,
            damage: 0,
            isMagic,
            color: pCol,
            pierceLeft: 0,
            hitIds: [],
            life: 0.45,
          };
        });
      }

      if (msg.telegraphs) {
        world.telegraphs = msg.telegraphs.map(([tid, kCode, zId, tx0, ty0, tx1, ty1, tw, tr, tTenths, mTenths, tCol]) => {
          const kind = TELEGRAPH_KIND_TABLE[kCode] || 'enemy_aoe';
          return {
            id: tid,
            fromEnemy: kind === 'enemy_aoe' || kind === 'enemy_laser' || kind === 'poison_pool',
            ownerId: 'net',
            zoneId: zId,
            kind,
            x: tx0,
            y: ty0,
            tx: tx1,
            ty: ty1,
            width: tw,
            radius: tr,
            timer: tTenths / 10,
            maxTimer: mTenths / 10,
            tickTimer: 0.4,
            damage: 0,
            color: tCol,
          };
        });
      }

      if (msg.towers) {
        for (const [slotId, tCode, lv, facing] of msg.towers) {
          const t = world.towers.find((xt) => xt.slotId === slotId);
          if (t) {
            t.type = TOWER_TYPE_TABLE[tCode] || null;
            t.level = lv;
            t.facing = facing;
          }
        }
      }

      if (msg.drops) {
        const prevDrops = this.clientDropMap;
        prevDrops.clear();
        for (const od of world.drops) prevDrops.set(od.id, od);
        world.drops = msg.drops.map(([did, dZone, dx, dy, kCode, amt, itemId]) => {
          const oldD = prevDrops.get(did);
          const smooth = oldD && Math.hypot(oldD.x - dx, oldD.y - dy) < 96;
          return {
            id: did,
            zoneId: dZone,
            x: smooth ? oldD.x + (dx - oldD.x) * 0.28 : dx,
            y: smooth ? oldD.y + (dy - oldD.y) * 0.28 : dy,
            kind: DROP_KIND_TABLE[kCode] || 'gold',
            amount: amt,
            ...(itemId ? { itemId } : {}),
            life: 25,
          };
        });
      }
    }
  }
}
