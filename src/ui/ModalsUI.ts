import { SoundFX } from '../audio/SoundFX';
import { getHeroClassDef } from '../data/heroes';
import { ITEMS, RARITY_META, getHeroRecommendedRecipeTargets, getItemDef, getUpgradesTo } from '../data/items';
import { ZONES } from '../data/worldMap';
import { getDiscountedGold, planSynthesis } from '../engine/EconomySystem';
import { GameEngine } from '../engine/GameEngine';
import { HeroEntity } from '../engine/GameState';
import { IconAtlas } from '../engine/IconAtlas';
import { TowerType, ZoneId } from '../types';

type ShopTab = 'recommended' | 'forge' | 'synth' | 'consumables' | 'books' | 'bag';

export class ModalsUI {
  private activeModal: 'none' | 'shop' | 'teleport' | 'base' | 'awaken' | 'pause' | 'settlement' = 'none';
  private shopTab: ShopTab = 'recommended';
  private modalEl: HTMLElement | null = null;
  private settlementVictory = false;

  constructor(
    private root: HTMLElement,
    private engine: GameEngine,
    private onExitToLobby: () => void,
    private onToggleFullscreen?: () => void
  ) {}

  public isOpen(): boolean {
    return this.activeModal !== 'none';
  }

  public close(): void {
    this.activeModal = 'none';
    this.modalEl?.remove();
    this.modalEl = null;
    this.engine.paused = false;
  }

  public toggleShop(): void {
    if (this.activeModal === 'shop') this.close();
    else {
      this.activeModal = 'shop';
      this.render();
    }
  }

  public toggleTeleport(): void {
    if (this.activeModal === 'teleport') this.close();
    else {
      this.activeModal = 'teleport';
      this.render();
    }
  }

  public toggleBase(): void {
    if (this.activeModal === 'base') this.close();
    else {
      this.activeModal = 'base';
      this.render();
    }
  }

  public togglePause(): void {
    if (this.activeModal === 'pause') this.close();
    else {
      this.activeModal = 'pause';
      this.engine.paused = true;
      this.render();
    }
  }

  public openAwakening(_hero: HeroEntity): void {
    this.activeModal = 'awaken';
    this.engine.paused = true;
    this.render();
  }

  public openSettlement(victory: boolean): void {
    this.activeModal = 'settlement';
    this.settlementVictory = victory;
    this.render();
  }

  public render(): void {
    this.modalEl?.remove();
    if (this.activeModal === 'none') return;

    const wrap = document.createElement('div');
    wrap.className = 'war3-modal-backdrop';
    wrap.innerHTML = `<div class="war3-modal war3-stone-panel">${this.buildContent()}</div>`;
    wrap.addEventListener('click', (e) => {
      if (e.target === wrap && this.activeModal !== 'settlement' && this.activeModal !== 'awaken') {
        this.close();
      }
    });
    this.root.appendChild(wrap);
    this.modalEl = wrap;
    this.bindModalEvents();
  }

  private buildContent(): string {
    if (this.activeModal === 'shop') return this.buildShopModal();
    if (this.activeModal === 'teleport') return this.buildTeleportModal();
    if (this.activeModal === 'base') return this.buildBaseModal();
    if (this.activeModal === 'awaken') return this.buildAwakenModal();
    if (this.activeModal === 'pause') return this.buildPauseModal();
    return this.buildSettlementModal();
  }

