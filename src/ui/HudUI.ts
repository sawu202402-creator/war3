import { getHeroClassDef } from '../data/heroes';
import { RARITY_META, getItemDef } from '../data/items';
import { ZONES } from '../data/worldMap';
import { getQuickBuyOptions } from '../engine/EconomySystem';
import { GameEngine } from '../engine/GameEngine';
import { IconAtlas } from '../engine/IconAtlas';
import { CoopManager } from '../net/CoopManager';

export class HudUI {
  private container: HTMLElement | null = null;
  private minimapCanvas: HTMLCanvasElement | null = null;
  private lastQuickHash = '';
  private lastSquadHash = '';
  private lastInvHash = '';
  private lastHeroClass = '';

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
          <div class="hud-left-top-row">
            <div class="hud-minimap-wrap war3-stone-panel" id="hud-minimap-btn" title="点击打开快捷传送 / 发信号">
              <canvas id="hud-minimap" width="124" height="124"></canvas>
              <span class="hud-zone-tag" id="hud-zone-tag">中心圣殿广场</span>
            </div>

            <!-- 手机端左上角英雄属性与快捷装备胶囊 -->
            <button class="hok-hero-pill war3-stone-panel" id="hok-hero-pill" type="button" title="点击打开商店与背包">
              <div class="hok-pill-ava-wrap">
                <img id="hok-hero-portrait" src="" alt="" />
                <span class="hok-pill-lv" id="hok-hero-lv">1</span>
              </div>
              <div class="hok-pill-info">
                <div class="hok-pill-name" id="hok-hero-name">圣殿骑士</div>
                <div class="hok-pill-bar hp"><div id="hok-hp-fill" style="width:100%"></div><span id="hok-hp-txt">500</span></div>
                <div class="hok-pill-bar mp"><div id="hok-mp-fill" style="width:100%"></div></div>
                <div class="hok-pill-bar xp"><div id="hok-xp-fill" style="width:0%"></div></div>
                <div class="hok-mini-inv" id="hok-inv-grid">
                  ${[0, 1, 2, 3, 4, 5].map((i) => `<span class="hok-inv-dot" id="hok-inv-${i}"></span>`).join('')}
                </div>
              </div>
            </button>
          </div>

          <div class="hud-quickbuy-stack">
            <div class="hud-quest-badge" id="hud-quest-badge" style="display:none;"></div>
            <div id="hud-quickbuy-list" style="display:flex;flex-direction:column;gap:5px;"></div>
          </div>
        </div>

        <div class="hud-center-col">
          <div class="hud-wave-pill war3-stone-panel">
            <span id="hud-wave-txt">准备第 1 波 · 16s</span>
            <button class="war3-btn war3-btn-gold" id="btn-early-wave" style="padding:2px 9px;font-size:10.5px;display:none;">提前出怪</button>
          </div>
          <div class="hud-athena-bar">
            <div class="hud-athena-fill" id="hud-athena-fill" style="width:100%"></div>
            <span class="hud-athena-label" id="hud-athena-txt">雅典娜圣殿 5200/5200</span>
          </div>
          <div class="hud-boss-bar" id="hud-boss-bar" style="display:none;">
            <div class="hud-boss-fill" id="hud-boss-fill" style="width:100%"></div>
            <span class="hud-boss-label" id="hud-boss-txt">
              <img class="boss-bar-ico" src="${IconAtlas.getDataUrl('ui_ico_kill')}" alt="" />
              <span id="hud-boss-txt-span">Boss</span>
            </span>
          </div>
          <div class="hud-banner war3-stone-panel" id="hud-banner"></div>
        </div>

