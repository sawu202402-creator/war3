import { SoundFX } from '../audio/SoundFX';
import { DIFFICULTIES, HERO_CLASSES, TALENT_TRACKS, getHeroClassDef } from '../data/heroes';
import { ITEMS, RARITY_META, getItemDef } from '../data/items';
import { ENEMY_ARCHETYPES } from '../data/waves';
import { IconAtlas } from '../engine/IconAtlas';
import { DAILY_CHECKIN_REWARDS, DAILY_MISSIONS, SaveManager } from '../meta/SaveManager';
import { CoopManager } from '../net/CoopManager';
import { DifficultyLevel, HeroClassDef, HeroClassId, HudMode } from '../types';

type LobbyTab = 'solo' | 'coop' | 'talents' | 'codex' | 'daily';

export class LobbyUI {
  private tab: LobbyTab = 'solo';
  private selectedDifficulty: DifficultyLevel = 1;
  private selectedCodexItemId = 'myth_frostmourne';
  private joinCodeInput = '';
  private copyMsg = '';

  constructor(
    private root: HTMLElement,
    private onLaunchSolo: (hero: HeroClassId, diff: DifficultyLevel, aiCount: number) => void,
    private onLaunchCoop: () => void,
    private cbs?: {
      onHudModeChange?: (mode: HudMode) => void;
      onToggleFullscreen?: () => void;
    }
  ) {}

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
          </div>
        </div>

        <div class="lobby-nav">
          <button class="nav-tab ${this.tab === 'solo' ? 'active' : ''}" data-tab="solo">
            <img src="${IconAtlas.getDataUrl('ui_ico_battle')}" alt="" />
            <span>单人征战</span>
          </button>
          <button class="nav-tab ${this.tab === 'coop' ? 'active' : ''}" data-tab="coop">
            <img src="${IconAtlas.getDataUrl('ui_ico_coop')}" alt="" />
            <span>1–4人联机</span>
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
              <strong style="color:#4ade80;font-size:14px;">🌐 公开联机大厅 (${publicRooms.length} 房间在线)</strong>
              <span style="font-size:11px;color:#94a3b8;">每 3 秒自动刷新可加入房</span>
            </div>
            <div class="coop-public-list">
              ${
                publicRooms.length === 0
                  ? `<div class="coop-empty-slot">暂无公开房间，可点击上方【一键快速匹配】自动加入或新建公开房</div>`
                  : publicRooms
                      .map(
                        (r) => `
                  <div class="coop-public-row">
                    <div>
                      <span style="font-weight:800;color:#fde047;">[${r.roomCode}]</span>
                      <span style="color:#f8fafc;font-weight:700;margin-left:6px;">房主 ${r.hostName}</span>
                      <span style="font-size:11px;color:#38bdf8;margin-left:6px;">难度 N${r.difficulty} · ${r.inGame ? `第 ${r.wave} 波战斗中` : '等候发车'}</span>
                    </div>
                    <div style="display:flex;align-items:center;gap:8px;">
                      <span style="font-size:12px;color:#4ade80;font-weight:800;">${r.memberCount}/${r.maxMembers}</span>
                      <button class="war3-btn war3-btn-blue" data-join-public="${r.roomCode}" style="padding:5px 12px;font-size:12px;">${r.inGame ? '中途加入' : '加入'}</button>
                    </div>
                  </div>`
                      )
                      .join('')
              }
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
            <span style="font-size:12px;color:#94a3b8;">房间号：</span>
            <strong style="font-size:22px;color:#fde047;letter-spacing:3px;">${lobby.roomCode}</strong>
            <span style="margin-left:10px;font-size:12px;color:#4ade80;">${CoopManager.getNetStatusLabel()}</span>
          </div>
          <div style="display:flex;gap:8px;flex-wrap:wrap;">
            ${isHost ? `<button class="war3-btn ${lobby.isPublic !== false ? 'war3-btn-green' : ''}" id="btn-toggle-public">${lobby.isPublic !== false ? '🌐 公开房间' : '🔒 仅限邀请'}</button>` : ''}
            <button class="war3-btn war3-btn-blue" id="btn-copy-link">复制邀请链接</button>
            <button class="war3-btn war3-btn-red" id="btn-leave-room">离开房间</button>
          </div>
          ${this.copyMsg ? `<div style="width:100%;font-size:12px;color:#4ade80;">${this.copyMsg}</div>` : ''}
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
                      <div>
                        <div style="font-weight:800;font-size:13px;color:${m.color};">${m.callsign} ${m.isHost ? '[房主]' : ''}</div>
                        <div style="font-size:11px;color:#cbd5e1;">${hd.name} · ${m.ready ? '已准备' : '未准备'}</div>
                      </div>
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
    const btnQuick = this.root.querySelector('#btn-quick-match') as HTMLButtonElement | null;
    if (btnQuick) {
      btnQuick.onclick = () => CoopManager.quickMatchOrCreate(this.selectedDifficulty);
    }
    const btnCreate = this.root.querySelector('#btn-create-room') as HTMLButtonElement | null;
    if (btnCreate) {
      btnCreate.onclick = () => CoopManager.createHostRoom(this.selectedDifficulty, true);
    }
    this.root.querySelectorAll('[data-join-public]').forEach((el) => {
      (el as HTMLElement).onclick = () => CoopManager.joinRoomByCode((el as HTMLElement).dataset.joinPublic!);
    });
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
      btnLeave.onclick = () => CoopManager.disconnect();
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
