#!/usr/bin/env python3
"""
Batch-processes all raw AI-generated images from the artifact directory into
/home/better/IdeaProjects/war3/public/assets/ and audits completeness & transparency.
"""

import glob
import os
from pathlib import Path
from PIL import Image

from process_assets import (
    build_derived_raster_fx,
    derive_tinted_glow,
    process_banner,
    process_cutout,
    process_hero_anim_sheet,
    process_icon_grid,
    process_q_chibi_hero_set,
    process_sheet_cutout,
    process_sheet_glow,
    process_single_glow,
    process_splash,
    process_tile,
)

RAW_DIR = Path("/home/better/.gemini/antigravity/brain/fec5ddf0-a8ba-4643-b8be-44c847b4b62f")
OUT_DIR = Path("/home/better/IdeaProjects/war3/public/assets")


def latest(prefix: str, prefer_earliest: bool = False) -> str:
    matches = sorted(RAW_DIR.glob(f"{prefix}_*.jpg")) + sorted(RAW_DIR.glob(f"{prefix}_*.png"))
    if not matches:
        raise FileNotFoundError(f"Missing raw asset for prefix: {prefix}")
    return str(matches[0] if prefer_earliest else matches[-1])


def out(name: str) -> str:
    return str(OUT_DIR / name)