        <div class="hud-right-col">
          <div class="hud-res-row">
            <span class="res-chip war3-stone-panel">
              <img src="${IconAtlas.getDataUrl('ui_ico_gold')}" alt="" />
              <span id="hud-gold">320</span>
            </span>
            <span class="res-chip war3-stone-panel" style="color:#86efac;">
              <img src="${IconAtlas.getDataUrl('ui_ico_crystal')}" alt="" />
              <span id="hud-crystal">0木</span>
            </span>
            <span class="res-chip war3-stone-panel" style="color:#7dd3fc;">
              <img src="${IconAtlas.getDataUrl('ui_ico_stone')}" alt="" />
              <span id="hud-stones">0石</span>
            </span>
            <button class="war3-btn war3-btn-gold" id="btn-hud-pause" style="padding:4px 9px;font-size:12px;" title="暂停菜单">⏸</button>
          </div>
          <div class="hud-squad-col" id="hud-squad-col"></div>
          <button class="war3-btn war3-btn-blue" id="btn-bot-mode" style="padding:3px 8px;font-size:10.5px;display:none;">AI: 守卫圣殿</button>
        </div>
      </div>

      <!-- 王者荣耀式移动端触控轮盘区 -->
      <div class="hok-wheel-root">
        <div class="hok-move-stick" id="hok-move-stick">
          <img class="hok-stick-ring" src="${IconAtlas.getDataUrl('fx_aura_paladin')}" alt="" />
          <div class="hok-stick-knob" id="hok-stick-knob"></div>
        </div>

        <div class="hok-cancel-zone" id="hok-cancel-zone">滑到此处取消施法</div>

        <button class="hok-prio-btn" id="hok-prio-btn" type="button">索敌: 最近</button>
        <button class="hok-atk-btn" id="hok-atk-btn" type="button" title="普攻已开启自动索敌；点按或长按可手动追击敌人">
          <img src="${IconAtlas.getDataUrl('ui_ico_battle')}" alt="" />
          <span>普攻</span>
          <span class="hok-atk-auto-tag">自动</span>
        </button>

        ${[0, 1, 2, 3]
          .map(
            (s) => `
          <button class="hok-skill-btn hok-s${s}" id="hok-skill-${s}" type="button">
            <img id="hok-skill-img-${s}" src="" alt="" />
            <div class="hok-skill-cd" id="hok-skill-cd-${s}" style="display:none;--cd-pct:0%;"></div>
          </button>`
          )
          .join('')}

        <button class="hok-flash-btn" id="hok-btn-flash" type="button" title="闪现（点按或拖动定向）">
          <img src="${IconAtlas.getDataUrl('act_flash')}" alt="" />
          <span class="hok-flash-tag">闪现</span>
          <div class="hok-skill-cd" id="hok-flash-cd" style="display:none;--cd-pct:0%;"></div>
        </button>

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
          <button class="hok-mini-btn" id="hok-btn-recall" type="button">
            <img src="${IconAtlas.getDataUrl('act_recall')}" alt="" />
            <span>回城</span>
          </button>
          <button class="hok-mini-btn hok-item-act-btn" id="hok-btn-item" type="button" style="display:none;">
            <img id="hok-item-img" src="" alt="" />
            <span>法宝</span>
            <div class="hok-skill-cd" id="hok-item-cd" style="display:none;--cd-pct:0%;font-size:11px;"></div>
          </button>
        </div>

        <div class="hok-mid-tools" id="hok-mid-tools">
          <button class="war3-btn war3-btn-gold hok-tool-btn" id="hok-btn-shop" type="button">
            <img src="${IconAtlas.getDataUrl('ui_ico_shop')}" alt="" /><span>商店</span>
          </button>
          <button class="war3-btn war3-btn-blue hok-tool-btn" id="hok-btn-tp" type="button">
            <img src="${IconAtlas.getDataUrl('ui_ico_teleport')}" alt="" /><span>传送</span>
          </button>
          <button class="war3-btn hok-tool-btn" id="hok-btn-base" type="button">
            <img src="${IconAtlas.getDataUrl('ui_ico_fortress')}" alt="" /><span>城防</span>
          </button>
          <button class="war3-btn hok-tool-btn" id="hok-btn-ping" type="button">
            <img src="${IconAtlas.getDataUrl('ui_ico_coop')}" alt="" /><span>信号</span>
          </button>
        </div>
      </div>

