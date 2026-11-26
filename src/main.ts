import './ui/style.css';
import { SoundFX } from './audio/SoundFX';
import { GameEngine } from './engine/GameEngine';
import { IconAtlas } from './engine/IconAtlas';
import { InputManager } from './engine/InputManager';
import { PwaInstallManager } from './meta/PwaInstallManager';
import { SaveManager } from './meta/SaveManager';
import { CoopManager } from './net/CoopManager';
import { HudUI } from './ui/HudUI';
import { LobbyUI } from './ui/LobbyUI';
import { ModalsUI } from './ui/ModalsUI';

async function bootstrap() {
  SaveManager.load();
  PwaInstallManager.init();

  const gameRoot = document.getElementById('game-root') as HTMLElement;
  const canvas = document.getElementById('game-canvas') as HTMLCanvasElement;
  const uiLayer = document.getElementById('ui-layer') as HTMLElement;
  const landscapeGuard = document.getElementById('landscape-guard') as HTMLElement;
  const guardBtn = document.getElementById('btn-guard-landscape') as HTMLButtonElement;
  const bootLoader = document.getElementById('boot-loader');
  const bootFill = document.getElementById('boot-bar-fill');
  const bootPct = document.getElementById('boot-pct');
  const ctx = canvas.getContext('2d', { alpha: false })!;

  await Promise.race([
    IconAtlas.preloadCritical((loaded, total) => {
      const pct = Math.min(100, Math.max(12, Math.round((loaded / Math.max(1, total)) * 100)));
      if (bootFill) bootFill.style.width = `${pct}%`;
      if (bootPct) bootPct.textContent = `${pct}%`;
    }),
    new Promise<void>((resolve) => setTimeout(resolve, 3800)),
  ]);
  if (bootFill) bootFill.style.width = '100%';
  if (bootPct) bootPct.textContent = '100%';
  document.documentElement.style.setProperty(
    '--war3-stone-tex',
    `url("${IconAtlas.getDataUrl('ui_stone_panel')}")`
  );
  setTimeout(() => IconAtlas.preloadRemainingInBackground(), 80);

  const toggleFullscreenLandscape = async () => {
    try {
      const doc = document as Document & {
        webkitFullscreenElement?: Element;
        webkitExitFullscreen?: () => Promise<void>;
      };
      if (doc.fullscreenElement || doc.webkitFullscreenElement) {
        if (doc.exitFullscreen) await doc.exitFullscreen();
        else if (doc.webkitExitFullscreen) await doc.webkitExitFullscreen();
        return;
      }
      const el = document.documentElement as HTMLElement & {
        webkitRequestFullscreen?: () => Promise<void>;
      };
      if (el.requestFullscreen) await el.requestFullscreen();
      else if (el.webkitRequestFullscreen) await el.webkitRequestFullscreen();
      const orient = screen.orientation as ScreenOrientation & { lock?: (mode: string) => Promise<void> };
      await orient?.lock?.('landscape');
    } catch {
      // fallback cleanly if fullscreen/orientation lock unsupported
    }
  };

  guardBtn.onclick = toggleFullscreenLandscape;

  let viewW = window.innerWidth;
  let viewH = window.innerHeight;
  let currentDpr = 1;
  const input = new InputManager(canvas);
  input.setHudMode(SaveManager.get().hudMode || 'auto');

  let hud!: HudUI;
  let modals!: ModalsUI;
  let lobby!: LobbyUI;
  let inMatch = false;

  const engine = new GameEngine(canvas, ctx, input, {
    onToggleShop: () => modals.toggleShop(),
    onToggleTeleport: () => modals.toggleTeleport(),
    onToggleBase: () => modals.toggleBase(),
    onTogglePause: () => modals.togglePause(),
    onPromptAwakening: (hero) => modals.openAwakening(hero),
    onShowSettlement: (victory) => modals.openSettlement(victory),
    onCloseSettlement: () => modals.close(),
    onNetUiRefresh: () => modals.refreshIfOpen(),
  });

  const enterLobby = () => {
    inMatch = false;
    engine.world = null;
    modals.close();
    hud.unmount();
    CoopManager.disconnect();
    SoundFX.setBgmMode('hub');
    lobby.render();
  };

  const returnToCoopRoom = () => {
    inMatch = false;
    engine.world = null;
    modals.close();
    hud.unmount();
    CoopManager.returnSquadToLobby();
    lobby.setTab('coop');
    SoundFX.setBgmMode('hub');
    lobby.render();
  };

  modals = new ModalsUI(uiLayer, engine, enterLobby, toggleFullscreenLandscape, returnToCoopRoom);
  hud = new HudUI(uiLayer, engine, {
    onOpenShop: () => modals.toggleShop(),
    onOpenTeleport: () => modals.toggleTeleport(),
    onOpenBase: () => modals.toggleBase(),
    onOpenPause: () => modals.togglePause(),
  });

  lobby = new LobbyUI(
    uiLayer,
    (hero, diff, aiCount) => {
      inMatch = true;
      uiLayer.innerHTML = '';
      engine.startNewMatch({ difficulty: diff, localHero: hero, aiSquadCount: aiCount });
      hud.mount();
    },
    () => {
      const l = CoopManager.lobby;
      if (!l) return;
      inMatch = true;
      uiLayer.innerHTML = '';
      engine.startNewMatch({
        difficulty: l.difficulty,
        localHero: l.members.find((m) => m.peerId === CoopManager.myPeerId)?.heroClass || 'blademaster',
        aiSquadCount: 0,
        coopRoster: l.members.map((m) => ({
          peerId: m.peerId,
          slot: m.slot,
          callsign: m.callsign,
          heroClass: m.heroClass,
        })),
      });
      hud.mount();
    },
    {
      onHudModeChange: (mode) => input.setHudMode(mode),
      onToggleFullscreen: toggleFullscreenLandscape,
    }
  );

  PwaInstallManager.onStateChange(() => {
    if (!inMatch) lobby.syncInstallShortcutUi();
  });

  CoopManager.bindUI(
    () => {
      if (!inMatch) lobby.render();
    },
    (l) => {
      inMatch = true;
      uiLayer.innerHTML = '';
      engine.startNewMatch({
        difficulty: l.difficulty,
        localHero: l.members.find((m) => m.peerId === CoopManager.myPeerId)?.heroClass || 'blademaster',
        aiSquadCount: 0,
        coopRoster: l.members.map((m) => ({
          peerId: m.peerId,
          slot: m.slot,
          callsign: m.callsign,
          heroClass: m.heroClass,
        })),
      });
      hud.mount();
    },
    () => {
      if (!inMatch) lobby.refreshDirectoryDom();
    }
  );
  CoopManager.ensurePublicDirectoryActive();

  const syncViewport = () => {
    if (window.scrollX !== 0 || window.scrollY !== 0) window.scrollTo(0, 0);
    viewW = Math.max(1, Math.round(gameRoot.clientWidth || window.innerWidth));
    viewH = Math.max(1, Math.round(gameRoot.clientHeight || window.innerHeight));
    const dpr = Math.min(window.devicePixelRatio || 1, viewW > 1440 ? 1.25 : 1.5);
    currentDpr = dpr;
    const tw = Math.max(1, Math.floor(viewW * dpr));
    const th = Math.max(1, Math.floor(viewH * dpr));
    if (canvas.width !== tw || canvas.height !== th) {
      canvas.width = tw;
      canvas.height = th;
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const isTouchPortrait = (input.detectTouchDevice() || input.usingTouch) && viewH > viewW;
    landscapeGuard.classList.toggle('visible', isTouchPortrait);
    if (engine.landscapePaused !== isTouchPortrait) {
      engine.landscapePaused = isTouchPortrait;
      if (isTouchPortrait) input.resetStates();
    }
  };

  window.addEventListener('resize', syncViewport);
  window.visualViewport?.addEventListener('resize', syncViewport);
  document.addEventListener('fullscreenchange', syncViewport);
  window.addEventListener('orientationchange', () => {
    syncViewport();
    setTimeout(syncViewport, 150);
    setTimeout(syncViewport, 350);
  });
  syncViewport();

  const urlRoom = CoopManager.consumeUrlRoomParam();
  if (urlRoom) {
    lobby.setTab('coop');
    lobby.render();
    CoopManager.joinRoomByCode(urlRoom);
  } else {
    lobby.render();
  }

  if (bootLoader) {
    bootLoader.classList.add('fade-out');
    setTimeout(() => bootLoader.remove(), 300);
  }

  let lastTime = performance.now();
  let hudTick = 0;

  const loop = (now: number) => {
    requestAnimationFrame(loop);
    const dt = Math.min(0.05, Math.max(0, (now - lastTime) / 1000));
    lastTime = now;

    if (inMatch && engine.world) {
      engine.update(dt, viewW, viewH);
      ctx.setTransform(currentDpr, 0, 0, currentDpr, 0, 0);
      engine.render(viewW, viewH);
      hud.syncStick();
      hudTick += dt;
      if (hudTick >= 0.08) {
        hudTick = 0;
        hud.sync();
        modals.syncLiveShop();
      }
    }
  };
  requestAnimationFrame(loop);
}

bootstrap();
