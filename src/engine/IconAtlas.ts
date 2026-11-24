import { ITEMS } from '../data/items';
import { HERO_CLASSES } from '../data/heroes';
import { ENEMY_ARCHETYPES } from '../data/waves';
import { ZoneDef } from '../types';

export type TerrainBiome = ZoneDef['biome'] | 'cobble' | 'grass' | 'road';

const UI_ALIAS: Record<string, string> = {
  ui_ico_battle: 'item_leg_thunderfury.png',
  ui_ico_coop: 'item_leg_aegis.png',
  ui_ico_talent: 'item_book_all.png',
  ui_ico_codex: 'item_book_xp.png',
  ui_ico_daily: 'item_scroll_repair.png',
  ui_ico_shop: 'prop_anvil.png',
  ui_ico_teleport: 'struct_portal.png',
  ui_ico_fortress: 'tower_holy_ico.png',
  ui_ico_gold: 'drop_gold.png',
  ui_ico_crystal: 'drop_crystal.png',
  ui_ico_stone: 'drop_stone.png',
  ui_ico_honor: 'skill_pr_r.png',
  ui_ico_kill: 'skill_bm_r.png',
};

const CRITICAL_ASSETS: string[] = [
  'hub_banner.jpg',
  'ui_stone_panel.png',
  'splash_paladin.jpg',
  'splash_blademaster.jpg',
  'splash_archmage.jpg',
  'splash_ranger.jpg',
  'splash_priest.jpg',
  'tile_sanctuary.png',
  'tile_cobble.png',
  'tile_road.png',
  'hero_paladin.png',
  'hero_blademaster.png',
  'hero_archmage.png',
  'hero_ranger.png',
  'hero_priest.png',
  'hero_td_paladin.png',
  'hero_td_blademaster.png',
  'hero_td_archmage.png',
  'hero_td_ranger.png',
  'hero_td_priest.png',
  'hero_anim_paladin_idle.png',
  'hero_anim_paladin_walk1.png',
  'hero_anim_paladin_walk2.png',
  'hero_anim_paladin_attack.png',
  'hero_anim_blademaster_idle.png',
  'hero_anim_blademaster_walk1.png',
  'hero_anim_blademaster_walk2.png',
  'hero_anim_blademaster_attack.png',
  'hero_anim_archmage_idle.png',
  'hero_anim_archmage_walk1.png',
  'hero_anim_archmage_walk2.png',
  'hero_anim_archmage_attack.png',
  'hero_anim_ranger_idle.png',
  'hero_anim_ranger_walk1.png',
  'hero_anim_ranger_walk2.png',
  'hero_anim_ranger_attack.png',
  'hero_anim_priest_idle.png',
  'hero_anim_priest_walk1.png',
  'hero_anim_priest_walk2.png',
  'hero_anim_priest_attack.png',
  'struct_athena.png',
  'struct_fountain.png',
  'struct_water_altar.png',
  'struct_portal.png',
  'struct_spawn_gate.png',
  'tower_base.png',
  'tower_arrow.png',
  'tower_frost.png',
  'tower_holy.png',
  'tower_holy_ico.png',
  'prop_tree.png',
  'prop_brazier.png',
  'prop_banner.png',
  'prop_anvil.png',
  'prop_tombstone.png',
  'drop_gold.png',
  'drop_crystal.png',
  'drop_stone.png',
  'fx_slash.png',
  'fx_explosion.png',
  'fx_frost_burst.png',
  'fx_holy_ring.png',
  'fx_aura_paladin.png',
  'fx_aura_arcane.png',
  'fx_aura_wind.png',
  'fx_dust_puff.png',
  'fx_swing_holy.png',
  'fx_swing_blade.png',
  'fx_cast_burst.png',
  'fx_hit_spark.png',
  'fx_beam_holy.png',
  'fx_beam_wind.png',
  'fx_lightning_arc.png',
  'fx_levelup_pillar.png',
  'fx_telegraph_danger.png',
  'fx_telegraph_danger_fill.png',
  'fx_target_lock.png',
  'fx_shield_holy.png',
  'fx_shield_arcane.png',
  'fx_ring_local.png',
  'fx_ring_ally.png',
  'fx_boss_aura.png',
  'fx_telegraph_frost.png',
  'fx_telegraph_nature.png',
  'fx_status_stun.png',
  'fx_status_slow.png',
  'fx_aim_line.png',
  'fx_aim_line_cancel.png',
  'fx_aim_cone.png',
  'fx_aim_cone_cancel.png',
  'fx_aim_range.png',
  'fx_aim_range_cancel.png',
  'fx_aim_aoe.png',
  'fx_aim_aoe_cancel.png',
  'fx_glow_fire.png',
  'fx_portal_gold.png',
  'fx_portal_fire.png',
  'fx_portal_emerald.png',
  'fx_plaza_rim.png',
  'fx_shadow_soft.png',
  'tile_road_v.png',
  'tile_road_h.png',
  'tile_plaza_disc.png',
  'ui_vignette.png',
  'ui_zone_plaque.png',
  'proj_arrow.png',
  'proj_fireball.png',
  'proj_frostbolt.png',
  'proj_arcane.png',
  'enemy_goblin.png',
  'enemy_wolf_rider.png',
  'enemy_skeleton_archer.png',
  'enemy_skeleton_mage.png',
  'summon_treant.png',
  'act_flash.png',
  'act_recall.png',
  'item_pot_hp_s.png',
  'item_pot_mp.png',
  'item_wep_t1.png',
  'item_arm_t1.png',
  'item_acc_t1.png',
  'item_boot_t1.png',
  'item_leg_thunderfury.png',
  'item_leg_aegis.png',
  'item_book_all.png',
  'item_book_xp.png',
  'item_scroll_repair.png',
  'skill_pr_r.png',
  'skill_bm_r.png',
];