      <!-- PC 端魔兽雕纹底部控制台 -->
      <div class="pc-bottom-bar war3-stone-panel" id="pc-bottom-bar">
        <div class="pc-hero-box">
          <div class="pc-portrait-frame">
            <img id="pc-hero-portrait" src="" alt="" />
            <span class="pc-lv-badge" id="pc-hero-lv-badge">1</span>
          </div>
          <div class="pc-bars">
            <div class="pc-hero-title" id="pc-hero-title">圣殿骑士</div>
            <div class="pc-bar-track">
              <div class="pc-hp-fill" id="pc-hp-fill" style="width:100%;"></div>
              <span class="pc-bar-txt" id="pc-hp-txt">500/500</span>
            </div>
            <div class="pc-bar-track">
              <div class="pc-mp-fill" id="pc-mp-fill" style="width:100%;"></div>
              <span class="pc-bar-txt" id="pc-mp-txt">240/240</span>
            </div>
            <div class="pc-xp-track" title="英雄经验进度">
              <div class="pc-xp-fill" id="pc-xp-fill" style="width:0%;"></div>
            </div>
            <div class="pc-stats-txt" id="pc-stats-txt">攻 60 · 法 20 · 甲 10 · 暴 8%</div>
          </div>
        </div>

        <div class="pc-skills-row">
          ${[0, 1, 2, 3]
            .map(
              (s, idx) => `
            <button class="pc-skill-slot" id="pc-skill-${s}" type="button">
              <img id="pc-skill-img-${s}" src="" alt="" />
              <span class="pc-kbd">${['Q', 'E', 'R', 'F'][idx]}</span>
              <div class="hok-skill-cd" id="pc-skill-cd-${s}" style="display:none;--cd-pct:0%;font-size:13px;"></div>
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
            <div class="hok-skill-cd" id="pc-flash-cd" style="display:none;--cd-pct:0%;font-size:12px;"></div>
          </button>
        </div>

        <div class="pc-inv-grid" id="pc-inv-grid">
          ${[0, 1, 2, 3, 4, 5].map((i) => `<div class="pc-inv-cell" id="pc-inv-${i}"></div>`).join('')}
        </div>

        <div class="pc-action-stack">
          <button class="war3-btn war3-btn-gold pc-act-btn-main" id="pc-btn-shop" type="button">
            <img src="${IconAtlas.getDataUrl('ui_ico_shop')}" alt="" />
            <span>商店 [Tab]</span>
          </button>
          <div class="pc-act-subrow">
            <button class="war3-btn war3-btn-blue pc-act-btn" id="pc-btn-tp" type="button">
              <img src="${IconAtlas.getDataUrl('ui_ico_teleport')}" alt="" />
              <span>传送[T]</span>
            </button>
            <button class="war3-btn pc-act-btn" id="pc-btn-base" type="button">
              <img src="${IconAtlas.getDataUrl('ui_ico_fortress')}" alt="" />
              <span>城防[G]</span>
            </button>
            <button class="war3-btn pc-act-btn" id="pc-btn-recall" type="button">
              <img src="${IconAtlas.getDataUrl('act_recall')}" alt="" />
              <span>回城[B]</span>
            </button>
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
    this.lastSquadHash = '';
    this.lastInvHash = '';
    this.lastHeroClass = '';
  }

  private bindDragAimButton(
    btn: HTMLElement,
    slot: number,
    onTap: () => void,
    onAimRelease: (dx: number, dy: number, distRatio: number) => void
  ): void {
    const cancelZone = this.container!.querySelector('#hok-cancel-zone') as HTMLElement;
    btn.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      try {
        btn.setPointerCapture(e.pointerId);
      } catch {
        // ignore
      }
      const local = this.engine.getLocalHero();
      const fx = local ? Math.cos(local.facing) : 1;
      const fy = local ? Math.sin(local.facing) : 0;
      this.engine.input.aimingSkill = {
        slot,
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
      btn.classList.add('is-aiming');
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
      btn.classList.remove('is-aiming');
      cancelZone.classList.remove('visible', 'hovered');
      if (!aim.cancelled) {
        const dragDist = Math.hypot(e.clientX - aim.startX, e.clientY - aim.startY);
        if (dragDist < 12) onTap();
        else onAimRelease(aim.dx, aim.dy, aim.distRatio);
      }
    };
    btn.addEventListener('pointerup', release);
    btn.addEventListener('pointercancel', release);
  }

  private bindEvents(): void {
    if (!this.container) return;
    const q = <T extends HTMLElement>(sel: string) => this.container!.querySelector(sel) as T;

    q('#hud-minimap-btn').onclick = () => this.handlers.onOpenTeleport();
    q('#hok-hero-pill').onclick = () => this.handlers.onOpenShop();
    q('#btn-hud-pause').onclick = () => this.handlers.onOpenPause();
    q('#btn-early-wave').onclick = () => this.engine.actionBase('early_wave');
    q('#btn-bot-mode').onclick = () => {
      const next = this.engine.toggleAllBotsMode();
      q('#btn-bot-mode').textContent = next === 'guard_base' ? 'AI: 守卫圣殿' : 'AI: 跟随我';
    };

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
      atkBtn.classList.add('is-pressed');
    });
    const endAtk = () => {
      this.engine.input.attackHeld = false;
      atkBtn.classList.remove('is-pressed');
    };
    atkBtn.addEventListener('pointerup', endAtk);
    atkBtn.addEventListener('pointercancel', endAtk);

    q('#hok-prio-btn').onclick = () => {
      const p = this.engine.input.cycleTargetPriority();
      q('#hok-prio-btn').textContent = `索敌: ${p === 'boss' ? 'Boss' : p === 'low_hp' ? '残血' : '最近'}`;
    };

    q('#hok-btn-hp').onclick = () => this.engine.handleUsePotionInput('hp');
    q('#hok-btn-mp').onclick = () => this.engine.handleUsePotionInput('mp');
    q('#hok-btn-recall').onclick = () => this.engine.handleRecallInput();
    q('#hok-btn-item').onclick = () => this.engine.handleActiveItemInput();
    q('#hok-btn-shop').onclick = () => this.handlers.onOpenShop();
    q('#hok-btn-tp').onclick = () => this.handlers.onOpenTeleport();
    q('#hok-btn-base').onclick = () => this.handlers.onOpenBase();
    q('#hok-btn-ping').onclick = () => this.engine.handleSendPing();

    for (let s = 0; s < 4; s++) {
      this.bindDragAimButton(
        q(`#hok-skill-${s}`),
        s,
        () => this.engine.handleCastSkillInput(s),
        (dx, dy, distRatio) => this.engine.handleCastSkillInput(s, dx, dy, distRatio)
      );
    }
    this.bindDragAimButton(
      q('#hok-btn-flash'),
      4,
      () => this.engine.handleFlashInput(),
      (dx, dy) => this.engine.handleFlashInput(dx, dy)
    );
  }

  public syncStick(): void {
    if (!this.container) return;
    const isTouch = this.engine.input.usingTouch;
    this.container.classList.toggle('is-touch-hud', isTouch);
    if (!isTouch) return;

    const stickEl = this.container.querySelector('#hok-move-stick') as HTMLElement | null;
    const knobEl = this.container.querySelector('#hok-stick-knob') as HTMLElement | null;
    if (!stickEl || !knobEl) return;

    const st = this.engine.input.moveStick;
    if (st.active) {
      stickEl.classList.add('active');
      stickEl.style.left = `${st.startX.toFixed(1)}px`;
      stickEl.style.top = `${st.startY.toFixed(1)}px`;
      stickEl.style.bottom = 'auto';
      stickEl.style.transform = 'translate(-50%, -50%)';
      const ox = st.curX - st.startX;
      const oy = st.curY - st.startY;
      knobEl.style.transform = `translate(${ox.toFixed(1)}px, ${oy.toFixed(1)}px)`;
    } else if (stickEl.classList.contains('active') || stickEl.style.left) {
      stickEl.classList.remove('active');
      stickEl.style.left = '';
      stickEl.style.top = '';
      stickEl.style.bottom = '';
      stickEl.style.transform = '';
      knobEl.style.transform = 'translate(0px, 0px)';
    }
  }

  public sync(): void {
    const world = this.engine.world;
    if (!this.container || !world) return;
    const local = this.engine.getLocalHero();
    if (!local) return;

    this.syncStick();

    if (this.minimapCanvas) {
      this.engine.renderMinimap(this.minimapCanvas);
    }

    const q = <T extends HTMLElement>(sel: string) => this.container!.querySelector(sel) as T;

    q('#hud-zone-tag').textContent = ZONES[local.zoneId]?.name || '圣殿';

    const waveTxt =
      world.waveState === 'prep'
        ? `准备第 ${world.wave + 1}${world.endlessMode ? ' (无尽)' : '/20'} 波 · ${Math.ceil(world.wavePrepTimer)}s`
        : `${world.endlessMode ? '无尽 ' : ''}第 ${world.wave}${world.endlessMode ? '' : '/20'} 波 · 战斗中`;
    q('#hud-wave-txt').textContent = waveTxt;
    q('#btn-early-wave').style.display = world.waveState === 'prep' && CoopManager.role !== 'client' ? 'inline-block' : 'none';

    const sancRatio = Math.max(0, Math.min(1, world.sanctuary.hp / Math.max(1, world.sanctuary.maxHp)));
    q('#hud-athena-fill').style.width = `${(sancRatio * 100).toFixed(1)}%`;
    q('#hud-athena-txt').textContent = `圣殿 Lv.${world.sanctuary.level} · ${Math.round(world.sanctuary.hp)}/${Math.round(world.sanctuary.maxHp)}${world.sanctuary.invulnTimer > 0 ? ' [无敌中]' : ''}`;

    const activeBoss =
      world.enemies.find((e) => e.isBoss && e.hp > 0 && e.zoneId === local.zoneId) ||
      world.enemies.find((e) => e.isBoss && e.hp > 0 && e.zoneId === 'sanctuary');
    const bossBar = q('#hud-boss-bar');
    if (activeBoss) {
      bossBar.style.display = 'block';
      q('#hud-boss-fill').style.width = `${Math.max(0, (activeBoss.hp / activeBoss.maxHp) * 100).toFixed(1)}%`;
      q('#hud-boss-txt-span').textContent = `${activeBoss.name} · ${Math.round(activeBoss.hp)}/${Math.round(activeBoss.maxHp)}`;
    } else {
      bossBar.style.display = 'none';
    }

    q('#hud-gold').textContent = `${Math.round(local.gold)}`;
    q('#hud-crystal').textContent = `${local.crystal}木`;
    q('#hud-stones').textContent = `${local.stones}石`;

    const allies = world.heroes.filter((h) => !h.isLocal);
    const hasBots = world.heroes.some((h) => h.isBot);
    q('#btn-bot-mode').style.display = hasBots ? 'block' : 'none';
    const squadHash = allies.map((a) => `${a.id}:${a.dead ? 0 : Math.round((a.hp / a.stats.maxHp) * 100)}`).join('|');
    if (squadHash !== this.lastSquadHash) {
      this.lastSquadHash = squadHash;
      q('#hud-squad-col').innerHTML = allies
        .map(
          (a) => `
          <div class="squad-mini-card war3-stone-panel">
            <img class="squad-mini-ava" src="${IconAtlas.getDataUrl(`hero_${a.classId}`)}" alt="" />
            <div style="display:flex;flex-direction:column;gap:2px;">
              <span style="color:${a.color};font-weight:800;font-size:10px;">${a.callsign.slice(0, 10)}</span>
              <div class="squad-hp-track"><div class="squad-hp-fill" style="width:${a.dead ? 0 : Math.round((a.hp / a.stats.maxHp) * 100)}%"></div></div>
            </div>
          </div>`
        )
        .join('');
    }

    const banner = q('#hud-banner');
    if (world.bannerTimer > 0 && world.bannerText) {
      banner.style.display = 'block';
      banner.textContent = world.bannerText;
      banner.style.color = world.bannerColor;
    } else {
      banner.style.display = 'none';
    }

    const questEl = q('#hud-quest-badge');
    if (local.carryingWater) {
      questEl.style.display = 'block';
      questEl.textContent = '正在护送圣泉之水 → 前往东郊祭坛!';
    } else if (world.quests.banditCleared) {
      questEl.style.display = 'block';
      questEl.textContent = '盗贼营地已清剿 · 全队商店 85 折';
    } else {
      questEl.style.display = 'none';
    }

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
                <div style="font-size:11.5px;font-weight:800;color:#fde047;">${qb.label}</div>
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

    const def = getHeroClassDef(local.classId);
    if (this.lastHeroClass !== local.classId) {
      this.lastHeroClass = local.classId;
      const portraitUrl = IconAtlas.getDataUrl(`hero_${local.classId}`);
      q<HTMLImageElement>('#pc-hero-portrait').src = portraitUrl;
      q<HTMLImageElement>('#hok-hero-portrait').src = portraitUrl;
      for (let s = 0; s < 4; s++) {
        const sk = def.skills[s];
        const iconUrl = IconAtlas.getDataUrl(sk.iconKey);
        q<HTMLImageElement>(`#pc-skill-img-${s}`).src = iconUrl;
        q<HTMLImageElement>(`#hok-skill-img-${s}`).src = iconUrl;
        q(`#pc-skill-${s}`).title = `[${sk.keyLabel}] ${sk.name} (${sk.cooldown}s · ${sk.manaCost}法力)：${sk.desc}`;
      }
    }

    const hpPct = `${Math.max(0, (local.hp / local.stats.maxHp) * 100).toFixed(1)}%`;
    const mpPct = `${Math.max(0, (local.mp / Math.max(1, local.stats.maxMp)) * 100).toFixed(1)}%`;
    const xpPct = `${Math.max(0, Math.min(100, (local.xp / Math.max(1, local.nextXp)) * 100)).toFixed(1)}%`;

    q('#pc-hero-lv-badge').textContent = `${local.level}`;
    q('#pc-hero-title').textContent = `${def.name}${local.awakeningUnlocked ? ' · ★觉醒' : ''}`;
    q('#pc-hp-fill').style.width = hpPct;
    q('#pc-hp-txt').textContent = `${Math.round(local.hp)}/${Math.round(local.stats.maxHp)}`;
    q('#pc-mp-fill').style.width = mpPct;
    q('#pc-mp-txt').textContent = `${Math.round(local.mp)}/${Math.round(local.stats.maxMp)}`;
    q('#pc-xp-fill').style.width = xpPct;
    q('#pc-stats-txt').textContent = `攻${Math.round(local.stats.ad)} · 法${Math.round(local.stats.ap)} · 甲${Math.round(local.stats.armor)} · 暴${Math.round(local.stats.critChance * 100)}%`;

    q('#hok-hero-lv').textContent = `${local.level}`;
    q('#hok-hero-name').textContent = `${def.name}${local.awakeningUnlocked ? ' ★' : ''}`;
    q('#hok-hp-fill').style.width = hpPct;
    q('#hok-hp-txt').textContent = `${Math.round(local.hp)}`;
    q('#hok-mp-fill').style.width = mpPct;
    q('#hok-xp-fill').style.width = xpPct;

    for (let s = 0; s < 4; s++) {
      const sk = def.skills[s];
      const cd = local.skillCds[s];
      const maxCd = Math.max(1.2, sk.cooldown * (1 - local.stats.cdr));
      const locked = Boolean(sk.unlockLevel && local.level < sk.unlockLevel);
      const lowMana = !locked && local.mp < sk.manaCost;
      const pct = locked ? 100 : cd > 0 ? Math.min(100, (cd / maxCd) * 100) : 0;
      const text = locked ? `Lv${sk.unlockLevel}` : cd > 0 ? `${Math.ceil(cd)}` : '';

      const pcBtn = q(`#pc-skill-${s}`);
      const hokBtn = q(`#hok-skill-${s}`);
      pcBtn.classList.toggle('is-low-mana', lowMana);
      hokBtn.classList.toggle('is-low-mana', lowMana);

      const pcCd = q(`#pc-skill-cd-${s}`);
      const hokCd = q(`#hok-skill-cd-${s}`);
      pcCd.style.display = text ? 'flex' : 'none';
      pcCd.style.setProperty('--cd-pct', `${pct.toFixed(1)}%`);
      pcCd.textContent = text;
      hokCd.style.display = text ? 'flex' : 'none';
      hokCd.style.setProperty('--cd-pct', `${pct.toFixed(1)}%`);
      hokCd.textContent = text;
    }

    q('#pc-cnt-hp').textContent = `${local.potionCharges.hp}`;
    q('#pc-cnt-mp').textContent = `${local.potionCharges.mp}`;
    q('#hok-cnt-hp').textContent = `${local.potionCharges.hp}`;
    q('#hok-cnt-mp').textContent = `${local.potionCharges.mp}`;

    const flashPct = local.flashCd > 0 ? Math.min(100, (local.flashCd / 18) * 100) : 0;
    const pcFlashCd = q('#pc-flash-cd');
    pcFlashCd.style.display = local.flashCd > 0 ? 'flex' : 'none';
    pcFlashCd.style.setProperty('--cd-pct', `${flashPct.toFixed(1)}%`);
    pcFlashCd.textContent = `${Math.ceil(local.flashCd)}`;
    const hokFlashCd = q('#hok-flash-cd');
    hokFlashCd.style.display = local.flashCd > 0 ? 'flex' : 'none';
    hokFlashCd.style.setProperty('--cd-pct', `${flashPct.toFixed(1)}%`);
    hokFlashCd.textContent = `${Math.ceil(local.flashCd)}`;

    // Active Artifact Button on Mobile
    const activeArt = local.inventory.map((id) => (id ? getItemDef(id) : undefined)).find((it) => it?.activeSkill);
    const itemBtn = q('#hok-btn-item');
    if (activeArt && activeArt.activeSkill) {
      itemBtn.style.display = 'flex';
      const itemImg = q<HTMLImageElement>('#hok-item-img');
      const url = IconAtlas.getDataUrl(activeArt.iconKey);
      if (itemImg.getAttribute('data-k') !== activeArt.iconKey) {
        itemImg.setAttribute('data-k', activeArt.iconKey);
        itemImg.src = url;
      }
      const icd = local.activeItemCd;
      const imax = Math.max(1, activeArt.activeSkill.cooldown * (1 - local.stats.cdr * 0.5));
      const itemCdEl = q('#hok-item-cd');
      itemCdEl.style.display = icd > 0 ? 'flex' : 'none';
      itemCdEl.style.setProperty('--cd-pct', `${Math.min(100, (icd / imax) * 100).toFixed(1)}%`);
      itemCdEl.textContent = icd > 0 ? `${Math.ceil(icd)}` : '';
    } else {
      itemBtn.style.display = 'none';
    }

    // Memoized Inventory Grid (PC + Mobile mini strip)
    const invHash = local.inventory.map((x) => x || '').join('|');
    if (invHash !== this.lastInvHash) {
      this.lastInvHash = invHash;
      for (let i = 0; i < 6; i++) {
        const cell = q(`#pc-inv-${i}`);
        const hokDot = q(`#hok-inv-${i}`);
        const itemId = local.inventory[i];
        const itemDef = itemId ? getItemDef(itemId) : null;
        if (itemDef) {
          const border = RARITY_META[itemDef.rarity].border;
          const html = `<img src="${IconAtlas.getDataUrl(itemDef.iconKey)}" title="${itemDef.name}: ${itemDef.desc}" alt="" />`;
          cell.style.borderColor = border;
          cell.innerHTML = html;
          hokDot.style.borderColor = border;
          hokDot.innerHTML = html;
        } else {
          cell.style.borderColor = '#475569';
          cell.innerHTML = '';
          hokDot.style.borderColor = '#475569';
          hokDot.innerHTML = '';
        }
      }
    }
  }
}
