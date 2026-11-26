interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
}

export type InstallGuidePlatform = 'wechat' | 'ios' | 'android' | 'desktop';

class PwaInstallController {
  private initialized = false;
  private deferredInstallPrompt: BeforeInstallPromptEvent | null = null;
  private installedThisSession = false;
  private listeners = new Set<() => void>();

  constructor() {
    if (typeof window !== 'undefined') {
      window.addEventListener('beforeinstallprompt', (e) => {
        e.preventDefault();
        this.deferredInstallPrompt = e as BeforeInstallPromptEvent;
        this.emitStateChange();
      });
      window.addEventListener('appinstalled', () => {
        this.deferredInstallPrompt = null;
        this.installedThisSession = true;
        this.emitStateChange();
      });
    }
  }

  public init(): void {
    if (this.initialized) return;
    this.initialized = true;

    if (
      typeof navigator !== 'undefined' &&
      'serviceWorker' in navigator &&
      typeof location !== 'undefined' &&
      (location.protocol === 'https:' ||
        location.hostname === 'localhost' ||
        location.hostname === '127.0.0.1')
    ) {
      navigator.serviceWorker.register('./sw.js').catch(() => {});
    }
  }

  public onStateChange(cb: () => void): () => void {
    this.listeners.add(cb);
    return () => {
      this.listeners.delete(cb);
    };
  }

  private emitStateChange(): void {
    for (const cb of this.listeners) {
      try {
        cb();
      } catch {
        // ignore listener failure
      }
    }
  }

  public isStandaloneApp(): boolean {
    if (this.installedThisSession) return true;
    if (typeof window === 'undefined') return false;
    try {
      if (window.matchMedia?.('(display-mode: standalone)').matches) return true;
      if (window.matchMedia?.('(display-mode: fullscreen)').matches && !document.fullscreenElement) {
        return true;
      }
      if ((navigator as Navigator & { standalone?: boolean }).standalone === true) return true;
    } catch {
      // ignore
    }
    return false;
  }

  public canShowHomeScreenShortcut(): boolean {
    if (this.isStandaloneApp()) return false;
    if (typeof window === 'undefined') return false;
    try {
      if (window.self !== window.top) return false;
    } catch {
      return false;
    }
    return true;
  }

  public hasNativeInstallPrompt(): boolean {
    return Boolean(this.deferredInstallPrompt);
  }

  public async triggerNativeInstallPrompt(): Promise<'accepted' | 'dismissed' | 'unavailable'> {
    const promptEv = this.deferredInstallPrompt;
    if (!promptEv) return 'unavailable';
    this.deferredInstallPrompt = null;
    try {
      await promptEv.prompt();
      const res = await promptEv.userChoice;
      if (res?.outcome === 'accepted') {
        this.installedThisSession = true;
      }
      this.emitStateChange();
      return res?.outcome === 'accepted' ? 'accepted' : 'dismissed';
    } catch {
      this.emitStateChange();
      return 'unavailable';
    }
  }

  public getInstallGuidePlatform(): InstallGuidePlatform {
    if (typeof navigator === 'undefined') return 'desktop';
    const ua = navigator.userAgent || '';
    if (/MicroMessenger/i.test(ua)) return 'wechat';
    const isIOS =
      /iPhone|iPad|iPod/i.test(ua) ||
      (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    if (isIOS) return 'ios';
    if (/Android|HarmonyOS/i.test(ua)) return 'android';
    return 'desktop';
  }
}

export const PwaInstallManager = new PwaInstallController();