  private buildShopModal(): string {
    const world = this.engine.world!;
    const hero = this.engine.getLocalHero()!;
    const recIds = getHeroRecommendedRecipeTargets(hero.classId);

    let bodyHtml = '';
    if (this.shopTab === 'recommended') {
      const starters = ITEMS.filter((i) => i.shopVisible && ['wep_t1', 'arm_t1', 'acc_t1', 'boot_t1', 'pot_hp_l', 'pot_mp', 'item_ankh'].includes(i.id));
      const targets = recIds.map((id) => getItemDef(id)!).filter(Boolean);
      bodyHtml = `
        <h4 class="modal-sec-title" style="color:#fde047;">职业推荐核心神装（支持一键合成或收藏至左侧快捷出装）</h4>
        <div class="item-grid" style="margin-bottom:14px;">
          ${targets.map((it) => this.renderSynthCard(it.id)).join('')}
        </div>
        <h4 class="modal-sec-title" style="color:#cbd5e1;">起步装备与保命药剂</h4>
        <div class="item-grid">
          ${starters.map((it) => this.renderBuyCard(it.id)).join('')}
        </div>
      `;
    } else if (this.shopTab === 'forge') {
      const baseGear = ITEMS.filter((i) => i.shopVisible && (i.category === 'weapon' || i.category === 'armor' || i.category === 'accessory' || i.category === 'boots'));
      const upgradeables = hero.inventory
        .map((id, idx) => {
          if (!id) return '';
          const cur = getItemDef(id);
          const next = getUpgradesTo(id);
          if (!cur || !next) return '';
          const g = getDiscountedGold(world, next.upgradeCostGold || 0);
          return `
            <div class="item-card" style="border-color:${RARITY_META[next.rarity].border};">
              <div class="item-card-top">
                <img src="${IconAtlas.getDataUrl(next.iconKey)}" alt="" />
                <div>
                  <div style="font-weight:800;font-size:13px;color:${RARITY_META[next.rarity].color};">${cur.name} → ${next.name}</div>
                  <div style="font-size:11px;color:#94a3b8;">${next.desc}</div>
                </div>
              </div>
              <button class="war3-btn war3-btn-blue" data-upg-inv="${idx}">升阶 (${g}G${next.upgradeCostCrystal ? ` · ${next.upgradeCostCrystal}木` : ''}${next.upgradeStones ? ` · ${next.upgradeStones}石` : ''})</button>
            </div>
          `;
        })
        .join('');
      bodyHtml = `
        ${
          upgradeables
            ? `<h4 class="modal-sec-title" style="color:#38bdf8;">原地锻造升阶（已穿戴装备直接进阶）</h4>
               <div class="item-grid" style="margin-bottom:12px;">${upgradeables}</div>`
            : ''
        }
        <h4 class="modal-sec-title" style="color:#cbd5e1;">基础装备与合成散件</h4>
        <div class="item-grid">
          ${baseGear.map((it) => this.renderBuyCard(it.id)).join('')}
        </div>
      `;
    } else if (this.shopTab === 'synth') {
      const recipes = ITEMS.filter((i) => i.recipe);
      bodyHtml = `
        <div class="item-grid">
          ${recipes.map((it) => this.renderSynthCard(it.id)).join('')}
        </div>
      `;
    } else if (this.shopTab === 'consumables') {
      const cons = ITEMS.filter((i) => i.shopVisible && (i.category === 'consumable' || i.id === 'mat_stone'));
      bodyHtml = `<div class="item-grid">${cons.map((it) => this.renderBuyCard(it.id)).join('')}</div>`;
    } else if (this.shopTab === 'books') {
      const books = ITEMS.filter((i) => i.shopVisible && i.category === 'book');
      bodyHtml = `<div class="item-grid">${books.map((it) => this.renderBuyCard(it.id)).join('')}</div>`;
    } else {
      const allies = world.heroes.filter((h) => !h.isLocal);
      bodyHtml = `
        <h4 class="modal-sec-title" style="color:#fde047;">主装备栏（6 格即时生效属性）</h4>
        <div class="item-grid" style="margin-bottom:12px;">
          ${hero.inventory.map((id, idx) => this.renderSlotManageCard(id, true, idx, allies)).join('')}
        </div>
        <h4 class="modal-sec-title" style="color:#94a3b8;">随身储物箱（6 格暂存材料，合成自动读取）</h4>
        <div class="item-grid" style="margin-bottom:12px;">
          ${hero.stash.map((id, idx) => this.renderSlotManageCard(id, false, idx, allies)).join('')}
        </div>
        ${
          allies.length > 0
            ? `<div class="war3-card war3-stone-panel">
                <strong style="font-size:13px;color:#4ade80;">转赠金币 / 灵晶给队友：</strong>
                <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:6px;">
                  ${allies
                    .map(
                      (a) => `
                    <button class="war3-btn" data-gift-gold="${a.id}" style="font-size:11px;padding:4px 8px;">赠 ${a.callsign} 300G</button>
                    <button class="war3-btn war3-btn-green" data-gift-crys="${a.id}" style="font-size:11px;padding:4px 8px;">赠 ${a.callsign} 1木</button>
                  `
                    )
                    .join('')}
                </div>
               </div>`
            : ''
        }
      `;
    }

    return `
      <div class="war3-modal-head">
        <div class="modal-title-group">
          <img class="modal-head-ico" src="${IconAtlas.getDataUrl('ui_ico_shop')}" alt="" />
          <h2>铁匠铺 &amp; 神装合成炉</h2>
          <div class="modal-res-chips">
            <span class="modal-res-chip"><img src="${IconAtlas.getDataUrl('ui_ico_gold')}" alt="" />${Math.round(hero.gold)}</span>
            <span class="modal-res-chip" style="color:#86efac;"><img src="${IconAtlas.getDataUrl('ui_ico_crystal')}" alt="" />${hero.crystal}木</span>
            <span class="modal-res-chip" style="color:#7dd3fc;"><img src="${IconAtlas.getDataUrl('ui_ico_stone')}" alt="" />${hero.stones}石</span>
          </div>
        </div>
        <button class="war3-btn war3-btn-red" id="btn-modal-close">关闭</button>
      </div>
      <div class="lobby-nav" style="padding:6px 14px;">
        <button class="nav-tab ${this.shopTab === 'recommended' ? 'active' : ''}" data-shop-tab="recommended">推荐出装</button>
        <button class="nav-tab ${this.shopTab === 'forge' ? 'active' : ''}" data-shop-tab="forge">锻造升阶</button>
        <button class="nav-tab ${this.shopTab === 'synth' ? 'active' : ''}" data-shop-tab="synth">神装合成树</button>
        <button class="nav-tab ${this.shopTab === 'consumables' ? 'active' : ''}" data-shop-tab="consumables">药水卷轴</button>
        <button class="nav-tab ${this.shopTab === 'books' ? 'active' : ''}" data-shop-tab="books">属性神书</button>
        <button class="nav-tab ${this.shopTab === 'bag' ? 'active' : ''}" data-shop-tab="bag">背包与赠送</button>
      </div>
      <div class="war3-modal-body">${bodyHtml}</div>
    `;
  }

