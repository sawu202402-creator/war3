import { SoundFX } from '../audio/SoundFX';
import { DIFFICULTIES, HERO_CLASSES, TALENT_TRACKS, getHeroClassDef } from '../data/heroes';
import { ITEMS, RARITY_META, SET_BONUSES, getItemDef } from '../data/items';
import { ENEMY_ARCHETYPES } from '../data/waves';
import { IconAtlas } from '../engine/IconAtlas';
import { PwaInstallManager } from '../meta/PwaInstallManager';
import { DAILY_CHECKIN_REWARDS, DAILY_MISSIONS, SaveManager } from '../meta/SaveManager';
import { CoopManager } from '../net/CoopManager';
import { PublicRoomAd } from '../net/CoopProtocol';
import { DifficultyLevel, HeroClassDef, HeroClassId, HudMode } from '../types';

type LobbyTab = 'solo' | 'coop' | 'talents' | 'codex' | 'daily';
type HallFilter = 'all' | 'waiting' | 'ingame';

export class LobbyUI {
  private tab: LobbyTab = 'solo';
  private selectedDifficulty: DifficultyLevel = 1;
  private selectedCodexItemId = 'myth_frostmourne';
  private joinCodeInput = '';
  private copyMsg = '';
  private hallFilter: HallFilter = 'all';
  private roomTitleDraft = '';
  private hostTitleDraft = '';
  private chatInputDraft = '';
  private hallStatusHint = '每 3 秒自动刷新可加入房';

  constructor(
    private root: HTMLElement,
    private onLaunchSolo: (hero: HeroClassId, diff: DifficultyLevel, aiCount: number) => void,
    private onLaunchCoop: () => void,
    private cbs?: {
      onHudModeChange?: (mode: HudMode) => void;
      onToggleFullscreen?: () => void;
    }
  ) {}

