import { SoundFX } from '../audio/SoundFX';
import { DIFFICULTIES, HERO_CLASSES, TALENT_TRACKS, getHeroClassDef } from '../data/heroes';
import { ITEMS, RARITY_META, getItemDef } from '../data/items';
import { ENEMY_ARCHETYPES } from '../data/waves';
import { IconAtlas } from '../engine/IconAtlas';
import { DAILY_CHECKIN_REWARDS, DAILY_MISSIONS, SaveManager } from '../meta/SaveManager';
import { CoopManager } from '../net/CoopManager';
import { DifficultyLevel, HeroClassId } from '../types';

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
    private onLaunchCoop: () => void
  ) {}

  public setTab(tab: LobbyTab): void {
    this.tab = tab;
  }

  public render(): void {
    const save = SaveManager.get();
    const selHero = getHeroClassDef(save.selectedHero);

    this.root.innerHTML = `
      <div class="lobby-backdrop">
        <div class="lobby-topbar">
          <div class="lobby-brand">
            <h1>⚔️ 圣殿守卫战 · ATHENA SIEGE</h1>
            <span>魔兽防守 RPG · 20波+无尽</span>
          </div>
          <div class="lobby-meta-bar">
            <span class="meta-pill">🏅 荣誉点: ${save.honorCoins}</span>
            <span class="meta-pill">💀 生涯击杀: ${save.careerKills}</span>
            <button class="war3-btn" id="btn-ctrl-mode" style="padding:4px 10px;font-size:11px">
              操作: ${save.rightClickMove ? '右键寻路+QWER' : 'WASD+指哪打哪'}
            </button>
            <button class="war3-btn" id="btn-sfx-toggle" style="padding:4px 9px;font-size:11px">
              ${SoundFX.isSfxMuted() ? '🔇 音效关' : '🔊 音效开'}
            </button>
            <button class="war3-btn" id="btn-bgm-toggle" style="padding:4px 9px;font-size:11px">
              ${SoundFX.isBgmMuted() ? '🎵 音乐关' : '🎶 音乐开'}
            </button>
          </div>
        </div>

        <div class="lobby-nav">
          <button class="nav-tab ${this.tab === 'solo' ? 'active' : ''}" data-tab="solo">⚔️ 单人征战</button>
          <button class="nav-tab ${this.tab === 'coop' ? 'active' : ''}" data-tab="coop">🤝 1–4人联机</button>
          <button class="nav-tab ${this.tab === 'talents' ? 'active' : ''}" data-tab="talents">🧬 圣殿传承</button>
          <button class="nav-tab ${this.tab === 'codex' ? 'active' : ''}" data-tab="codex">📖 神装合成 & 图鉴</button>
          <button class="nav-tab ${this.tab === 'daily' ? 'active' : ''}" data-tab="daily">📅 每日军务 & 无尽榜</button>
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

  private renderSoloTab(selectedId: HeroClassId): string {
    const save = SaveManager.get();
    const sel = getHeroClassDef(selectedId);
    const mastery = SaveManager.getHeroMasteryLevel(sel.id);
    const diffCfg = DIFFICULTIES[this.selectedDifficulty];

    return `
      <div style="display:flex;flex-direction:column;gap:12px;max-width:1120px;margin:0 auto;">
        <div class="lobby-hero-banner">
          <img src="${IconAtlas.getDataUrl('hub_banner')}" alt="圣殿守卫战" />
          <div class="lobby-hero-banner-overlay">
            <div style="font-size:11px;letter-spacing:2px;color:#fde68a;font-weight:800;">CLASSIC WARCRAFT III DEFENSE RPG</div>
            <div style="font-size:20px;font-weight:900;color:#ffffff;text-shadow:0 2px 8px rgba(0,0,0,0.85);">守卫雅典娜圣殿 · 20波神魔决战与无尽守卫</div>
          </div>
        </div>
        <div class="war3-card">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;flex-wrap:wrap;gap:8px;">
            <strong style="color:var(--war3-gold-bright);font-size:15px;">选择守护英雄（5 大经典魔兽职业 · Lv.15 双分支觉醒）</strong>
            <span style="font-size:12px;color:var(--war3-muted);">当前熟练度：Lv.${mastery.level} (${mastery.curXp}/${mastery.nextXp})</span>
          </div>
          <div class="hero-grid">
            ${HERO_CLASSES.map((h) => {
              const unlocked = save.unlockedHeroes.includes(h.id);
              const isSel = h.id === selectedId;
              return `
                <div class="hero-card ${isSel ? 'selected' : ''}" data-pick-hero="${h.id}">
                  <div class="hero-card-head">
                    <img src="${IconAtlas.getDataUrl(`hero_${h.id}`)}" alt="" />
                    <div>
                      <div style="font-weight:800;color:${h.color};font-size:14px;">${h.name}</div>
                      <div style="font-size:11px;color:#94a3b8;">${h.roleTag}</div>
                    </div>
                  </div>
                  <div style="font-size:11px;color:#cbd5e1;">被动【${h.passiveName}】</div>
                  ${
                    unlocked
                      ? `<div style="font-size:11px;color:${isSel ? '#fde047' : '#4ade80'};font-weight:700;">${isSel ? '✅ 已出战' : '点击选择'}</div>`
                      : `<button class="war3-btn war3-btn-gold" data-unlock-hero="${h.id}" style="padding:4px 8px;font-size:11px;">解锁 (${h.unlockCost} 荣誉点)</button>`
                  }
                </div>
              `;
            }).join('')}
          </div>

          <div style="margin-top:12px;padding-top:10px;border-top:1px solid rgba(200,162,74,0.24);">
            <div style="font-size:13px;font-weight:800;color:${sel.color};margin-bottom:4px;">
              【${sel.name} · ${sel.title}】被动：${sel.passiveDesc}
            </div>
            <div style="font-size:11.5px;color:#94a3b8;">
              觉醒分支：${sel.awakeningBranches.map((b) => `<strong style="color:${b.color}">${b.name}</strong> (${b.tag})`).join(' ｜ ')}
            </div>
            <div class="hero-skill-preview">
              ${sel.skills
                .map(
                  (sk) => `
                  <div class="skill-row">
                    <img src="${IconAtlas.getDataUrl(sk.iconKey)}" alt="" />
                    <div>
                      <div style="font-size:12px;font-weight:800;color:#fef3c7;">[${sk.keyLabel}] ${sk.name} ${sk.isUlt ? '<span style="color:#fb7185">大招</span>' : ''}</div>
                      <div style="font-size:11px;color:#94a3b8;line-height:1.35;">${sk.desc}</div>
                    </div>
                  </div>
                `
                )
                .join('')}
            </div>
          </div>
        </div>

        <div class="war3-card" style="display:flex;flex-wrap:wrap;gap:14px;align-items:center;justify-content:space-between;">
          <div style="display:flex;flex-direction:column;gap:8px;flex:1;min-width:260px;">
            <strong style="font-size:14px;color:var(--war3-gold-bright);">选择战区难度 & AI 队友</strong>
            <div class="diff-row">
              ${([1, 2, 3, 4, 5] as DifficultyLevel[])
                .map((d) => {
                  const cfg = DIFFICULTIES[d];
                  const locked = d > save.maxClearedDifficulty + 1 && d > 2; // N1/N2 directly playable, N3+ unlock on clear
                  return `
                    <button class="diff-pill ${this.selectedDifficulty === d ? 'active' : ''}" data-pick-diff="${d}" ${locked ? 'disabled' : ''}>
                      ${locked ? '🔒 ' : ''}${cfg.shortName}
                    </button>
                  `;
                })
                .join('')}
            </div>
            <div style="font-size:11.5px;color:${diffCfg.color};">${diffCfg.desc}</div>
            <div style="display:flex;align-items:center;gap:8px;margin-top:2px;">
              <span style="font-size:12px;color:#cbd5e1;font-weight:700;">单人 AI 队友数量:</span>
              ${[0, 1, 2, 3]
                .map(
                  (n) => `<button class="diff-pill ${save.aiSquadCount === n ? 'active' : ''}" data-ai-count="${n}">${n} 名</button>`
                )
                .join('')}
              <span style="font-size:11px;color:#94a3b8;">（局内可一键切换AI留守圣殿或跟随下副本）</span>
            </div>
          </div>
          <button class="war3-btn war3-btn-gold" id="btn-start-solo" style="padding:14px 28px;font-size:16px;">
            ⚔️ 进入圣殿防守战
          </button>
        </div>
      </div>
    `;
  }

  private renderCoopTab(): string {
    const save = SaveManager.get();
    const lobby = CoopManager.lobby;

    if (!lobby) {
      return `
        <div style="max-width:860px;margin:0 auto;display:flex;flex-direction:column;gap:12px;">
          <div class="war3-card">
            <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:8px;">
              <div>
                <strong style="color:var(--war3-gold-bright);font-size:15px;">🌐 零服务器 WebRTC P2P + 云中继 1–4 人联机</strong>
                <div style="font-size:12px;color:#94a3b8;margin-top:3px;">房主建房后分享 5 位房间码或邀请链接，支持手机/PC跨平台开黑、装备金币互赠！</div>
              </div>
              <div style="display:flex;gap:6px;align-items:center;">
                <input id="inp-callsign" value="${save.callsign}" maxlength="12" style="background:#0f172a;border:1px solid #785b22;color:#fff;padding:6px 10px;border-radius:6px;width:130px;" />
                <button class="war3-btn" id="btn-save-callsign">改名</button>
              </div>
            </div>
          </div>

          ${CoopManager.status === 'connecting' ? `<div class="war3-card" style="color:#38bdf8;font-weight:700;">⏳ 正在建立房间信号通道，请稍候...</div>` : ''}
          ${CoopManager.errorMsg ? `<div class="war3-card" style="border-color:#f43f5e;color:#fda4af;">❌ ${CoopManager.errorMsg}</div>` : ''}

          <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:12px;">
            <div class="war3-card" style="display:flex;flex-direction:column;gap:10px;">
              <strong style="color:#fde047;font-size:15px;">📡 创建守城房间（房主）</strong>
              <p style="margin:0;font-size:12px;color:#94a3b8;">创建 1–4 人协防房间，房主控制波次模拟与难度选择，Boss 材料独立掉落！</p>
              <button class="war3-btn war3-btn-gold" id="btn-create-room">➕ 创建 1–4 人联机房间</button>
            </div>
            <div class="war3-card" style="display:flex;flex-direction:column;gap:10px;">
              <strong style="color:#38bdf8;font-size:15px;">🔑 输入房间码加入</strong>
              <input id="inp-room-code" value="${this.joinCodeInput}" placeholder="输入 5 位房间码" maxlength="6" style="background:#0f172a;border:1px solid #38bdf8;color:#fff;padding:8px 12px;border-radius:6px;font-size:15px;letter-spacing:2px;text-transform:uppercase;" />
              <button class="war3-btn war3-btn-blue" id="btn-join-room">🚀 加入好友小队</button>
            </div>
          </div>
        </div>
      `;
    }

    const isHost = CoopManager.role === 'host';
    const me = lobby.members.find((m) => m.peerId === CoopManager.myPeerId);

    return `
      <div style="max-width:920px;margin:0 auto;display:flex;flex-direction:column;gap:12px;">
        <div class="war3-card" style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:10px;">
          <div>
            <span style="font-size:12px;color:#94a3b8;">房间号：</span>
            <strong style="font-size:22px;color:#fde047;letter-spacing:3px;">${lobby.roomCode}</strong>
            <span style="margin-left:10px;font-size:12px;color:#4ade80;">${CoopManager.getNetStatusLabel()}</span>
          </div>
          <div style="display:flex;gap:8px;flex-wrap:wrap;">
            <button class="war3-btn war3-btn-blue" id="btn-copy-link">🔗 复制直接邀请链接</button>
            <button class="war3-btn war3-btn-red" id="btn-leave-room">🚪 离开房间</button>
          </div>
          ${this.copyMsg ? `<div style="width:100%;font-size:12px;color:#4ade80;">${this.copyMsg}</div>` : ''}
        </div>

        <div class="war3-card">
          <strong style="color:var(--war3-gold-bright);font-size:14px;">小队成员 (${lobby.members.length}/4)</strong>
          <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:8px;margin-top:8px;">
            ${[0, 1, 2, 3]
              .map((slot) => {
                const m = lobby.members.find((x) => x.slot === slot);
                if (!m) {
                  return `<div style="border:1px dashed #334155;border-radius:8px;padding:12px;color:#64748b;font-size:12px;display:flex;align-items:center;justify-content:center;">P${slot + 1} 等待队友加入...</div>`;
                }
                const hd = getHeroClassDef(m.heroClass);
                return `
                  <div style="border:1.5px solid ${m.color};border-radius:8px;padding:10px;background:rgba(15,23,42,0.86);">
                    <div style="display:flex;align-items:center;gap:8px;">
                      <img src="${IconAtlas.getDataUrl(`hero_${m.heroClass}`)}" style="width:36px;height:36px;border-radius:6px;" alt="" />
                      <div>
                        <div style="font-weight:800;font-size:13px;color:${m.color};">${m.callsign} ${m.isHost ? '👑' : ''}</div>
                        <div style="font-size:11px;color:#cbd5e1;">${hd.name} · ${m.ready ? '✅ 已准备' : '⏳ 未准备'}</div>
                      </div>
                    </div>
                  </div>
                `;
              })
              .join('')}
          </div>
        </div>

        <div class="war3-card" style="display:flex;flex-wrap:wrap;gap:10px;align-items:center;justify-content:space-between;">
          <div style="display:flex;gap:6px;flex-wrap:wrap;align-items:center;">
            <span style="font-size:12px;color:#cbd5e1;font-weight:700;">我的出战英雄:</span>
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
                  <button class="war3-btn war3-btn-gold" id="btn-launch-coop" style="padding:10px 20px;">🚀 全队出击</button>
                </div>
              `
              : `<button class="war3-btn ${me?.ready ? 'war3-btn-green' : 'war3-btn-blue'}" id="btn-toggle-ready">${me?.ready ? '✅ 已准备（等待房主开局）' : '🙋 点击准备'}</button>`
          }
        </div>
      </div>
    `;
  }

  private renderTalentsTab(): string {
    const save = SaveManager.get();
    return `
      <div style="max-width:960px;margin:0 auto;display:flex;flex-direction:column;gap:12px;">
        <div class="war3-card">
          <strong style="color:var(--war3-gold-bright);font-size:15px;">🧬 圣殿永久传承天赋（消耗荣誉点，保留局内从零发育乐趣）</strong>
          <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:10px;margin-top:10px;">
            ${TALENT_TRACKS.map((tr) => {
              const lv = save.talents[tr.key] || 0;
              const maxed = lv >= tr.maxLevel;
              const cost = SaveManager.getTalentUpgradeCost(tr.key);
              return `
                <div style="border:1px solid var(--war3-gold-dim);border-radius:8px;padding:10px;background:rgba(15,23,42,0.85);display:flex;flex-direction:column;gap:5px;">
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
      <div style="max-width:1060px;margin:0 auto;display:flex;flex-direction:column;gap:12px;">
        <div class="war3-card">
          <strong style="color:var(--war3-gold-bright);font-size:15px;">⚒️ 装备合成路线图鉴（点击查看子部件材料）</strong>
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
                <div style="margin-top:12px;padding:12px;border-radius:8px;border:1.5px solid ${RARITY_META[sel.rarity].border};background:rgba(10,14,22,0.9);">
                  <div style="display:flex;align-items:center;gap:10px;">
                    <img src="${IconAtlas.getDataUrl(sel.iconKey)}" style="width:46px;height:46px;border-radius:6px;" alt="" />
                    <div>
                      <div style="font-size:15px;font-weight:800;color:${RARITY_META[sel.rarity].color};">${sel.name}</div>
                      <div style="font-size:12px;color:#cbd5e1;">${sel.desc}</div>
                    </div>
                  </div>
                  <div style="margin-top:10px;font-size:12px;color:#fde047;font-weight:700;">
                    合成配方：${sel.recipe!.items.map((id) => `【${getItemDef(id)?.name || id}】`).join(' + ')}
                    ${sel.recipe!.gold ? ` + ${sel.recipe!.gold} 金币` : ''}
                    ${sel.recipe!.crystal ? ` + ${sel.recipe!.crystal} 灵晶` : ''}
                  </div>
                </div>
              `
              : ''
          }
        </div>

        <div class="war3-card">
          <strong style="color:var(--war3-gold-bright);font-size:15px;">👹 魔神与秘境 Boss 图鉴</strong>
          <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:8px;margin-top:8px;">
            ${bosses
              .map(
                (b) => `
                <div style="border:1px solid ${b.accentColor};border-radius:8px;padding:8px;background:rgba(15,23,42,0.85);">
                  <div style="font-weight:800;color:${b.accentColor};font-size:13px;">${b.name}</div>
                  <div style="font-size:11px;color:#94a3b8;margin-top:3px;">基础血量 ${b.baseHp} · 奖励 ${b.goldReward}G / ${b.crystalReward || 0}木</div>
                  <div style="font-size:11px;color:#fde047;margin-top:2px;">掉落：${(b.dropItems || []).map((d) => getItemDef(d.itemId)?.name).join('、')}</div>
                </div>
              `
              )
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
      <div style="max-width:960px;margin:0 auto;display:flex;flex-direction:column;gap:12px;">
        <div class="war3-card">
          <div style="display:flex;justify-content:space-between;align-items:center;">
            <strong style="color:var(--war3-gold-bright);font-size:15px;">📅 7日圣殿补给签到（连续 ${save.daily.signStreak} 天）</strong>
            <button class="war3-btn war3-btn-gold" id="btn-checkin" ${canSign ? '' : 'disabled'}>
              ${canSign ? '🎁 领取今日签到荣誉点' : '✅ 今日已签到'}
            </button>
          </div>
          <div style="display:grid;grid-template-columns:repeat(7,1fr);gap:6px;margin-top:10px;">
            ${DAILY_CHECKIN_REWARDS.map(
              (d) => `
              <div style="text-align:center;padding:8px 4px;border-radius:7px;border:1px solid ${d.day <= save.daily.signStreak ? '#4ade80' : '#475569'};background:rgba(15,23,42,0.8);">
                <div style="font-size:11px;color:#94a3b8;">第${d.day}天</div>
                <div style="font-size:13px;font-weight:800;color:#fde047;">+${d.honor}</div>
              </div>`
            ).join('')}
          </div>
        </div>

        <div class="war3-card">
          <strong style="color:var(--war3-gold-bright);font-size:15px;">📋 每日战斗悬赏</strong>
          <div style="display:flex;flex-direction:column;gap:8px;margin-top:8px;">
            ${DAILY_MISSIONS.map((m) => {
              const cur = Math.min(m.target, save.daily.missionProgress[m.id] || 0);
              const claimed = save.daily.claimedIds.includes(m.id);
              return `
                <div style="display:flex;justify-content:space-between;align-items:center;border:1px solid #334155;border-radius:7px;padding:8px 12px;background:rgba(15,23,42,0.75);">
                  <div>
                    <div style="font-size:13px;font-weight:700;color:#f1f5f9;">${m.title}</div>
                    <div style="font-size:11px;color:#94a3b8;">进度 ${cur}/${m.target} · 奖励 ${m.rewardHonor} 荣誉点</div>
                  </div>
                  <button class="war3-btn ${claimed ? '' : 'war3-btn-green'}" data-claim-dm="${m.id}" ${claimed || cur < m.target ? 'disabled' : ''}>
                    ${claimed ? '✅ 已领取' : cur >= m.target ? '领取奖励' : '进行中'}
                  </button>
                </div>
              `;
            }).join('')}
          </div>
        </div>

        <div class="war3-card">
          <strong style="color:var(--war3-gold-bright);font-size:15px;">🏆 个人无尽守卫最高波次纪录</strong>
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
        this.tab = (el as HTMLElement).dataset.tab as LobbyTab;
        this.render();
      };
    });

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

    // Co-op tab events
    const btnSaveName = this.root.querySelector('#btn-save-callsign') as HTMLButtonElement | null;
    if (btnSaveName) {
      btnSaveName.onclick = () => {
        const inp = this.root.querySelector('#inp-callsign') as HTMLInputElement;
        SaveManager.setCallsign(inp.value);
        this.render();
      };
    }
    const btnCreate = this.root.querySelector('#btn-create-room') as HTMLButtonElement | null;
    if (btnCreate) {
      btnCreate.onclick = () => CoopManager.createHostRoom(this.selectedDifficulty);
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
          this.copyMsg = `✅ 已复制邀请链接：${url}`;
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
        this.onLaunchCoop();
      };
    }
    const btnReady = this.root.querySelector('#btn-toggle-ready') as HTMLButtonElement | null;
    if (btnReady) {
      btnReady.onclick = () => CoopManager.toggleClientReady();
    }

    // Talents & Daily & Codex
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