  private renderBuyCard(itemId: string): string {
    const world = this.engine.world!;
    const it = getItemDef(itemId)!;
    const rm = RARITY_META[it.rarity];
    const g = getDiscountedGold(world, it.costGold || 0);
    return `
      <div class="item-card" style="border-color:${rm.border};">
        <div class="item-card-top">
          <img src="${IconAtlas.getDataUrl(it.iconKey)}" alt="" />
          <div>
            <div style="font-weight:800;font-size:13px;color:${rm.color};">${it.name}</div>
            <div style="font-size:11px;color:#94a3b8;">${it.desc}</div>
          </div>
        </div>
        <button class="war3-btn war3-btn-gold" data-buy-id="${it.id}">购买 (${g}G${it.costCrystal ? ` + ${it.costCrystal}木` : ''})</button>
      </div>
    `;
  }

  private renderSynthCard(itemId: string): string {
    const world = this.engine.world!;
    const hero = this.engine.getLocalHero()!;
    const it = getItemDef(itemId)!;
    const rm = RARITY_META[it.rarity];
    const plan = planSynthesis(world, hero, itemId);
    const isPinned = hero.pinnedRecipeId === itemId;
    return `
      <div class="item-card" style="border-color:${rm.border};">
        <div class="item-card-top">
          <img src="${IconAtlas.getDataUrl(it.iconKey)}" alt="" />
          <div>
            <div style="font-weight:800;font-size:13px;color:${rm.color};">${it.name}</div>
            <div style="font-size:11px;color:#94a3b8;">${it.desc}</div>
          </div>
        </div>
        <div style="font-size:11px;color:#fde047;">
          需要：${it.recipe!.items.map((id) => getItemDef(id)?.name || id).join(' + ')}
        </div>
        <div style="display:flex;gap:6px;">
          <button class="war3-btn ${plan.canDo ? 'war3-btn-gold' : ''}" data-synth-id="${it.id}" style="flex:1;" ${plan.canDo ? '' : 'disabled'}>
            ${plan.canDo ? `一键合成 (${plan.goldCost}G${plan.crystalCost ? `·${plan.crystalCost}木` : ''})` : plan.missingHardReason || '条件不足'}
          </button>
          <button class="war3-btn ${isPinned ? 'war3-btn-blue' : ''}" data-pin-id="${it.id}" title="收藏到战斗左侧快捷出装">
            ${isPinned ? '已收藏' : '收藏'}
          </button>
        </div>
      </div>
    `;
  }

