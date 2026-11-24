import { getHeroClassDef } from '../data/heroes';
import {
  ATHENA_POS,
  FOUNTAIN_POS,
  PORTALS,
  WATER_ALTAR_POS,
  WAVE_LANES,
  WORLD_PROPS,
  WORLD_WIDTH,
  WORLD_HEIGHT,
  ZONE_LIST,
} from '../data/worldMap';
import { EnemyEntity, GameWorldState, HeroEntity } from './GameState';
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

  public renderWorld(
    ctx: CanvasRenderingContext2D,
    world: GameWorldState,
    input: InputManager,
    camX: number,
    camY: number,
    viewW: number,
    viewH: number
  ): void {
    ctx.fillStyle = '#070a10';
    ctx.fillRect(0, 0, viewW, viewH);

    ctx.save();
    ctx.translate(Math.round(-camX), Math.round(-camY));

    const minX = camX - 160;
    const minY = camY - 160;
    const maxX = camX + viewW + 160;
    const maxY = camY + viewH + 160;
    const nowSec = world.elapsedSec;

    // 1. Render visible biome zones using AI seamless terrain tiles
    for (const z of ZONE_LIST) {
      const r = z.rect;
      if (r.x > maxX || r.x + r.w < minX || r.y > maxY || r.y + r.h < minY) continue;
      const pat = this.getPattern(ctx, z.biome);
      ctx.fillStyle = pat || '#1e3524';
      ctx.fillRect(r.x, r.y, r.w, r.h);

      ctx.strokeStyle = z.color;
      ctx.globalAlpha = 0.65;
      ctx.lineWidth = 4;
      ctx.strokeRect(r.x + 2, r.y + 2, r.w - 4, r.h - 4);
      ctx.globalAlpha = 1;

      ctx.fillStyle = 'rgba(10, 14, 22, 0.78)';
      ctx.fillRect(r.x + 14, r.y + 12, 232, 32);
      ctx.strokeStyle = z.color;
      ctx.lineWidth = 1.5;
      ctx.strokeRect(r.x + 14, r.y + 12, 232, 32);
      ctx.fillStyle = '#fef3c7';
      ctx.font = 'bold 14px Georgia, serif';
      ctx.fillText(z.name, r.x + 24, r.y + 33);
    }

    // 2. Sanctuary cobble plaza, dirt roads & demonic spawn gates
    this.renderSanctuaryTerrain(ctx);

    // 3. Portals
    for (const p of PORTALS) {
      if (p.x < minX || p.x > maxX || p.y < minY || p.y > maxY) continue;
      const pulse = 1 + Math.sin(nowSec * 3.2) * 0.05;
      const sz = p.radius * 2.55 * pulse;
      const img = IconAtlas.getSprite('struct_portal');
      this.drawCenteredSprite(ctx, img, p.x, p.y, sz, sz);
      ctx.fillStyle = '#fef3c7';
      ctx.font = 'bold 12px sans-serif';
      ctx.textAlign = 'center';
      ctx.strokeStyle = '#000';
      ctx.lineWidth = 3;
      ctx.strokeText(p.label, p.x, p.y + p.radius + 16);
      ctx.fillText(p.label, p.x, p.y + p.radius + 16);
      ctx.textAlign = 'left';
    }

    // 4. Boss / Skill Ground Telegraphs (tactical warning markers)
    for (const t of world.telegraphs) {
      if (t.x + t.radius < minX || t.x - t.radius > maxX || t.y + t.radius < minY || t.y - t.radius > maxY) continue;
      ctx.save();
      if (t.kind === 'enemy_aoe') {
        const fillRatio = 1 - Math.max(0, t.timer / t.maxTimer);
        ctx.fillStyle = 'rgba(239, 68, 68, 0.18)';
        ctx.beginPath();
        ctx.arc(t.x, t.y, t.radius, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = 'rgba(239, 68, 68, 0.34)';
        ctx.beginPath();
        ctx.arc(t.x, t.y, t.radius * fillRatio, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = '#f87171';
        ctx.lineWidth = 2.5;
        ctx.stroke();
      } else {
        ctx.globalAlpha = 0.24 + Math.sin(nowSec * 6) * 0.06;
        ctx.fillStyle = t.color;
        ctx.beginPath();
        ctx.arc(t.x, t.y, t.radius, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = 0.78;
        ctx.strokeStyle = t.color;
        ctx.lineWidth = 2.5;
        ctx.setLineDash([8, 6]);
        ctx.stroke();
      }
      ctx.restore();
    }

    // 5. Athena Statue, Fountain, Water Altar, Towers
    this.renderAthenaAndStructures(ctx, world, nowSec);

    // 6. Props (AI sprites with contact shadows)
    for (const pr of WORLD_PROPS) {
      if (pr.x < minX || pr.x > maxX || pr.y < minY || pr.y > maxY) continue;
      this.renderProp(ctx, pr, nowSec);
    }

    // 7. Drops (AI sprites)
    for (const d of world.drops) {
      if (d.x < minX || d.x > maxX || d.y < minY || d.y > maxY) continue;
      const bob = Math.sin(nowSec * 4 + d.id) * 3;
      const key = d.kind === 'gold' ? 'drop_gold' : d.kind === 'crystal' ? 'drop_crystal' : 'drop_stone';
      ctx.fillStyle = 'rgba(0,0,0,0.4)';
      ctx.beginPath();
      ctx.ellipse(d.x, d.y + 11, 12, 6, 0, 0, Math.PI * 2);
      ctx.fill();
      this.drawCenteredSprite(ctx, IconAtlas.getSprite(key), d.x, d.y + bob, 32, 32);
    }

    // 8. Summons
    for (const s of world.summons) {
      if (s.x < minX || s.x > maxX || s.y < minY || s.y > maxY) continue;
      ctx.save();
      ctx.fillStyle = 'rgba(0,0,0,0.42)';
      ctx.beginPath();
      ctx.ellipse(s.x, s.y + s.radius * 0.72, s.radius * 0.95, s.radius * 0.45, 0, 0, Math.PI * 2);
      ctx.fill();
      const sKey = s.kind === 'illusion' ? 'hero_td_blademaster' : 'summon_treant';
      const sz = s.radius * 2.6;
      this.drawCenteredSprite(ctx, IconAtlas.getSprite(sKey), s.x, s.y - 4, sz, sz, {
        flipX: Math.cos(s.facing) < 0,
        alpha: s.kind === 'illusion' ? 0.72 : 1.0,
      });
      this.drawHpBar(ctx, s.x, s.y - s.radius - 14, 38, 5, s.hp / s.maxHp, '#4ade80');
      ctx.restore();
    }

    // 9. Enemies & Bosses (Y-sorted light depth order)
    const visibleEnemies = world.enemies
      .filter((e) => e.x + 120 >= minX && e.x - 120 <= maxX && e.y + 120 >= minY && e.y - 120 <= maxY)
      .sort((a, b) => a.y - b.y);
    for (const e of visibleEnemies) {
      this.renderEnemy(ctx, e, nowSec);
    }

    // 10. Heroes
    for (const h of world.heroes) {
      if (h.x + 120 < minX || h.x - 120 > maxX || h.y + 120 < minY || h.y - 120 > maxY) continue;
      this.renderHero(ctx, h, nowSec);
    }

    // 11. Projectiles (AI directional glow sprites)
    for (const p of world.projectiles) {
      if (p.x < minX || p.x > maxX || p.y < minY || p.y > maxY) continue;
      const pKey = !p.isMagic
        ? 'proj_arrow'
        : p.color === '#38bdf8' || p.color === '#67e8f9' || p.color === '#bae6fd'
          ? 'proj_frostbolt'
          : p.color === '#fb923c' || p.color === '#ef4444' || p.color === '#fde047'
            ? 'proj_fireball'
            : 'proj_arcane';
      const ang = Math.atan2(p.vy, p.vx);
      const sz = Math.max(26, p.radius * 3.1);
      this.drawCenteredSprite(ctx, IconAtlas.getSprite(pKey), p.x, p.y, sz, sz, {
        angle: ang,
        additive: true,
      });
    }

    // 12. Visual Effects (AI FX sprites + subtle War3 rings)
    for (const v of world.vfx) {
      const t = 1 - v.life / v.maxLife;
      const alpha = Math.max(0, 1 - t);
      ctx.save();
      ctx.globalAlpha = alpha;
      if (v.kind === 'slash') {
        this.drawCenteredSprite(ctx, IconAtlas.getSprite('fx_slash'), v.x, v.y, v.radius * 1.4, v.radius * 1.4, {
          angle: v.angle || 0,
          alpha,
          additive: true,
        });
      } else if (v.kind === 'explosion') {
        const fxKey = v.color === '#38bdf8' || v.color === '#67e8f9' ? 'fx_frost_burst' : 'fx_explosion';
        const sz = v.radius * (0.95 + t * 0.55) * 1.45;
        this.drawCenteredSprite(ctx, IconAtlas.getSprite(fxKey), v.x, v.y, sz, sz, {
          alpha,
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
        ctx.strokeStyle = v.color;
        ctx.lineWidth = Math.max(2, v.radius * (1 - t));
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(v.x, v.y);
        ctx.lineTo(v.tx, v.ty);
        ctx.stroke();
      } else if (v.kind === 'chain' && v.points && v.points.length > 1) {
        ctx.strokeStyle = v.color;
        ctx.lineWidth = 3.5;
        ctx.beginPath();
        ctx.moveTo(v.points[0].x, v.points[0].y);
        for (let k = 1; k < v.points.length; k++) ctx.lineTo(v.points[k].x, v.points[k].y);
        ctx.stroke();
      } else if (v.kind === 'levelup') {
        this.drawCenteredSprite(ctx, IconAtlas.getSprite('fx_holy_ring'), v.x, v.y, 140 * (0.7 + t * 0.5), 140 * (0.7 + t * 0.5), {
          alpha,
          additive: true,
        });
        const grad = ctx.createLinearGradient(v.x, v.y - 120, v.x, v.y + 20);
        grad.addColorStop(0, 'rgba(253, 224, 71, 0)');
        grad.addColorStop(0.6, 'rgba(253, 224, 71, 0.55)');
        grad.addColorStop(1, 'rgba(253, 224, 71, 0)');
        ctx.fillStyle = grad;
        ctx.fillRect(v.x - 24, v.y - 120, 48, 140);
      }
      ctx.restore();
    }

    // 13. Honor of Kings Skill Aiming Indicator
    const localHero = world.heroes.find((h) => h.isLocal);
    if (localHero && !localHero.dead && input.aimingSkill) {
      this.renderAimIndicator(ctx, localHero, input);
    }

    // 14. Pings
    for (const p of world.pings) {
      const t = 1 - p.life / 3.0;
      ctx.save();
      ctx.strokeStyle = p.color;
      ctx.globalAlpha = Math.max(0, 1 - t);
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(p.x, p.y, 18 + t * 55, 0, Math.PI * 2);
      ctx.stroke();
      ctx.fillStyle = p.color;
      ctx.font = 'bold 13px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(p.label, p.x, p.y - 24);
      ctx.restore();
    }

    // 15. Floating Texts
    for (const ft of world.floatingTexts) {
      ctx.save();
      ctx.globalAlpha = Math.max(0, ft.life / ft.maxLife);
      ctx.font = `900 ${ft.size}px sans-serif`;
      ctx.textAlign = 'center';
      ctx.strokeStyle = '#000000';
      ctx.lineWidth = 3;
      ctx.strokeText(ft.text, ft.x, ft.y);
      ctx.fillStyle = ft.color;
      ctx.fillText(ft.text, ft.x, ft.y);
      ctx.restore();
    }

    ctx.restore();
  }

  private renderSanctuaryTerrain(ctx: CanvasRenderingContext2D): void {
    const cobble = this.getPattern(ctx, 'cobble');
    const road = this.getPattern(ctx, 'road');

    ctx.fillStyle = road || '#4a3a28';
    ctx.fillRect(2040, 1290, 120, 1600);
    ctx.fillRect(1310, 2040, 2240, 120);

    ctx.save();
    ctx.beginPath();
    ctx.arc(ATHENA_POS.x, ATHENA_POS.y, 340, 0, Math.PI * 2);
    ctx.clip();
    ctx.fillStyle = cobble || '#333b48';
    ctx.fillRect(ATHENA_POS.x - 340, ATHENA_POS.y - 340, 680, 680);
    ctx.restore();

    ctx.strokeStyle = '#c8a24a';
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.arc(ATHENA_POS.x, ATHENA_POS.y, 340, 0, Math.PI * 2);
    ctx.stroke();

    const gateImg = IconAtlas.getSprite('struct_spawn_gate');
    for (const lane of WAVE_LANES) {
      ctx.save();
      this.drawCenteredSprite(ctx, gateImg, lane.spawn.x, lane.spawn.y - 10, 112, 112);
      ctx.fillStyle = '#fecaca';
      ctx.strokeStyle = '#000000';
      ctx.lineWidth = 3;
      ctx.font = 'bold 12px sans-serif';
      ctx.textAlign = 'center';
      ctx.strokeText(lane.name, lane.spawn.x, lane.spawn.y - 60);
      ctx.fillText(lane.name, lane.spawn.x, lane.spawn.y - 60);
      ctx.restore();
    }
  }

  private renderAthenaAndStructures(ctx: CanvasRenderingContext2D, world: GameWorldState, nowSec: number): void {
    // 1. Fountain of Health
    this.drawCenteredSprite(ctx, IconAtlas.getSprite('struct_fountain'), FOUNTAIN_POS.x, FOUNTAIN_POS.y, 148, 148);
    ctx.fillStyle = '#e0f2fe';
    ctx.strokeStyle = '#000';
    ctx.lineWidth = 3;
    ctx.font = 'bold 12px sans-serif';
    ctx.textAlign = 'center';
    ctx.strokeText('复活圣泉 (接水点)', FOUNTAIN_POS.x, FOUNTAIN_POS.y + 62);
    ctx.fillText('复活圣泉 (接水点)', FOUNTAIN_POS.x, FOUNTAIN_POS.y + 62);

    // 2. Water Altar
    this.drawCenteredSprite(ctx, IconAtlas.getSprite('struct_water_altar'), WATER_ALTAR_POS.x, WATER_ALTAR_POS.y, 132, 132);
    ctx.fillStyle = '#bae6fd';
    ctx.strokeText('东郊圣水祭坛 (运水终点)', WATER_ALTAR_POS.x, WATER_ALTAR_POS.y - 68);
    ctx.fillText('东郊圣水祭坛 (运水终点)', WATER_ALTAR_POS.x, WATER_ALTAR_POS.y - 68);

    // 3. Towers
    const padImg = IconAtlas.getSprite('tower_base');
    for (const t of world.towers) {
      ctx.save();
      this.drawCenteredSprite(ctx, padImg, t.x, t.y + 6, 72, 72);
      if (t.type && t.level > 0) {
        const tImg = IconAtlas.getSprite(`tower_${t.type}`);
        this.drawCenteredSprite(ctx, tImg, t.x, t.y - 18, 88, 88);
        ctx.fillStyle = '#fde047';
        ctx.strokeStyle = '#000';
        ctx.lineWidth = 3;
        ctx.font = 'bold 11px sans-serif';
        ctx.textAlign = 'center';
        ctx.strokeText(`Lv.${t.level}`, t.x, t.y + 34);
        ctx.fillText(`Lv.${t.level}`, t.x, t.y + 34);
      } else {
        ctx.fillStyle = '#cbd5e1';
        ctx.strokeStyle = '#000';
        ctx.lineWidth = 2.5;
        ctx.font = 'bold 11px sans-serif';
        ctx.textAlign = 'center';
        ctx.strokeText('塔基[G]', t.x, t.y + 30);
        ctx.fillText('塔基[G]', t.x, t.y + 30);
      }
      ctx.restore();
    }

    // 4. Goddess Athena Shrine Statue
    ctx.save();
    ctx.fillStyle = 'rgba(0,0,0,0.45)';
    ctx.beginPath();
    ctx.ellipse(ATHENA_POS.x, ATHENA_POS.y + 42, 64, 26, 0, 0, Math.PI * 2);
    ctx.fill();

    this.drawCenteredSprite(ctx, IconAtlas.getSprite('struct_athena'), ATHENA_POS.x, ATHENA_POS.y - 14, 176, 176);

    if (world.sanctuary.invulnTimer > 0 || world.sanctuary.shield > 0) {
      ctx.strokeStyle = world.sanctuary.invulnTimer > 0 ? '#fde047' : '#38bdf8';
      ctx.lineWidth = 3.5;
      ctx.beginPath();
      ctx.arc(ATHENA_POS.x, ATHENA_POS.y - 6, 78 + Math.sin(nowSec * 5) * 3, 0, Math.PI * 2);
      ctx.stroke();
    } else if (world.sanctuary.underAttackFlash > 0) {
      ctx.strokeStyle = '#ef4444';
      ctx.lineWidth = 3.5;
      ctx.beginPath();
      ctx.arc(ATHENA_POS.x, ATHENA_POS.y - 6, 76, 0, Math.PI * 2);
      ctx.stroke();
    }

    ctx.fillStyle = '#fef3c7';
    ctx.strokeStyle = '#000';
    ctx.lineWidth = 3;
    ctx.font = 'bold 14px Georgia, serif';
    ctx.textAlign = 'center';
    ctx.strokeText(`雅典娜圣殿 Lv.${world.sanctuary.level}`, ATHENA_POS.x, ATHENA_POS.y - 100);
    ctx.fillText(`雅典娜圣殿 Lv.${world.sanctuary.level}`, ATHENA_POS.x, ATHENA_POS.y - 100);
    this.drawHpBar(ctx, ATHENA_POS.x, ATHENA_POS.y - 90, 128, 8, world.sanctuary.hp / world.sanctuary.maxHp, '#facc15');
    ctx.restore();
  }

  private renderProp(ctx: CanvasRenderingContext2D, pr: typeof WORLD_PROPS[number], nowSec: number): void {
    ctx.save();
    ctx.fillStyle = 'rgba(0,0,0,0.38)';
    ctx.beginPath();
    ctx.ellipse(pr.x + 4, pr.y + pr.radius * 0.65, pr.radius * 0.95, pr.radius * 0.45, 0, 0, Math.PI * 2);
    ctx.fill();

    const spriteKey = `prop_${pr.kind}`;
    const size = pr.kind === 'tree' ? 86 : pr.kind === 'tent' ? 84 : 62;
    this.drawCenteredSprite(ctx, IconAtlas.getSprite(spriteKey), pr.x, pr.y - 6, size, size);

    if (pr.kind === 'brazier') {
      const grad = ctx.createRadialGradient(pr.x, pr.y - 10, 2, pr.x, pr.y - 10, 44 + Math.sin(nowSec * 10 + pr.x) * 6);
      grad.addColorStop(0, 'rgba(251, 146, 60, 0.35)');
      grad.addColorStop(1, 'rgba(251, 146, 60, 0)');
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(pr.x, pr.y - 10, 46, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  private renderEnemy(ctx: CanvasRenderingContext2D, e: EnemyEntity, nowSec: number): void {
    ctx.save();
    // Soft ground contact shadow
    ctx.fillStyle = 'rgba(0,0,0,0.45)';
    ctx.beginPath();
    ctx.ellipse(e.x, e.y + e.radius * 0.65, e.radius * 0.92, e.radius * 0.42, 0, 0, Math.PI * 2);
    ctx.fill();

    // Boss warning halo on floor
    if (e.isBoss) {
      ctx.strokeStyle = e.accentColor;
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.ellipse(e.x, e.y + e.radius * 0.48, e.radius + 10 + Math.sin(nowSec * 5) * 3, (e.radius + 10) * 0.56, 0, 0, Math.PI * 2);
      ctx.stroke();
    }

    const sKey = `enemy_${e.kind}`;
    const spr = e.hitFlash > 0 ? (IconAtlas.getWhiteFlash(sKey) || IconAtlas.getSprite(sKey)) : IconAtlas.getSprite(sKey);
    const walkBob = e.stunTimer <= 0 ? Math.sin(nowSec * 9 + e.id) * 2 : 0;
    const drawSz = e.isBoss ? e.radius * 2.85 : e.isMiniBoss ? e.radius * 2.7 : e.radius * 2.65;
    this.drawCenteredSprite(ctx, spr, e.x, e.y - e.radius * 0.28 + walkBob, drawSz, drawSz, {
      flipX: Math.cos(e.facing) < 0,
    });

    if (e.stunTimer > 0) {
      ctx.strokeStyle = '#facc15';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(e.x, e.y - e.radius - 12, 8, nowSec * 6, nowSec * 6 + Math.PI * 1.4);
      ctx.stroke();
    } else if (e.slowTimer > 0) {
      ctx.strokeStyle = '#38bdf8';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.ellipse(e.x, e.y + e.radius * 0.55, e.radius * 0.95, e.radius * 0.45, 0, 0, Math.PI * 2);
      ctx.stroke();
    }

    const barW = e.isBoss ? 92 : e.isMiniBoss ? 54 : 36;
    const barY = e.y - drawSz * 0.55 - 8;
    this.drawHpBar(ctx, e.x, barY, barW, e.isBoss ? 7 : 5, e.hp / e.maxHp, e.isBoss ? '#f43f5e' : '#ef4444');
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

  private renderHero(ctx: CanvasRenderingContext2D, h: HeroEntity, nowSec: number): void {
    const def = getHeroClassDef(h.classId);
    const scale = h.avatarTimer > 0 ? 1.35 : 1.0;
    const r = 20 * scale;

    ctx.save();
    if (h.dead) {
      ctx.fillStyle = 'rgba(0,0,0,0.45)';
      ctx.beginPath();
      ctx.ellipse(h.x, h.y + 12, 18, 8, 0, 0, Math.PI * 2);
      ctx.fill();
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

    // War3 Selection Ring + Class Aura Ring
    ctx.strokeStyle = h.isLocal ? '#4ade80' : '#38bdf8';
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.ellipse(h.x, h.y + 12, r + 10, (r + 10) * 0.56, 0, 0, Math.PI * 2);
    ctx.stroke();

    ctx.strokeStyle = def.auraColor;
    ctx.lineWidth = 2;
    ctx.setLineDash([7, 5]);
    ctx.beginPath();
    ctx.ellipse(h.x, h.y + 12, r + 16, (r + 16) * 0.56, 0, nowSec * 1.4, nowSec * 1.4 + Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);

    // Bladestorm AI swirl FX
    if (h.bladestormTimer > 0) {
      this.drawCenteredSprite(ctx, IconAtlas.getSprite('fx_slash'), h.x, h.y, 260, 260, {
        angle: nowSec * 14,
        alpha: 0.75,
        additive: true,
      });
    }

    // Paladin Consecrate ground ring
    if (h.consecrateTimer > 0) {
      this.drawCenteredSprite(ctx, IconAtlas.getSprite('fx_holy_ring'), h.x, h.y + 6, 460, 320, {
        alpha: 0.42,
        additive: true,
      });
    }

    // Shadow
    ctx.fillStyle = 'rgba(0,0,0,0.45)';
    ctx.beginPath();
    ctx.ellipse(h.x, h.y + 14, r * 0.95, r * 0.45, 0, 0, Math.PI * 2);
    ctx.fill();

    // Upright AI Hero Sprite with swing pulse
    const hKey = `hero_td_${h.classId}`;
    const spr = h.hitFlash > 0 ? (IconAtlas.getWhiteFlash(hKey) || IconAtlas.getSprite(hKey)) : IconAtlas.getSprite(hKey);
    const lunge = h.swingAnim > 0 ? Math.sin((h.swingAnim / 0.22) * Math.PI) * 6 : 0;
    const drawSz = 68 * scale;
    this.drawCenteredSprite(
      ctx,
      spr,
      h.x + Math.cos(h.facing) * lunge,
      h.y - 10 + Math.sin(h.facing) * lunge * 0.5,
      drawSz,
      drawSz,
      { flipX: Math.cos(h.facing) < 0 }
    );

    if (h.invulnTimer > 0 || h.shield > 0) {
      ctx.strokeStyle = h.invulnTimer > 0 ? '#fde047' : '#38bdf8';
      ctx.lineWidth = 2.8;
      ctx.beginPath();
      ctx.arc(h.x, h.y - 6, r + 12, 0, Math.PI * 2);
      ctx.stroke();
    }

    if (h.recallTimer > 0) {
      this.drawHpBar(ctx, h.x, h.y + r + 16, 48, 5, 1 - h.recallTimer / 1.6, '#38bdf8');
    }

    ctx.globalAlpha = 1;
    ctx.fillStyle = h.isLocal ? '#fde047' : '#e2e8f0';
    ctx.strokeStyle = '#000';
    ctx.lineWidth = 2.5;
    ctx.font = 'bold 11px sans-serif';
    ctx.textAlign = 'center';
    const tag = `${h.carryingWater ? '💧 ' : ''}Lv.${h.level} ${h.callsign}`;
    const topY = h.y - drawSz * 0.56 - 14;
    ctx.strokeText(tag, h.x, topY);
    ctx.fillText(tag, h.x, topY);
    this.drawHpBar(ctx, h.x, topY + 6, 54, 6, h.hp / h.stats.maxHp, '#22c55e');
    this.drawHpBar(ctx, h.x, topY + 13, 54, 3.5, h.mp / Math.max(1, h.stats.maxMp), '#38bdf8');
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

    const col = aim.cancelled ? '#ef4444' : '#38bdf8';
    const fill = aim.cancelled ? 'rgba(239, 68, 68, 0.22)' : 'rgba(56, 189, 248, 0.22)';

    ctx.save();
    ctx.strokeStyle = col;
    ctx.globalAlpha = 0.45;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(hero.x, hero.y, range, 0, Math.PI * 2);
    ctx.stroke();
    ctx.globalAlpha = 1;

    const ang = Math.atan2(aim.dy, aim.dx);
    if (aimType === 'ground_aoe') {
      const tx = hero.x + aim.dx * range * aim.distRatio;
      const ty = hero.y + aim.dy * range * aim.distRatio;
      ctx.fillStyle = fill;
      ctx.strokeStyle = col;
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.arc(tx, ty, radius, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    } else if (aimType === 'cone') {
      const cone = sk?.coneAngle || Math.PI / 3;
      ctx.fillStyle = fill;
      ctx.strokeStyle = col;
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.moveTo(hero.x, hero.y);
      ctx.arc(hero.x, hero.y, range, ang - cone / 2, ang + cone / 2);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    } else {
      const ex = hero.x + Math.cos(ang) * range;
      const ey = hero.y + Math.sin(ang) * range;
      ctx.strokeStyle = col;
      ctx.lineWidth = 18;
      ctx.globalAlpha = 0.28;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(hero.x, hero.y);
      ctx.lineTo(ex, ey);
      ctx.stroke();
      ctx.globalAlpha = 1;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(hero.x, hero.y);
      ctx.lineTo(ex, ey);
      ctx.stroke();
    }
    ctx.restore();
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
      ctx.fillStyle = `${z.color}33`;
      ctx.fillRect(z.rect.x * sx, z.rect.y * sy, z.rect.w * sx, z.rect.h * sy);
      ctx.strokeStyle = `${z.color}88`;
      ctx.lineWidth = 1;
      ctx.strokeRect(z.rect.x * sx, z.rect.y * sy, z.rect.w * sx, z.rect.h * sy);
    }

    ctx.fillStyle = '#facc15';
    ctx.beginPath();
    ctx.arc(ATHENA_POS.x * sx, ATHENA_POS.y * sy, 4.5, 0, Math.PI * 2);
    ctx.fill();

    for (const e of world.enemies) {
      if (e.hp <= 0) continue;
      ctx.fillStyle = e.isBoss ? '#f43f5e' : '#ef4444';
      ctx.fillRect(e.x * sx - (e.isBoss ? 2.5 : 1), e.y * sy - (e.isBoss ? 2.5 : 1), e.isBoss ? 5 : 2, e.isBoss ? 5 : 2);
    }

    for (const hero of world.heroes) {
      if (hero.dead) continue;
      ctx.fillStyle = hero.isLocal ? '#4ade80' : '#38bdf8';
      ctx.beginPath();
      ctx.arc(hero.x * sx, hero.y * sy, hero.isLocal ? 3.8 : 2.8, 0, Math.PI * 2);
      ctx.fill();
    }

    for (const p of world.pings) {
      ctx.strokeStyle = p.color;
      ctx.lineWidth = 1.8;
      ctx.beginPath();
      ctx.arc(p.x * sx, p.y * sy, 5, 0, Math.PI * 2);
      ctx.stroke();
    }
  }
}
