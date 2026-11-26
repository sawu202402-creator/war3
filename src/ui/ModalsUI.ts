import { SoundFX } from '../audio/SoundFX';
import { getHeroClassDef } from '../data/heroes';
import {
  ITEMS,
  RARITY_META,
  SET_BONUSES,
  getHeroRecommendedRecipeTargets,
  getItemDef,
  getItemsUsingIngredient,
  getUpgradeChain,
  getUpgradesTo,
} from '../data/items';
import { ZONES } from '../data/worldMap';
import {
  getDiscountedGold,
  getSellRefund,
  planDirectAcquire,
  planSynthesis,
} from '../engine/EconomySystem';
import { GameEngine } from '../engine/GameEngine';
import { HeroEntity } from '../engine/GameState';
import { IconAtlas } from '../engine/IconAtlas';
import { CoopManager } from '../net/CoopManager';
import { ItemDef, TowerType, ZoneId } from '../types';

type ShopCategory =
  | 'recommended'
  | 'weapon'
  | 'bow'
  | 'magic'
  | 'sanctum'
  | 'armor'
  | 'boots'
  | 'consumables'
  | 'books'
  | 'stash_gift';

const SHOP_CATEGORIES: { id: ShopCategory; label: string }[] = [
  { id: 'recommended', label: '推荐' },
  { id: 'weapon', label: '狂刃' },
  { id: 'bow', label: '弓弩' },
  { id: 'magic', label: '奥法' },
  { id: 'sanctum', label: '圣谕' },
  { id: 'armor', label: '圣盾' },
  { id: 'boots', label: '移动' },
  { id: 'consumables', label: '药水' },
  { id: 'books', label: '神书' },
  { id: 'stash_gift', label: '箱·赠' },
];

export class ModalsUI {
  private activeModal: 'none' | 'shop' | 'teleport' | 'base' | 'awaken' | 'pause' | 'settlement' = 'none';
  private shopCat: ShopCategory = 'recommended';
  private selectedShopItemId: string | null = null;
  private selectedBagSlot: { inInv: boolean; idx: number } | null = null;
  private lastShopLiveHash = '';
  private lastShopRenderAt = 0;
  private modalEl: HTMLElement | null = null;
  private settlementVictory = false;

  constructor(
    private root: HTMLElement,
    private engine: GameEngine,
    private onExitToLobby: () => void,
    private onToggleFullscreen?: () => void,
    private onReturnSquad?: () => void
  ) {}

  public isOpen(): boolean {
    return this.activeModal !== 'none';
  }

  public refreshIfOpen(): void {
    if (this.activeModal !== 'none') this.render();
  }

  public close(): void {
    this.activeModal = 'none';
    this.modalEl?.remove();
    this.modalEl = null;
    this.engine.paused = false;
  }

