import { getHeroClassDef } from '../data/heroes';
import {
  ATHENA_POS,
  CONVERGENCE_POS,
  FOUNTAIN_POS,
  PORTALS,
  WATER_ALTAR_POS,
  WAVE_LANES,
  WORLD_PROPS,
  WORLD_WIDTH,
  WORLD_HEIGHT,
  ZONE_LIST,
} from '../data/worldMap';
import { EnemyEntity, GameWorldState, HeroAnimPose, HeroEntity } from './GameState';
import { IconAtlas, TerrainBiome } from './IconAtlas';
import { InputManager } from './InputManager';

export class War3Renderer {
  private patternCache = new Map<TerrainBiome, CanvasPattern>();

  private getPattern(ctx: CanvasRenderingContext2D, biome: TerrainBiome): CanvasPattern | null {
    const cached = this.patternCache.get(biome);
    if (cached) return cached;
    const tile = IconAtlas.getTerrainTile(biome);
    if (!tile) return null;
    const pat = ctx.createPattern(tile, 'repeat');
    if (pat) this.patternCache.set(biome, pat);
    return pat;
  }

  private drawCenteredSprite(
    ctx: CanvasRenderingContext2D,
    img: HTMLImageElement | HTMLCanvasElement | null,
    cx: number,
    cy: number,
    drawW: number,
    drawH: number,
    opts?: { flipX?: boolean; angle?: number; alpha?: number; additive?: boolean }
  ): boolean {
    if (!img) return false;
    if (img instanceof HTMLImageElement && (!img.complete || img.naturalWidth <= 0)) return false;
    ctx.save();
    ctx.translate(cx, cy);
    if (opts?.angle) ctx.rotate(opts.angle);
    if (opts?.flipX) ctx.scale(-1, 1);
    if (opts?.alpha !== undefined) ctx.globalAlpha *= opts.alpha;
    if (opts?.additive) ctx.globalCompositeOperation = 'lighter';
    ctx.drawImage(img, -drawW / 2, -drawH / 2, drawW, drawH);
    ctx.restore();
    return true;
  }

  private drawFootAnchoredSprite(
    ctx: CanvasRenderingContext2D,
    img: HTMLImageElement | HTMLCanvasElement | null,
    footX: number,
    footY: number,
    drawW: number,
    drawH: number,
    opts?: {
      scaleX?: number;
      scaleY?: number;
      tilt?: number;
      skewX?: number;
      alpha?: number;
      additive?: boolean;
    }
  ): boolean {
    if (!img) return false;
    if (img instanceof HTMLImageElement && (!img.complete || img.naturalWidth <= 0)) return false;
    ctx.save();
    ctx.translate(footX, footY);
    if (opts?.tilt) ctx.rotate(opts.tilt);
    if (opts?.skewX) ctx.transform(1, 0, opts.skewX, 1, 0, 0);
    const sx = opts?.scaleX ?? 1;
    const sy = opts?.scaleY ?? 1;
    if (sx !== 1 || sy !== 1) ctx.scale(sx, sy);
    if (opts?.alpha !== undefined) ctx.globalAlpha *= opts.alpha;
    if (opts?.additive) ctx.globalCompositeOperation = 'lighter';
    ctx.drawImage(img, -drawW / 2, -drawH * 0.9, drawW, drawH);
    ctx.restore();
    return true;
  }

  private drawStretchedBeam(
    ctx: CanvasRenderingContext2D,
    img: HTMLImageElement | HTMLCanvasElement | null,
    x1: number,
    y1: number,
    x2: number,
    y2: number,
    thickness: number,
    alpha = 1,
    additive = true
  ): void {
    if (!img) return;
    if (img instanceof HTMLImageElement && (!img.complete || img.naturalWidth <= 0)) return;
    const dx = x2 - x1;
    const dy = y2 - y1;
    const dist = Math.hypot(dx, dy);
    if (dist < 2) return;
    ctx.save();
    ctx.translate((x1 + x2) * 0.5, (y1 + y2) * 0.5);
    ctx.rotate(Math.atan2(dy, dx));
    ctx.globalAlpha *= alpha;
    if (additive) ctx.globalCompositeOperation = 'lighter';
    ctx.drawImage(img, -dist * 0.5, -thickness * 0.5, dist, thickness);
    ctx.restore();
  }

  private drawSoftShadow(
    ctx: CanvasRenderingContext2D,
    cx: number,
    cy: number,
    w: number,
    h: number,
    alpha = 0.72
  ): void {
    this.drawCenteredSprite(ctx, IconAtlas.getSprite('fx_shadow_soft'), cx, cy, w, h, { alpha });
  }