def main() -> None:
    OUT_DIR.mkdir(parents=True, exist_ok=True)

    # 1. Banner
    process_banner(latest("hub_banner_raw"), out("hub_banner.jpg"))

    # 2. 14 Terrain Tiles
    tiles = [
        "sanctuary", "cobble", "road", "gold", "xp", "crystal",
        "fire", "ice", "thunder", "forest", "bandit", "trial", "mine", "abyss",
    ]
    for t in tiles:
        process_tile(latest(f"tile_{t}_raw"), out(f"tile_{t}.png"), size=256)

    # 3. 5 Hero Portraits (full-bleed square 128x128); Q-chibi map sprites built in section 9
    heroes = ["paladin", "blademaster", "archmage", "ranger", "priest"]
    for h in heroes:
        im = Image.open(latest(f"hero_{h}_raw")).convert("RGB").resize((128, 128), Image.Resampling.LANCZOS)
        im.save(out(f"hero_{h}.png"), format="PNG", optimize=True)

    # 4. 9 Major Bosses (240x240)
    bosses = [
        ("enemy_boss_skeleton_king", True),   # first draft was clean #FF00FF
        ("enemy_boss_abyss_lord", False),
        ("enemy_boss_frost_wyrm", False),
        ("enemy_boss_doom_overlord", False),
        ("enemy_boss_fire_lord", False),
        ("enemy_boss_ice_phoenix", False),
        ("enemy_boss_thunder_roc", False),
        ("enemy_boss_ancient_treant", False),
        ("enemy_boss_hidden_chaos", False),
    ]
    for b, use_first in bosses:
        process_cutout(latest(f"{b}_raw", prefer_earliest=use_first), out(f"{b}.png"), size=240)

    # 5. Structures & Towers
    process_cutout(latest("struct_athena_raw"), out("struct_athena.png"), size=256)
    process_cutout(latest("struct_fountain_raw"), out("struct_fountain.png"), size=240)
    process_cutout(latest("struct_water_altar_raw"), out("struct_water_altar.png"), size=220)
    process_cutout(latest("struct_portal_raw"), out("struct_portal.png"), size=192, tol_hard=26, tol_soft=54)
    process_cutout(latest("struct_spawn_gate_raw"), out("struct_spawn_gate.png"), size=200)
    process_cutout(latest("tower_arrow_raw"), out("tower_arrow.png"), size=192)
    process_cutout(latest("tower_frost_raw"), out("tower_frost.png"), size=192)
    process_cutout(latest("tower_holy_raw"), out("tower_holy.png"), size=192)

    # 6. Mob & Summon Sheets (2x2 -> 160x160)
    process_sheet_cutout(
        latest("sheet_mobs_1_raw"),
        [out("enemy_goblin.png"), out("enemy_wolf_rider.png"), out("enemy_skeleton_archer.png"), out("enemy_skeleton_mage.png")],
        size=160,
    )
    process_sheet_cutout(
        latest("sheet_mobs_2_raw"),
        [out("enemy_orc_berserker.png"), out("enemy_bomb_golem.png"), out("enemy_shaman_healer.png"), out("enemy_shadow_assassin.png")],
        size=160,
    )
    process_sheet_cutout(
        latest("sheet_mobs_3_raw"),
        [out("enemy_siege_catapult.png"), out("enemy_frost_giant.png"), out("enemy_thunder_mage.png"), out("enemy_split_slime.png")],
        size=160,
    )
    process_sheet_cutout(
        latest("sheet_mobs_4_raw"),
        [out("enemy_doom_guard.png"), out("enemy_infernal_titan.png"), out("enemy_train_gold_mob.png"), out("enemy_train_xp_mob.png")],
        size=160,
    )
    process_sheet_cutout(
        latest("sheet_mobs_5_raw"),
        [out("enemy_train_crystal_mob.png"), out("enemy_mine_golem.png"), out("enemy_bandit_grunt.png"), out("enemy_bandit_chief.png")],
        size=160,
    )
    process_sheet_cutout(
        latest("sheet_mobs_6_raw"),
        [out("enemy_boss_trial_mirror.png"), out("enemy_treasure_goblin.png"), out("enemy_wandering_elite.png"), out("summon_treant.png")],
        size=160,
    )

    # 7. Props, Drops, FX, Projectiles
    process_sheet_cutout(
        latest("sheet_props_1_raw"),
        [out("prop_tree.png"), out("prop_brazier.png"), out("prop_pillar.png"), out("prop_crystal.png")],
        size=160,
    )
    process_sheet_cutout(
        latest("sheet_props_2_raw"),
        [out("prop_banner.png"), out("prop_tent.png"), out("prop_anvil.png"), out("prop_tombstone.png")],
        size=160,
    )
    process_sheet_cutout(
        latest("sheet_drops_raw"),
        [out("drop_gold.png"), out("drop_crystal.png"), out("drop_stone.png"), out("tower_base.png")],
        size=144,
    )
    process_sheet_glow(
        latest("sheet_fx_raw"),
        [out("fx_slash.png"), out("fx_explosion.png"), out("fx_frost_burst.png"), out("fx_holy_ring.png")],
        size=160,
    )
    process_sheet_glow(
        latest("sheet_proj_raw"),
        [out("proj_arrow.png"), out("proj_fireball.png"), out("proj_frostbolt.png"), out("proj_arcane.png")],
        size=96,
    )

    # 8. 85 RPG Icons across 10 Grids
    process_icon_grid(latest("icon_grid_1_raw"), [
        out("skill_pal_q.png"), out("skill_pal_e.png"), out("skill_pal_r.png"),
        out("skill_pal_f.png"), out("skill_bm_q.png"), out("skill_bm_e.png"),
        out("skill_bm_r.png"), out("skill_bm_f.png"), out("act_flash.png"),
    ], cols=3, rows=3, size=112)

    process_icon_grid(latest("icon_grid_2_raw"), [
        out("skill_am_q.png"), out("skill_am_e.png"), out("skill_am_r.png"),
        out("skill_am_f.png"), out("skill_rng_q.png"), out("skill_rng_e.png"),
        out("skill_rng_r.png"), out("skill_rng_f.png"), out("act_recall.png"),
    ], cols=3, rows=3, size=112)

    process_icon_grid(latest("icon_grid_3_raw"), [
        out("skill_pr_q.png"), out("skill_pr_e.png"), out("skill_pr_r.png"),
        out("skill_pr_f.png"), out("tower_arrow_ico.png"), out("tower_frost_ico.png"),
        out("tower_holy_ico.png"), out("item_pot_hp_s.png"), out("item_pot_hp_l.png"),
    ], cols=3, rows=3, size=112)

    process_icon_grid(latest("icon_grid_4_raw"), [
        out("item_pot_mp.png"), out("item_pot_omni.png"), out("item_pot_invuln.png"),
        out("item_scroll_repair.png"), out("item_ankh.png"), out("item_book_str.png"),
        out("item_book_agi.png"), out("item_book_int.png"), out("item_book_xp.png"),
    ], cols=3, rows=3, size=112)

    process_icon_grid(latest("icon_grid_5_raw"), [
        out("item_book_all.png"), out("item_wep_t1.png"), out("item_wep_t2.png"),
        out("item_wep_t3.png"), out("item_wep_t4.png"), out("item_arm_t1.png"),
        out("item_arm_t2.png"), out("item_arm_t3.png"), out("item_arm_t4.png"),
    ], cols=3, rows=3, size=112)

    process_icon_grid(latest("icon_grid_6_raw"), [
        out("item_acc_t1.png"), out("item_acc_t2.png"), out("item_acc_t3.png"),
        out("item_acc_t4.png"), out("item_boot_t1.png"), out("item_boot_t2.png"),
        out("item_boot_t3.png"), out("item_comp_vamp.png"), out("item_comp_claw.png"),
    ], cols=3, rows=3, size=112)

    process_icon_grid(latest("icon_grid_7_raw"), [
        out("item_comp_frost.png"), out("item_comp_flame.png"), out("item_comp_thunder.png"),
        out("item_comp_pendant.png"), out("item_comp_thorn.png"), out("item_comp_crit.png"),
        out("item_comp_mana.png"), out("item_mat_stone.png"), out("item_mat_fire.png"),
    ], cols=3, rows=3, size=112)

    process_icon_grid(latest("icon_grid_8_raw"), [
        out("item_mat_ice.png"), out("item_mat_thunder.png"), out("item_mat_forest.png"),
        out("item_mat_bone.png"), out("item_mat_abyss.png"), out("item_mat_shard.png"),
        out("item_mat_chaos.png"), out("item_epic_windboots.png"), out("item_leg_bloodreaver.png"),
    ], cols=3, rows=3, size=112)

    process_icon_grid(latest("icon_grid_9_raw"), [
        out("item_leg_thunderfury.png"), out("item_leg_wintersoul.png"), out("item_leg_inferno.png"),
        out("item_leg_aegis.png"), out("item_myth_frostmourne.png"), out("item_myth_apocalypse.png"),
        out("item_myth_immortal.png"), out("item_myth_chaos.png"), out("item_ex_paladin.png"),
    ], cols=3, rows=3, size=112)

    process_icon_grid(latest("icon_grid_10_raw"), [
        out("item_ex_blademaster.png"), out("item_ex_archmage.png"),
        out("item_ex_ranger.png"), out("item_ex_priest.png"),
    ], cols=2, rows=2, size=112)

    # 9. Native Stylized Q-Version (Chibi 2.3-head) Hero Map Sprites & Action Frames + 5 Splash Key Arts
    preferred_q_sheets = {
        "paladin": "hero_anim_paladin_q_raw_sheet_1795589127307.jpg",
        "blademaster": "hero_anim_blademaster_q_raw_final_1795589282997.jpg",
        "archmage": "hero_anim_archmage_q_raw_sheet_v3_1795589290719.jpg",
        "ranger": "hero_anim_ranger_q_raw_2_1795589270615.jpg",
        "priest": "hero_anim_priest_q_raw_2_1795589280492.jpg",
    }
    q_specs = {
        "paladin":     (0.55, 0.25, 0.34, 0.65, 0.56, 0.29),
        "blademaster": (0.55, 0.37, 0.45, 0.72, 0.60, 0.24),
        "archmage":    (0.49, 0.28, 0.39, 0.70, 0.56, 0.28),
        "ranger":      (0.42, 0.28, 0.36, 0.66, 0.46, 0.25),
        "priest":      (0.53, 0.27, 0.35, 0.68, 0.48, 0.25),
    }
    for h in heroes:
        pref_path = RAW_DIR / preferred_q_sheets.get(h, "")
        q_raw_matches = sorted(RAW_DIR.glob(f"hero_anim_{h}_q_raw_*.jpg")) + sorted(RAW_DIR.glob(f"hero_anim_{h}_q_raw_*.png"))
        chosen_q = str(pref_path) if pref_path.exists() else (str(q_raw_matches[-1]) if q_raw_matches else "")
        if chosen_q:
            idle_path = out(f"hero_anim_{h}_idle.png")
            process_hero_anim_sheet(
                chosen_q,
                [
                    idle_path,
                    out(f"hero_anim_{h}_walk1.png"),
                    out(f"hero_anim_{h}_walk2.png"),
                    out(f"hero_anim_{h}_attack.png"),
                ],
                size=192,
                clear_interior_white=False,
                aggressive_magenta=True,
            )
            td_im = Image.open(idle_path).convert("RGBA").resize((176, 176), Image.Resampling.LANCZOS)
            td_im.save(out(f"hero_td_{h}.png"), format="PNG", optimize=True)
        else:
            fx, fy, he, te, hb, hr = q_specs[h]
            process_q_chibi_hero_set(
                latest(f"hero_td_{h}_raw"),
                out(f"hero_td_{h}.png"),
                [
                    out(f"hero_anim_{h}_idle.png"),
                    out(f"hero_anim_{h}_walk1.png"),
                    out(f"hero_anim_{h}_walk2.png"),
                    out(f"hero_anim_{h}_attack.png"),
                ],
                head_fx=fx,
                head_fy=fy,
                head_end=he,
                torso_end=te,
                head_bulge=hb,
                head_rad=hr,
                clear_interior_white=(h == "ranger"),
            )
        process_splash(latest(f"splash_{h}_raw"), out(f"splash_{h}.jpg"), width=540, height=720)

    # 10. UI Stone Panel Texture, Ground Runic Auras, Dust & Derived Slash/Burst/Spark VFX
    process_tile(latest("ui_stone_panel_raw"), out("ui_stone_panel.png"), size=256)
    process_sheet_glow(
        latest("sheet_auras_raw"),
        [
            out("fx_aura_paladin.png"),
            out("fx_aura_arcane.png"),
            out("fx_aura_wind.png"),
            out("fx_dust_puff.png"),
        ],
        size=192,
    )
    derive_tinted_glow(out("fx_slash.png"), out("fx_swing_holy.png"), (1.28, 1.08, 0.52), size=192)
    derive_tinted_glow(out("fx_slash.png"), out("fx_swing_blade.png"), (1.35, 0.52, 0.25), size=192)
    derive_tinted_glow(out("fx_frost_burst.png"), out("fx_cast_burst.png"), (1.10, 1.15, 1.25), size=192, src2=out("fx_holy_ring.png"))
    derive_tinted_glow(out("fx_explosion.png"), out("fx_hit_spark.png"), (1.35, 1.18, 0.72), size=160, src2=out("fx_frost_burst.png"))

    # 10b. Generate 32-bit RGBA PWA App Icons from AI Paladin splash key art
    public_dir = OUT_DIR.parent
    splash_src = Image.open(latest("splash_paladin_raw")).convert("RGBA")
    sw, sh = splash_src.size
    side = min(sw, sh)
    crop_box = ((sw - side) // 2, max(0, int((sh - side) * 0.16)), (sw + side) // 2, max(0, int((sh - side) * 0.16)) + side)
    sq_icon = splash_src.crop(crop_box)
    for icon_sz in (192, 512):
        border = max(4, int(icon_sz * 0.04))
        inner_sz = icon_sz - border * 2
        framed = Image.new("RGBA", (icon_sz, icon_sz), (200, 162, 74, 255))
        inner = sq_icon.resize((inner_sz, inner_sz), Image.Resampling.LANCZOS)
        framed.paste(inner, (border, border), inner)
        framed.save(str(public_dir / f"icon-{icon_sz}.png"), format="PNG", optimize=True)

    # 10c. Build 100% raster VFX, rings, beams, shadows, feathered roads & plaza disc
    build_derived_raster_fx(OUT_DIR, RAW_DIR)

    # 11. Audit completeness & cutout quality
    files = sorted(OUT_DIR.glob("*"))
    total_bytes = sum(f.stat().st_size for f in files)
    bad_cutouts = []
    for f in files:
        if f.name.startswith(("hero_td_", "hero_anim_", "enemy_", "struct_", "tower_", "prop_", "drop_", "fx_", "proj_", "summon_")) and not f.name.endswith("_ico.png"):
            im = Image.open(f).convert("RGBA")
            w, h = im.size
            c_alphas = [
                im.getpixel((0, 0))[3],
                im.getpixel((w - 1, 0))[3],
                im.getpixel((0, h - 1))[3],
                im.getpixel((w - 1, h - 1))[3],
            ]
            # Check center opacity fraction
            opaque = 0
            total = 0
            for y in range(0, h, 4):
                for x in range(0, w, 4):
                    total += 1
                    if im.getpixel((x, y))[3] > 20:
                        opaque += 1
            ratio = opaque / max(1, total)
            min_ratio = 0.015 if f.name.startswith(("fx_ring_", "fx_aim_", "fx_telegraph_", "fx_beam_", "fx_lightning_", "fx_target_", "fx_shield_", "fx_status_", "fx_plaza_")) else 0.05 if f.name.startswith("proj_") else 0.08
            if max(c_alphas) > 15 or ratio < min_ratio or ratio > 0.96:
                bad_cutouts.append((f.name, c_alphas, round(ratio, 3)))

    print(f"Processed {len(files)} assets -> {total_bytes / (1024*1024):.2f} MB")
    if bad_cutouts:
        print("Cutout warnings:", bad_cutouts)
    else:
        print("All transparent cutout sprites passed border-alpha & fill-ratio checks!")


if __name__ == "__main__":
    main()
