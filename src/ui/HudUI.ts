import { getHeroClassDef } from '../data/heroes';
import { getItemDef } from '../data/items';
import { ZONES } from '../data/worldMap';
import { getQuickBuyOptions } from '../engine/EconomySystem';
import { GameEngine } from '../engine/GameEngine';
import { IconAtlas } from '../engine/IconAtlas';
import { CoopManager } from '../net/CoopManager';

export class HudUI {
  private container: HTMLElement | null = null;
  private minimapCanvas: HTMLCanvasElement | null = null;
  private lastQuickHash = '';

  constructor(
    private root: HTMLElement,
    private engine: GameEngine,
    private handlers: {
      onOpenShop: () => void;
      onOpenTeleport: () => void;
      onOpenBase: () => void;
      onOpenPause: () => void;
    }
  ) {}

  public mount(): void {
    this.unmount();
    const div = document.createElement('div');
    div.className = `hud-root ${this.engine.input.usingTouch ? 'is-touch-hud' : ''}`;
    div.innerHTML = `
      <div class="hud-top-bar">
        <div class="hud-left-col">
          <div class="hud-minimap-wrap" id="hud-minimap-btn" title="点击打开快捷传送 / 发信号">
            <canvas id="hud-minimap" width="124" height="124"></canvas>
            <span class="hud-zone-tag" id="hud-zone-tag">中心圣殿广场</span>
          </div>
          <div class="hud-quickbuy-stack">
            <div class="hud-quest-badge" id="hud-quest-badge" style="display:none;"></div>
            <div id="hud-quickbuy-list" style="display:flex;flex-direction:column;gap:5px;"></div>
          </div>
        </div>

        <div class="hud-center-col">
          <div class="hud-wave-pill">
            <span id="hud-wave-txt">准备第 1 波 · 16s</span>
            <button class="war3-btn war3-btn-gold" id="btn-early-wave" style="padding:2px 8px;font-size:10.5px;display:none;">提前出怪</button>
          </div>
          <div class="hud-athena-bar">
            <div class="hud-athena-fill" id="hud-athena-fill" style="width:100%"></div>
            <span class="hud-athena-label" id="hud-athena-txt">雅典娜圣殿 5200/5200</span>
          </div>
          <div class="hud-boss-bar" id="hud-boss-bar" style="display:none;">
            <div class="hud-boss-fill" id="hud-boss-fill" style="width:100%"></div>
            <span class="hud-boss-label" id="hud-boss-txt">Boss</span>
          </div>
        </div>

        <div class="hud-right-col">
          <div class="hud-res-row">
            <span class="res-chip" id="hud-gold">💰 320</span>
            <span class="res-chip" id="hud-crystal" style="color:#86efac;">💎 0木</span>
            <span class="res-chip" id="hud-stones" style="color:#7dd3fc;">🪨 0石</span>
            <button class="war3-btn" id="btn-hud-pause" style="padding:4px 9px;font-size:12px;">⏸</button>
          </div>
          <div class="hud-squad-col" id="hud-squad-col"></div>
          <button class="war3-btn war3-btn-blue" id="btn-bot-mode" style="padding:3px 8px;font-size:10.5px;display:none;">AI: 守卫圣殿</button>
        </div>
      </div>

      <div class="hud-banner" id="hud-banner"></div>

      <!-- 王者荣耀式移动端触控轮盘区 -->
      <div class="hok-wheel-root">
        <div class="hok-cancel-zone" id="hok-cancel-zone">✖ 滑到此处取消施法</div>

        <button class="hok-prio-btn" id="hok-prio-btn" type="button">索敌: 最近</button>
        <button class="hok-atk-btn" id="hok-atk-btn" type="button">普攻</button>

        ${[0, 1, 2, 3]
          .map(
            (s) => `
          <button class="hok-skill-btn hok-s${s}" id="hok-skill-${s}" type="button">
            <img id="hok-skill-img-${s}" src="" alt="" />
            <div class="hok-skill-cd" id="hok-skill-cd-${s}" style="display:none;"></div>
          </button>`
          )
          .join('')}

        <div class="hok-util-strip">
          <button class="hok-mini-btn" id="hok-btn-hp" type="button">
            <img src="${IconAtlas.getDataUrl('item_pot_hp_s')}" alt="" />
            <span>红药</span>
            <span class="hok-mini-badge" id="hok-cnt-hp">3</span>
          </button>
          <button class="hok-mini-btn" id="hok-btn-mp" type="button">
            <img src="${IconAtlas.getDataUrl('item_pot_mp')}" alt="" />
            <span>蓝药</span>
            <span class="hok-mini-badge" id="hok-cnt-mp">2</span>
          </button>
          <button class="hok-mini-btn" id="hok-btn-flash" type="button">
            <img src="${IconAtlas.getDataUrl('act_flash')}" alt="" />
            <span>闪现</span>
          </button>
          <button class="hok-mini-btn" id="hok-btn-recall" type="button">
            <img src="${IconAtlas.getDataUrl('act_recall')}" alt="" />
            <span>回城</span>
          </button>
        </div>

        <div class="hok-left-tools">
          <button class="war3-btn war3-btn-gold" id="hok-btn-shop" style="padding:6px 10px;font-size:12px;">⚒️ 商店</button>
          <button class="war3-btn war3-btn-blue" id="hok-btn-tp" style="padding:6px 10px;font-size:12px;">🌀 传送</button>
          <button class="war3-btn" id="hok-btn-base" style="padding:6px 10px;font-size:12px;">🏰 城防</button>
        </div>
      </div>

      <!-- PC 端魔兽底部控制栏 -->
      <div class="pc-bottom-bar" id="pc-bottom-bar">
        <div class="pc-hero-box">
          <img id="pc-hero-portrait" src="" alt="" />
          <div class="pc-bars">
            <div style="font-size:11px;font-weight:800;color:#fde047;" id="pc-hero-title">Lv.1 英雄</div>
            <div class="pc-bar-track">
              <div id="pc-hp-fill" style="height:100%;background:#22c55e;width:100%;"></div>
              <span class="pc-bar-txt" id="pc-hp-txt">500/500</span>
            </div>
            <div class="pc-bar-track">
              <div id="pc-mp-fill" style="height:100%;background:#38bdf8;width:100%;"></div>
              <span class="pc-bar-txt" id="pc-mp-txt">240/240</span>
            </div>
            <div style="font-size:10px;color:#94a3b8;" id="pc-stats-txt">攻 60 · 法 20 · 甲 10</div>
          </div>
        </div>

        <div class="pc-skills-row">
          ${[0, 1, 2, 3]
            .map(
              (s, idx) => `
            <button class="pc-skill-slot" id="pc-skill-${s}" type="button">
              <img id="pc-skill-img-${s}" src="" alt="" />
              <span class="pc-kbd">${['Q', 'E', 'R', 'F'][idx]}</span>
              <div class="hok-skill-cd" id="pc-skill-cd-${s}" style="display:none;font-size:13px;"></div>
            </button>`
            )
            .join('')}
          <button class="pc-skill-slot" id="pc-btn-hp" type="button" title="生命药水 [1]">
            <img src="${IconAtlas.getDataUrl('item_pot_hp_s')}" alt="" />
            <span class="pc-kbd">1</span>
            <span class="hok-mini-badge" id="pc-cnt-hp" style="top:1px;right:1px;">3</span>
          </button>
          <button class="pc-skill-slot" id="pc-btn-mp" type="button" title="法力药水 [2]">
            <img src="${IconAtlas.getDataUrl('item_pot_mp')}" alt="" />
            <span class="pc-kbd">2</span>
            <span class="hok-mini-badge" id="pc-cnt-mp" style="top:1px;right:1px;">2</span>
          </button>
          <button class="pc-skill-slot" id="pc-btn-flash" type="button" title="闪现 [C]">
            <img src="${IconAtlas.getDataUrl('act_flash')}" alt="" />
            <span class="pc-kbd">C</span>
            <div class="hok-skill-cd" id="pc-flash-cd" style="display:none;font-size:12px;"></div>
          </button>
        </div>

        <div class="pc-inv-grid" id="pc-inv-grid">
          ${[0, 1, 2, 3, 4, 5].map((i) => `<div class="pc-inv-cell" id="pc-inv-${i}"></div>`).join('')}
        </div>

        <div style="display:flex;flex-direction:column;gap:4px;">
          <button class="war3-btn war3-btn-gold" id="pc-btn-shop" style="padding:4px 9px;font-size:11px;">⚒️ 商店 [Tab]</button>
          <div style="display:flex;gap:4px;">
            <button class="war3-btn war3-btn-blue" id="pc-btn-tp" style="padding:4px 7px;font-size:11px;">传送[T]</button>
            <button class="war3-btn" id="pc-btn-base" style="padding:4px 7px;font-size:11px;">城防[G]</button>
            <button class="war3-btn" id="pc-btn-recall" style="padding:4px 7px;font-size:11px;">回城[B]</button>
          </div>
        </div>
      </div>
    `;

    this.root.appendChild(div);
    this.container = div;
    this.minimapCanvas = div.querySelector('#hud-minimap') as HTMLCanvasElement;
    this.bindEvents();
    this.sync();
  }