  private renderSlotManageCard(itemId: string | null, inInv: boolean, idx: number, allies: HeroEntity[]): string {
    if (!itemId) {
      return `<div class="item-card" style="opacity:0.5;justify-content:center;align-items:center;min-height:76px;font-size:12px;">空栏位 #${idx + 1}</div>`;
    }
    const it = getItemDef(itemId)!;
    const rm = RARITY_META[it.rarity];
    const next = getUpgradesTo(itemId);
    return `
      <div class="item-card" style="border-color:${rm.border};">
        <div class="item-card-top">
          <img src="${IconAtlas.getDataUrl(it.iconKey)}" alt="" />
          <div>
            <div style="font-weight:800;font-size:13px;color:${rm.color};">${it.name}${it.heroExclusive ? ` Lv.${this.engine.getLocalHero()!.exclusiveLevel}` : ''}</div>
            <div style="font-size:11px;color:#94a3b8;">${it.desc}</div>
          </div>
        </div>
        <div style="display:flex;gap:5px;flex-wrap:wrap;">
          ${next ? `<button class="war3-btn war3-btn-blue" data-slot-upg="${inInv ? '1' : '0'}:${idx}" style="font-size:11px;padding:3px 7px;">升阶</button>` : ''}
          <button class="war3-btn" data-slot-swap="${inInv ? '1' : '0'}:${idx}" style="font-size:11px;padding:3px 7px;">${inInv ? '存入箱子' : '穿戴装备'}</button>
          ${!it.heroExclusive ? `<button class="war3-btn war3-btn-red" data-slot-sell="${inInv ? '1' : '0'}:${idx}" style="font-size:11px;padding:3px 7px;">出售</button>` : ''}
          ${allies.map((a) => (!it.heroExclusive ? `<button class="war3-btn" data-slot-gift="${inInv ? '1' : '0'}:${idx}:${a.id}" style="font-size:10px;padding:3px 6px;">送给${a.callsign.slice(0, 4)}</button>` : '')).join('')}
        </div>
      </div>
    `;
  }