class AssetLoaderManager {
  private images = new Map<string, HTMLImageElement>();
  private inflight = new Map<string, Promise<void>>();
  private whiteFlashes = new Map<string, HTMLCanvasElement>();

  public init(): void {
    // Compatibility no-op; images load via preloadCritical / lazy getSprite
  }

  private resolveFilename(key: string): string {
    if (UI_ALIAS[key]) return UI_ALIAS[key];
    if (key === 'hub_banner' || key.startsWith('splash_')) {
      return `${key.replace(/\.jpg$/, '')}.jpg`;
    }
    if (key.includes('.')) return key;
    return `${key}.png`;
  }

  public getDataUrl(key: string): string {
    if (key === 'tower_arrow') return './assets/tower_arrow_ico.png';
    if (key === 'tower_frost') return './assets/tower_frost_ico.png';
    if (key === 'tower_holy') return './assets/tower_holy_ico.png';
    return `./assets/${this.resolveFilename(key)}`;
  }

  private loadFile(filename: string): Promise<void> {
    if (this.images.has(filename)) return Promise.resolve();
    const existing = this.inflight.get(filename);
    if (existing) return existing;

    const p = new Promise<void>((resolve) => {
      const img = new Image();
      img.onload = () => {
        this.images.set(filename, img);
        this.inflight.delete(filename);
        resolve();
      };
      img.onerror = () => {
        this.inflight.delete(filename);
        resolve();
      };
      img.src = `./assets/${filename}`;
    });
    this.inflight.set(filename, p);
    return p;
  }

  public getSprite(key: string): HTMLImageElement | null {
    const filename = this.resolveFilename(key);
    const img = this.images.get(filename);
    if (img && img.complete && img.naturalWidth > 0) return img;
    void this.loadFile(filename);
    return null;
  }

  public getTerrainTile(biome: TerrainBiome): HTMLImageElement | null {
    const resolved = biome === 'grass' ? 'sanctuary' : biome;
    return this.getSprite(`tile_${resolved}`);
  }

  public getWhiteFlash(key: string): HTMLCanvasElement | null {
    const filename = this.resolveFilename(key);
    const cached = this.whiteFlashes.get(filename);
    if (cached) return cached;

    const img = this.getSprite(key);
    if (!img) return null;

    const c = document.createElement('canvas');
    c.width = img.naturalWidth || 128;
    c.height = img.naturalHeight || 128;
    const ctx = c.getContext('2d');
    if (!ctx) return null;
    ctx.drawImage(img, 0, 0);
    ctx.globalCompositeOperation = 'source-in';
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, c.width, c.height);
    this.whiteFlashes.set(filename, c);
    return c;
  }

  public async preloadCritical(onProgress?: (loaded: number, total: number) => void): Promise<void> {
    const queue = new Set<string>(CRITICAL_ASSETS);
    for (const h of HERO_CLASSES) {
      for (const sk of h.skills) {
        queue.add(this.resolveFilename(sk.iconKey));
      }
    }
    const list = Array.from(queue);
    const total = list.length;
    let loaded = 0;

    const concurrency = 8;
    let cursor = 0;
    const worker = async () => {
      while (cursor < list.length) {
        const idx = cursor++;
        await this.loadFile(list[idx]);
        loaded++;
        onProgress?.(loaded, total);
      }
    };
    await Promise.all(Array.from({ length: concurrency }, () => worker()));
  }

  public preloadRemainingInBackground(): void {
    const rest = new Set<string>();
    const allBiomes: TerrainBiome[] = [
      'gold', 'xp', 'crystal', 'fire', 'ice', 'thunder', 'forest', 'bandit', 'trial', 'mine', 'abyss',
    ];
    for (const b of allBiomes) rest.add(`tile_${b}.png`);
    for (const kind of Object.keys(ENEMY_ARCHETYPES)) {
      rest.add(`enemy_${kind}.png`);
    }
    for (const it of ITEMS) {
      rest.add(this.resolveFilename(it.iconKey));
    }
    rest.add('prop_pillar.png');
    rest.add('prop_crystal.png');
    rest.add('prop_tent.png');
    rest.add('tower_arrow_ico.png');
    rest.add('tower_frost_ico.png');
    rest.add('tower_holy_ico.png');

    for (const f of rest) {
      if (!this.images.has(f)) {
        void this.loadFile(f);
      }
    }
  }
}

export const IconAtlas = new AssetLoaderManager();