  public unmount(): void {
    this.container?.remove();
    this.container = null;
    this.minimapCanvas = null;
    this.lastQuickHash = '';
  }

  private bindEvents(): void {
    if (!this.container) return;
    const q = <T extends HTMLElement>(sel: string) => this.container!.querySelector(sel) as T;

    q('#hud-minimap-btn').onclick = () => this.handlers.onOpenTeleport();
    q('#btn-hud-pause').onclick = () => this.handlers.onOpenPause();
    q('#btn-early-wave').onclick = () => this.engine.actionBase('early_wave');
    q('#btn-bot-mode').onclick = () => {
      const next = this.engine.toggleAllBotsMode();
      q('#btn-bot-mode').textContent = next === 'guard_base' ? 'AI: 守卫圣殿' : 'AI: 跟随我';
    };

    // PC Buttons
    for (let s = 0; s < 4; s++) {
      q(`#pc-skill-${s}`).onclick = () => this.engine.handleCastSkillInput(s);
    }
    q('#pc-btn-hp').onclick = () => this.engine.handleUsePotionInput('hp');
    q('#pc-btn-mp').onclick = () => this.engine.handleUsePotionInput('mp');
    q('#pc-btn-flash').onclick = () => this.engine.handleFlashInput();
    q('#pc-btn-shop').onclick = () => this.handlers.onOpenShop();
    q('#pc-btn-tp').onclick = () => this.handlers.onOpenTeleport();
    q('#pc-btn-base').onclick = () => this.handlers.onOpenBase();
    q('#pc-btn-recall').onclick = () => this.engine.handleRecallInput();

    // Touch Honor-of-Kings Controls
    const atkBtn = q('#hok-atk-btn');
    atkBtn.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      this.engine.input.attackHeld = true;
    });
    const endAtk = () => {
      this.engine.input.attackHeld = false;
    };
    atkBtn.addEventListener('pointerup', endAtk);
    atkBtn.addEventListener('pointercancel', endAtk);

    q('#hok-prio-btn').onclick = () => {
      const p = this.engine.input.cycleTargetPriority();
      q('#hok-prio-btn').textContent = `索敌: ${p === 'boss' ? 'Boss' : p === 'low_hp' ? '残血' : '最近'}`;
    };

    q('#hok-btn-hp').onclick = () => this.engine.handleUsePotionInput('hp');
    q('#hok-btn-mp').onclick = () => this.engine.handleUsePotionInput('mp');
    q('#hok-btn-flash').onclick = () => this.engine.handleFlashInput();
    q('#hok-btn-recall').onclick = () => this.engine.handleRecallInput();
    q('#hok-btn-shop').onclick = () => this.handlers.onOpenShop();
    q('#hok-btn-tp').onclick = () => this.handlers.onOpenTeleport();
    q('#hok-btn-base').onclick = () => this.handlers.onOpenBase();

    // Wheel-casting drag gesture on all 4 skill buttons
    const cancelZone = q('#hok-cancel-zone');
    for (let s = 0; s < 4; s++) {
      const btn = q(`#hok-skill-${s}`);
      btn.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        btn.setPointerCapture(e.pointerId);
        const local = this.engine.getLocalHero();
        const fx = local ? Math.cos(local.facing) : 1;
        const fy = local ? Math.sin(local.facing) : 0;
        this.engine.input.aimingSkill = {
          slot: s,
          pointerId: e.pointerId,
          startX: e.clientX,
          startY: e.clientY,
          curX: e.clientX,
          curY: e.clientY,
          dx: fx,
          dy: fy,
          distRatio: 0.65,
          cancelled: false,
        };
        cancelZone.classList.add('visible');
      });

      btn.addEventListener('pointermove', (e) => {
        const aim = this.engine.input.aimingSkill;
        if (!aim || aim.pointerId !== e.pointerId) return;
        const vx = e.clientX - aim.startX;
        const vy = e.clientY - aim.startY;
        const dist = Math.hypot(vx, vy);
        if (dist > 8) {
          aim.dx = vx / dist;
          aim.dy = vy / dist;
          aim.distRatio = Math.min(1, dist / 65);
        }
        const rect = cancelZone.getBoundingClientRect();
        const inCancel =
          e.clientX >= rect.left - 18 &&
          e.clientX <= rect.right + 18 &&
          e.clientY >= rect.top - 18 &&
          e.clientY <= rect.bottom + 18;
        aim.cancelled = inCancel;
        cancelZone.classList.toggle('hovered', inCancel);
      });

      const release = (e: PointerEvent) => {
        const aim = this.engine.input.aimingSkill;
        if (!aim || aim.pointerId !== e.pointerId) return;
        this.engine.input.aimingSkill = null;
        cancelZone.classList.remove('visible', 'hovered');
        if (!aim.cancelled) {
          const dragDist = Math.hypot(e.clientX - aim.startX, e.clientY - aim.startY);
          if (dragDist < 12) {
            this.engine.handleCastSkillInput(s);
          } else {
            this.engine.handleCastSkillInput(s, aim.dx, aim.dy, aim.distRatio);
          }
        }
      };
      btn.addEventListener('pointerup', release);
      btn.addEventListener('pointercancel', release);
    }
  }

  public sync(): void {
    const world = this.engine.world;
    if (!this.container || !world) return;
    const local = this.engine.getLocalHero();
    if (!local) return;

    this.container.classList.toggle('is-touch-hud', this.engine.input.usingTouch);

    if (this.minimapCanvas) {
      this.engine.renderMinimap(this.minimapCanvas);
    }

    const q = <T extends HTMLElement>(sel: string) => this.container!.querySelector(sel) as T;

    // Zone tag
    q('#hud-zone-tag').textContent = ZONES[local.zoneId]?.name || '圣殿';

    // Wave & Sanctuary
    const waveTxt =
      world.waveState === 'prep'
        ? `准备第 ${world.wave + 1}${world.endlessMode ? ' (无尽)' : '/20'} 波 · ${Math.ceil(world.wavePrepTimer)}s`
        : `${world.endlessMode ? '无尽 ' : ''}第 ${world.wave}${world.endlessMode ? '' : '/20'} 波 · 战斗中`;
    q('#hud-wave-txt').textContent = waveTxt;
    q('#btn-early-wave').style.display = world.waveState === 'prep' && CoopManager.role !== 'client' ? 'inline-block' : 'none';

    const sancRatio = Math.max(0, Math.min(1, world.sanctuary.hp / Math.max(1, world.sanctuary.maxHp)));
    q('#hud-athena-fill').style.width = `${(sancRatio * 100).toFixed(1)}%`;
    q('#hud-athena-txt').textContent = `圣殿 Lv.${world.sanctuary.level} · ${Math.round(world.sanctuary.hp)}/${Math.round(world.sanctuary.maxHp)}${world.sanctuary.invulnTimer > 0 ? ' [无敌中]' : ''}`;

    // Active Boss Bar
    const activeBoss =
      world.enemies.find((e) => e.isBoss && e.hp > 0 && e.zoneId === local.zoneId) ||
      world.enemies.find((e) => e.isBoss && e.hp > 0 && e.zoneId === 'sanctuary');
    const bossBar = q('#hud-boss-bar');
    if (activeBoss) {
      bossBar.style.display = 'block';
      q('#hud-boss-fill').style.width = `${Math.max(0, (activeBoss.hp / activeBoss.maxHp) * 100).toFixed(1)}%`;
      q('#hud-boss-txt').textContent = `👑 ${activeBoss.name} · ${Math.round(activeBoss.hp)}/${Math.round(activeBoss.maxHp)}`;
    } else {
      bossBar.style.display = 'none';
    }

    // Resources
    q('#hud-gold').textContent = `💰 ${Math.round(local.gold)}`;
    q('#hud-crystal').textContent = `💎 ${local.crystal}木`;
    q('#hud-stones').textContent = `🪨 ${local.stones}石`;

    // Squad HP & AI button
    const hasBots = world.heroes.some((h) => h.isBot);
    q('#btn-bot-mode').style.display = hasBots ? 'block' : 'none';
    const allies = world.heroes.filter((h) => !h.isLocal);
    q('#hud-squad-col').innerHTML = allies
      .map(
        (a) => `
        <div class="squad-mini-card">
          <span style="color:${a.color};font-weight:800;">${a.callsign.slice(0, 12)}</span>
          <div class="squad-hp-track"><div class="squad-hp-fill" style="width:${a.dead ? 0 : Math.round((a.hp / a.stats.maxHp) * 100)}%"></div></div>
        </div>`
      )
      .join('');

    // Banner
    const banner = q('#hud-banner');
    if (world.bannerTimer > 0 && world.bannerText) {
      banner.style.display = 'block';
      banner.textContent = world.bannerText;
      banner.style.color = world.bannerColor;
    } else {
      banner.style.display = 'none';
    }

    // Quest badge
    const questEl = q('#hud-quest-badge');
    if (local.carryingWater) {
      questEl.style.display = 'block';
      questEl.textContent = '💧 正在护送圣泉之水 → 前往最右侧祭坛!';
    } else if (world.quests.banditCleared) {
      questEl.style.display = 'block';
      questEl.textContent = '🏴‍☠️ 盗贼营地已清剿 · 全队商店 85 折';
    } else {
      questEl.style.display = 'none';
    }

    // Quick-buy Suggestions (Honor of Kings left popup)
    const quicks = getQuickBuyOptions(world, local);
    const qHash = quicks.map((x) => `${x.kind}:${x.itemId}`).join('|');
    if (qHash !== this.lastQuickHash) {
      this.lastQuickHash = qHash;
      const listEl = q('#hud-quickbuy-list');
      listEl.innerHTML = quicks
        .map((qb, i) => {
          const def = getItemDef(qb.itemId);
          return `
            <button class="quickbuy-btn" data-qb-idx="${i}" type="button">
              <img src="${IconAtlas.getDataUrl(def?.iconKey || 'item_wep_t1')}" alt="" />
              <div style="text-align:left;">
                <div style="font-size:12px;font-weight:800;color:#fde047;">${qb.label}</div>
                <div style="font-size:10px;color:#cbd5e1;">${qb.subLabel}</div>
              </div>
            </button>
          `;
        })
        .join('');
      listEl.querySelectorAll('[data-qb-idx]').forEach((btn) => {
        (btn as HTMLElement).onclick = () => {
          const idx = Number((btn as HTMLElement).dataset.qbIdx);
          const pick = getQuickBuyOptions(world, local)[idx];
          if (!pick) return;
          if (pick.kind === 'synth') this.engine.actionSynthesize(pick.itemId);
          else if (pick.kind === 'upgrade' && pick.slotIdx !== undefined) this.engine.actionUpgradeSlot(true, pick.slotIdx);
          else this.engine.actionBuy(pick.itemId);
          this.lastQuickHash = '';
          this.sync();
        };
      });
    }

    // Hero portrait, bars, skills & inventory
    const def = getHeroClassDef(local.classId);
    q<HTMLImageElement>('#pc-hero-portrait').src = IconAtlas.getDataUrl(`hero_${local.classId}`);
    q('#pc-hero-title').textContent = `Lv.${local.level} ${def.name}${local.awakeningUnlocked ? ' ★觉醒' : ''}`;
    q('#pc-hp-fill').style.width = `${Math.max(0, (local.hp / local.stats.maxHp) * 100).toFixed(1)}%`;
    q('#pc-hp-txt').textContent = `${Math.round(local.hp)}/${Math.round(local.stats.maxHp)}`;
    q('#pc-mp-fill').style.width = `${Math.max(0, (local.mp / Math.max(1, local.stats.maxMp)) * 100).toFixed(1)}%`;
    q('#pc-mp-txt').textContent = `${Math.round(local.mp)}/${Math.round(local.stats.maxMp)}`;
    q('#pc-stats-txt').textContent = `攻 ${Math.round(local.stats.ad)} · 法 ${Math.round(local.stats.ap)} · 甲 ${Math.round(local.stats.armor)} · 暴 ${Math.round(local.stats.critChance * 100)}%`;

    for (let s = 0; s < 4; s++) {
      const sk = def.skills[s];
      const iconUrl = IconAtlas.getDataUrl(sk.iconKey);
      q<HTMLImageElement>(`#pc-skill-img-${s}`).src = iconUrl;
      q<HTMLImageElement>(`#hok-skill-img-${s}`).src = iconUrl;

      const cd = local.skillCds[s];
      const locked = Boolean(sk.unlockLevel && local.level < sk.unlockLevel);
      const text = locked ? `Lv${sk.unlockLevel}` : cd > 0 ? `${Math.ceil(cd)}` : '';
      const pcCd = q(`#pc-skill-cd-${s}`);
      const hokCd = q(`#hok-skill-cd-${s}`);
      pcCd.style.display = text ? 'flex' : 'none';
      pcCd.textContent = text;
      hokCd.style.display = text ? 'flex' : 'none';
      hokCd.textContent = text;
    }

    q('#pc-cnt-hp').textContent = `${local.potionCharges.hp}`;
    q('#pc-cnt-mp').textContent = `${local.potionCharges.mp}`;
    q('#hok-cnt-hp').textContent = `${local.potionCharges.hp}`;
    q('#hok-cnt-mp').textContent = `${local.potionCharges.mp}`;

    const flashCd = q('#pc-flash-cd');
    flashCd.style.display = local.flashCd > 0 ? 'flex' : 'none';
    flashCd.textContent = `${Math.ceil(local.flashCd)}`;

    for (let i = 0; i < 6; i++) {
      const cell = q(`#pc-inv-${i}`);
      const itemId = local.inventory[i];
      const itemDef = itemId ? getItemDef(itemId) : null;
      cell.innerHTML = itemDef ? `<img src="${IconAtlas.getDataUrl(itemDef.iconKey)}" title="${itemDef.name}: ${itemDef.desc}" />` : '';
    }
  }
}