  private drawWorldLabel(
    ctx: CanvasRenderingContext2D,
    cx: number,
    y: number,
    text: string,
    textColor: string,
    borderColor = 'rgba(200, 162, 74, 0.55)',
    fontSize = 11
  ): void {
    ctx.save();
    ctx.font = `bold ${fontSize}px sans-serif`;
    const padX = 7;
    const w = Math.ceil(ctx.measureText(text).width) + padX * 2;
    const h = fontSize + 7;
    const x = Math.round(cx - w / 2);
    const top = Math.round(y - h + 4);
    ctx.fillStyle = 'rgba(8, 12, 20, 0.82)';
    ctx.fillRect(x, top, w, h);
    ctx.fillStyle = borderColor;
    ctx.fillRect(x, top, w, 1);
    ctx.fillRect(x, top + h - 1, w, 1);
    ctx.fillRect(x, top, 1, h);
    ctx.fillRect(x + w - 1, top, 1, h);
    ctx.fillStyle = textColor;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, Math.round(cx), top + h / 2 + 0.5);
    ctx.restore();
  }

  public renderWorld(
    ctx: CanvasRenderingContext2D,
    world: GameWorldState,
    input: InputManager,
    camX: number,
    camY: number,
    viewW: number,
    viewH: number,
    worldZoom = 1.0,
    lockedTargetId: number | null = null
  ): void {
    ctx.fillStyle = '#070a10';
    ctx.fillRect(0, 0, viewW, viewH);

    ctx.save();
    if (worldZoom !== 1) ctx.scale(worldZoom, worldZoom);
    ctx.translate(Math.round(-camX), Math.round(-camY));

    const worldW = viewW / worldZoom;
    const worldH = viewH / worldZoom;
    const minX = camX - 180;
    const minY = camY - 180;
    const maxX = camX + worldW + 180;
    const maxY = camY + worldH + 180;
    const nowSec = world.elapsedSec;

    // 1. Render visible biome zones using AI seamless terrain tiles & carved zone plaques
    const zonePlaqueSpr = IconAtlas.getSprite('ui_zone_plaque');
    for (const z of ZONE_LIST) {
      const r = z.rect;
      if (r.x > maxX || r.x + r.w < minX || r.y > maxY || r.y + r.h < minY) continue;
      const pat = this.getPattern(ctx, z.biome);
      ctx.fillStyle = pat || '#1e3524';
      ctx.fillRect(r.x, r.y, r.w, r.h);

      // Subtle dark region seam bevel without neon wireframe boxes
      ctx.fillStyle = 'rgba(6, 9, 15, 0.45)';
      ctx.fillRect(r.x, r.y, r.w, 4);
      ctx.fillRect(r.x, r.y + r.h - 4, r.w, 4);
      ctx.fillRect(r.x, r.y, 4, r.h);
      ctx.fillRect(r.x + r.w - 4, r.y, 4, r.h);

      if (zonePlaqueSpr) {
        ctx.drawImage(zonePlaqueSpr, r.x + 12, r.y + 10, 242, 36);
      } else {
        ctx.fillStyle = 'rgba(10, 14, 22, 0.84)';
        ctx.fillRect(r.x + 12, r.y + 10, 242, 36);
      }
      ctx.fillStyle = '#fef3c7';
      ctx.font = 'bold 13.5px Georgia, serif';
      ctx.fillText(z.name, r.x + 25, r.y + 33);
    }

    // 2. Sanctuary feathered dirt-and-stone roads, carved plaza disc & spawn gates
    this.renderSanctuaryTerrain(ctx, nowSec, minX, maxX, minY, maxY);

    // 3. Portals (dual-layer biome-tinted AI runes + engraved label pills)
    for (const p of PORTALS) {
      if (p.x < minX || p.x > maxX || p.y < minY || p.y > maxY) continue;
      const pulse = 1 + Math.sin(nowSec * 3.2) * 0.05;
      const sz = p.radius * 2.6 * pulse;
      const portalAuraKey =
        p.toZone === 'gold_room'
          ? 'fx_portal_gold'
          : p.toZone === 'dungeon_fire'
            ? 'fx_portal_fire'
            : p.toZone === 'crystal_room'
              ? 'fx_portal_emerald'
              : 'fx_aura_arcane';
      this.drawSoftShadow(ctx, p.x, p.y + p.radius * 0.6, sz * 0.9, sz * 0.45, 0.62);
      this.drawCenteredSprite(ctx, IconAtlas.getSprite(portalAuraKey) || IconAtlas.getSprite('fx_aura_arcane'), p.x, p.y, sz * 1.18, sz * 1.18, {
        angle: nowSec * 0.9,
        alpha: 0.5,
        additive: true,
      });
      this.drawCenteredSprite(ctx, IconAtlas.getSprite('struct_portal'), p.x, p.y, sz, sz);
      this.drawWorldLabel(ctx, p.x, p.y + p.radius + 17, p.label, '#fef3c7', `${p.color}aa`, 10.5);
    }

    // 4. Boss / Skill Ground Telegraphs (100% raster warning rings & storm overlays)
    for (const t of world.telegraphs) {
      if (t.x + t.radius < minX || t.x - t.radius > maxX || t.y + t.radius < minY || t.y - t.radius > maxY) continue;
      if (t.kind === 'enemy_aoe') {
        const fillRatio = 1 - Math.max(0, t.timer / Math.max(0.001, t.maxTimer));
        const diam = t.radius * 2.08;
        this.drawCenteredSprite(ctx, IconAtlas.getSprite('fx_telegraph_danger'), t.x, t.y, diam, diam, {
          angle: nowSec * 0.85,
          alpha: 0.84,
          additive: true,
        });
        const fillDiam = diam * Math.max(0.18, fillRatio);
        this.drawCenteredSprite(ctx, IconAtlas.getSprite('fx_telegraph_danger_fill'), t.x, t.y, fillDiam, fillDiam, {
          alpha: 0.45 + fillRatio * 0.35,
          additive: true,
        });
      } else if (t.kind === 'blizzard') {
        const diam = t.radius * 2.1;
        this.drawCenteredSprite(ctx, IconAtlas.getSprite('fx_telegraph_frost'), t.x, t.y, diam, diam, {
          angle: nowSec * 0.65,
          alpha: 0.56,
          additive: true,
        });
        this.drawCenteredSprite(ctx, IconAtlas.getSprite('fx_aura_arcane'), t.x, t.y, diam * 0.85, diam * 0.85, {
          angle: -nowSec * 0.9,
          alpha: 0.34,
          additive: true,
        });
        const shardSpr = IconAtlas.getSprite('proj_frostbolt');
        for (let k = 0; k < 6; k++) {
          const cycle = (nowSec * 2.1 + k * 0.37 + t.id * 0.19) % 1;
          const sx = t.x + Math.sin(k * 2.4 + t.id) * (t.radius * 0.72) + (cycle - 0.5) * -18;
          const sy = t.y + Math.cos(k * 1.9 + t.id) * (t.radius * 0.52) - (1 - cycle) * 95;
          this.drawCenteredSprite(ctx, shardSpr, sx, sy, 28, 28, {
            angle: 1.85,
            alpha: Math.sin(cycle * Math.PI) * 0.88,
            additive: true,
          });
        }
      } else if (t.kind === 'starfall') {
        const diam = t.radius * 2.1;
        this.drawCenteredSprite(ctx, IconAtlas.getSprite('fx_telegraph_nature'), t.x, t.y, diam, diam, {
          angle: -nowSec * 0.7,
          alpha: 0.56,
          additive: true,
        });
        const starSpr = IconAtlas.getSprite('fx_hit_spark');
        for (let k = 0; k < 6; k++) {
          const cycle = (nowSec * 2.4 + k * 0.41 + t.id * 0.23) % 1;
          const sx = t.x + Math.cos(k * 2.1 + t.id) * (t.radius * 0.75) + (cycle - 0.5) * 16;
          const sy = t.y + Math.sin(k * 1.7 + t.id) * (t.radius * 0.54) - (1 - cycle) * 105;
          this.drawCenteredSprite(ctx, starSpr, sx, sy, 26, 26, {
            angle: nowSec * 5 + k,
            alpha: Math.sin(cycle * Math.PI) * 0.92,
            additive: true,
          });
        }
      } else if (t.kind === 'sanctuary') {
        const diam = t.radius * 2.12;
        this.drawCenteredSprite(ctx, IconAtlas.getSprite('fx_aura_paladin'), t.x, t.y, diam, diam, {
          angle: nowSec * 0.5,
          alpha: 0.52,
          additive: true,
        });
        this.drawCenteredSprite(ctx, IconAtlas.getSprite('fx_holy_ring'), t.x, t.y, diam * 0.88, diam * 0.88, {
          angle: -nowSec * 0.7,
          alpha: 0.36,
          additive: true,
        });
      } else {
        const diam = t.radius * 2.05;
        this.drawCenteredSprite(ctx, IconAtlas.getSprite('fx_telegraph_nature'), t.x, t.y, diam, diam, {
          angle: nowSec * 0.5,
          alpha: 0.58,
          additive: true,
        });
      }
    }

    // 5. Athena Statue, Fountain, Water Altar, Towers
    this.renderAthenaAndStructures(ctx, world, nowSec);

    // 6. Props (AI sprites with soft raster contact shadows)
    for (const pr of WORLD_PROPS) {
      if (pr.x < minX || pr.x > maxX || pr.y < minY || pr.y > maxY) continue;
      this.renderProp(ctx, pr, nowSec);
    }

    // 7. Drops (AI sprites)
    for (const d of world.drops) {
      if (d.x < minX || d.x > maxX || d.y < minY || d.y > maxY) continue;
      const bob = Math.sin(nowSec * 4 + d.id) * 3;
      const key = d.kind === 'gold' ? 'drop_gold' : d.kind === 'crystal' ? 'drop_crystal' : 'drop_stone';
      this.drawSoftShadow(ctx, d.x, d.y + 11, 26, 13, 0.65);
      this.drawCenteredSprite(ctx, IconAtlas.getSprite(key), d.x, d.y + bob, 32, 32);
    }

    // 8. Summons
    for (const s of world.summons) {
      if (s.x < minX || s.x > maxX || s.y < minY || s.y > maxY) continue;
      ctx.save();
      this.drawSoftShadow(ctx, s.x, s.y + s.radius * 0.72, s.radius * 2.1, s.radius * 1.0, 0.68);
      const sKey = s.kind === 'illusion' ? 'hero_anim_blademaster_attack' : 'summon_treant';
      const spr = IconAtlas.getSprite(sKey) || (s.kind === 'illusion' ? IconAtlas.getSprite('hero_td_blademaster') : null);
      const sz = s.radius * 2.7;
      this.drawCenteredSprite(ctx, spr, s.x, s.y - 4, sz, sz, {
        flipX: Math.cos(s.facing) < 0,
        alpha: s.kind === 'illusion' ? 0.72 : 1.0,
      });
      this.drawHpBar(ctx, s.x, s.y - s.radius - 14, 38, 5, s.hp / s.maxHp, '#4ade80');
      ctx.restore();
    }

    // 9. Enemies & Bosses (Y-sorted depth order + raster Target Lock reticle)
    const visibleEnemies = world.enemies
      .filter((e) => e.x + 120 >= minX && e.x - 120 <= maxX && e.y + 120 >= minY && e.y - 120 <= maxY)
      .sort((a, b) => a.y - b.y);
    for (const e of visibleEnemies) {
      if (lockedTargetId !== null && e.id === lockedTargetId) {
        const lockSz = (e.radius * 2.6 + Math.sin(nowSec * 8) * 3) * 1.18;
        this.drawCenteredSprite(ctx, IconAtlas.getSprite('fx_aura_wind'), e.x, e.y + e.radius * 0.45, lockSz * 0.92, lockSz * 0.52, {
          angle: -nowSec * 3.0,
          alpha: 0.46,
          additive: true,
        });
        this.drawCenteredSprite(ctx, IconAtlas.getSprite('fx_target_lock'), e.x, e.y + e.radius * 0.45, lockSz, lockSz * 0.58, {
          angle: nowSec * 2.4,
          alpha: 0.9,
          additive: true,
        });
      }
      this.renderEnemy(ctx, e, nowSec);
    }

    // 10. Heroes (Y-sorted depth order with anti-overlap nameplate staggering)
    const visibleHeroes = world.heroes
      .filter((h) => h.x + 140 >= minX && h.x - 140 <= maxX && h.y + 140 >= minY && h.y - 140 <= maxY)
      .sort((a, b) => a.y - b.y);
    const placedPlates: { x: number; y: number }[] = [];
    for (const h of visibleHeroes) {
      const scale = h.avatarTimer > 0 ? 1.32 : 1.0;
      const basePlateY = h.y + 14 - 90 * scale * 0.88 - 16;
      let lift = 0;
      if (!h.dead) {
        while (lift <= 44 && placedPlates.some((p) => Math.abs(p.x - h.x) < 74 && Math.abs(p.y - (basePlateY - lift)) < 24)) {
          lift += 22;
        }
        placedPlates.push({ x: h.x, y: basePlateY - lift });
      }
      this.renderHero(ctx, h, nowSec, lift);
    }

    // 11. Projectiles (AI directional glow sprites + motion trail ghosts)
    for (const p of world.projectiles) {
      if (p.x < minX || p.x > maxX || p.y < minY || p.y > maxY) continue;
      const pKey = !p.isMagic
        ? 'proj_arrow'
        : p.color === '#38bdf8' || p.color === '#67e8f9' || p.color === '#bae6fd'
          ? 'proj_frostbolt'
          : p.color === '#fb923c' || p.color === '#ef4444' || p.color === '#fde047'
            ? 'proj_fireball'
            : 'proj_arcane';
      const spr = IconAtlas.getSprite(pKey);
      const spd = Math.hypot(p.vx, p.vy) || 1;
      const ux = p.vx / spd;
      const uy = p.vy / spd;
      const ang = Math.atan2(p.vy, p.vx);
      const sz = Math.max(26, p.radius * 3.1);
      this.drawCenteredSprite(ctx, spr, p.x - ux * 24, p.y - uy * 24, sz * 0.62, sz * 0.62, {
        angle: ang,
        alpha: 0.24,
        additive: true,
      });
      this.drawCenteredSprite(ctx, spr, p.x - ux * 12, p.y - uy * 12, sz * 0.8, sz * 0.8, {
        angle: ang,
        alpha: 0.48,
        additive: true,
      });
      this.drawCenteredSprite(ctx, spr, p.x, p.y, sz, sz, {
        angle: ang,
        additive: true,
      });
    }

    // 12. Visual Effects (100% raster AI FX sprites)
    for (const v of world.vfx) {
      const t = 1 - v.life / Math.max(0.001, v.maxLife);
      const alpha = Math.max(0, 1 - t);
      ctx.save();
      if (v.kind === 'slash') {
        this.drawCenteredSprite(ctx, IconAtlas.getSprite('fx_slash'), v.x, v.y, v.radius * 1.45, v.radius * 1.45, {
          angle: v.angle || 0,
          alpha,
          additive: true,
        });
      } else if (v.kind === 'swing_holy' || v.kind === 'swing_blade') {
        const swKey = v.kind === 'swing_holy' ? 'fx_swing_holy' : 'fx_swing_blade';
        const swSz = v.radius * (1.25 + t * 0.35);
        this.drawCenteredSprite(ctx, IconAtlas.getSprite(swKey) || IconAtlas.getSprite('fx_slash'), v.x, v.y, swSz, swSz, {
          angle: v.angle || 0,
          alpha: alpha * 0.95,
          additive: true,
        });
      } else if (v.kind === 'hit_spark') {
        const spSz = v.radius * (0.8 + t * 0.7);
        this.drawCenteredSprite(ctx, IconAtlas.getSprite('fx_hit_spark') || IconAtlas.getSprite('fx_explosion'), v.x, v.y, spSz, spSz, {
          angle: (v.angle || 0) + t * 0.9,
          alpha,
          additive: true,
        });
      } else if (v.kind === 'cast_burst') {
        const cbSz = v.radius * (0.75 + t * 0.65);
        this.drawCenteredSprite(ctx, IconAtlas.getSprite('fx_cast_burst') || IconAtlas.getSprite('fx_frost_burst'), v.x, v.y, cbSz, cbSz, {
          angle: (v.angle || 0) + t * 1.2,
          alpha: alpha * 0.85,
          additive: true,
        });
      } else if (v.kind === 'dust') {
        const dSz = v.radius * (0.6 + t * 0.9);
        this.drawCenteredSprite(ctx, IconAtlas.getSprite('fx_dust_puff'), v.x, v.y - t * 9, dSz, dSz, {
          angle: v.angle || 0,
          alpha: alpha * 0.58,
        });
      } else if (v.kind === 'explosion') {
        const isFrost = v.color === '#38bdf8' || v.color === '#67e8f9';
        const fxKey = isFrost ? 'fx_frost_burst' : 'fx_explosion';
        const sz = v.radius * (0.95 + t * 0.55) * 1.45;
        this.drawCenteredSprite(ctx, IconAtlas.getSprite(fxKey), v.x, v.y, sz, sz, {
          alpha,
          additive: true,
        });
        this.drawCenteredSprite(ctx, IconAtlas.getSprite(isFrost ? 'fx_telegraph_frost' : 'fx_holy_ring'), v.x, v.y, v.radius * (1.2 + t * 0.85), v.radius * (1.2 + t * 0.85), {
          angle: t * 1.4,
          alpha: alpha * 0.55,
          additive: true,
        });
      } else if (v.kind === 'ring' || v.kind === 'teleport') {
        const fxKey = v.kind === 'teleport' ? 'struct_portal' : 'fx_holy_ring';
        const sz = v.radius * (0.75 + t * 0.45) * 1.5;
        this.drawCenteredSprite(ctx, IconAtlas.getSprite(fxKey), v.x, v.y, sz, sz, {
          alpha,
          additive: true,
        });
      } else if (v.kind === 'beam' && v.tx !== undefined && v.ty !== undefined) {
        const bKey = v.color === '#4ade80' ? 'fx_beam_wind' : 'fx_beam_holy';
        this.drawStretchedBeam(
          ctx,
          IconAtlas.getSprite(bKey),
          v.x,
          v.y,
          v.tx,
          v.ty,
          Math.max(30, v.radius * 1.38 * (1 - t * 0.3)),
          alpha,
          true
        );
        this.drawCenteredSprite(ctx, IconAtlas.getSprite('fx_hit_spark'), v.tx, v.ty, 54 * (1 - t * 0.3), 54 * (1 - t * 0.3), {
          angle: t * 3,
          alpha,
          additive: true,
        });
      } else if (v.kind === 'chain' && v.points && v.points.length > 1) {
        const cKey = v.color === '#fef08a' ? 'fx_beam_holy' : 'fx_lightning_arc';
        const chainSpr = IconAtlas.getSprite(cKey);
        const sparkSpr = IconAtlas.getSprite('fx_hit_spark');
        for (let k = 0; k < v.points.length - 1; k++) {
          this.drawStretchedBeam(
            ctx,
            chainSpr,
            v.points[k].x,
            v.points[k].y,
            v.points[k + 1].x,
            v.points[k + 1].y,
            34 * (1 - t * 0.35),
            alpha,
            true
          );
          this.drawCenteredSprite(ctx, sparkSpr, v.points[k + 1].x, v.points[k + 1].y, 34, 34, {
            angle: nowSec * 5 + k,
            alpha,
            additive: true,
          });
        }
      } else if (v.kind === 'levelup') {
        const pilSpr = IconAtlas.getSprite('fx_levelup_pillar');
        this.drawCenteredSprite(ctx, IconAtlas.getSprite('fx_holy_ring'), v.x, v.y + 8, 152 * (0.7 + t * 0.55), 88 * (0.7 + t * 0.55), {
          angle: t * 1.5,
          alpha,
          additive: true,
        });
        this.drawFootAnchoredSprite(ctx, pilSpr, v.x, v.y + 18 - t * 24, 128, 224, {
          alpha: Math.min(1, alpha * 1.25),
          additive: true,
        });
        const sparkSpr = IconAtlas.getSprite('fx_hit_spark');
        for (let k = 0; k < 4; k++) {
          const ang = nowSec * 4 + k * (Math.PI * 0.5);
          this.drawCenteredSprite(ctx, sparkSpr, v.x + Math.cos(ang) * 28, v.y - t * 90 - k * 14, 24, 24, {
            angle: ang,
            alpha,
            additive: true,
          });
        }
      }
      ctx.restore();
    }

    // 13. Floating AI ambient golden motes near Sanctuary Plaza
    const moteSpr = IconAtlas.getSprite('fx_hit_spark');
    if (moteSpr) {
      for (let i = 0; i < 16; i++) {
        const mx = ATHENA_POS.x + Math.sin(nowSec * 0.31 + i * 2.1) * 440;
        const my = ATHENA_POS.y + Math.cos(nowSec * 0.27 + i * 1.7) * 340 - ((nowSec * 14 + i * 30) % 70);
        if (mx < minX || mx > maxX || my < minY || my > maxY) continue;
        const pulseA = 0.14 + 0.16 * (0.5 + 0.5 * Math.sin(nowSec * 2.2 + i * 1.3));
        this.drawCenteredSprite(ctx, moteSpr, mx, my, 12, 12, {
          alpha: pulseA,
          additive: true,
        });
      }
    }

    // 14. Honor of Kings Skill Aiming Indicator (100% raster)
    const localHero = world.heroes.find((h) => h.isLocal);
    if (localHero && !localHero.dead && input.aimingSkill) {
      this.renderAimIndicator(ctx, localHero, input);
    }

    // 15. Pings (expanding AI ring)
    for (const p of world.pings) {
      const t = 1 - p.life / 3.0;
      const sz = 44 + t * 116;
      ctx.save();
      this.drawCenteredSprite(ctx, IconAtlas.getSprite('fx_ring_ally') || IconAtlas.getSprite('fx_holy_ring'), p.x, p.y, sz, sz, {
        angle: t * 2.4,
        alpha: Math.max(0, 1 - t),
        additive: true,
      });
      ctx.globalAlpha = Math.max(0, 1 - t);
      ctx.strokeStyle = '#000';
      ctx.lineWidth = 3;
      ctx.fillStyle = p.color;
      ctx.font = 'bold 13px sans-serif';
      ctx.textAlign = 'center';
      ctx.strokeText(p.label, p.x, p.y - 24);
      ctx.fillText(p.label, p.x, p.y - 24);
      ctx.restore();
    }

    // 16. Floating Texts with crit pop-in punch
    for (const ft of world.floatingTexts) {
      ctx.save();
      ctx.globalAlpha = Math.max(0, ft.life / ft.maxLife);
      const age = ft.maxLife - ft.life;
      const pop = ft.size >= 15 && age < 0.14 ? 1.32 - (age / 0.14) * 0.32 : 1.0;
      ctx.translate(ft.x, ft.y);
      if (pop !== 1.0) ctx.scale(pop, pop);
      ctx.font = `900 ${ft.size}px sans-serif`;
      ctx.textAlign = 'center';
      ctx.strokeStyle = '#000000';
      ctx.lineWidth = 3;
      ctx.strokeText(ft.text, 0, 0);
      ctx.fillStyle = ft.color;
      ctx.fillText(ft.text, 0, 0);
      ctx.restore();
    }

    ctx.restore();

    // 17. Raster War3 Screen-Edge Vignette
    const vigSpr = IconAtlas.getSprite('ui_vignette');
    if (vigSpr) {
      ctx.drawImage(vigSpr, 0, 0, viewW, viewH);
    }
  }

  private drawRoadSegment(
    ctx: CanvasRenderingContext2D,
    roadV: HTMLImageElement | null,
    x1: number,
    y1: number,
    x2: number,
    y2: number,
    width: number,
    minX: number,
    maxX: number,
    minY: number,
    maxY: number
  ): void {
    const pad = width * 0.65;
    if (Math.max(x1, x2) + pad < minX || Math.min(x1, x2) - pad > maxX || Math.max(y1, y2) + pad < minY || Math.min(y1, y2) - pad > maxY) {
      return;
    }
    const dx = x2 - x1;
    const dy = y2 - y1;
    const len = Math.hypot(dx, dy);
    if (len < 2) return;
    ctx.save();
    ctx.translate(x1, y1);
    ctx.rotate(Math.atan2(dy, dx) - Math.PI / 2);
    if (roadV) {
      for (let off = 0; off < len; off += 256) {
        const chunk = Math.min(256, len - off);
        ctx.drawImage(roadV, 0, 0, 160, chunk, -width * 0.5, off, width, chunk);
      }
    } else {
      ctx.fillStyle = '#4a3a28';
      ctx.fillRect(-width * 0.38, 0, width * 0.76, len);
    }
    ctx.restore();
  }

  private renderSanctuaryTerrain(
    ctx: CanvasRenderingContext2D,
    nowSec: number,
    minX: number,
    maxX: number,
    minY: number,
    maxY: number
  ): void {
    const roadV = IconAtlas.getSprite('tile_road_v');

    // 1. North 3 Parallel Columns -> Converge at 北关汇合隘口 -> Royal Defense Avenue -> East Water Road
    this.drawRoadSegment(ctx, roadV, 1760, 1320, 1760, 1600, 114, minX, maxX, minY, maxY);
    this.drawRoadSegment(ctx, roadV, 2100, 1320, 2100, 1890, 120, minX, maxX, minY, maxY);
    this.drawRoadSegment(ctx, roadV, 2440, 1320, 2440, 1600, 114, minX, maxX, minY, maxY);
    this.drawRoadSegment(ctx, roadV, 1760, 1585, CONVERGENCE_POS.x, CONVERGENCE_POS.y, 118, minX, maxX, minY, maxY);
    this.drawRoadSegment(ctx, roadV, 2440, 1585, CONVERGENCE_POS.x, CONVERGENCE_POS.y, 118, minX, maxX, minY, maxY);
    this.drawRoadSegment(ctx, roadV, CONVERGENCE_POS.x, CONVERGENCE_POS.y, ATHENA_POS.x, ATHENA_POS.y, 158, minX, maxX, minY, maxY);
    this.drawRoadSegment(ctx, roadV, FOUNTAIN_POS.x, FOUNTAIN_POS.y, WATER_ALTAR_POS.x, WATER_ALTAR_POS.y, 148, minX, maxX, minY, maxY);

    // 2. Convergence Bastion Disc + South Athena Courtyard Disc (zero vector clipping)
    const plazaDisc = IconAtlas.getSprite('tile_plaza_disc');
    if (plazaDisc) {
      this.drawCenteredSprite(ctx, plazaDisc, CONVERGENCE_POS.x, CONVERGENCE_POS.y, 320, 320);
      this.drawCenteredSprite(ctx, plazaDisc, ATHENA_POS.x, ATHENA_POS.y, 880, 880);
    } else {
      const cobble = this.getPattern(ctx, 'cobble');
      ctx.fillStyle = cobble || '#333b48';
      ctx.fillRect(CONVERGENCE_POS.x - 160, CONVERGENCE_POS.y - 160, 320, 320);
      ctx.fillRect(ATHENA_POS.x - 440, ATHENA_POS.y - 440, 880, 880);
    }
    this.drawWorldLabel(
      ctx,
      CONVERGENCE_POS.x,
      CONVERGENCE_POS.y - 144,
      '北关汇合隘口',
      '#fde68a',
      'rgba(200, 162, 74, 0.72)',
      11
    );

    const gateImg = IconAtlas.getSprite('struct_spawn_gate');
    const riftSpr = IconAtlas.getSprite('fx_boss_aura');
    for (const lane of WAVE_LANES) {
      ctx.save();
      this.drawCenteredSprite(ctx, riftSpr, lane.spawn.x, lane.spawn.y + 8, 134, 84, {
        angle: nowSec * 0.6 + lane.id,
        alpha: 0.36 + Math.sin(nowSec * 3.5 + lane.id) * 0.08,
        additive: true,
      });
      this.drawCenteredSprite(ctx, gateImg, lane.spawn.x, lane.spawn.y - 10, 112, 112);
      this.drawWorldLabel(ctx, lane.spawn.x, lane.spawn.y - 58, lane.name, '#fecaca', 'rgba(244, 63, 94, 0.58)', 11);
      ctx.restore();
    }
  }

  private renderAthenaAndStructures(ctx: CanvasRenderingContext2D, world: GameWorldState, nowSec: number): void {
    // 1. Fountain of Health with pulsing AI shimmer halo & gentle healing mist
    this.drawSoftShadow(ctx, FOUNTAIN_POS.x, FOUNTAIN_POS.y + 32, 132, 54, 0.72);
    this.drawCenteredSprite(
      ctx,
      IconAtlas.getSprite('fx_aura_arcane'),
      FOUNTAIN_POS.x,
      FOUNTAIN_POS.y + 8,
      154,
      96,
      { angle: nowSec * 0.4, alpha: 0.32 + Math.sin(nowSec * 3) * 0.06, additive: true }
    );
    this.drawCenteredSprite(ctx, IconAtlas.getSprite('struct_fountain'), FOUNTAIN_POS.x, FOUNTAIN_POS.y, 148, 148);
    const mistSpr = IconAtlas.getSprite('fx_dust_puff');
    for (let k = 0; k < 2; k++) {
      const cy = (nowSec * 0.45 + k * 0.5) % 1;
      this.drawCenteredSprite(ctx, mistSpr, FOUNTAIN_POS.x + Math.sin(nowSec * 2 + k * 3) * 20, FOUNTAIN_POS.y - 8 - cy * 26, 46, 46, {
        angle: cy * 1.4,
        alpha: Math.sin(cy * Math.PI) * 0.35,
        additive: true,
      });
    }
    this.drawWorldLabel(ctx, FOUNTAIN_POS.x, FOUNTAIN_POS.y + 66, '复活圣泉 (接水点)', '#e0f2fe', 'rgba(56, 189, 248, 0.55)', 10.5);

    // 2. Water Altar
    this.drawSoftShadow(ctx, WATER_ALTAR_POS.x, WATER_ALTAR_POS.y + 30, 126, 52, 0.72);
    this.drawCenteredSprite(ctx, IconAtlas.getSprite('fx_aura_arcane'), WATER_ALTAR_POS.x, WATER_ALTAR_POS.y + 12, 142, 86, {
      angle: -nowSec * 0.35,
      alpha: 0.3,
      additive: true,
    });
    this.drawCenteredSprite(ctx, IconAtlas.getSprite('struct_water_altar'), WATER_ALTAR_POS.x, WATER_ALTAR_POS.y, 132, 132);
    this.drawWorldLabel(ctx, WATER_ALTAR_POS.x, WATER_ALTAR_POS.y - 66, '东郊圣水祭坛 (运水终点)', '#bae6fd', 'rgba(56, 189, 248, 0.55)', 10.5);

    // 3. Towers
    const padImg = IconAtlas.getSprite('tower_base');
    for (const t of world.towers) {
      ctx.save();
      this.drawSoftShadow(ctx, t.x, t.y + 18, 72, 34, 0.65);
      this.drawCenteredSprite(ctx, padImg, t.x, t.y + 6, 72, 72);
      if (t.type && t.level > 0) {
        const tImg = IconAtlas.getSprite(`tower_${t.type}`);
        this.drawCenteredSprite(ctx, tImg, t.x, t.y - 18, 88, 88);
        this.drawWorldLabel(ctx, t.x, t.y + 38, `Lv.${t.level}`, '#fde047', 'rgba(250, 204, 21, 0.55)', 10);
      } else {
        this.drawWorldLabel(ctx, t.x, t.y + 35, '塔基 [G]', '#cbd5e1', 'rgba(148, 163, 184, 0.45)', 10);
      }
      ctx.restore();
    }

    // 4. Goddess Athena Shrine Statue
    ctx.save();
    this.drawCenteredSprite(
      ctx,
      IconAtlas.getSprite('fx_aura_paladin'),
      ATHENA_POS.x,
      ATHENA_POS.y + 24,
      188,
      108,
      { angle: nowSec * 0.25, alpha: 0.36, additive: true }
    );
    this.drawSoftShadow(ctx, ATHENA_POS.x, ATHENA_POS.y + 42, 144, 58, 0.78);
    this.drawCenteredSprite(ctx, IconAtlas.getSprite('struct_athena'), ATHENA_POS.x, ATHENA_POS.y - 14, 176, 176);

    if (world.sanctuary.invulnTimer > 0 || world.sanctuary.shield > 0) {
      const shKey = world.sanctuary.invulnTimer > 0 ? 'fx_shield_holy' : 'fx_shield_arcane';
      const shSz = 176 + Math.sin(nowSec * 5) * 6;
      this.drawCenteredSprite(ctx, IconAtlas.getSprite(shKey), ATHENA_POS.x, ATHENA_POS.y - 8, shSz, shSz, {
        angle: nowSec * 0.45,
        alpha: 0.65,
        additive: true,
      });
    } else if (world.sanctuary.underAttackFlash > 0) {
      this.drawCenteredSprite(ctx, IconAtlas.getSprite('fx_telegraph_danger'), ATHENA_POS.x, ATHENA_POS.y - 4, 176, 176, {
        angle: -nowSec * 1.6,
        alpha: 0.72,
        additive: true,
      });
    }

    this.drawWorldLabel(
      ctx,
      ATHENA_POS.x,
      ATHENA_POS.y + 44,
      `雅典娜圣殿 Lv.${world.sanctuary.level}`,
      '#fef3c7',
      'rgba(250, 204, 21, 0.72)',
      11.5
    );
    if (world.sanctuary.hp < world.sanctuary.maxHp || world.sanctuary.shield > 0) {
      this.drawHpBar(ctx, ATHENA_POS.x, ATHENA_POS.y + 52, 120, 7, world.sanctuary.hp / world.sanctuary.maxHp, '#facc15');
    }
    ctx.restore();
  }

  private renderProp(ctx: CanvasRenderingContext2D, pr: typeof WORLD_PROPS[number], nowSec: number): void {
    ctx.save();
    this.drawSoftShadow(ctx, pr.x + 3, pr.y + pr.radius * 0.65, pr.radius * 2.15, pr.radius * 1.02, 0.7);

    if (pr.kind === 'crystal') {
      this.drawCenteredSprite(ctx, IconAtlas.getSprite('fx_aura_arcane'), pr.x, pr.y + 8, 66, 40, {
        angle: nowSec * 0.6 + pr.x,
        alpha: 0.3,
        additive: true,
      });
    }

    if (pr.kind === 'anvil') {
      this.drawCenteredSprite(ctx, IconAtlas.getSprite('fx_glow_fire'), pr.x, pr.y - 6, 56, 56, {
        alpha: 0.34 + Math.sin(nowSec * 6) * 0.08,
        additive: true,
      });
    }

    const spriteKey = `prop_${pr.kind}`;
    const size = pr.kind === 'tree' ? 86 : pr.kind === 'tent' ? 84 : 62;
    this.drawCenteredSprite(ctx, IconAtlas.getSprite(spriteKey), pr.x, pr.y - 6, size, size);

    if (pr.kind === 'anvil') {
      this.drawWorldLabel(ctx, pr.x, pr.y + 30, '铁匠铺', '#fde68a', 'rgba(250, 204, 21, 0.55)', 10.5);
    }

    if (pr.kind === 'brazier') {
      const fSz = 114 + Math.sin(nowSec * 9 + pr.x) * 12;
      this.drawCenteredSprite(ctx, IconAtlas.getSprite('fx_glow_fire'), pr.x, pr.y - 10, fSz, fSz, {
        angle: Math.sin(nowSec * 4 + pr.y) * 0.25,
        alpha: 0.72 + Math.sin(nowSec * 11 + pr.x) * 0.12,
        additive: true,
      });
      const sparkSpr = IconAtlas.getSprite('fx_hit_spark');
      for (let k = 0; k < 2; k++) {
        const cy = (nowSec * 0.9 + k * 0.5 + pr.x * 0.01) % 1;
        this.drawCenteredSprite(ctx, sparkSpr, pr.x + Math.sin(nowSec * 5 + k * 2 + pr.y) * 8, pr.y - 16 - cy * 34, 14, 14, {
          angle: nowSec * 4 + k,
          alpha: (1 - cy) * 0.75,
          additive: true,
        });
      }
    }
    ctx.restore();
  }

  private renderEnemy(ctx: CanvasRenderingContext2D, e: EnemyEntity, nowSec: number): void {
    ctx.save();
    // Soft raster ground contact shadow
    const sinStep = Math.sin(e.animPhase);
    const hop = e.stunTimer <= 0 ? Math.abs(sinStep) * 4.5 * e.moveSpeedNorm : 0;
    const shadowScale = Math.max(0.75, 1 - hop * 0.04);

    this.drawSoftShadow(
      ctx,
      e.x + e.knockX * 0.4,
      e.y + e.radius * 0.65 + e.knockY * 0.25,
      e.radius * 2.0 * shadowScale,
      e.radius * 0.94 * shadowScale,
      0.74
    );

    // Boss warning raster aura on floor
    if (e.isBoss) {
      const auraSz = (e.radius + 14) * 2.3 + Math.sin(nowSec * 5) * 6;
      this.drawCenteredSprite(ctx, IconAtlas.getSprite('fx_boss_aura'), e.x, e.y + e.radius * 0.48, auraSz, auraSz * 0.56, {
        angle: nowSec * 0.85,
        alpha: 0.74,
        additive: true,
      });
    }

    const sKey = `enemy_${e.kind}`;
    const spr = e.hitFlash > 0 ? IconAtlas.getWhiteFlash(sKey) || IconAtlas.getSprite(sKey) : IconAtlas.getSprite(sKey);
    const drawSz = e.isBoss ? e.radius * 2.85 : e.isMiniBoss ? e.radius * 2.7 : e.radius * 2.65;
    const facingDir = Math.cos(e.facing) < 0 ? -1 : 1;

    // Attack lunge curve
    let atkLunge = 0;
    let atkSx = 1;
    let atkSy = 1;
    if (e.attackAnim > 0) {
      const p = 1 - Math.min(1, e.attackAnim / 0.26);
      atkLunge = Math.sin(p * Math.PI) * 8;
      atkSx = 1 + Math.sin(p * Math.PI) * 0.12;
      atkSy = 1 - Math.sin(p * Math.PI) * 0.08;
    }

    const idleBreath = e.stunTimer <= 0 ? Math.sin(e.animPhase) * 0.025 * (1 - e.moveSpeedNorm) : 0;
    const runTilt = e.stunTimer <= 0 ? facingDir * (0.06 * e.moveSpeedNorm + sinStep * 0.04 * e.moveSpeedNorm) : 0;
    const cx = e.x + e.knockX + Math.cos(e.facing) * atkLunge;
    const cy = e.y + e.knockY - e.radius * 0.28 - hop + Math.sin(e.facing) * atkLunge * 0.5;

    if (spr && (!(spr instanceof HTMLImageElement) || (spr.complete && spr.naturalWidth > 0))) {
      ctx.save();
      ctx.translate(cx, cy);
      if (runTilt) ctx.rotate(runTilt);
      ctx.scale(facingDir * atkSx * (1 - idleBreath * 0.5), atkSy * (1 + idleBreath));
      ctx.drawImage(spr, -drawSz / 2, -drawSz / 2, drawSz, drawSz);
      ctx.restore();
    }

    if (e.burnTimer > 0) {
      this.drawCenteredSprite(ctx, IconAtlas.getSprite('fx_glow_fire'), e.x, e.y - 2, e.radius * 2.0, e.radius * 2.0, {
        angle: nowSec * 3.5,
        alpha: 0.48,
        additive: true,
      });
    }

    if (e.stunTimer > 0) {
      this.drawCenteredSprite(ctx, IconAtlas.getSprite('fx_status_stun'), e.x, e.y - drawSz * 0.55 - 16, 38, 26, {
        angle: nowSec * 4.2,
        additive: true,
      });
    } else if (e.slowTimer > 0) {
      this.drawCenteredSprite(ctx, IconAtlas.getSprite('fx_status_slow'), e.x, e.y + e.radius * 0.52, e.radius * 2.3, e.radius * 1.25, {
        angle: -nowSec * 1.4,
        alpha: 0.78,
        additive: true,
      });
    }

    const barW = e.isBoss ? 98 : e.isMiniBoss ? 56 : 38;
    const barH = e.isBoss ? 8 : 5;
    const barY = e.y - drawSz * 0.55 - 8 - hop;
    this.drawHpBar(ctx, e.x, barY, barW, barH, e.hp / e.maxHp, e.isBoss ? '#f43f5e' : '#ef4444');
    if (e.shield > 0) {
      const shR = Math.min(1, e.shield / Math.max(1, e.maxHp));
      ctx.fillStyle = 'rgba(125, 211, 252, 0.88)';
      ctx.fillRect(e.x - barW / 2, barY, barW * shR, 2.5);
    }
    if (e.armorShredTimer > 0) {
      ctx.fillStyle = '#fb923c';
      ctx.fillRect(e.x - barW / 2, barY + barH + 1, barW, 2);
    }
    if (e.isBoss || e.isMiniBoss) {
      ctx.fillStyle = '#fef3c7';
      ctx.strokeStyle = '#000';
      ctx.lineWidth = 2.5;
      ctx.font = 'bold 11px sans-serif';
      ctx.textAlign = 'center';
      ctx.strokeText(e.name, e.x, barY - 6);
      ctx.fillText(e.name, e.x, barY - 6);
    }
    ctx.restore();
  }

  private resolveHeroPose(h: HeroEntity): HeroAnimPose {
    if (h.swingAnim > 0 || h.castAnim > 0 || h.bladestormTimer > 0) return 'attack';
    if (h.moveSpeedNorm >= 0.08) {
      const seq: HeroAnimPose[] = ['walk1', 'idle', 'walk2', 'idle'];
      return seq[Math.floor(h.animPhase / (Math.PI * 0.5)) % 4];
    }
    return 'idle';
  }

  private renderHero(ctx: CanvasRenderingContext2D, h: HeroEntity, nowSec: number, nameplateLift = 0): void {
    const def = getHeroClassDef(h.classId);
    const scale = h.avatarTimer > 0 ? 1.32 : 1.0;
    const r = 20 * scale;

    ctx.save();
    if (h.dead) {
      this.drawSoftShadow(ctx, h.x, h.y + 12, 40, 18, 0.7);
      this.drawCenteredSprite(ctx, IconAtlas.getSprite('prop_tombstone'), h.x, h.y - 6, 48, 48);
      ctx.fillStyle = '#fca5a5';
      ctx.strokeStyle = '#000';
      ctx.lineWidth = 2.5;
      ctx.font = 'bold 12px sans-serif';
      ctx.textAlign = 'center';
      ctx.strokeText(`复活 ${Math.ceil(h.reviveTimer)}s`, h.x, h.y - 32);
      ctx.fillText(`复活 ${Math.ceil(h.reviveTimer)}s`, h.x, h.y - 32);
      ctx.restore();
      return;
    }

    if (h.stealthTimer > 0) ctx.globalAlpha = 0.45;

    // 1. Soft Rotating AI Runic Ground Aura + crisp raster Selection Rune Ring
    const auraKey =
      h.classId === 'paladin' || h.classId === 'priest'
        ? 'fx_aura_paladin'
        : h.classId === 'archmage'
          ? 'fx_aura_arcane'
          : 'fx_aura_wind';
    const auraSpr = IconAtlas.getSprite(auraKey);
    if (auraSpr) {
      ctx.save();
      ctx.translate(h.x, h.y + 11);
      ctx.scale(1, 0.56);
      ctx.rotate(nowSec * 0.9);
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = h.isLocal ? 0.34 : 0.18;
      const auraSz = 82 * scale;
      ctx.drawImage(auraSpr, -auraSz / 2, -auraSz / 2, auraSz, auraSz);
      ctx.restore();
    }

    const selRingKey = h.isLocal ? 'fx_ring_local' : 'fx_ring_ally';
    this.drawCenteredSprite(ctx, IconAtlas.getSprite(selRingKey), h.x, h.y + 11, (r + 9) * 2.05, (r + 9) * 1.1, {
      angle: -nowSec * 0.55,
      alpha: h.isLocal ? 0.78 : 0.5,
      additive: true,
    });

    // Bladestorm AI swirl FX
    if (h.bladestormTimer > 0) {
      this.drawCenteredSprite(ctx, IconAtlas.getSprite('fx_aura_wind') || IconAtlas.getSprite('fx_slash'), h.x, h.y, 260, 260, {
        angle: nowSec * 14,
        alpha: 0.78,
        additive: true,
      });
    }

    // Paladin Consecrate ground ring
    if (h.consecrateTimer > 0) {
      this.drawCenteredSprite(ctx, IconAtlas.getSprite('fx_aura_paladin') || IconAtlas.getSprite('fx_holy_ring'), h.x, h.y + 6, 460, 280, {
        angle: nowSec * 0.8,
        alpha: 0.48,
        additive: true,
      });
    }

    // 2. Dash / Ghost Afterimages
    const drawSz = 88 * scale;
    for (const ghost of h.afterimages) {
      const gKey = `hero_anim_${h.classId}_${ghost.pose}`;
      const gSpr = IconAtlas.getSprite(gKey) || IconAtlas.getSprite(`hero_td_${h.classId}`);
      this.drawFootAnchoredSprite(ctx, gSpr, ghost.x, ghost.y + 14, drawSz * 0.96, drawSz * 0.96, {
        scaleX: ghost.flip,
        alpha: ghost.alpha * 0.55,
        additive: true,
      });
    }

    // 3. Agile Stylized Multi-Pose Kinematics
    const pose = this.resolveHeroPose(h);
    const spriteKey = `hero_anim_${h.classId}_${pose}`;
    const rawSpr = IconAtlas.getSprite(spriteKey) || IconAtlas.getSprite(`hero_td_${h.classId}`);
    const spr = h.hitFlash > 0 ? IconAtlas.getWhiteFlash(spriteKey) || IconAtlas.getWhiteFlash(`hero_td_${h.classId}`) || rawSpr : rawSpr;

    const facingSign = h.flipVisual >= 0 ? 1 : -1;
    const turnScale = 0.84 + 0.16 * Math.min(1, Math.abs(h.flipVisual));
    const flipX = facingSign * turnScale;

    // Subtle idle breathing vs crisp agile run stride (non-rubbery)
    const idleWeight = 1 - h.moveSpeedNorm;
    const breath = Math.sin(h.animPhase) * 0.022 * idleWeight;
    const skewIdle = Math.sin(h.animPhase * 0.5) * 0.012 * idleWeight;

    const sinRun = Math.sin(h.animPhase);
    const strideHop = Math.abs(sinRun) * 2.8 * h.moveSpeedNorm;
    const runScaleY = 1 + (Math.abs(sinRun) - 0.5) * 0.04 * h.moveSpeedNorm;
    const runTilt = facingSign * (0.055 * h.moveSpeedNorm + sinRun * 0.025 * h.moveSpeedNorm);

    // 3-phase attack / cast curve
    let atkLunge = 0;
    let atkSx = 1;
    let atkSy = 1;
    let atkTilt = 0;
    if (h.swingAnim > 0 || h.castAnim > 0) {
      const activeDur = h.swingAnim > 0 ? Math.max(0.01, h.swingDuration || 0.28) : 0.42;
      const activeRem = h.swingAnim > 0 ? h.swingAnim : h.castAnim;
      const p = Math.max(0, Math.min(1, 1 - activeRem / activeDur));
      if (p < 0.22) {
        const k = p / 0.22;
        atkLunge = -4 * k;
        atkSx = 1 + 0.05 * k;
        atkSy = 1 - 0.07 * k;
        atkTilt = -facingSign * 0.08 * k;
      } else if (p < 0.58) {
        const k = (p - 0.22) / 0.36;
        const pulse = Math.sin(k * Math.PI * 0.72);
        atkLunge = 12 * pulse;
        atkSx = 1 + 0.13 * pulse;
        atkSy = 1 - 0.08 * pulse;
        atkTilt = facingSign * 0.16 * pulse;
      } else {
        const k = (p - 0.58) / 0.42;
        const decay = 1 - k;
        atkLunge = 9 * decay;
        atkSx = 1 + 0.07 * decay;
        atkSy = 1 - 0.04 * decay;
        atkTilt = facingSign * 0.09 * decay;
      }
    }

    // Contact shadow scales inversely with hop (100% raster soft shadow)
    const shadowScale = Math.max(0.68, 1 - strideHop * 0.035);
    this.drawSoftShadow(ctx, h.x, h.y + 14, r * 2.15 * shadowScale, r * 1.02 * shadowScale, 0.78);

    const footX = h.x + Math.cos(h.facing) * atkLunge;
    const footY = h.y + 14 - strideHop + Math.sin(h.facing) * atkLunge * 0.45;

    this.drawFootAnchoredSprite(ctx, spr, footX, footY, drawSz, drawSz, {
      scaleX: flipX * atkSx * (1 - breath * 0.6),
      scaleY: (1 + breath) * runScaleY * atkSy,
      tilt: runTilt + atkTilt,
      skewX: skewIdle,
    });

    if (h.castAnim > 0) {
      const caRatio = h.castAnim / 0.42;
      this.drawCenteredSprite(ctx, IconAtlas.getSprite('fx_cast_burst'), h.x, h.y - 26 + (1 - caRatio) * -10, 62, 62, {
        angle: nowSec * 4,
        alpha: caRatio * 0.55,
        additive: true,
      });
    }

    if (h.invulnTimer > 0 || h.shield > 0) {
      const shKey = h.invulnTimer > 0 ? 'fx_shield_holy' : 'fx_shield_arcane';
      this.drawCenteredSprite(ctx, IconAtlas.getSprite(shKey), h.x, h.y - 12, (r + 20) * 2, (r + 20) * 2, {
        angle: nowSec * 0.85,
        alpha: 0.66,
        additive: true,
      });
    }

    if (h.recallTimer > 0) {
      this.drawHpBar(ctx, h.x, h.y + r + 16, 48, 5, 1 - h.recallTimer / 1.6, '#38bdf8');
    }

    // 4. Sculpted War3 Hero Nameplate (compact left-attached Lv badge + anti-overlap lift)
    ctx.globalAlpha = 1;
    const displayName = h.callsign.startsWith('圣殿勇者-') ? def.name : h.callsign;
    const tag = `${h.carryingWater ? '💧 ' : ''}${displayName}`;
    const topY = footY - drawSz * 0.88 - 16 - nameplateLift;
    ctx.fillStyle = h.isLocal ? '#fde047' : '#e2e8f0';
    ctx.strokeStyle = '#000';
    ctx.lineWidth = 2.6;
    ctx.font = 'bold 11px sans-serif';
    ctx.textAlign = 'center';
    ctx.strokeText(tag, h.x, topY);
    ctx.fillText(tag, h.x, topY);

    const lvW = 18;
    const barW = 52;
    const totalW = lvW + barW;
    const leftX = h.x - totalW / 2;
    const trackY = topY + 4;
    const hpRatio = h.hp / Math.max(1, h.stats.maxHp);

    ctx.fillStyle = h.isLocal ? '#b4821e' : '#475569';
    ctx.fillRect(leftX - 2, trackY - 1, totalW + 4, 14);
    ctx.fillStyle = '#090d16';
    ctx.fillRect(leftX - 1, trackY, totalW + 2, 12);

    ctx.fillStyle = h.isLocal ? '#3b2809' : '#1e293b';
    ctx.fillRect(leftX, trackY + 1, lvW - 1, 10);
    ctx.fillStyle = h.isLocal ? '#fde047' : '#cbd5e1';
    ctx.font = 'bold 9px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(`${h.level}`, leftX + (lvW - 1) / 2, trackY + 9);

    const barCenterX = leftX + lvW + barW / 2;
    this.drawHpBar(ctx, barCenterX, trackY + 2, barW, 5, hpRatio, h.isLocal ? '#22c55e' : '#4ade80');
    if (h.shield > 0) {
      const shRatio = Math.min(1, h.shield / Math.max(1, h.stats.maxHp));
      ctx.fillStyle = 'rgba(224, 242, 254, 0.84)';
      ctx.fillRect(leftX + lvW, trackY + 2, barW * shRatio, 2);
    }
    this.drawHpBar(ctx, barCenterX, trackY + 8, barW, 3, h.mp / Math.max(1, h.stats.maxMp), '#38bdf8');

    ctx.fillStyle = 'rgba(0,0,0,0.45)';
    for (let t = 1; t < 4; t++) {
      ctx.fillRect(Math.round(leftX + lvW + (barW * t) / 4), trackY + 2, 1, 5);
    }
    ctx.restore();
  }

  private renderAimIndicator(ctx: CanvasRenderingContext2D, hero: HeroEntity, input: InputManager): void {
    const aim = input.aimingSkill;
    if (!aim || aim.slot > 4) return;
    const def = getHeroClassDef(hero.classId);
    const sk = aim.slot < 4 ? def.skills[aim.slot] : null;
    const range = sk ? sk.range : 270;
    const radius = sk ? sk.radius : 60;
    const aimType = sk ? sk.aimType : 'direction';
    const suf = aim.cancelled ? '_cancel' : '';

    this.drawCenteredSprite(ctx, IconAtlas.getSprite(`fx_aim_range${suf}`), hero.x, hero.y, range * 2, range * 2, {
      alpha: 0.55,
      additive: true,
    });

    const ang = Math.atan2(aim.dy, aim.dx);
    if (aimType === 'ground_aoe') {
      const tx = hero.x + aim.dx * range * aim.distRatio;
      const ty = hero.y + aim.dy * range * aim.distRatio;
      this.drawStretchedBeam(ctx, IconAtlas.getSprite(`fx_aim_line${suf}`), hero.x, hero.y, tx, ty, 24, 0.45, true);
      this.drawCenteredSprite(ctx, IconAtlas.getSprite(`fx_aim_aoe${suf}`), tx, ty, radius * 2, radius * 2, {
        alpha: 0.88,
        additive: true,
      });
    } else if (aimType === 'cone') {
      this.drawCenteredSprite(ctx, IconAtlas.getSprite(`fx_aim_cone${suf}`), hero.x, hero.y, range * 2.08, range * 2.08, {
        angle: ang,
        alpha: 0.88,
        additive: true,
      });
    } else {
      const ex = hero.x + Math.cos(ang) * range;
      const ey = hero.y + Math.sin(ang) * range;
      this.drawStretchedBeam(ctx, IconAtlas.getSprite(`fx_aim_line${suf}`), hero.x, hero.y, ex, ey, 68, 0.88, true);
    }
  }

  private drawHpBar(
    ctx: CanvasRenderingContext2D,
    cx: number,
    y: number,
    w: number,
    h: number,
    ratio: number,
    color: string
  ): void {
    const r = Math.max(0, Math.min(1, ratio));
    ctx.fillStyle = 'rgba(0,0,0,0.78)';
    ctx.fillRect(cx - w / 2 - 1, y - 1, w + 2, h + 2);
    ctx.fillStyle = color;
    ctx.fillRect(cx - w / 2, y, w * r, h);
  }

  public renderMinimap(ctx: CanvasRenderingContext2D, world: GameWorldState, w: number, h: number): void {
    ctx.fillStyle = '#090d14';
    ctx.fillRect(0, 0, w, h);
    const sx = w / WORLD_WIDTH;
    const sy = h / WORLD_HEIGHT;

    for (const z of ZONE_LIST) {
      const rx = z.rect.x * sx;
      const ry = z.rect.y * sy;
      const rw = z.rect.w * sx;
      const rh = z.rect.h * sy;
      ctx.fillStyle = `${z.color}2e`;
      ctx.fillRect(rx, ry, rw, rh);
      ctx.fillStyle = `${z.color}88`;
      ctx.fillRect(rx, ry, rw, 1);
      ctx.fillRect(rx, ry + rh - 1, rw, 1);
      ctx.fillRect(rx, ry, 1, rh);
      ctx.fillRect(rx + rw - 1, ry, 1, rh);
    }

    // 1-approach 3-column converging lane layout + chokepoint + courtyard disc + east water road
    const drawMapRoad = (x1: number, y1: number, x2: number, y2: number, wWorld: number) => {
      const mx1 = x1 * sx;
      const my1 = y1 * sy;
      const mx2 = x2 * sx;
      const my2 = y2 * sy;
      const dx = mx2 - mx1;
      const dy = my2 - my1;
      const len = Math.hypot(dx, dy);
      if (len < 1) return;
      ctx.save();
      ctx.translate(mx1, my1);
      ctx.rotate(Math.atan2(dy, dx));
      ctx.fillStyle = 'rgba(200, 162, 74, 0.34)';
      ctx.fillRect(0, -wWorld * sx * 0.5, len, wWorld * sx);
      ctx.restore();
    };
    drawMapRoad(1760, 1320, 1760, 1590, 95);
    drawMapRoad(2100, 1320, 2100, 1890, 105);
    drawMapRoad(2440, 1320, 2440, 1590, 95);
    drawMapRoad(1760, 1585, CONVERGENCE_POS.x, CONVERGENCE_POS.y, 98);
    drawMapRoad(2440, 1585, CONVERGENCE_POS.x, CONVERGENCE_POS.y, 98);
    drawMapRoad(CONVERGENCE_POS.x, CONVERGENCE_POS.y, ATHENA_POS.x, ATHENA_POS.y, 145);
    drawMapRoad(FOUNTAIN_POS.x, FOUNTAIN_POS.y, WATER_ALTAR_POS.x, WATER_ALTAR_POS.y, 120);

    const plazaSpr = IconAtlas.getSprite('tile_plaza_disc');
    if (plazaSpr) {
      this.drawCenteredSprite(ctx, plazaSpr, CONVERGENCE_POS.x * sx, CONVERGENCE_POS.y * sy, 320 * sx, 320 * sy, { alpha: 0.72 });
      this.drawCenteredSprite(ctx, plazaSpr, ATHENA_POS.x * sx, ATHENA_POS.y * sy, 880 * sx, 880 * sy, { alpha: 0.72 });
    }

    // Towers
    for (const t of world.towers) {
      ctx.fillStyle = t.type && t.level > 0 ? '#38bdf8' : '#64748b';
      ctx.fillRect(t.x * sx - 1.5, t.y * sy - 1.5, 3, 3);
    }

    // Pulsing raster Athena Beacon
    const beaconSz = 10 + Math.sin(world.elapsedSec * 4) * 2.5;
    const sparkSpr = IconAtlas.getSprite('fx_hit_spark');
    if (sparkSpr) {
      this.drawCenteredSprite(ctx, sparkSpr, ATHENA_POS.x * sx, ATHENA_POS.y * sy, beaconSz, beaconSz, { additive: true });
    } else {
      ctx.fillStyle = '#facc15';
      ctx.fillRect(ATHENA_POS.x * sx - 3, ATHENA_POS.y * sy - 3, 6, 6);
    }

    for (const e of world.enemies) {
      if (e.hp <= 0) continue;
      ctx.fillStyle = e.isBoss ? '#f43f5e' : '#ef4444';
      ctx.fillRect(e.x * sx - (e.isBoss ? 2.5 : 1), e.y * sy - (e.isBoss ? 2.5 : 1), e.isBoss ? 5 : 2, e.isBoss ? 5 : 2);
    }

    for (const hero of world.heroes) {
      if (hero.dead) continue;
      const hx = hero.x * sx;
      const hy = hero.y * sy;
      ctx.fillStyle = '#090d14';
      ctx.fillRect(hx - 4, hy - 4, 8, 8);
      ctx.fillStyle = hero.isLocal ? '#4ade80' : '#38bdf8';
      ctx.fillRect(hx - 3, hy - 3, 6, 6);
    }

    const pingSpr = IconAtlas.getSprite('fx_ring_ally');
    for (const p of world.pings) {
      if (pingSpr) {
        this.drawCenteredSprite(ctx, pingSpr, p.x * sx, p.y * sy, 12, 12, { additive: true });
      }
    }
  }
}