  private buildTeleportModal(): string {
    const world = this.engine.world!;
    const zones = Object.values(ZONES);
    return `
      <div class="war3-modal-head">
        <div class="modal-title-group">
          <img class="modal-head-ico" src="${IconAtlas.getDataUrl('ui_ico_teleport')}" alt="" />
          <h2>圣殿全图快捷传送阵</h2>
        </div>
        <button class="war3-btn war3-btn-red" id="btn-modal-close">关闭</button>
      </div>
      <div class="war3-modal-body">
        <div class="item-grid">
          ${zones
            .map((z) => {
              const cd = Math.ceil(world.dungeonRespawns[z.id] || 0);
              return `
                <div class="item-card" style="border-color:${z.color};">
                  <div class="tp-card-top">
                    <img class="tp-biome-thumb" src="${IconAtlas.getDataUrl(`tile_${z.biome}`)}" alt="" style="border-color:${z.color};" />
                    <div>
                      <div style="font-weight:800;font-size:13.5px;color:${z.color};">${z.name}</div>
                      <div style="font-size:11px;color:#cbd5e1;margin-top:2px;">${z.subtitle}</div>
                    </div>
                  </div>
                  ${
                    z.hasTiers
                      ? `<div style="display:flex;gap:5px;">
                          <button class="war3-btn war3-btn-gold" data-tp="${z.id}:1" style="flex:1;padding:5px;font-size:11px;">初级</button>
                          <button class="war3-btn war3-btn-blue" data-tp="${z.id}:2" style="flex:1;padding:5px;font-size:11px;">中级</button>
                          <button class="war3-btn war3-btn-red" data-tp="${z.id}:3" style="flex:1;padding:5px;font-size:11px;">高级</button>
                         </div>`
                      : `<button class="war3-btn war3-btn-gold" data-tp="${z.id}:0">
                          ${cd > 0 ? `传送 (Boss 复活中 ${cd}s)` : `立即传送${z.recommendedWave ? ` (建议W${z.recommendedWave}+)` : ''}`}
                         </button>`
                  }
                </div>
              `;
            })
            .join('')}
        </div>
      </div>
    `;
  }

  private buildBaseModal(): string {
    const world = this.engine.world!;
    const lv = world.sanctuary.level;
    const upgGold = 260 + lv * 140;
    const upgCrys = lv >= 4 ? 1 : 0;
    const pauseCost = 1 + world.wavePauseCountUsed;
    const pausesLeft = world.maxWavePauses - world.wavePauseCountUsed;

    return `
      <div class="war3-modal-head">
        <div class="modal-title-group">
          <img class="modal-head-ico" src="${IconAtlas.getDataUrl('ui_ico_fortress')}" alt="" />
          <h2>雅典娜圣殿升级 &amp; 城防哨塔建设</h2>
        </div>
        <button class="war3-btn war3-btn-red" id="btn-modal-close">关闭</button>
      </div>
      <div class="war3-modal-body" style="display:flex;flex-direction:column;gap:12px;">
        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:8px;">
          <button class="war3-btn war3-btn-gold" id="btn-base-upg">
            升级圣殿 (Lv.${lv}→${lv + 1})<br/>
            <span style="font-size:11px;">+1400 HP · +4 甲 · +8 回血 (${upgGold}G${upgCrys ? ` + ${upgCrys}木` : ''})</span>
          </button>
          <button class="war3-btn war3-btn-blue" id="btn-base-invuln" ${world.sanctuary.invulnCd > 0 ? 'disabled' : ''}>
            圣殿神圣无敌 (15秒)<br/>
            <span style="font-size:11px;">${world.sanctuary.invulnCd > 0 ? `冷却中 ${Math.ceil(world.sanctuary.invulnCd)}s` : '免费激活！关键时刻保家'}</span>
          </button>
          <button class="war3-btn war3-btn-green" id="btn-base-pause" ${pausesLeft <= 0 ? 'disabled' : ''}>
            停怪 60 秒 (剩 ${pausesLeft} 次)<br/>
            <span style="font-size:11px;">消耗 ${pauseCost} 灵晶延缓下一波进攻</span>
          </button>
        </div>

        <h4 class="modal-sec-title" style="color:#fde047;">圣殿四角防御哨塔基座（最高升至 Lv.5）</h4>
        <div class="item-grid">
          ${world.towers
            .map(
              (t) => `
              <div class="item-card" style="border-color:#c8a24a;">
                <div class="tp-card-top">
                  <img class="tp-biome-thumb" src="${IconAtlas.getDataUrl(t.type ? `tower_${t.type}` : 'tower_base')}" alt="" style="border-color:#c8a24a;background:#090d16;" />
                  <div style="font-weight:800;font-size:13px;color:#fef3c7;">
                    ${t.label}<br/>
                    <span style="font-size:11px;color:#cbd5e1;font-weight:600;">${t.type ? `${t.type === 'arrow' ? '精灵箭塔' : t.type === 'frost' ? '寒冰减速塔' : '圣光治疗塔'} Lv.${t.level}` : '空基座'}</span>
                  </div>
                </div>
                <div style="display:flex;gap:5px;flex-wrap:wrap;">
                  ${
                    t.type
                      ? `<button class="war3-btn war3-btn-gold" data-tower="${t.slotId}:${t.type}" ${t.level >= 5 ? 'disabled' : ''}>
                          ${t.level >= 5 ? '已满级' : `升级至 Lv.${t.level + 1} (${380 + t.level * 220}G${t.level >= 2 ? ' + 1木' : ''})`}
                         </button>`
                      : `
                        <button class="war3-btn war3-btn-green" data-tower="${t.slotId}:arrow" style="font-size:11px;padding:4px 8px;">建箭塔(320G)</button>
                        <button class="war3-btn war3-btn-blue" data-tower="${t.slotId}:frost" style="font-size:11px;padding:4px 8px;">建冰塔(320G)</button>
                        <button class="war3-btn war3-btn-gold" data-tower="${t.slotId}:holy" style="font-size:11px;padding:4px 8px;">建圣光塔(320G)</button>
                      `
                  }
                </div>
              </div>
            `
            )
            .join('')}
        </div>
      </div>
    `;
  }