  private escapeHtml(raw: string): string {
    return (raw || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  private filterPublicRooms(rooms: PublicRoomAd[]): PublicRoomAd[] {
    if (this.hallFilter === 'waiting') {
      return rooms.filter((r) => !r.inGame && r.memberCount < r.maxMembers);
    }
    if (this.hallFilter === 'ingame') {
      return rooms.filter((r) => r.inGame);
    }
    return rooms;
  }

  private renderPublicRoomsListHtml(rooms: PublicRoomAd[]): string {
    const filtered = this.filterPublicRooms(rooms);
    if (rooms.length === 0) {
      return `<div class="coop-empty-slot">暂无公开房间，可点击上方【一键快速匹配】或创建自己的公开战局</div>`;
    }
    if (filtered.length === 0) {
      return `<div class="coop-empty-slot">当前筛选下暂无房间（共有 ${rooms.length} 个房间在线，可切换“全部”查看）</div>`;
    }
    return filtered
      .map((r) => {
        const heroes = (r.memberHeroes && r.memberHeroes.length > 0 ? r.memberHeroes : r.hostHero ? [r.hostHero] : []).slice(0, 4);
        const title = this.escapeHtml(r.roomTitle || `${r.hostName}的战局`);
        const host = this.escapeHtml(r.hostName);
        const code = this.escapeHtml(r.roomCode);
        const full = r.memberCount >= r.maxMembers;
        const statusText = r.inGame ? `第 ${r.wave} 波战斗中` : '等候发车';
        const statusColor = r.inGame ? '#fbbf24' : '#4ade80';
        return `
                  <div class="coop-public-row">
                    <div style="display:flex;flex-direction:column;gap:4px;min-width:0;flex:1;">
                      <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;">
                        <span style="font-weight:800;color:#fde047;">[${code}]</span>
                        <strong style="color:#f8fafc;font-size:13px;">${title}</strong>
                        <span style="font-size:11px;padding:1px 6px;border-radius:4px;background:rgba(234,179,8,0.18);border:1px solid rgba(250,204,21,0.45);color:#fef08a;font-weight:700;">N${r.difficulty}</span>
                        <span style="font-size:11px;color:${statusColor};font-weight:700;">${statusText}</span>
                      </div>
                      <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
                        <span style="font-size:11.5px;color:#cbd5e1;">房主：${host}</span>
                        ${
                          heroes.length > 0
                            ? `<span class="coop-hall-heroes">${heroes
                                .map((hid) => `<img class="coop-hall-hero-mini" src="${IconAtlas.getDataUrl(`hero_${hid}`)}" alt="" title="${this.escapeHtml(getHeroClassDef(hid).name)}" />`)
                                .join('')}</span>`
                            : ''
                        }
                      </div>
                    </div>
                    <div style="display:flex;align-items:center;gap:8px;flex-shrink:0;">
                      <span style="font-size:12px;color:${full ? '#f87171' : '#4ade80'};font-weight:800;">${r.memberCount}/${r.maxMembers}人</span>
                      <button class="war3-btn ${full ? '' : r.inGame ? 'war3-btn-gold' : 'war3-btn-blue'}" data-join-public="${code}" ${full ? 'disabled' : ''} style="padding:5px 12px;font-size:12px;">
                        ${full ? '已满员' : r.inGame ? '战局空降' : '加入房间'}
                      </button>
                    </div>
                  </div>`;
      })
      .join('');
  }

  private bindPublicJoinButtons(): void {
    this.root.querySelectorAll('[data-join-public]').forEach((el) => {
      const btn = el as HTMLButtonElement;
      if (btn.disabled) return;
      btn.onclick = () => CoopManager.joinRoomByCode(btn.dataset.joinPublic!);
    });
  }

  public refreshDirectoryDom(): void {
    const rooms = CoopManager.getPublicRooms();
    const badge = this.root.querySelector('#coop-online-badge') as HTMLElement | null;
    if (badge) {
      badge.textContent = rooms.length > 0 ? String(rooms.length) : '';
      badge.style.display = rooms.length > 0 ? 'inline-flex' : 'none';
    }
    if (this.tab !== 'coop' || CoopManager.lobby) return;
    const countEl = this.root.querySelector('#coop-hall-count') as HTMLElement | null;
    if (countEl) {
      countEl.textContent = `${rooms.length} 房间在线`;
    }
    const listEl = this.root.querySelector('#coop-hall-list') as HTMLElement | null;
    if (listEl) {
      listEl.innerHTML = this.renderPublicRoomsListHtml(rooms);
      this.bindPublicJoinButtons();
    }
  }

  public syncInstallShortcutUi(): void {
    const btn = this.root.querySelector('#btn-hub-install') as HTMLButtonElement | null;
    if (!PwaInstallManager.canShowHomeScreenShortcut()) {
      if (btn) btn.style.display = 'none';
      this.root.querySelector('#install-guide-overlay')?.remove();
      return;
    }
    const overlay = this.root.querySelector('#install-guide-overlay');
    if (
      overlay &&
      PwaInstallManager.hasNativeInstallPrompt() &&
      !overlay.querySelector('#btn-install-native')
    ) {
      this.openInstallAppGuide();
    }
  }

  private openInstallAppGuide(): void {
    const backdrop = this.root.querySelector('.lobby-backdrop') as HTMLElement | null;
    if (!backdrop) return;
    backdrop.querySelector('#install-guide-overlay')?.remove();

    const plat = PwaInstallManager.getInstallGuidePlatform();
    const modalTitle = plat === 'desktop' ? '📲 添加到电脑桌面' : '📲 添加到手机桌面';
    const step1 =
      plat === 'wechat'
        ? '① 点击微信右上角 <strong>【 ··· 】</strong> 菜单'
        : plat === 'ios'
          ? '① 点击 Safari 浏览器底部/顶部的 <strong>【分享 📤】</strong> 按钮'
          : plat === 'android'
            ? '① Chrome 请点右上角 <strong>【 ⋮ 】→【添加到主屏幕】→ 选【创建快捷方式】</strong>（国内网络点“安装”会卡谷歌服务导致找不到图标，选“创建快捷方式”本地秒出！）'
            : '① 点击浏览器地址栏右侧的 <strong>【安装应用 ⊕】</strong> 图标';
    const step2 =
      plat === 'wechat'
        ? '② 安卓可直接点 <strong>【添加到桌面】</strong>；苹果请点 <strong>【在默认浏览器打开】→ 分享 📤 → 添加到主屏幕</strong>'
        : plat === 'ios'
          ? '② 在弹出菜单向下滑，点击 <strong>【添加到主屏幕 ➕】</strong> 即可生成桌面图标'
          : plat === 'android'
            ? '② 小米/华为/OPPO/vivo 请确认开启 <strong>系统设置 → 应用管理 → Chrome → 权限 →【桌面快捷方式】</strong>；或点下方复制网址去<strong>手机自带浏览器</strong>添加'
            : '② 或点击浏览器右上角 <strong>【 ⋮ 】→【安装 圣殿守卫战】</strong>';

    const overlay = document.createElement('div');
    overlay.id = 'install-guide-overlay';
    overlay.className = 'install-guide-overlay';
    overlay.innerHTML = `
      <div class="install-guide-card war3-stone-panel">
        <div class="install-guide-top">
          <div class="install-icon-preview">
            <img src="./assets/app_icon_ui.png" width="56" height="56" alt="圣殿守卫战" />
            <span>圣殿守卫战</span>
          </div>
          <div class="install-guide-head">
            <span class="install-badge-pill">全屏无地址栏 · 桌面一键秒开</span>
            <h3>${modalTitle}</h3>
            <p>生成专属游戏图标，下次桌面一键秒开、自动隐藏浏览器地址栏全屏畅玩！</p>
          </div>
        </div>
        <div class="install-steps-box">
          <div class="install-step-item">${step1}</div>
          <div class="install-step-item">${step2}</div>
        </div>
        <div class="install-guide-actions">
          ${PwaInstallManager.hasNativeInstallPrompt() ? `<button class="war3-btn war3-btn-gold" id="btn-install-native" type="button">⚡ 系统直接安装</button>` : ''}
          <button class="war3-btn war3-btn-blue" id="btn-install-copy-url" type="button">📋 复制游戏网址</button>
          <button class="war3-btn war3-btn-green" id="btn-install-close" type="button">我知道了</button>
        </div>
      </div>
    `;

    const openedAt = performance.now();
    backdrop.appendChild(overlay);

    overlay.onclick = (e) => {
      if (e.target === overlay && performance.now() - openedAt > 380) {
        overlay.remove();
      }
    };

    const closeBtn = overlay.querySelector('#btn-install-close') as HTMLButtonElement | null;
    if (closeBtn) {
      closeBtn.onclick = () => overlay.remove();
    }

    const nativeBtn = overlay.querySelector('#btn-install-native') as HTMLButtonElement | null;
    if (nativeBtn) {
      nativeBtn.onclick = async () => {
        const out = await PwaInstallManager.triggerNativeInstallPrompt();
        if (out === 'accepted') {
          SoundFX.playEventFanfare();
          const hubBtn = this.root.querySelector('#btn-hub-install') as HTMLButtonElement | null;
          if (hubBtn) hubBtn.style.display = 'none';
          overlay.remove();
        }
      };
    }

    const copyUrlBtn = overlay.querySelector('#btn-install-copy-url') as HTMLButtonElement | null;
    if (copyUrlBtn) {
      copyUrlBtn.onclick = async () => {
        const cleanUrl = `${window.location.origin}${window.location.pathname}`;
        let copied = false;
        try {
          if (navigator.clipboard?.writeText) {
            await navigator.clipboard.writeText(cleanUrl);
            copied = true;
          }
        } catch {
          copied = false;
        }
        if (!copied) {
          try {
            const ta = document.createElement('textarea');
            ta.value = cleanUrl;
            ta.setAttribute('readonly', '');
            ta.style.position = 'fixed';
            ta.style.opacity = '0';
            document.body.appendChild(ta);
            ta.select();
            copied = document.execCommand('copy');
            ta.remove();
          } catch {
            copied = false;
          }
        }
        if (copied) {
          SoundFX.playGold();
          copyUrlBtn.textContent = '✅ 网址已复制，可粘贴到浏览器打开！';
        } else {
          copyUrlBtn.textContent = cleanUrl;
        }
      };
    }
  }

  public setTab(tab: LobbyTab): void {
    this.tab = tab;
    if (tab === 'coop') {
      CoopManager.ensurePublicDirectoryActive();
    }
  }

  public isCoopTab(): boolean {
    return this.tab === 'coop';
  }

  public render(): void {
    const save = SaveManager.get();
    const selHero = getHeroClassDef(save.selectedHero);
    const bgSrc =
      this.tab === 'solo'
        ? IconAtlas.getDataUrl(`splash_${selHero.id}`)
        : IconAtlas.getDataUrl('hub_banner');

    this.root.innerHTML = `
      <div class="lobby-backdrop" style="--hero-accent:${selHero.color};">
        <div class="lobby-bg-layer">
          <img class="lobby-bg-img" src="${bgSrc}" alt="" />
          <div class="lobby-bg-scrim"></div>
        </div>

        <div class="lobby-topbar war3-stone-panel">
          <div class="lobby-brand">
            <img class="war3-crest-ico" src="${IconAtlas.getDataUrl('ui_ico_battle')}" alt="" />
            <div>
              <h1>圣殿守卫战 · ATHENA SIEGE</h1>
              <span class="brand-subpill">经典魔兽奇幻防守 RPG · 20波+无尽征程</span>
            </div>
          </div>
          <div class="lobby-meta-bar">
            <span class="meta-pill">
              <img class="pill-ico" src="${IconAtlas.getDataUrl('ui_ico_honor')}" alt="" />
              荣誉 <b>${save.honorCoins}</b>
            </span>
            <span class="meta-pill meta-pill-kills">
              <img class="pill-ico" src="${IconAtlas.getDataUrl('ui_ico_kill')}" alt="" />
              击杀 <b>${save.careerKills}</b>
            </span>
            <button class="war3-btn" id="btn-hud-mode" style="padding:5px 9px;font-size:11px">
              触控: ${(save.hudMode || 'auto') === 'touch' ? '手机轮盘' : (save.hudMode || 'auto') === 'pc' ? '键鼠' : '自动'}
            </button>
            <button class="war3-btn" id="btn-ctrl-mode" style="padding:5px 9px;font-size:11px">
              PC: ${save.rightClickMove ? '右键寻路' : 'WASD'}
            </button>
            <button class="war3-btn" id="btn-fullscreen" style="padding:5px 9px;font-size:11px">
              全屏
            </button>
            <button class="war3-btn" id="btn-sfx-toggle" style="padding:5px 9px;font-size:11px">
              ${SoundFX.isSfxMuted() ? '音效: 关' : '音效: 开'}
            </button>
            <button class="war3-btn" id="btn-bgm-toggle" style="padding:5px 9px;font-size:11px">
              ${SoundFX.isBgmMuted() ? '音乐: 关' : '音乐: 开'}
            </button>
            ${
              PwaInstallManager.canShowHomeScreenShortcut()
                ? `<button class="hub-install-btn" id="btn-hub-install" type="button" title="添加到桌面全屏畅玩"><img src="./assets/app_icon_ui.png" width="18" height="18" alt="" /><span>添加桌面</span></button>`
                : ''
            }
          </div>
        </div>

        <div class="lobby-nav">
          <button class="nav-tab ${this.tab === 'solo' ? 'active' : ''}" data-tab="solo">
            <img src="${IconAtlas.getDataUrl('ui_ico_battle')}" alt="" />
            <span>单人征战</span>
          </button>
          <button class="nav-tab ${this.tab === 'coop' ? 'active' : ''}" data-tab="coop">
            <img src="${IconAtlas.getDataUrl('ui_ico_coop')}" alt="" />
            <span>联机大厅</span>
            <span class="nav-online-pill" id="coop-online-badge" style="display:${CoopManager.getPublicRooms().length > 0 ? 'inline-flex' : 'none'};">${CoopManager.getPublicRooms().length > 0 ? CoopManager.getPublicRooms().length : ''}</span>
          </button>
          <button class="nav-tab ${this.tab === 'talents' ? 'active' : ''}" data-tab="talents">
            <img src="${IconAtlas.getDataUrl('ui_ico_talent')}" alt="" />
            <span>圣殿传承</span>
          </button>
          <button class="nav-tab ${this.tab === 'codex' ? 'active' : ''}" data-tab="codex">
            <img src="${IconAtlas.getDataUrl('ui_ico_codex')}" alt="" />
            <span>神装合成 &amp; 图鉴</span>
          </button>
          <button class="nav-tab ${this.tab === 'daily' ? 'active' : ''}" data-tab="daily">
            <img src="${IconAtlas.getDataUrl('ui_ico_daily')}" alt="" />
            <span>每日军务 &amp; 无尽榜</span>
          </button>
        </div>

        <div class="lobby-body">
          ${this.tab === 'solo' ? this.renderSoloTab(selHero.id) : ''}
          ${this.tab === 'coop' ? this.renderCoopTab() : ''}
          ${this.tab === 'talents' ? this.renderTalentsTab() : ''}
          ${this.tab === 'codex' ? this.renderCodexTab() : ''}
          ${this.tab === 'daily' ? this.renderDailyTab() : ''}
        </div>
      </div>
    `;

    this.bindEvents();
  }

  private heroRatings(sel: HeroClassDef): { label: string; pct: number; color: string }[] {
    const st = sel.baseStats;
    return [
      { label: '生存', pct: Math.min(100, Math.round((st.maxHp / 860 + st.armor / 36) * 52)), color: '#4ade80' },
      { label: '物理', pct: Math.min(100, Math.round(((st.ad + st.atkSpeed * 22) / 112) * 86)), color: '#fb923c' },
      { label: '法强', pct: Math.min(100, Math.round(((st.ap + st.cdr * 100) / 86) * 88)), color: '#38bdf8' },
      { label: '机动', pct: Math.min(100, Math.round(((st.moveSpeed - 190) / 120) * 85 + 22)), color: '#facc15' },
    ];
  }

  private renderSoloTab(selectedId: HeroClassId): string {
    const save = SaveManager.get();
    const sel = getHeroClassDef(selectedId);
    const mastery = SaveManager.getHeroMasteryLevel(sel.id);
    const masteryPct = Math.min(100, Math.round((mastery.curXp / Math.max(1, mastery.nextXp)) * 100));
    const diffCfg = DIFFICULTIES[this.selectedDifficulty];
    const bars = this.heroRatings(sel);

    return `
      <div class="hero-altar-grid">
        <!-- Left Hero Altar Showcase + 5-Hero Medallion Roster -->
        <div class="hero-showcase-pedestal war3-stone-panel" style="--hero-col:${sel.color};">
          <div class="hero-splash-stage">
            <img class="hero-splash-img" src="${IconAtlas.getDataUrl(`splash_${sel.id}`)}" alt="${sel.name}" />
            <div class="hero-splash-vignette"></div>
            <div class="hero-splash-crest">
              <div class="hero-crest-tags">
                <span class="role-badge" style="border-color:${sel.color};color:${sel.color};">${sel.roleTag}</span>
                <span class="mastery-chip">熟练度 Lv.${mastery.level}</span>
              </div>
              <div class="hero-crest-title" style="color:${sel.color};">${sel.name}</div>
              <div class="hero-crest-sub">${sel.title} · Lv.15 双分支觉醒</div>
              <div class="hero-stat-bars">
                ${bars
                  .map(
                    (b) => `
                  <div class="hero-stat-item">
                    <span>${b.label}</span>
                    <div class="hero-stat-track">
                      <div class="hero-stat-fill" style="width:${b.pct}%;background:${b.color};"></div>
                    </div>
                  </div>`
                  )
                  .join('')}
              </div>
            </div>
          </div>

          <div class="hero-roster-dock">
            ${HERO_CLASSES.map((h) => {
              const unlocked = save.unlockedHeroes.includes(h.id);
              const isSel = h.id === selectedId;
              return `
                <div class="hero-medallion ${isSel ? 'selected' : ''} ${unlocked ? '' : 'locked'}" data-pick-hero="${h.id}" style="--hero-col:${h.color};">
                  <div class="hero-medallion-frame">
                    <img src="${IconAtlas.getDataUrl(`hero_${h.id}`)}" alt="${h.name}" />
                    ${!unlocked ? `<span class="hero-lock-tag">${h.unlockCost}</span>` : ''}
                  </div>
                  <div class="hero-medallion-name">${h.name}</div>
                  ${
                    unlocked
                      ? `<div class="hero-medallion-state" style="color:${isSel ? '#fde047' : '#94a3b8'};">${isSel ? '已出战' : '选择'}</div>`
                      : `<button class="war3-btn war3-btn-gold hero-unlock-btn" data-unlock-hero="${h.id}" type="button">解锁 ${h.unlockCost}</button>`
                  }
                </div>
              `;
            }).join('')}
          </div>
        </div>

        <!-- Right War3 Carved Stone Command Tome -->
        <div class="hero-command-tome">
          <div class="war3-card war3-stone-panel">
            <div class="tome-header">
              <div>
                <div class="tome-title" style="color:${sel.color};">被动【${sel.passiveName}】</div>
                <div class="tome-desc">${sel.passiveDesc}</div>
              </div>
              <div class="mastery-box">
                <div style="font-size:11px;color:#fde68a;font-weight:700;">熟练 Lv.${mastery.level}</div>
                <div class="mastery-track"><div class="mastery-fill" style="width:${masteryPct}%"></div></div>
              </div>
            </div>

            <div class="awaken-strip">
              ${sel.awakeningBranches
                .map(
                  (b) => `
                <div class="awaken-chip" style="border-color:${b.color};">
                  <div style="font-weight:800;font-size:12px;color:${b.color};">${b.name} · [${b.tag}]</div>
                  <div style="font-size:11px;color:#cbd5e1;">${b.specialEffect}</div>
                </div>`
                )
                .join('')}
            </div>

            <div class="hero-skill-preview">
              ${sel.skills
                .map(
                  (sk) => `
                <div class="skill-row ${sk.isUlt ? 'is-ult' : ''}">
                  <div class="skill-ico-wrap">
                    <img src="${IconAtlas.getDataUrl(sk.iconKey)}" alt="" />
                    <span class="skill-key-badge">${sk.keyLabel}</span>
                  </div>
                  <div class="skill-copy">
                    <div class="skill-copy-top">
                      <span class="skill-name">${sk.name}</span>
                      <span class="skill-costs">${sk.cooldown}s · ${sk.manaCost}MP</span>
                    </div>
                    <div class="skill-desc">${sk.desc}</div>
                  </div>
                </div>
              `
                )
                .join('')}
            </div>
          </div>

          <div class="war3-card war3-stone-panel launch-deck">
            <div class="launch-config">
              <div class="launch-section-title">战区难度等级</div>
              <div class="diff-row">
                ${([1, 2, 3, 4, 5] as DifficultyLevel[])
                  .map((d) => {
                    const cfg = DIFFICULTIES[d];
                    const locked = d > save.maxClearedDifficulty + 1 && d > 2;
                    return `
                      <button class="diff-pill ${this.selectedDifficulty === d ? 'active' : ''}" data-pick-diff="${d}" ${locked ? 'disabled' : ''}>
                        ${locked ? '未解锁 ' : ''}${cfg.shortName}
                      </button>
                    `;
                  })
                  .join('')}
              </div>
              <div class="diff-desc" style="color:${diffCfg.color};">${diffCfg.desc}</div>
              <div class="ai-squad-row">
                <span class="ai-label">AI 助战队友:</span>
                ${[0, 1, 2, 3]
                  .map(
                    (n) => `<button class="diff-pill ${save.aiSquadCount === n ? 'active' : ''}" data-ai-count="${n}">${n} 名</button>`
                  )
                  .join('')}
                <span class="ai-hint">战局内可随时切换守殿或随行</span>
              </div>
            </div>

            <button class="war3-btn war3-btn-gold battle-launch-btn" id="btn-start-solo" type="button">
              <img src="${IconAtlas.getDataUrl('ui_ico_battle')}" alt="" />
              <span>进入圣殿防守战</span>
            </button>
          </div>
        </div>
      </div>
    `;
  }

  private renderCoopTab(): string {
    const save = SaveManager.get();
    const lobby = CoopManager.lobby;

    if (!lobby) {
      const publicRooms = CoopManager.getPublicRooms();
      return `
        <div class="lobby-inner-col">
          <div class="war3-card war3-stone-panel">
            <div class="card-head-flex">
              <div class="card-title-with-ico">
                <img src="${IconAtlas.getDataUrl('ui_ico_coop')}" alt="" />
                <div>
                  <strong>零服务器 WebRTC 3通道 P2P + 云中继 1–4 人联机</strong>
                  <div class="sub-muted">支持公开大厅一键快速匹配、战局中途空降支援与掉线 AI 托管重连归还。</div>
                </div>
              </div>
              <div style="display:flex;gap:6px;align-items:center;">
                <input id="inp-callsign" class="war3-input" value="${save.callsign}" maxlength="12" style="width:130px;" />
                <button class="war3-btn" id="btn-save-callsign">改名</button>
              </div>
            </div>
          </div>

          ${CoopManager.status === 'connecting' ? `<div class="war3-card war3-stone-panel" style="color:#38bdf8;font-weight:700;">正在建立跨端联机通道，请稍候...</div>` : ''}
          ${CoopManager.errorMsg ? `<div class="war3-card war3-stone-panel" style="border-color:#f43f5e;color:#fda4af;">连接失败：${CoopManager.errorMsg}</div>` : ''}

          <div class="coop-split-grid">
            <div class="war3-card war3-stone-panel" style="display:flex;flex-direction:column;gap:8px;">
              <strong style="color:#fde047;font-size:15px;">快速开黑 / 创建守城房间</strong>
              <p style="margin:0;font-size:12px;color:#94a3b8;">支持 1–4 人协防，Boss 材料全员独立掉落，队友断线由 AI 自动托管守城。</p>
              <div class="coop-diff-pills">
                <span style="font-size:12px;color:#cbd5e1;font-weight:700;align-self:center;">建房难度:</span>
                ${([1, 2, 3, 4, 5] as DifficultyLevel[])
                  .map(
                    (d) =>
                      `<button class="coop-pill-btn ${this.selectedDifficulty === d ? 'diff-active' : ''}" data-pre-diff="${d}">N${d}</button>`
                  )
                  .join('')}
              </div>
              <div style="margin-bottom:8px;">
                <input class="war3-input" id="inp-room-title" maxlength="20" value="${this.escapeHtml(this.roomTitleDraft)}" placeholder="自定义房间标题（如：N2圣殿速刷，留空自动命名）" style="width:100%;" />
              </div>
              <div style="display:flex;gap:8px;flex-wrap:wrap;">
                <button class="war3-btn war3-btn-green" id="btn-quick-match" style="flex:1;min-width:130px;">⚡ 一键快速匹配</button>
                <button class="war3-btn war3-btn-gold" id="btn-create-room" style="flex:1;min-width:140px;">创建公开房间 (N${this.selectedDifficulty})</button>
              </div>
            </div>
            <div class="war3-card war3-stone-panel" style="display:flex;flex-direction:column;gap:8px;">
              <strong style="color:#38bdf8;font-size:15px;">输入房间码加入</strong>
              <input id="inp-room-code" class="war3-input" value="${this.joinCodeInput}" placeholder="输入 5 位房间码" maxlength="6" style="font-size:15px;letter-spacing:2px;text-transform:uppercase;border-color:#38bdf8;" />
              <button class="war3-btn war3-btn-blue" id="btn-join-room">加入好友小队</button>
            </div>
          </div>

          <div class="war3-card war3-stone-panel">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
              <strong style="color:#4ade80;font-size:14px;">🌐 公开联机大厅 (<span id="coop-hall-count">${publicRooms.length} 房间在线</span>)</strong>
              <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
                <span id="coop-hall-sync-hint" style="font-size:11px;color:#94a3b8;">${this.escapeHtml(this.hallStatusHint)}</span>
                <button class="coop-pill-btn" id="btn-refresh-hall">🔄 刷新大厅</button>
              </div>
            </div>
            <div class="coop-hall-toolbar">
              <button class="coop-pill-btn ${this.hallFilter === 'all' ? 'active' : ''}" data-hall-filter="all">全部</button>
              <button class="coop-pill-btn ${this.hallFilter === 'waiting' ? 'active' : ''}" data-hall-filter="waiting">等候发车</button>
              <button class="coop-pill-btn ${this.hallFilter === 'ingame' ? 'active' : ''}" data-hall-filter="ingame">战局空降</button>
            </div>
            <div class="coop-public-list" id="coop-hall-list">
              ${this.renderPublicRoomsListHtml(publicRooms)}
            </div>
          </div>
        </div>
      `;
    }

    const isHost = CoopManager.role === 'host';
    const me = lobby.members.find((m) => m.peerId === CoopManager.myPeerId);

    return `
      <div class="lobby-inner-col">
        <div class="war3-card war3-stone-panel card-head-flex">
          <div>
            <div>
              <span style="font-size:12px;color:#94a3b8;">房间：</span>
              <strong style="font-size:16px;color:#f8fafc;">${this.escapeHtml(lobby.roomTitle || `${(lobby.members.find((m) => m.isHost) || lobby.members[0])?.callsign || '冒险者'}的战局`)}</strong>
              <span style="margin-left:8px;font-size:12px;color:#94a3b8;">房号</span>
              <strong style="font-size:18px;color:#fde047;letter-spacing:2px;">${this.escapeHtml(lobby.roomCode)}</strong>
              <span style="margin-left:8px;font-size:12px;color:#4ade80;">${CoopManager.getNetStatusLabel()}</span>
            </div>
            ${
              isHost
                ? `
              <div class="coop-room-title-row">
                <input class="war3-input" id="inp-host-title" maxlength="20" value="${this.escapeHtml(this.hostTitleDraft || lobby.roomTitle || '')}" placeholder="输入房间标题" style="width:170px;padding:4px 8px;font-size:12px;" />
                <button class="coop-pill-btn" id="btn-save-title">改房名</button>
              </div>`
                : ''
            }
          </div>
          <div style="display:flex;gap:8px;flex-wrap:wrap;">
            ${isHost ? `<button class="war3-btn ${lobby.isPublic !== false ? 'war3-btn-green' : ''}" id="btn-toggle-public">${lobby.isPublic !== false ? '🌐 公开房间' : '🔒 仅限邀请'}</button>` : ''}
            <button class="war3-btn war3-btn-blue" id="btn-copy-link">复制邀请链接</button>
            <button class="war3-btn war3-btn-red" id="btn-leave-room">离开房间</button>
          </div>
          ${this.copyMsg ? `<div style="width:100%;font-size:12px;color:#4ade80;">${this.escapeHtml(this.copyMsg)}</div>` : ''}
        </div>

        <div class="war3-card war3-stone-panel">
          <strong style="color:var(--war3-gold-bright);font-size:14px;">小队成员 (${lobby.members.length}/4)</strong>
          <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:8px;margin-top:8px;">
            ${[0, 1, 2, 3]
              .map((slot) => {
                const m = lobby.members.find((x) => x.slot === slot);
                if (!m) {
                  return `<div class="coop-empty-slot">P${slot + 1} 等待队友加入...</div>`;
                }
                const hd = getHeroClassDef(m.heroClass);
                return `
                  <div class="coop-member-card" style="border-color:${m.color};">
                    <div style="display:flex;align-items:center;gap:8px;">
                      <img src="${IconAtlas.getDataUrl(`hero_${m.heroClass}`)}" style="width:40px;height:40px;border-radius:6px;border:1.5px solid var(--war3-gold);" alt="" />
                      <div style="min-width:0;flex:1;">
                        <div style="font-weight:800;font-size:13px;color:${m.color};">${this.escapeHtml(m.callsign)} ${m.isHost ? '[房主]' : ''}</div>
                        <div style="font-size:11px;color:#cbd5e1;">${hd.name} · ${m.ready ? '已准备' : '未准备'}</div>
                      </div>
                      ${
                        isHost && !m.isHost
                          ? `<button class="coop-pill-btn" data-kick-peer="${this.escapeHtml(m.peerId)}" style="border-color:rgba(248,113,113,0.55);color:#fca5a5;">移出</button>`
                          : ''
                      }
                    </div>
                  </div>
                `;
              })
              .join('')}
          </div>
        </div>

        <div class="war3-card war3-stone-panel card-head-flex">
          <div style="display:flex;gap:6px;flex-wrap:wrap;align-items:center;">
            <span style="font-size:12px;color:#cbd5e1;font-weight:700;">出战英雄:</span>
            ${HERO_CLASSES.map(
              (h) => `
              <button class="diff-pill ${me?.heroClass === h.id ? 'active' : ''}" data-coop-hero="${h.id}">
                ${h.name}
              </button>`
            ).join('')}
          </div>
          ${
            isHost
              ? `
                <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;">
                  ${([1, 2, 3, 4, 5] as DifficultyLevel[])
                    .map((d) => `<button class="diff-pill ${lobby.difficulty === d ? 'active' : ''}" data-coop-diff="${d}">N${d}</button>`)
                    .join('')}
                  <button class="war3-btn war3-btn-gold" id="btn-launch-coop" style="padding:10px 20px;">全队出击</button>
                </div>
              `
              : `<button class="war3-btn ${me?.ready ? 'war3-btn-green' : 'war3-btn-blue'}" id="btn-toggle-ready">${me?.ready ? '已准备（等待房主开局）' : '点击准备'}</button>`
          }
        </div>

        <div class="war3-card war3-stone-panel coop-chat-box">
          <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:6px;">
            <strong style="color:#fde68a;font-size:13px;">💬 小队频道与快捷战术语</strong>
            <div class="coop-quick-phrases">
              ${['准备开局', '等一会', '换个输出', '需要辅助', '冲高难度!']
                .map((p) => `<button class="coop-pill-btn" data-quick-chat="${p}">${p}</button>`)
                .join('')}
            </div>
          </div>
          <div class="coop-chat-log" id="coop-chat-log">
            ${
              CoopManager.roomChatLog.length === 0
                ? `<div style="font-size:11.5px;color:#64748b;">小队频道已就绪，点击快捷短语或输入消息沟通阵容…</div>`
                : CoopManager.roomChatLog
                    .map(
                      (c) => `
                <div class="coop-chat-line ${c.system ? 'sys' : ''}">
                  ${c.heroClass ? `<img src="${IconAtlas.getDataUrl(`hero_${c.heroClass}`)}" alt="" />` : ''}
                  <strong style="color:${c.system ? '#fbbf24' : '#fde047'};">${this.escapeHtml(c.callsign)}:</strong>
                  <span>${this.escapeHtml(c.text)}</span>
                </div>`
                    )
                    .join('')
            }
          </div>
          <div style="display:flex;gap:6px;">
            <input class="war3-input" id="inp-room-chat" maxlength="60" value="${this.escapeHtml(this.chatInputDraft)}" placeholder="输入小队消息，按回车发送..." style="flex:1;padding:6px 10px;font-size:12px;" />
            <button class="war3-btn war3-btn-blue" id="btn-send-chat" style="padding:6px 14px;font-size:12px;">发送</button>
          </div>
        </div>
      </div>
    `;
  }

  private renderTalentsTab(): string {
    const save = SaveManager.get();
    return `
      <div class="lobby-inner-col">
        <div class="war3-card war3-stone-panel">
          <div class="card-title-with-ico" style="margin-bottom:10px;">
            <img src="${IconAtlas.getDataUrl('ui_ico_talent')}" alt="" />
            <div>
              <strong>圣殿永久传承天赋</strong>
              <div class="sub-muted">消耗局外荣誉点永久强化天赋基数，同时保留局内从零打宝合成的成长乐趣。</div>
            </div>
          </div>
          <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:10px;">
            ${TALENT_TRACKS.map((tr) => {
              const lv = save.talents[tr.key] || 0;
              const maxed = lv >= tr.maxLevel;
              const cost = SaveManager.getTalentUpgradeCost(tr.key);
              return `
                <div class="talent-card">
                  <div style="display:flex;justify-content:space-between;font-weight:800;font-size:13px;">
                    <span style="color:#fef3c7;">${tr.name}</span>
                    <span style="color:#4ade80;">Lv.${lv}/${tr.maxLevel}</span>
                  </div>
                  <div style="font-size:11px;color:#94a3b8;">${tr.desc}</div>
                  <div style="font-size:12px;color:#38bdf8;font-weight:700;">当前加成：${tr.valueText(lv)}</div>
                  <button class="war3-btn ${maxed ? '' : 'war3-btn-gold'}" data-upg-talent="${tr.key}" ${maxed || save.honorCoins < cost ? 'disabled' : ''}>
                    ${maxed ? '已满级' : `升级 (${cost} 荣誉点)`}
                  </button>
                </div>
              `;
            }).join('')}
          </div>
        </div>
      </div>
    `;
  }

  private renderCodexTab(): string {
    const recipeItems = ITEMS.filter((i) => i.recipe);
    const sel = getItemDef(this.selectedCodexItemId) || recipeItems[0];
    const bosses = Object.values(ENEMY_ARCHETYPES).filter((e) => e.isBoss);

    return `
      <div class="lobby-inner-col">
        <div class="war3-card war3-stone-panel">
          <div class="card-title-with-ico">
            <img src="${IconAtlas.getDataUrl('ui_ico_battle')}" alt="" />
            <div>
              <strong>五大职业本命武器套装</strong>
              <div class="sub-muted">5 位英雄各有 1 套专属 T1→T4 锻造与双分支神兵线（点选件徽可直查合成路线）</div>
            </div>
          </div>
          <div class="codex-sets-grid">
            ${SET_BONUSES.map(
              (sb) => `
              <div class="codex-set-card">
                <div style="display:flex;justify-content:space-between;align-items:center;gap:6px;flex-wrap:wrap;">
                  <strong style="color:#fde68a;font-size:13px;">${sb.name}</strong>
                  ${sb.heroTag ? `<span style="font-size:10.5px;color:#38bdf8;font-weight:700;">${sb.heroTag}</span>` : ''}
                </div>
                <div class="codex-set-pieces">
                  ${sb.itemIds
                    .map((id) => {
                      const it = getItemDef(id);
                      if (!it) return '';
                      const rm = RARITY_META[it.rarity];
                      return `
                        <button class="codex-set-chip" data-codex-item="${it.id}" type="button" style="border-color:${rm.border};color:${rm.color};">
                          <img src="${IconAtlas.getDataUrl(it.iconKey)}" alt="" />
                          <span>${it.name}</span>
                        </button>
                      `;
                    })
                    .join('')}
                </div>
                <div style="font-size:11px;color:#cbd5e1;line-height:1.4;">${sb.twoPieceDesc}</div>
                <div style="font-size:11px;color:#fde047;line-height:1.4;">${sb.fourPieceDesc}</div>
              </div>
            `
            ).join('')}
          </div>
        </div>

        <div class="war3-card war3-stone-panel">
          <div class="card-title-with-ico">
            <img src="${IconAtlas.getDataUrl('ui_ico_codex')}" alt="" />
            <div>
              <strong>神装合成路线图鉴</strong>
              <div class="sub-muted">点击神装名称查看所需底层散件与秘境 Boss 核心材料</div>
            </div>
          </div>
          <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:10px;">
            ${recipeItems
              .map((it) => {
                const rm = RARITY_META[it.rarity];
                const active = it.id === sel.id;
                return `
                  <button class="diff-pill ${active ? 'active' : ''}" data-codex-item="${it.id}" style="border-color:${rm.border};color:${rm.color};">
                    ${it.name}
                  </button>
                `;
              })
              .join('')}
          </div>
          ${
            sel
              ? `
                <div class="codex-pedestal" style="border-color:${RARITY_META[sel.rarity].border};box-shadow:0 0 22px ${RARITY_META[sel.rarity].border}33;">
                  <div style="display:flex;align-items:center;gap:12px;">
                    <img src="${IconAtlas.getDataUrl(sel.iconKey)}" style="width:54px;height:54px;border-radius:8px;border:2px solid ${RARITY_META[sel.rarity].border};" alt="" />
                    <div>
                      <div style="font-size:16px;font-weight:900;color:${RARITY_META[sel.rarity].color};">${sel.name}</div>
                      <div style="font-size:12px;color:#cbd5e1;margin-top:2px;">${sel.desc}</div>
                    </div>
                  </div>
                  <div class="codex-recipe-row">
                    ${sel.recipe!.items
                      .map((id) => {
                        const sub = getItemDef(id);
                        return `
                          <span class="recipe-chip">
                            <img src="${IconAtlas.getDataUrl(sub?.iconKey || 'item_wep_t1')}" alt="" />
                            ${sub?.name || id}
                          </span>`;
                      })
                      .join('')}
                    ${sel.recipe!.gold ? `<span class="recipe-chip cost">${sel.recipe!.gold} 金币</span>` : ''}
                    ${sel.recipe!.crystal ? `<span class="recipe-chip cost">${sel.recipe!.crystal} 灵晶</span>` : ''}
                  </div>
                </div>
              `
              : ''
          }
        </div>

        <div class="war3-card war3-stone-panel">
          <div class="card-title-with-ico" style="margin-bottom:8px;">
            <img src="${IconAtlas.getDataUrl('ui_ico_kill')}" alt="" />
            <div>
              <strong>魔神与秘境 Boss 图鉴</strong>
              <div class="sub-muted">共 ${bosses.length} 位守关与秘境首领（已击破 ${bosses.filter((b) => SaveManager.get().defeatedBosses.includes(b.kind)).length}/${bosses.length}）</div>
            </div>
          </div>
          <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:8px;">
            ${bosses
              .map((b) => {
                const defeated = SaveManager.get().defeatedBosses.includes(b.kind);
                return `
                <div class="boss-codex-card" style="border-color:${b.accentColor};">
                  <img class="boss-codex-avatar" src="${IconAtlas.getDataUrl(`enemy_${b.kind}`)}" alt="${b.name}" />
                  <div>
                    <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;">
                      <span style="font-weight:800;color:${b.accentColor};font-size:13px;">${b.name}</span>
                      <span style="font-size:10px;font-weight:800;padding:1px 5px;border-radius:4px;background:${defeated ? 'rgba(22,163,74,0.35)' : 'rgba(51,65,85,0.5)'};color:${defeated ? '#4ade80' : '#94a3b8'};">${defeated ? '✅ 已击破' : '未击破'}</span>
                    </div>
                    <div style="font-size:11px;color:#94a3b8;margin-top:2px;">基础血量 ${b.baseHp} · ${b.goldReward}G / ${b.crystalReward || 0}木</div>
                    <div style="font-size:11px;color:#fde047;margin-top:2px;">掉落：${(b.dropItems || []).map((d) => getItemDef(d.itemId)?.name).join('、') || '随机强化资源'}</div>
                  </div>
                </div>
              `;
              })
              .join('')}
          </div>
        </div>
      </div>
    `;
  }

  private renderDailyTab(): string {
    const save = SaveManager.get();
    const canSign = SaveManager.canCheckInToday();
    const endlessRows = Object.entries(save.bestEndlessWave).sort((a, b) => b[1] - a[1]);

    return `
      <div class="lobby-inner-col">
        <div class="war3-card war3-stone-panel">
          <div class="card-head-flex">
            <div class="card-title-with-ico">
              <img src="${IconAtlas.getDataUrl('ui_ico_daily')}" alt="" />
              <strong>7日圣殿补给签到（已连续 ${save.daily.signStreak} 天）</strong>
            </div>
            <button class="war3-btn war3-btn-gold" id="btn-checkin" ${canSign ? '' : 'disabled'}>
              ${canSign ? '领取今日签到荣誉点' : '今日已签到'}
            </button>
          </div>
          <div style="display:grid;grid-template-columns:repeat(7,1fr);gap:6px;margin-top:10px;">
            ${DAILY_CHECKIN_REWARDS.map(
              (d) => `
              <div style="text-align:center;padding:8px 4px;border-radius:7px;border:1px solid ${d.day <= save.daily.signStreak ? '#4ade80' : '#475569'};background:rgba(12,17,27,0.85);">
                <div style="font-size:11px;color:#94a3b8;">第${d.day}天</div>
                <div style="font-size:13px;font-weight:800;color:#fde047;">+${d.honor}</div>
              </div>`
            ).join('')}
          </div>
        </div>

        <div class="war3-card war3-stone-panel">
          <strong style="color:var(--war3-gold-bright);font-size:15px;">每日战斗悬赏</strong>
          <div style="display:flex;flex-direction:column;gap:8px;margin-top:8px;">
            ${DAILY_MISSIONS.map((m) => {
              const cur = Math.min(m.target, save.daily.missionProgress[m.id] || 0);
              const claimed = save.daily.claimedIds.includes(m.id);
              return `
                <div style="display:flex;justify-content:space-between;align-items:center;border:1px solid #334155;border-radius:7px;padding:8px 12px;background:rgba(12,17,27,0.78);">
                  <div>
                    <div style="font-size:13px;font-weight:700;color:#f1f5f9;">${m.title}</div>
                    <div style="font-size:11px;color:#94a3b8;">进度 ${cur}/${m.target} · 奖励 ${m.rewardHonor} 荣誉点</div>
                  </div>
                  <button class="war3-btn ${claimed ? '' : 'war3-btn-green'}" data-claim-dm="${m.id}" ${claimed || cur < m.target ? 'disabled' : ''}>
                    ${claimed ? '已领取' : cur >= m.target ? '领取奖励' : '进行中'}
                  </button>
                </div>
              `;
            }).join('')}
          </div>
        </div>

        <div class="war3-card war3-stone-panel">
          <strong style="color:var(--war3-gold-bright);font-size:15px;">个人无尽守卫最高波次纪录</strong>
          ${
            endlessRows.length === 0
              ? '<div style="font-size:12px;color:#94a3b8;margin-top:6px;">暂无战绩，快进入圣殿开启第一场守护吧！</div>'
              : `<div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:8px;">
                  ${endlessRows
                    .map(([k, w]) => {
                      const [hid, diff] = k.split('_');
                      const hd = getHeroClassDef((hid as HeroClassId) || 'blademaster');
                      return `<span class="meta-pill">${hd.name} · N${diff}：最高第 ${w} 波</span>`;
                    })
                    .join('')}
                 </div>`
          }
        </div>
      </div>
    `;
  }

  private bindEvents(): void {
    this.root.querySelectorAll('[data-tab]').forEach((el) => {
      (el as HTMLElement).onclick = () => {
        const nextTab = (el as HTMLElement).dataset.tab as LobbyTab;
        this.setTab(nextTab);
        this.render();
      };
    });

    const btnHudMode = this.root.querySelector('#btn-hud-mode') as HTMLButtonElement | null;
    if (btnHudMode) {
      btnHudMode.onclick = () => {
        const s = SaveManager.get();
        const cur = s.hudMode || 'auto';
        const next: HudMode = cur === 'auto' ? 'touch' : cur === 'touch' ? 'pc' : 'auto';
        s.hudMode = next;
        SaveManager.save();
        this.cbs?.onHudModeChange?.(next);
        this.render();
      };
    }

    const btnFullscreen = this.root.querySelector('#btn-fullscreen') as HTMLButtonElement | null;
    if (btnFullscreen) {
      btnFullscreen.onclick = () => this.cbs?.onToggleFullscreen?.();
    }

    const btnCtrl = this.root.querySelector('#btn-ctrl-mode') as HTMLButtonElement | null;
    if (btnCtrl) {
      btnCtrl.onclick = () => {
        const s = SaveManager.get();
        s.rightClickMove = !s.rightClickMove;
        SaveManager.save();
        this.render();
      };
    }

    const btnSfx = this.root.querySelector('#btn-sfx-toggle') as HTMLButtonElement | null;
    if (btnSfx) {
      btnSfx.onclick = () => {
        SoundFX.setSfxMuted(!SoundFX.isSfxMuted());
        this.render();
      };
    }

    const btnBgm = this.root.querySelector('#btn-bgm-toggle') as HTMLButtonElement | null;
    if (btnBgm) {
      btnBgm.onclick = () => {
        SoundFX.setBgmMuted(!SoundFX.isBgmMuted());
        this.render();
      };
    }

    const btnInstall = this.root.querySelector('#btn-hub-install') as HTMLButtonElement | null;
    if (btnInstall) {
      btnInstall.onclick = async () => {
        const plat = PwaInstallManager.getInstallGuidePlatform();
        if (plat !== 'android' && PwaInstallManager.hasNativeInstallPrompt()) {
          const outcome = await PwaInstallManager.triggerNativeInstallPrompt();
          if (outcome === 'accepted') {
            SoundFX.playEventFanfare();
            btnInstall.style.display = 'none';
            return;
          }
          if (outcome === 'dismissed') return;
        }
        this.openInstallAppGuide();
      };
    }

    this.root.querySelectorAll('[data-pick-hero]').forEach((el) => {
      (el as HTMLElement).onclick = (ev) => {
        if ((ev.target as HTMLElement).dataset.unlockHero) return;
        const id = (el as HTMLElement).dataset.pickHero as HeroClassId;
        if (SaveManager.get().unlockedHeroes.includes(id)) {
          SaveManager.selectHero(id);
          this.render();
        }
      };
    });

    this.root.querySelectorAll('[data-unlock-hero]').forEach((el) => {
      (el as HTMLElement).onclick = (ev) => {
        ev.stopPropagation();
        const id = (el as HTMLElement).dataset.unlockHero as HeroClassId;
        if (SaveManager.unlockHero(id)) {
          SoundFX.playSynthesize();
          this.render();
        }
      };
    });

    this.root.querySelectorAll('[data-pick-diff]').forEach((el) => {
      (el as HTMLElement).onclick = () => {
        this.selectedDifficulty = Number((el as HTMLElement).dataset.pickDiff) as DifficultyLevel;
        this.render();
      };
    });

    this.root.querySelectorAll('[data-ai-count]').forEach((el) => {
      (el as HTMLElement).onclick = () => {
        SaveManager.get().aiSquadCount = Number((el as HTMLElement).dataset.aiCount);
        SaveManager.save();
        this.render();
      };
    });

    const btnStart = this.root.querySelector('#btn-start-solo') as HTMLButtonElement | null;
    if (btnStart) {
      btnStart.onclick = () => {
        const s = SaveManager.get();
        this.onLaunchSolo(s.selectedHero, this.selectedDifficulty, s.aiSquadCount);
      };
    }

    const btnSaveName = this.root.querySelector('#btn-save-callsign') as HTMLButtonElement | null;
    if (btnSaveName) {
      btnSaveName.onclick = () => {
        const inp = this.root.querySelector('#inp-callsign') as HTMLInputElement;
        SaveManager.setCallsign(inp.value);
        this.render();
      };
    }
    this.root.querySelectorAll('[data-pre-diff]').forEach((el) => {
      (el as HTMLElement).onclick = () => {
        this.selectedDifficulty = Number((el as HTMLElement).dataset.preDiff) as DifficultyLevel;
        this.render();
      };
    });
    const inpRoomTitle = this.root.querySelector('#inp-room-title') as HTMLInputElement | null;
    if (inpRoomTitle) {
      inpRoomTitle.oninput = () => {
        this.roomTitleDraft = inpRoomTitle.value;
      };
    }
    const btnQuick = this.root.querySelector('#btn-quick-match') as HTMLButtonElement | null;
    if (btnQuick) {
      btnQuick.onclick = () => CoopManager.quickMatchOrCreate(this.selectedDifficulty);
    }
    const btnCreate = this.root.querySelector('#btn-create-room') as HTMLButtonElement | null;
    if (btnCreate) {
      btnCreate.onclick = () => {
        this.hostTitleDraft = '';
        CoopManager.createHostRoom(this.selectedDifficulty, true, this.roomTitleDraft);
      };
    }
    const btnRefreshHall = this.root.querySelector('#btn-refresh-hall') as HTMLButtonElement | null;
    if (btnRefreshHall) {
      btnRefreshHall.onclick = () => {
        CoopManager.refreshPublicRooms();
        this.hallStatusHint = '已同步广播检索全网房间…';
        const hintEl = this.root.querySelector('#coop-hall-sync-hint') as HTMLElement | null;
        if (hintEl) hintEl.textContent = this.hallStatusHint;
        this.refreshDirectoryDom();
        window.setTimeout(() => {
          this.hallStatusHint = '每 3 秒自动刷新可加入房';
          const h = this.root.querySelector('#coop-hall-sync-hint') as HTMLElement | null;
          if (h) h.textContent = this.hallStatusHint;
        }, 1600);
      };
    }
    this.root.querySelectorAll('[data-hall-filter]').forEach((el) => {
      (el as HTMLElement).onclick = () => {
        this.hallFilter = (el as HTMLElement).dataset.hallFilter as HallFilter;
        this.root.querySelectorAll('[data-hall-filter]').forEach((btn) => {
          btn.classList.toggle('active', (btn as HTMLElement).dataset.hallFilter === this.hallFilter);
        });
        this.refreshDirectoryDom();
      };
    });
    this.bindPublicJoinButtons();
    const inpHostTitle = this.root.querySelector('#inp-host-title') as HTMLInputElement | null;
    if (inpHostTitle) {
      inpHostTitle.oninput = () => {
        this.hostTitleDraft = inpHostTitle.value;
      };
      inpHostTitle.onkeydown = (ev) => {
        if (ev.key === 'Enter') {
          CoopManager.setHostRoomTitle(inpHostTitle.value);
          this.hostTitleDraft = '';
        }
      };
    }
    const btnSaveTitle = this.root.querySelector('#btn-save-title') as HTMLButtonElement | null;
    if (btnSaveTitle && inpHostTitle) {
      btnSaveTitle.onclick = () => {
        CoopManager.setHostRoomTitle(inpHostTitle.value);
        this.hostTitleDraft = '';
      };
    }
    this.root.querySelectorAll('[data-kick-peer]').forEach((el) => {
      (el as HTMLElement).onclick = () => {
        const pid = (el as HTMLElement).dataset.kickPeer;
        if (pid) CoopManager.kickLobbyMember(pid);
      };
    });
    const inpRoomChat = this.root.querySelector('#inp-room-chat') as HTMLInputElement | null;
    if (inpRoomChat) {
      inpRoomChat.oninput = () => {
        this.chatInputDraft = inpRoomChat.value;
      };
      inpRoomChat.onkeydown = (ev) => {
        if (ev.key === 'Enter') {
          const text = inpRoomChat.value.trim();
          if (text) {
            this.chatInputDraft = '';
            CoopManager.sendRoomChat(text);
          }
        }
      };
    }
    const btnSendChat = this.root.querySelector('#btn-send-chat') as HTMLButtonElement | null;
    if (btnSendChat && inpRoomChat) {
      btnSendChat.onclick = () => {
        const text = inpRoomChat.value.trim();
        if (text) {
          this.chatInputDraft = '';
          CoopManager.sendRoomChat(text);
        }
      };
    }
    this.root.querySelectorAll('[data-quick-chat]').forEach((el) => {
      (el as HTMLElement).onclick = () => {
        const text = (el as HTMLElement).dataset.quickChat || '';
        if (text) CoopManager.sendRoomChat(text);
      };
    });
    const chatLogEl = this.root.querySelector('#coop-chat-log') as HTMLElement | null;
    if (chatLogEl) {
      chatLogEl.scrollTop = chatLogEl.scrollHeight;
    }
    const btnTogglePublic = this.root.querySelector('#btn-toggle-public') as HTMLButtonElement | null;
    if (btnTogglePublic) {
      btnTogglePublic.onclick = () => CoopManager.toggleHostPublicRoom();
    }
    const inpCode = this.root.querySelector('#inp-room-code') as HTMLInputElement | null;
    if (inpCode) {
      inpCode.oninput = () => {
        this.joinCodeInput = inpCode.value.toUpperCase();
      };
    }
    const btnJoin = this.root.querySelector('#btn-join-room') as HTMLButtonElement | null;
    if (btnJoin) {
      btnJoin.onclick = () => CoopManager.joinRoomByCode(this.joinCodeInput);
    }
    const btnCopyLink = this.root.querySelector('#btn-copy-link') as HTMLButtonElement | null;
    if (btnCopyLink) {
      btnCopyLink.onclick = async () => {
        const url = CoopManager.getInviteUrl();
        try {
          await navigator.clipboard.writeText(url);
          this.copyMsg = `已复制邀请链接：${url}`;
        } catch {
          this.copyMsg = `邀请链接：${url}`;
        }
        this.render();
      };
    }
    const btnLeave = this.root.querySelector('#btn-leave-room') as HTMLButtonElement | null;
    if (btnLeave) {
      btnLeave.onclick = () => {
        this.hostTitleDraft = '';
        this.chatInputDraft = '';
        CoopManager.disconnect();
      };
    }
    this.root.querySelectorAll('[data-coop-hero]').forEach((el) => {
      (el as HTMLElement).onclick = () => CoopManager.setMyHeroClass((el as HTMLElement).dataset.coopHero as HeroClassId);
    });
    this.root.querySelectorAll('[data-coop-diff]').forEach((el) => {
      (el as HTMLElement).onclick = () => CoopManager.setHostDifficulty(Number((el as HTMLElement).dataset.coopDiff) as DifficultyLevel);
    });
    const btnLaunchCoop = this.root.querySelector('#btn-launch-coop') as HTMLButtonElement | null;
    if (btnLaunchCoop) {
      btnLaunchCoop.onclick = () => {
        CoopManager.launchHostMatch();
        if (this.root.querySelector('#btn-launch-coop')) {
          this.onLaunchCoop();
        }
      };
    }
    const btnReady = this.root.querySelector('#btn-toggle-ready') as HTMLButtonElement | null;
    if (btnReady) {
      btnReady.onclick = () => CoopManager.toggleClientReady();
    }

    this.root.querySelectorAll('[data-upg-talent]').forEach((el) => {
      (el as HTMLElement).onclick = () => {
        const key = (el as HTMLElement).dataset.upgTalent as keyof ReturnType<typeof SaveManager.get>['talents'];
        if (SaveManager.upgradeTalent(key)) {
          SoundFX.playSynthesize();
          this.render();
        }
      };
    });
    this.root.querySelectorAll('[data-codex-item]').forEach((el) => {
      (el as HTMLElement).onclick = () => {
        this.selectedCodexItemId = (el as HTMLElement).dataset.codexItem || 'myth_frostmourne';
        this.render();
      };
    });
    const btnSign = this.root.querySelector('#btn-checkin') as HTMLButtonElement | null;
    if (btnSign) {
      btnSign.onclick = () => {
        if (SaveManager.claimCheckIn() > 0) {
          SoundFX.playSynthesize();
          this.render();
        }
      };
    }
    this.root.querySelectorAll('[data-claim-dm]').forEach((el) => {
      (el as HTMLElement).onclick = () => {
        const id = (el as HTMLElement).dataset.claimDm || '';
        if (SaveManager.claimDailyMission(id) > 0) {
          SoundFX.playSynthesize();
          this.render();
        }
      };
    });
  }
}