  public toggleShop(): void {
    if (this.activeModal === 'shop') {
      this.close();
    } else {
      const hero = this.engine.getLocalHero();
      this.activeModal = 'shop';
      this.shopCat = 'recommended';
      this.selectedBagSlot = null;
      this.selectedShopItemId = hero
        ? hero.pinnedRecipeId || getHeroRecommendedRecipeTargets(hero.classId)[0] || 'wep_t1'
        : 'wep_t1';
      this.lastShopLiveHash = '';
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
    this.engine.paused = false;
    this.render();
  }

  public render(): void {
    const prevListScroll = (this.modalEl?.querySelector('.hok-shop-list') as HTMLElement | null)?.scrollTop ?? 0;
    const prevDetailScroll = (this.modalEl?.querySelector('.hok-detail-scroll') as HTMLElement | null)?.scrollTop ?? 0;

    this.modalEl?.remove();
    if (this.activeModal === 'none') return;

    const wrap = document.createElement('div');
    wrap.className = 'war3-modal-backdrop';
    const isShop = this.activeModal === 'shop';
    wrap.innerHTML = `<div class="war3-modal war3-stone-panel ${isShop ? 'hok-shop-modal' : ''}">${this.buildContent()}</div>`;
    wrap.addEventListener('click', (e) => {
      if (e.target === wrap && this.activeModal !== 'settlement' && this.activeModal !== 'awaken') {
        this.close();
      }
    });
    this.root.appendChild(wrap);
    this.modalEl = wrap;
    this.lastShopRenderAt = performance.now();

    if (isShop) {
      const newList = wrap.querySelector('.hok-shop-list') as HTMLElement | null;
      const newDetail = wrap.querySelector('.hok-detail-scroll') as HTMLElement | null;
      if (newList) newList.scrollTop = prevListScroll;
      if (newDetail) newDetail.scrollTop = prevDetailScroll;
    }

    this.bindModalEvents();
  }

  public syncLiveShop(): void {
    if (this.activeModal !== 'shop' || !this.modalEl) return;
    const world = this.engine.world;
    const hero = this.engine.getLocalHero();
    if (!world || !hero) return;

    const goldEl = this.modalEl.querySelector('#shop-live-gold');
    const crysEl = this.modalEl.querySelector('#shop-live-crystal');
    const stoneEl = this.modalEl.querySelector('#shop-live-stones');
    if (goldEl) goldEl.textContent = `${Math.round(hero.gold)}`;
    if (crysEl) crysEl.textContent = `${hero.crystal}木`;
    if (stoneEl) stoneEl.textContent = `${hero.stones}石`;

    const groups = this.getShopGroupsForCategory(hero);
    const visibleIds = groups.flatMap((g) => g.items.map((it) => it.id));
    if (this.selectedShopItemId && !visibleIds.includes(this.selectedShopItemId)) {
      visibleIds.push(this.selectedShopItemId);
    }
    const affordStr = visibleIds
      .map((id) => (planDirectAcquire(world, hero, id).canDo ? '1' : '0'))
      .join('');
    const hash = [
      hero.inventory.map((x) => x || '').join(','),
      hero.stash.map((x) => x || '').join(','),
      hero.pinnedRecipeId || '',
      hero.ankhs,
      this.shopCat,
      this.selectedShopItemId || '',
      this.selectedBagSlot ? `${this.selectedBagSlot.inInv ? 1 : 0}:${this.selectedBagSlot.idx}` : '',
      affordStr,
    ].join('|');

    if (hash !== this.lastShopLiveHash && performance.now() - this.lastShopRenderAt >= 400) {
      this.lastShopLiveHash = hash;
      this.render();
    }
  }

  private buildContent(): string {
    if (this.activeModal === 'shop') return this.buildShopModal();
    if (this.activeModal === 'teleport') return this.buildTeleportModal();
    if (this.activeModal === 'base') return this.buildBaseModal();
    if (this.activeModal === 'awaken') return this.buildAwakenModal();
    if (this.activeModal === 'pause') return this.buildPauseModal();
    return this.buildSettlementModal();
  }

  private getShopGroupsForCategory(hero: HeroEntity): { title: string; items: ItemDef[] }[] {
    const pick = (ids: string[]) => ids.map((id) => getItemDef(id)).filter((x): x is ItemDef => Boolean(x));

    switch (this.shopCat) {
      case 'recommended': {
        const recTargets = getHeroRecommendedRecipeTargets(hero.classId);
        const coreIds =
          hero.pinnedRecipeId && !recTargets.includes(hero.pinnedRecipeId)
            ? [hero.pinnedRecipeId, ...recTargets]
            : recTargets;
        const heroStarter =
          hero.classId === 'ranger'
            ? 'bow_t1'
            : hero.classId === 'priest'
              ? 'sac_t1'
              : hero.classId === 'archmage'
                ? 'acc_t1'
                : hero.classId === 'paladin'
                  ? 'arm_t1'
                  : 'wep_t1';
        const starterList = Array.from(
          new Set([
            heroStarter,
            'boot_t1',
            'wep_t1',
            'bow_t1',
            'acc_t1',
            'sac_t1',
            'arm_t1',
            'pot_hp_l',
            'pot_mp',
            'pot_omni',
            'pot_invuln',
            'item_ankh',
          ])
        );
        return [
          { title: '核心推荐神装（点选右侧可预购 / 查合成树）', items: pick(coreIds) },
          { title: '本命基础件与消耗品', items: pick(starterList) },
        ];
      }
      case 'weapon':
        return [
          { title: '狂刃基础与近战散件（战神套 · 剑圣）', items: pick(['wep_t1', 'comp_vamp', 'comp_claw', 'comp_thunder', 'comp_crit']) },
          { title: '进阶锻造（支持一键补差价升阶）', items: pick(['wep_t2', 'wep_t3', 'wep_t4']) },
          { title: '传说 / 神话神兵', items: pick(['leg_bloodreaver', 'leg_thunderfury', 'myth_frostmourne', 'myth_chaos']) },
        ];
      case 'bow':
        return [
          { title: '穿云基础与远程散件（逐星套 · 游侠）', items: pick(['bow_t1', 'comp_claw', 'comp_thunder', 'comp_crit', 'comp_vamp']) },
          { title: '弓弩锻造升阶线', items: pick(['bow_t2', 'bow_t3', 'bow_t4']) },
          { title: '传说 / 神话神弓', items: pick(['leg_starbow', 'leg_shadowcrossbow', 'myth_windrunner']) },
        ];
      case 'magic':
        return [
          { title: '奥法基础与法术散件（秘法套 · 大法师）', items: pick(['acc_t1', 'comp_frost', 'comp_flame', 'comp_mana']) },
          { title: '进阶锻造（支持一键补差价升阶）', items: pick(['acc_t2', 'acc_t3', 'acc_t4']) },
          { title: '传说 / 神话法器', items: pick(['leg_wintersoul', 'leg_inferno', 'myth_apocalypse']) },
        ];
      case 'sanctum':
        return [
          { title: '圣谕基础与辅助散件（圣谕套 · 祭司）', items: pick(['sac_t1', 'comp_pendant', 'comp_mana', 'comp_frost']) },
          { title: '牧杖锻造升阶线', items: pick(['sac_t2', 'sac_t3', 'sac_t4']) },
          { title: '传说 / 神话圣典', items: pick(['leg_lifescepter', 'leg_druidicstaff', 'myth_elune']) },
        ];
      case 'armor':
        return [
          { title: '重甲基础与防御散件（神盾套 · 骑士）', items: pick(['arm_t1', 'comp_pendant', 'comp_thorn']) },
          { title: '进阶锻造（支持一键补差价升阶）', items: pick(['arm_t2', 'arm_t3', 'arm_t4']) },
          { title: '传说 / 神话重甲', items: pick(['leg_aegis', 'myth_immortal']) },
        ];
      case 'boots':
        return [{ title: '移动与疾风神靴线', items: pick(['boot_t1', 'boot_t2', 'boot_t3', 'epic_windboots']) }];
      case 'consumables':
        return [
          {
            title: '回复药剂 · 无敌神盾 · 强化石',
            items: ITEMS.filter((i) => i.shopVisible && (i.category === 'consumable' || i.id === 'mat_stone')),
          },
        ];
      case 'books':
        return [{ title: '永久属性成长神书', items: ITEMS.filter((i) => i.shopVisible && i.category === 'book') }];
      case 'stash_gift':
        return [];
    }
  }

  private formatCostLabel(gold: number, crystal: number, stones: number): string {
    if (gold === 0 && crystal === 0 && stones === 0) return '免费';
    return `${gold}G${crystal > 0 ? ` · ${crystal}木` : ''}${stones > 0 ? ` · ${stones}石` : ''}`;
  }

  private isOwnedByHero(hero: HeroEntity, itemId: string): boolean {
    return hero.inventory.includes(itemId) || hero.stash.includes(itemId);
  }

  private buildShopModal(): string {
    const world = this.engine.world!;
    const hero = this.engine.getLocalHero()!;
    const pinnedDef = hero.pinnedRecipeId ? getItemDef(hero.pinnedRecipeId) : undefined;
    const allies = world.heroes.filter((h) => !h.isLocal);
    const stashUsed = hero.stash.filter(Boolean).length;

    let middleHtml = '';
    if (this.shopCat === 'stash_gift') {
      middleHtml = `
        <div class="hok-shop-group-title">随身储物箱（6 格材料与备用装备 · 点选可在右侧操作）</div>
        <div class="hok-stash-grid">
          ${hero.stash
            .map((id, idx) => {
              const it = id ? getItemDef(id) : undefined;
              const rm = it ? RARITY_META[it.rarity] : undefined;
              const isSel =
                Boolean(this.selectedBagSlot && !this.selectedBagSlot.inInv && this.selectedBagSlot.idx === idx);
              return `
                <button class="hok-stash-cell ${isSel ? 'is-selected' : ''}" data-bag-slot="0:${idx}" type="button" style="${rm ? `border-color:${rm.border};` : ''}">
                  ${
                    it
                      ? `<img src="${IconAtlas.getDataUrl(it.iconKey)}" alt="" />
                         <span class="hok-stash-name" style="color:${rm!.color};">${it.name}</span>`
                      : `<span class="hok-stash-empty">空格 #${idx + 1}</span>`
                  }
                </button>
              `;
            })
            .join('')}
        </div>
        <div class="hok-shop-group-title" style="margin-top:10px;">队友互助赠送金币 / 灵晶</div>
        ${
          allies.length > 0
            ? `<div class="hok-gift-panel">
                ${allies
                  .map(
                    (a) => `
                  <div class="hok-gift-row">
                    <span class="hok-gift-ally" style="color:${a.color};">${a.callsign}</span>
                    <button class="war3-btn" data-gift-gold="${a.id}" type="button">赠 300G</button>
                    <button class="war3-btn war3-btn-green" data-gift-crys="${a.id}" type="button">赠 1木</button>
                  </div>`
                  )
                  .join('')}
               </div>`
            : '<div class="hok-shop-empty-note">当前无队友（单人守城模式），随身储物箱内的材料在合成神装时会自动扣取。</div>'
        }
      `;
    } else {
      const groups = this.getShopGroupsForCategory(hero);
      middleHtml = groups
        .map(
          (grp) => `
          <div class="hok-shop-group-title">${grp.title}</div>
          <div class="hok-item-grid">
            ${grp.items.map((it) => this.renderHoKItemTile(it)).join('')}
          </div>
        `
        )
        .join('');
    }

    const detailHtml = this.buildShopDetailPanel(hero, allies);

    return `
      <div class="hok-shop-head">
        <div class="modal-title-group">
          <img class="modal-head-ico" src="${IconAtlas.getDataUrl('ui_ico_shop')}" alt="" />
          <h2>局内商店</h2>
          ${
            pinnedDef
              ? `<button class="hok-head-pin-chip" data-pin-id="${pinnedDef.id}" type="button" title="点击取消预购">
                  <img src="${IconAtlas.getDataUrl(pinnedDef.iconKey)}" alt="" />
                  <span>预购: ${pinnedDef.name} ×</span>
                 </button>`
              : ''
          }
        </div>
        <div class="hok-head-right">
          <div class="modal-res-chips">
            <span class="modal-res-chip"><img src="${IconAtlas.getDataUrl('ui_ico_gold')}" alt="" /><span id="shop-live-gold">${Math.round(hero.gold)}</span></span>
            <span class="modal-res-chip" style="color:#86efac;"><img src="${IconAtlas.getDataUrl('ui_ico_crystal')}" alt="" /><span id="shop-live-crystal">${hero.crystal}木</span></span>
            <span class="modal-res-chip" style="color:#7dd3fc;"><img src="${IconAtlas.getDataUrl('ui_ico_stone')}" alt="" /><span id="shop-live-stones">${hero.stones}石</span></span>
          </div>
          <button class="war3-btn war3-btn-red hok-close-btn" id="btn-modal-close" type="button">关闭</button>
        </div>
      </div>

      <div class="hok-shop-main">
        <div class="hok-shop-cats">
          ${SHOP_CATEGORIES.map(
            (c) => `
            <button class="hok-cat-btn ${this.shopCat === c.id ? 'active' : ''}" data-shop-cat="${c.id}" type="button">
              ${c.label}
            </button>
          `
          ).join('')}
        </div>

        <div class="hok-shop-list">${middleHtml}</div>

        <div class="hok-shop-detail">${detailHtml}</div>
      </div>

      <div class="hok-shop-footer">
        <span class="hok-footer-label">已出装备</span>
        <div class="hok-footer-slots">
          ${hero.inventory
            .map((id, idx) => {
              const it = id ? getItemDef(id) : undefined;
              const rm = it ? RARITY_META[it.rarity] : undefined;
              const next = it ? getUpgradesTo(it.id) : undefined;
              const canUpg = next ? planDirectAcquire(world, hero, next.id).canDo : false;
              const isSel =
                Boolean(this.selectedBagSlot && this.selectedBagSlot.inInv && this.selectedBagSlot.idx === idx);
              return `
                <button class="hok-footer-slot ${isSel ? 'is-selected' : ''} ${it ? 'has-item' : ''}"
                        data-bag-slot="1:${idx}" type="button"
                        style="${rm ? `border-color:${rm.border};` : ''}"
                        title="${it ? `${it.name}（点击查看 / 出售 / 升阶）` : `空装备格 #${idx + 1}`}">
                  ${
                    it
                      ? `<img src="${IconAtlas.getDataUrl(it.iconKey)}" alt="" />
                         ${canUpg ? '<span class="hok-slot-upg-tag">↑</span>' : ''}`
                      : `<span class="hok-slot-num">${idx + 1}</span>`
                  }
                </button>
              `;
            })
            .join('')}
        </div>
        <button class="war3-btn ${this.shopCat === 'stash_gift' ? 'war3-btn-blue' : ''} hok-stash-shortcut" data-shop-cat="stash_gift" type="button">
          储物箱 (${stashUsed}/6)
        </button>
      </div>
    `;
  }

  private renderHoKItemTile(it: ItemDef): string {
    const world = this.engine.world!;
    const hero = this.engine.getLocalHero()!;
    const rm = RARITY_META[it.rarity];
    const plan = planDirectAcquire(world, hero, it.id);
    const isPinned = hero.pinnedRecipeId === it.id;
    const isOwned = this.isOwnedByHero(hero, it.id);
    const isSel = !this.selectedBagSlot && this.selectedShopItemId === it.id;
    const costStr =
      it.category === 'material' && !it.shopVisible
        ? 'Boss掉落'
        : `${plan.goldCost}G${plan.crystalCost > 0 ? `+${plan.crystalCost}木` : ''}${plan.stoneCost > 0 ? `+${plan.stoneCost}石` : ''}`;

    return `
      <button class="hok-item-tile ${plan.canDo ? 'can-afford' : ''} ${isSel ? 'is-selected' : ''} ${isPinned ? 'is-pinned' : ''}"
              data-shop-item="${it.id}" type="button"
              style="border-color:${isSel ? '#fde047' : plan.canDo ? '#22c55e' : rm.border};">
        <div class="hok-tile-ico-wrap">
          <img src="${IconAtlas.getDataUrl(it.iconKey)}" alt="" />
          ${isPinned ? '<span class="hok-tile-badge pin">预购</span>' : isOwned ? '<span class="hok-tile-badge own">已有</span>' : ''}
        </div>
        <div class="hok-tile-meta">
          <div class="hok-tile-name" style="color:${rm.color};">${it.name}</div>
          <div class="hok-tile-cost ${plan.canDo ? 'affordable' : ''}">${plan.mode === 'upgrade' ? '升阶 ' : ''}${costStr}</div>
        </div>
      </button>
    `;
  }

  private buildShopDetailPanel(hero: HeroEntity, allies: HeroEntity[]): string {
    const world = this.engine.world!;

    if (this.selectedBagSlot) {
      const arr = this.selectedBagSlot.inInv ? hero.inventory : hero.stash;
      const itemId = arr[this.selectedBagSlot.idx];
      if (itemId) {
        const it = getItemDef(itemId)!;
        const rm = RARITY_META[it.rarity];
        const next = getUpgradesTo(itemId);
        const nextPlan = next ? planDirectAcquire(world, hero, next.id) : null;
        const parents = getItemsUsingIngredient(itemId);
        const refund = getSellRefund(itemId);
        const inInv = this.selectedBagSlot.inInv;
        const idx = this.selectedBagSlot.idx;

        return `
          <div class="hok-detail-scroll">
            <div class="hok-detail-head">
              <img class="hok-detail-ico" src="${IconAtlas.getDataUrl(it.iconKey)}" alt="" style="border-color:${rm.border};" />
              <div class="hok-detail-titlebox">
                <div class="hok-detail-name" style="color:${rm.color};">${it.name}${it.heroExclusive ? ` Lv.${hero.exclusiveLevel}` : ''}</div>
                <div class="hok-detail-sub">${rm.label} · ${inInv ? `已出栏 #${idx + 1}` : `储物箱 #${idx + 1}`}</div>
              </div>
            </div>
            <div class="hok-detail-desc">${it.desc}</div>
            ${
              next
                ? `<div class="hok-upg-preview">
                    <div class="hok-upg-label">可锻造升阶 → <span style="color:${RARITY_META[next.rarity].color};">${next.name}</span></div>
                    <div class="hok-upg-desc">${next.desc}</div>
                   </div>`
                : ''
            }
            ${this.renderSetBonusPreviewHtml(hero, it.setId)}
            ${this.renderParentChipsHtml(parents)}
            ${
              allies.length > 0 && !it.heroExclusive
                ? `<div class="hok-parents-box">
                    <div class="hok-parents-title">转赠队友</div>
                    <div class="hok-parent-chips">
                      ${allies
                        .map(
                          (a) =>
                            `<button class="hok-parent-chip" data-slot-gift="${inInv ? '1' : '0'}:${idx}:${a.id}" type="button">赠 ${a.callsign.slice(0, 5)}</button>`
                        )
                        .join('')}
                    </div>
                   </div>`
                : ''
            }
          </div>
          <div class="hok-detail-actions">
            ${
              next && nextPlan
                ? `<button class="war3-btn war3-btn-blue" data-slot-upg="${inInv ? '1' : '0'}:${idx}" type="button" ${nextPlan.canDo ? '' : 'disabled'}>
                    升阶 (${this.formatCostLabel(
                      getDiscountedGold(world, next.upgradeCostGold || 0),
                      next.upgradeCostCrystal || 0,
                      next.upgradeStones || 0
                    )})
                   </button>`
                : ''
            }
            <div class="hok-detail-subactions">
              <button class="war3-btn" data-slot-swap="${inInv ? '1' : '0'}:${idx}" type="button" style="flex:1;">${inInv ? '存箱子' : '穿戴'}</button>
              ${
                !it.heroExclusive
                  ? `<button class="war3-btn war3-btn-red" data-slot-sell="${inInv ? '1' : '0'}:${idx}" type="button" style="flex:1;">出售 +${refund}G</button>`
                  : ''
              }
            </div>
          </div>
        `;
      }
      this.selectedBagSlot = null;
    }

    const fallbackId = this.selectedShopItemId || hero.pinnedRecipeId || getHeroRecommendedRecipeTargets(hero.classId)[0] || 'wep_t1';
    const it = getItemDef(fallbackId) || ITEMS[0];
    this.selectedShopItemId = it.id;
    const rm = RARITY_META[it.rarity];
    const plan = planDirectAcquire(world, hero, it.id);
    const isPinned = hero.pinnedRecipeId === it.id;
    const canPin = Boolean(it.recipe || it.upgradesFrom);
    const parents = getItemsUsingIngredient(it.id);
    const costLabel =
      it.category === 'material' && !it.shopVisible
        ? '副本 / Boss 掉落'
        : this.formatCostLabel(plan.goldCost, plan.crystalCost, plan.stoneCost);

    const actionText =
      it.category === 'material' && !it.shopVisible
        ? '需击败 Boss 获取'
        : plan.canDo
          ? `${plan.mode === 'synth' ? '一键合成' : plan.mode === 'upgrade' ? '升阶锻造' : '购买'} (${costLabel})`
          : plan.reason || `需 ${costLabel}`;

    return `
      <div class="hok-detail-scroll">
        <div class="hok-detail-head">
          <img class="hok-detail-ico" src="${IconAtlas.getDataUrl(it.iconKey)}" alt="" style="border-color:${rm.border};" />
          <div class="hok-detail-titlebox">
            <div class="hok-detail-name" style="color:${rm.color};">${it.name}</div>
            <div class="hok-detail-sub">${rm.label} · ${costLabel}</div>
          </div>
        </div>
        <div class="hok-detail-desc">${it.desc}</div>
        ${
          it.activeSkill
            ? `<div class="hok-detail-active">主动【${it.activeSkill.name}】(${it.activeSkill.cooldown}s)：${it.activeSkill.desc}</div>`
            : ''
        }
        ${this.renderSetBonusPreviewHtml(hero, it.setId)}
        ${this.renderVisualTreeHtml(hero, it)}
        ${this.renderParentChipsHtml(parents)}
      </div>
      <div class="hok-detail-actions">
        <button class="war3-btn ${plan.canDo ? 'war3-btn-gold' : ''}" data-hok-acquire="${it.id}" type="button" ${plan.canDo ? '' : 'disabled'}>
          ${actionText}
        </button>
        ${
          canPin
            ? `<button class="war3-btn ${isPinned ? 'war3-btn-blue' : ''}" data-pin-id="${it.id}" type="button">
                ${isPinned ? '取消预购（已拆解推送）' : '预购（自动推送小件）'}
               </button>`
            : ''
        }
      </div>
    `;
  }

  private renderSetBonusPreviewHtml(hero: HeroEntity, setId?: string): string {
    if (!setId) return '';
    const sb = SET_BONUSES.find((s) => s.id === setId);
    if (!sb) return '';
    const ownedCount = hero.inventory.filter((id) => id && getItemDef(id)?.setId === setId).length;
    const fullNeed = sb.fullPieceCount ?? 4;
    return `
      <div class="hok-set-preview">
        <div class="hok-set-head">
          <span>${sb.name} (${ownedCount}/${fullNeed})</span>
          ${sb.heroTag ? `<span class="hok-set-tag">${sb.heroTag}</span>` : ''}
        </div>
        <div class="hok-set-tier ${ownedCount >= 2 ? 'active' : ''}">${sb.twoPieceDesc}</div>
        <div class="hok-set-tier ${ownedCount >= fullNeed ? 'active' : ''}">${sb.fourPieceDesc}</div>
      </div>
    `;
  }

  private renderParentChipsHtml(parents: ItemDef[]): string {
    if (parents.length === 0) return '';
    return `
      <div class="hok-parents-box">
        <div class="hok-parents-title">可合成 / 进阶 →</div>
        <div class="hok-parent-chips">
          ${parents
            .map(
              (p) => `
              <button class="hok-parent-chip" data-select-item="${p.id}" type="button" style="border-color:${RARITY_META[p.rarity].border};">
                <img src="${IconAtlas.getDataUrl(p.iconKey)}" alt="" />
                <span style="color:${RARITY_META[p.rarity].color};">${p.name}</span>
              </button>
            `
            )
            .join('')}
        </div>
      </div>
    `;
  }

  private renderVisualTreeHtml(hero: HeroEntity, it: ItemDef): string {
    const world = this.engine.world!;
    const ownedPool = [...hero.inventory, ...hero.stash];
    const takeOwned = (id: string): boolean => {
      const idx = ownedPool.indexOf(id);
      if (idx >= 0) {
        ownedPool[idx] = null;
        return true;
      }
      return false;
    };

    if (it.recipe) {
      const rootOwned = this.isOwnedByHero(hero, it.id);
      const childrenHtml = it.recipe.items
        .map((reqId) => {
          const sub = getItemDef(reqId);
          if (!sub) return '';
          const subRm = RARITY_META[sub.rarity];
          const held = takeOwned(sub.id);
          const subPlan = planDirectAcquire(world, hero, sub.id);
          const subTag = held
            ? '<span class="hok-node-tag ok">✓ 已有</span>'
            : sub.category === 'material' && !sub.shopVisible
              ? '<span class="hok-node-tag boss">Boss</span>'
              : `<span class="hok-node-tag">${subPlan.goldCost}G</span>`;
          return `
            <button class="hok-tree-child ${held ? 'is-owned' : ''}" data-select-item="${sub.id}" type="button" style="border-color:${held ? '#22c55e' : subRm.border};">
              <img src="${IconAtlas.getDataUrl(sub.iconKey)}" alt="" />
              <span class="hok-node-name" style="color:${subRm.color};">${sub.name}</span>
              ${subTag}
            </button>
          `;
        })
        .join('');

      return `
        <div class="hok-tree">
          <div class="hok-tree-title">合成路线图（点小件可查看/单买）</div>
          <div class="hok-tree-root ${rootOwned ? 'is-owned' : ''}" style="border-color:${RARITY_META[it.rarity].border};">
            <img src="${IconAtlas.getDataUrl(it.iconKey)}" alt="" />
            <span>${it.name}</span>
            ${rootOwned ? '<span class="hok-node-tag ok">✓</span>' : ''}
          </div>
          <div class="hok-tree-stem"></div>
          <div class="hok-tree-children">${childrenHtml}</div>
        </div>
      `;
    }

    if (it.upgradesFrom) {
      const chain = getUpgradeChain(it.id);
      return `
        <div class="hok-tree">
          <div class="hok-tree-title">锻造进阶路线</div>
          <div class="hok-chain-row">
            ${chain
              .map((step, i) => {
                const held = this.isOwnedByHero(hero, step.id);
                const sRm = RARITY_META[step.rarity];
                return `
                  ${i > 0 ? '<span class="hok-chain-arrow">→</span>' : ''}
                  <button class="hok-chain-node ${step.id === it.id ? 'is-cur' : ''} ${held ? 'is-owned' : ''}"
                          data-select-item="${step.id}" type="button" style="border-color:${sRm.border};">
                    <img src="${IconAtlas.getDataUrl(step.iconKey)}" alt="" />
                    <span>${step.name.slice(0, 4)}</span>
                  </button>
                `;
              })
              .join('')}
          </div>
        </div>
      `;
    }

    return '';
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
              const activeBoss = world.enemies.find((e) => e.zoneId === z.id && e.isBoss && e.hp > 0);
              const bossTag =
                z.id !== 'sanctuary' && !z.hasTiers && z.id !== 'stone_mine'
                  ? cd > 0
                    ? `<span style="color:#f87171;font-weight:700;">⏳ Boss冷却 ${cd}s</span>`
                    : activeBoss
                      ? `<span style="color:#fbbf24;font-weight:700;">⚔️ ${activeBoss.name} 交战中</span>`
                      : `<span style="color:#4ade80;font-weight:700;">✨ Boss就绪</span>`
                  : '';
              return `
                <div class="item-card" style="border-color:${z.color};">
                  <div class="tp-card-top">
                    <img class="tp-biome-thumb" src="${IconAtlas.getDataUrl(`tile_${z.biome}`)}" alt="" style="border-color:${z.color};" />
                    <div>
                      <div style="font-weight:800;font-size:13.5px;color:${z.color};">${z.name}</div>
                      <div style="font-size:11px;color:#cbd5e1;margin-top:2px;">${z.subtitle}</div>
                      ${bossTag ? `<div style="font-size:10.5px;margin-top:2px;">${bossTag}</div>` : ''}
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

    const auraTier = lv >= 10 ? 2 : lv >= 5 ? 1 : 0;
    const auraBanner =
      auraTier >= 2
        ? '✨ 已激活【雅典娜神佑 II】：全队 +22% 攻击/法强 · +0.30 攻速 · +14 回蓝 · +8% 减伤'
        : auraTier === 1
          ? '✨ 已激活【雅典娜神佑 I】：全队 +10% 攻击/法强 · +0.14 攻速 · +6 回蓝（Lv.10 进阶 II 阶）'
          : '🌟 阶段光环预告：圣殿升至 Lv.5 解锁【神佑 I】，Lv.10 解锁【神佑 II】全队光环';

    return `
      <div class="war3-modal-head">
        <div class="modal-title-group">
          <img class="modal-head-ico" src="${IconAtlas.getDataUrl('ui_ico_fortress')}" alt="" />
          <h2>雅典娜圣殿升级 &amp; 城防哨塔建设</h2>
        </div>
        <button class="war3-btn war3-btn-red" id="btn-modal-close">关闭</button>
      </div>
      <div class="war3-modal-body" style="display:flex;flex-direction:column;gap:12px;">
        <div style="padding:7px 11px;border-radius:7px;border:1px solid ${auraTier > 0 ? 'rgba(74,222,128,0.65)' : 'rgba(250,204,21,0.45)'};background:rgba(12,18,30,0.86);font-size:11.5px;color:${auraTier > 0 ? '#86efac' : '#fde68a'};font-weight:700;">
          ${auraBanner}
          <div style="margin-top:4px;font-size:11px;color:#cbd5e1;font-weight:600;">
            当前圣殿：护甲 ${world.sanctuary.armor} · 回血 ${world.sanctuary.hpRegen}/s · 危急圣盾 ${world.sanctuary.autoAegisCd > 0 ? `${Math.ceil(world.sanctuary.autoAegisCd)}s冷却` : '就绪'}（含自动圣光哨塔打击）
          </div>
        </div>
        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:8px;">
          <button class="war3-btn war3-btn-gold" id="btn-base-upg">
            升级圣殿 (Lv.${lv}→${lv + 1})<br/>
            <span style="font-size:11px;">+2600 HP · +5 甲 · +14 回血 (${upgGold}G${upgCrys ? ` + ${upgCrys}木` : ''})</span>
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
                    <span style="font-size:11px;color:#cbd5e1;font-weight:600;">${
                      t.type
                        ? `${t.type === 'arrow' ? '精灵箭塔 (高爆单体)' : t.type === 'frost' ? '寒冰减速塔 (群伤+48%缓速)' : '圣光治疗塔 (打击+修圣殿)'} Lv.${t.level}`
                        : '空基座 · 可选箭/冰/圣光三种守塔流派'
                    }</span>
                  </div>
                </div>
                <div style="display:flex;gap:5px;flex-wrap:wrap;">
                  ${
                    t.type
                      ? `<button class="war3-btn war3-btn-gold" data-tower="${t.slotId}:${t.type}" ${t.level >= 5 ? 'disabled' : ''}>
                          ${t.level >= 5 ? '已满级' : `升级至 Lv.${t.level + 1} (${380 + t.level * 220}G${t.level >= 2 ? ' + 1木' : ''})`}
                         </button>`
                      : `
                        <button class="war3-btn war3-btn-green" data-tower="${t.slotId}:arrow" style="font-size:11px;padding:4px 8px;">建箭塔·高攻(320G)</button>
                        <button class="war3-btn war3-btn-blue" data-tower="${t.slotId}:frost" style="font-size:11px;padding:4px 8px;">建冰塔·缓速(320G)</button>
                        <button class="war3-btn war3-btn-gold" data-tower="${t.slotId}:holy" style="font-size:11px;padding:4px 8px;">建圣光·回血(320G)</button>
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
    const squad = this.engine.lastSquadStats;
    const totalSquadDmg = Math.max(
      1,
      squad.reduce((acc, s) => acc + Math.max(0, s.damageDealt), 0)
    );
    return `
      <div class="war3-modal-head">
        <div class="modal-title-group">
          <img class="modal-head-ico" src="${IconAtlas.getDataUrl(this.settlementVictory ? 'ui_ico_honor' : 'ui_ico_kill')}" alt="" />
          <h2>${this.settlementVictory ? '圣殿守护大捷！第 20 波终极魔王已被击败' : '圣殿防线失守'}</h2>
        </div>
      </div>
      <div class="war3-modal-body" style="display:flex;flex-direction:column;gap:12px;text-align:center;">
        <div style="font-size:14.5px;color:#fde047;font-weight:800;line-height:1.6;">
          坚持波次：第 ${world.wave} 波 ｜ 击杀敌军：${hero.kills} ｜ 最高连斩：${hero.comboPeak}<br/>
          总伤害：${Math.round(hero.damageDealt)} ｜ 本局获得荣誉：<span style="color:#4ade80;">+${this.engine.lastRunHonor}</span>
        </div>
        ${
          squad.length > 1
            ? `
          <div class="mvp-scoreboard">
            ${squad
              .map((s, idx) => {
                const dmgPct = Math.round((Math.max(0, s.damageDealt) / totalSquadDmg) * 100);
                return `
                  <div class="mvp-row ${idx === 0 ? 'is-mvp' : ''}">
                    <img class="mvp-ava" src="${IconAtlas.getDataUrl(`hero_${s.classId}`)}" alt="" />
                    <div class="mvp-info">
                      <div class="mvp-name-line">
                        <span style="color:${s.color};font-weight:800;">${s.callsign}</span>
                        ${idx === 0 ? '<span class="mvp-badge">👑 MVP</span>' : ''}
                      </div>
                      <div class="mvp-metrics">击杀 ${s.kills} · Boss ${s.bossKills} · 救援 ${s.revives} · 连斩 ${s.comboPeak}</div>
                      <div class="mvp-dmg-track"><div class="mvp-dmg-fill" style="width:${dmgPct}%"></div></div>
                    </div>
                    <div class="mvp-dmg-txt">${Math.round(s.damageDealt)}<br/><span>${dmgPct}% 输出</span></div>
                  </div>
                `;
              })
              .join('')}
          </div>`
            : ''
        }
        <div style="display:flex;gap:10px;justify-content:center;flex-wrap:wrap;">
          ${
            this.settlementVictory
              ? `<button class="war3-btn war3-btn-blue" id="btn-go-endless" style="padding:12px 22px;font-size:15px;">继续挑战无尽守卫模式</button>`
              : ''
          }
          ${
            CoopManager.isActiveCoop() && this.onReturnSquad
              ? `<button class="war3-btn war3-btn-green" id="btn-return-squad" style="padding:12px 22px;font-size:15px;">返回小队房间（再来一局）</button>`
              : ''
          }
          <button class="war3-btn war3-btn-gold" id="btn-back-lobby" style="padding:12px 22px;font-size:15px;">${CoopManager.isActiveCoop() ? '退出联机回大厅' : '返回主大厅'}</button>
        </div>
      </div>
    `;
  }

  private bindModalEvents(): void {
    if (!this.modalEl) return;
    const closeBtn = this.modalEl.querySelector('#btn-modal-close') as HTMLButtonElement | null;
    if (closeBtn) closeBtn.onclick = () => this.close();

    this.modalEl.querySelectorAll('[data-shop-cat]').forEach((el) => {
      (el as HTMLElement).onclick = () => {
        this.shopCat = (el as HTMLElement).dataset.shopCat as ShopCategory;
        if (this.shopCat !== 'stash_gift') {
          this.selectedBagSlot = null;
          const h = this.engine.getLocalHero();
          if (h) {
            const first = this.getShopGroupsForCategory(h)[0]?.items[0];
            if (first) this.selectedShopItemId = first.id;
          }
        }
        this.render();
      };
    });
    this.modalEl.querySelectorAll('[data-shop-item]').forEach((el) => {
      (el as HTMLElement).onclick = () => {
        const id = (el as HTMLElement).dataset.shopItem!;
        const world = this.engine.world!;
        const hero = this.engine.getLocalHero()!;
        if (!this.selectedBagSlot && this.selectedShopItemId === id) {
          if (planDirectAcquire(world, hero, id).canDo) {
            this.engine.actionBuy(id);
          }
        } else {
          this.selectedBagSlot = null;
          this.selectedShopItemId = id;
        }
        this.render();
      };
    });
    this.modalEl.querySelectorAll('[data-select-item]').forEach((el) => {
      (el as HTMLElement).onclick = () => {
        this.selectedBagSlot = null;
        this.selectedShopItemId = (el as HTMLElement).dataset.selectItem!;
        this.render();
      };
    });
    this.modalEl.querySelectorAll('[data-hok-acquire]').forEach((el) => {
      (el as HTMLElement).onclick = () => {
        this.engine.actionBuy((el as HTMLElement).dataset.hokAcquire!);
        this.render();
      };
    });
    this.modalEl.querySelectorAll('[data-bag-slot]').forEach((el) => {
      (el as HTMLElement).onclick = () => {
        const [inv, idxStr] = (el as HTMLElement).dataset.bagSlot!.split(':');
        const idx = Number(idxStr);
        const h = this.engine.getLocalHero()!;
        const arr = inv === '1' ? h.inventory : h.stash;
        if (arr[idx]) {
          this.selectedBagSlot = { inInv: inv === '1', idx };
          this.render();
        }
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
        this.selectedBagSlot = null;
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
    const btnReturnSquad = this.modalEl.querySelector('#btn-return-squad') as HTMLButtonElement | null;
    if (btnReturnSquad) {
      btnReturnSquad.onclick = () => {
        this.close();
        this.onReturnSquad?.();
      };
    }
    const btnBack = this.modalEl.querySelector('#btn-back-lobby') as HTMLButtonElement | null;
    if (btnBack) btnBack.onclick = () => { this.close(); this.onExitToLobby(); };
  }
}