  private buildAwakenModal(): string {
    const hero = this.engine.getLocalHero()!;
    const def = getHeroClassDef(hero.classId);
    return `
      <div class="war3-modal-head">
        <div class="modal-title-group">
          <img class="modal-head-ico" src="${IconAtlas.getDataUrl(`hero_${hero.classId}`)}" alt="" />
          <h2>Lv.15 英雄转职觉醒 · 选择你的终极专精</h2>
        </div>
      </div>
      <div class="war3-modal-body" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:12px;">
        ${def.awakeningBranches
          .map(
            (b) => `
            <div class="war3-card war3-stone-panel" style="border-color:${b.color};display:flex;flex-direction:column;gap:8px;justify-content:space-between;">
              <div>
                <div style="font-size:17px;font-weight:900;color:${b.color};">${b.name} · [${b.tag}]</div>
                <p style="font-size:12px;color:#cbd5e1;">${b.desc}</p>
                <div style="font-size:12px;color:#fde047;font-weight:700;">专精特效：${b.specialEffect}</div>
              </div>
              <button class="war3-btn war3-btn-gold" data-awaken="${b.id}">选择【${b.name}】觉醒</button>
            </div>
          `
          )
          .join('')}
      </div>
    `;
  }

  private buildPauseModal(): string {
    return `
      <div class="war3-modal-head">
        <div class="modal-title-group">
          <img class="modal-head-ico" src="${IconAtlas.getDataUrl('ui_ico_battle')}" alt="" />
          <h2>圣殿战局已暂停</h2>
        </div>
      </div>
      <div class="war3-modal-body" style="display:flex;flex-direction:column;gap:10px;max-width:340px;margin:0 auto;">
        <button class="war3-btn war3-btn-gold" id="btn-resume">继续守卫圣殿</button>
        <button class="war3-btn war3-btn-blue" id="btn-pause-fullscreen">全屏 / 锁定横屏</button>
        <button class="war3-btn" id="btn-pause-sfx">${SoundFX.isSfxMuted() ? '音效：关' : '音效：开'}</button>
        <button class="war3-btn" id="btn-pause-bgm">${SoundFX.isBgmMuted() ? '音乐：关' : '音乐：开'}</button>
        <button class="war3-btn war3-btn-red" id="btn-quit-match">返回主大厅</button>
      </div>
    `;
  }

  private buildSettlementModal(): string {
    const world = this.engine.world!;
    const hero = this.engine.getLocalHero()!;
    return `
      <div class="war3-modal-head">
        <div class="modal-title-group">
          <img class="modal-head-ico" src="${IconAtlas.getDataUrl(this.settlementVictory ? 'ui_ico_honor' : 'ui_ico_kill')}" alt="" />
          <h2>${this.settlementVictory ? '圣殿守护大捷！第 20 波终极魔王已被击败' : '圣殿防线失守'}</h2>
        </div>
      </div>
      <div class="war3-modal-body" style="display:flex;flex-direction:column;gap:12px;text-align:center;">
        <div style="font-size:15px;color:#fde047;font-weight:800;">
          坚持波次：第 ${world.wave} 波 ｜ 击杀敌军：${hero.kills} ｜ 总伤害：${hero.damageDealt}
        </div>
        <div style="display:flex;gap:10px;justify-content:center;flex-wrap:wrap;">
          ${
            this.settlementVictory
              ? `<button class="war3-btn war3-btn-blue" id="btn-go-endless" style="padding:12px 22px;font-size:15px;">继续挑战无尽守卫模式</button>`
              : ''
          }
          <button class="war3-btn war3-btn-gold" id="btn-back-lobby" style="padding:12px 22px;font-size:15px;">返回主大厅</button>
        </div>
      </div>
    `;
  }

  private bindModalEvents(): void {
    if (!this.modalEl) return;
    const closeBtn = this.modalEl.querySelector('#btn-modal-close') as HTMLButtonElement | null;
    if (closeBtn) closeBtn.onclick = () => this.close();

    this.modalEl.querySelectorAll('[data-shop-tab]').forEach((el) => {
      (el as HTMLElement).onclick = () => {
        this.shopTab = (el as HTMLElement).dataset.shopTab as ShopTab;
        this.render();
      };
    });
    this.modalEl.querySelectorAll('[data-buy-id]').forEach((el) => {
      (el as HTMLElement).onclick = () => {
        this.engine.actionBuy((el as HTMLElement).dataset.buyId!);
        this.render();
      };
    });
    this.modalEl.querySelectorAll('[data-synth-id]').forEach((el) => {
      (el as HTMLElement).onclick = () => {
        this.engine.actionSynthesize((el as HTMLElement).dataset.synthId!);
        this.render();
      };
    });
    this.modalEl.querySelectorAll('[data-pin-id]').forEach((el) => {
      (el as HTMLElement).onclick = () => {
        const h = this.engine.getLocalHero()!;
        const id = (el as HTMLElement).dataset.pinId!;
        h.pinnedRecipeId = h.pinnedRecipeId === id ? null : id;
        this.render();
      };
    });
    this.modalEl.querySelectorAll('[data-upg-inv]').forEach((el) => {
      (el as HTMLElement).onclick = () => {
        this.engine.actionUpgradeSlot(true, Number((el as HTMLElement).dataset.upgInv));
        this.render();
      };
    });
    this.modalEl.querySelectorAll('[data-slot-upg]').forEach((el) => {
      (el as HTMLElement).onclick = () => {
        const [inv, idx] = (el as HTMLElement).dataset.slotUpg!.split(':');
        this.engine.actionUpgradeSlot(inv === '1', Number(idx));
        this.render();
      };
    });
    this.modalEl.querySelectorAll('[data-slot-sell]').forEach((el) => {
      (el as HTMLElement).onclick = () => {
        const [inv, idx] = (el as HTMLElement).dataset.slotSell!.split(':');
        this.engine.actionSellSlot(inv === '1', Number(idx));
        this.render();
      };
    });
    this.modalEl.querySelectorAll('[data-slot-swap]').forEach((el) => {
      (el as HTMLElement).onclick = () => {
        const [inv, idx] = (el as HTMLElement).dataset.slotSwap!.split(':');
        const fromInv = inv === '1';
        const h = this.engine.getLocalHero()!;
        const targetArr = fromInv ? h.stash : h.inventory;
        const free = targetArr.indexOf(null);
        this.engine.actionSwapSlot(fromInv, Number(idx), !fromInv, free >= 0 ? free : 0);
        this.render();
      };
    });
    this.modalEl.querySelectorAll('[data-slot-gift]').forEach((el) => {
      (el as HTMLElement).onclick = () => {
        const [inv, idx, toId] = (el as HTMLElement).dataset.slotGift!.split(':');
        this.engine.actionGiftItem(toId, inv === '1', Number(idx));
        this.render();
      };
    });
    this.modalEl.querySelectorAll('[data-gift-gold]').forEach((el) => {
      (el as HTMLElement).onclick = () => {
        this.engine.actionGiftResource((el as HTMLElement).dataset.giftGold!, 'gold', 300);
        this.render();
      };
    });
    this.modalEl.querySelectorAll('[data-gift-crys]').forEach((el) => {
      (el as HTMLElement).onclick = () => {
        this.engine.actionGiftResource((el as HTMLElement).dataset.giftCrys!, 'crystal', 1);
        this.render();
      };
    });

    this.modalEl.querySelectorAll('[data-tp]').forEach((el) => {
      (el as HTMLElement).onclick = () => {
        const [z, t] = (el as HTMLElement).dataset.tp!.split(':');
        const tier = Number(t) > 0 ? (Number(t) as 1 | 2 | 3) : undefined;
        if (this.engine.actionTeleport(z as ZoneId, tier)) {
          this.close();
        }
      };
    });

    const btnBaseUpg = this.modalEl.querySelector('#btn-base-upg') as HTMLButtonElement | null;
    if (btnBaseUpg) btnBaseUpg.onclick = () => { this.engine.actionBase('upgrade'); this.render(); };
    const btnBaseInv = this.modalEl.querySelector('#btn-base-invuln') as HTMLButtonElement | null;
    if (btnBaseInv) btnBaseInv.onclick = () => { this.engine.actionBase('invuln'); this.render(); };
    const btnBasePause = this.modalEl.querySelector('#btn-base-pause') as HTMLButtonElement | null;
    if (btnBasePause) btnBasePause.onclick = () => { this.engine.actionBase('pause_wave'); this.render(); };

    this.modalEl.querySelectorAll('[data-tower]').forEach((el) => {
      (el as HTMLElement).onclick = () => {
        const [slotId, tType] = (el as HTMLElement).dataset.tower!.split(':');
        this.engine.actionTower(slotId, tType as TowerType);
        this.render();
      };
    });

    this.modalEl.querySelectorAll('[data-awaken]').forEach((el) => {
      (el as HTMLElement).onclick = () => {
        this.engine.actionSelectAwakening((el as HTMLElement).dataset.awaken!);
        this.close();
      };
    });

    const btnRes = this.modalEl.querySelector('#btn-resume') as HTMLButtonElement | null;
    if (btnRes) btnRes.onclick = () => this.close();
    const btnPfs = this.modalEl.querySelector('#btn-pause-fullscreen') as HTMLButtonElement | null;
    if (btnPfs) btnPfs.onclick = () => this.onToggleFullscreen?.();
    const btnPsfx = this.modalEl.querySelector('#btn-pause-sfx') as HTMLButtonElement | null;
    if (btnPsfx) btnPsfx.onclick = () => { SoundFX.setSfxMuted(!SoundFX.isSfxMuted()); this.render(); };
    const btnPbgm = this.modalEl.querySelector('#btn-pause-bgm') as HTMLButtonElement | null;
    if (btnPbgm) btnPbgm.onclick = () => { SoundFX.setBgmMuted(!SoundFX.isBgmMuted()); this.render(); };
    const btnQuit = this.modalEl.querySelector('#btn-quit-match') as HTMLButtonElement | null;
    if (btnQuit) btnQuit.onclick = () => { this.close(); this.onExitToLobby(); };

    const btnEnd = this.modalEl.querySelector('#btn-go-endless') as HTMLButtonElement | null;
    if (btnEnd) {
      btnEnd.onclick = () => {
        this.engine.continueEndless();
        this.close();
      };
    }
    const btnBack = this.modalEl.querySelector('#btn-back-lobby') as HTMLButtonElement | null;
    if (btnBack) btnBack.onclick = () => { this.close(); this.onExitToLobby(); };
  }
}
