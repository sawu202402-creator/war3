import { SaveManager } from '../meta/SaveManager';
import { DifficultyLevel, HeroClassId } from '../types';
import { CoopNetMessage, LobbyMember, LobbyState, SQUAD_COLORS } from './CoopProtocol';
import { MqttWsRoomBus, RoomWireEnvelope } from './MqttWsRoomBus';

const ROOM_ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';

type BusPayload =
  | CoopNetMessage
  | { type: '__hb' }
  | { type: '__bye' }
  | { type: '__ping'; t0: number }
  | { type: '__pong'; t0: number }
  | { type: '__rtc'; sdp?: RTCSessionDescriptionInit; cand?: RTCIceCandidateInit };

interface PeerRtcBundle {
  pc: RTCPeerConnection;
  dcFast: RTCDataChannel | null;
  dcRel: RTCDataChannel | null;
  pendingCands: RTCIceCandidateInit[];
  remoteDescSet: boolean;
}

const RTC_ICE_SERVERS: RTCIceServer[] = [
  { urls: 'stun:stun.miwifi.com:3478' },
  { urls: 'stun:stun.qq.com:3478' },
  { urls: 'stun:stun.cloudflare.com:3478' },
  { urls: 'stun:stun.l.google.com:19302' },
];

function randomCode(len = 5): string {
  let out = '';
  for (let i = 0; i < len; i++) {
    out += ROOM_ALPHABET[Math.floor(Math.random() * ROOM_ALPHABET.length)];
  }
  return out;
}

class CoopNetworkManager {
  public role: 'offline' | 'host' | 'client' = 'offline';
  public status: 'idle' | 'connecting' | 'ready' | 'error' = 'idle';
  public errorMsg = '';
  public myPeerId = 'local';
  public mySlot = 0;
  public lobby: LobbyState | null = null;
  public rttMs = 0;

  private bus: MqttWsRoomBus<BusPayload> | null = null;
  private rtcPeers = new Map<string, PeerRtcBundle>();
  private hostPeerId = '';
  private clientLastSeen = new Map<string, number>();
  private hostLastSeen = 0;
  private heartbeatTimer = 0;
  private joinRetryTimer = 0;
  private inMatchTriggered = false;

  private onLobbyChangeCb: (() => void) | null = null;
  private onMatchStartCb: ((lobby: LobbyState) => void) | null = null;
  private onGameMessageCb: ((msg: CoopNetMessage, fromPeerId: string) => void) | null = null;
  private onPeerLeaveCb: ((peerId: string) => void) | null = null;

  constructor() {
    if (typeof window !== 'undefined') {
      window.addEventListener('pagehide', () => {
        if (this.bus && this.role !== 'offline') this.bus.send('*', { type: '__bye' });
      });
      const wake = () => {
        if (typeof document !== 'undefined' && document.hidden) return;
        if (!this.bus || this.role === 'offline') return;
        const now = performance.now();
        this.hostLastSeen = now;
        for (const k of this.clientLastSeen.keys()) this.clientLastSeen.set(k, now);
        this.bus.wakeAndCheckLinks();
      };
      if (typeof document !== 'undefined') document.addEventListener('visibilitychange', wake);
      window.addEventListener('focus', wake);
    }
  }

  public bindUI(onLobbyChange: () => void, onMatchStart: (lobby: LobbyState) => void): void {
    this.onLobbyChangeCb = onLobbyChange;
    this.onMatchStartCb = onMatchStart;
  }

  public bindEngine(
    onGameMessage: (msg: CoopNetMessage, fromPeerId: string) => void,
    onPeerLeave: (peerId: string) => void
  ): void {
    this.onGameMessageCb = onGameMessage;
    this.onPeerLeaveCb = onPeerLeave;
  }

  public isActiveCoop(): boolean {
    return (this.role === 'host' || this.role === 'client') && this.lobby !== null;
  }

  public hasDirectP2P(): boolean {
    if (this.role === 'client') {
      const b = this.rtcPeers.get(this.hostPeerId);
      return Boolean(b?.dcFast?.readyState === 'open');
    }
    if (this.role === 'host' && this.clientLastSeen.size > 0) {
      for (const pid of this.clientLastSeen.keys()) {
        if (this.rtcPeers.get(pid)?.dcFast?.readyState !== 'open') return false;
      }
      return true;
    }
    return false;
  }

  public getNetStatusLabel(): string {
    const mode = this.hasDirectP2P() ? 'P2P直连' : '云中继';
    return this.rttMs > 0 ? `${mode} · ${this.rttMs}ms` : mode;
  }

  public getInviteUrl(): string {
    if (!this.lobby || typeof window === 'undefined') return '';
    const u = new URL(window.location.href);
    u.searchParams.set('room', this.lobby.roomCode);
    return u.toString();
  }

  public consumeUrlRoomParam(): string | null {
    if (typeof window === 'undefined') return null;
    try {
      const u = new URL(window.location.href);
      const code = u.searchParams.get('room');
      if (code && code.trim().length >= 4) {
        u.searchParams.delete('room');
        window.history.replaceState({}, '', u.toString());
        return code.trim().toUpperCase();
      }
    } catch {
      // ignore
    }
    return null;
  }

  public disconnect(): void {
    window.clearInterval(this.heartbeatTimer);
    window.clearInterval(this.joinRetryTimer);
    for (const pid of Array.from(this.rtcPeers.keys())) this.closeRtcPeer(pid);
    if (this.bus) {
      if (this.role !== 'offline') this.bus.send('*', { type: '__bye' });
      this.bus.close();
      this.bus = null;
    }
    this.clientLastSeen.clear();
    this.hostPeerId = '';
    this.hostLastSeen = 0;
    this.rttMs = 0;
    this.inMatchTriggered = false;
    this.role = 'offline';
    this.status = 'idle';
    this.errorMsg = '';
    this.lobby = null;
    this.myPeerId = 'local';
    this.mySlot = 0;
    this.notifyLobby();
  }

  public createHostRoom(difficulty: DifficultyLevel = 1): void {
    this.disconnect();
    this.role = 'host';
    this.status = 'connecting';
    const code = randomCode(5);
    const hostId = `host_${code}`;
    this.myPeerId = hostId;
    this.hostPeerId = hostId;
    this.notifyLobby();

    const save = SaveManager.get();
    this.bus = new MqttWsRoomBus<BusPayload>(
      hostId,
      code,
      () => {
        if (this.role !== 'host') return;
        this.mySlot = 0;
        this.status = 'ready';
        this.lobby = {
          roomCode: code,
          difficulty,
          inGame: false,
          members: [
            {
              peerId: hostId,
              slot: 0,
              callsign: save.callsign,
              heroClass: save.selectedHero,
              color: SQUAD_COLORS[0],
              ready: true,
              isHost: true,
            },
          ],
        };
        this.startHeartbeatLoop();
        this.notifyLobby();
      },
      (env) => this.handleHostEnvelope(env),
      () => {
        if (this.role !== 'host') return;
        this.status = 'error';
        this.errorMsg = '房间信号建立失败，请重试';
        this.notifyLobby();
      },
      () => {
        if (this.role === 'host' && this.lobby) this.broadcastLobby();
      }
    );
  }

  public joinRoomByCode(rawCode: string): void {
    const code = rawCode.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (code.length < 4) {
      this.status = 'error';
      this.errorMsg = '请输入有效的 5 位房间码';
      this.notifyLobby();
      return;
    }

    this.disconnect();
    this.role = 'client';
    this.status = 'connecting';
    const clientId = `p_${randomCode(6).toLowerCase()}`;
    this.myPeerId = clientId;
    this.hostPeerId = `host_${code}`;
    this.notifyLobby();

    const save = SaveManager.get();
    const sendReq = () => {
      if (this.role !== 'client' || this.status !== 'connecting') return;
      this.bus?.send(this.hostPeerId, {
        type: 'join_req',
        callsign: save.callsign,
        heroClass: save.selectedHero,
      });
    };

    this.bus = new MqttWsRoomBus<BusPayload>(
      clientId,
      code,
      () => {
        if (this.role !== 'client') return;
        let attempts = 0;
        sendReq();
        window.clearInterval(this.joinRetryTimer);
        this.joinRetryTimer = window.setInterval(() => {
          if (this.role !== 'client' || this.status !== 'connecting') {
            window.clearInterval(this.joinRetryTimer);
            return;
          }
          attempts++;
          if (attempts >= 20) {
            window.clearInterval(this.joinRetryTimer);
            this.status = 'error';
            this.errorMsg = `未找到房间 [${code}]，请确认房主在线`;
            this.notifyLobby();
            return;
          }
          sendReq();
        }, 750);
      },
      (env) => this.handleClientEnvelope(env),
      () => {
        if (this.role !== 'client') return;
        window.clearInterval(this.joinRetryTimer);
        this.status = 'error';
        this.errorMsg = '连接房间中继失败';
        this.notifyLobby();
      }
    );
  }

  public setHostDifficulty(diff: DifficultyLevel): void {
    if (this.role !== 'host' || !this.lobby) return;
    this.lobby.difficulty = diff;
    this.broadcastLobby();
    this.notifyLobby();
  }

  public setMyHeroClass(heroClass: HeroClassId): void {
    if (!this.lobby) return;
    const me = this.lobby.members.find((m) => m.peerId === this.myPeerId);
    if (!me) return;
    me.heroClass = heroClass;
    if (this.role === 'host') {
      this.broadcastLobby();
    } else {
      this.sendToHost({ type: 'member_update', ready: me.ready, callsign: me.callsign, heroClass });
    }
    this.notifyLobby();
  }

  public toggleClientReady(): void {
    if (this.role !== 'client' || !this.lobby) return;
    const me = this.lobby.members.find((m) => m.peerId === this.myPeerId);
    if (!me) return;
    me.ready = !me.ready;
    this.sendToHost({ type: 'member_update', ready: me.ready, callsign: me.callsign, heroClass: me.heroClass });
    this.notifyLobby();
  }

  public launchHostMatch(): void {
    if (this.role !== 'host' || !this.lobby) return;
    this.lobby.inGame = true;
    const pkt: CoopNetMessage = { type: 'start_game', lobby: this.lobby };
    this.bus?.send('*', pkt);
    setTimeout(() => this.bus?.send('*', pkt), 350);
    this.onMatchStartCb?.(this.lobby);
  }

  public broadcastLobby(): void {
    if (this.role !== 'host' || !this.lobby) return;
    this.bus?.send('*', { type: 'lobby_state', lobby: this.lobby });
  }

  public broadcastFromHost(msg: CoopNetMessage): void {
    if (this.role !== 'host' || !this.bus) return;
    const rtcWire = JSON.stringify({ f: this.myPeerId, m: msg });
    const fallback: string[] = [];
    for (const pid of this.clientLastSeen.keys()) {
      if (!this.trySendRtc(pid, msg, rtcWire)) fallback.push(pid);
    }
    if (fallback.length === 1) this.bus.send(fallback[0], msg);
    else if (fallback.length > 1) this.bus.send('*', msg);
  }

  public sendToHost(msg: CoopNetMessage): void {
    if (this.role !== 'client' || !this.bus || !this.hostPeerId) return;
    if (!this.trySendRtc(this.hostPeerId, msg)) {
      this.bus.send(this.hostPeerId, msg);
    }
  }

  public sendGameMessage(msg: CoopNetMessage): void {
    if (this.role === 'host') this.broadcastFromHost(msg);
    else if (this.role === 'client') this.sendToHost(msg);
  }

  private handleHostEnvelope(env: RoomWireEnvelope<BusPayload>): void {
    if (this.role !== 'host' || !this.lobby) return;
    const fromId = env.from;
    const msg = env.msg;
    if (!msg || typeof msg !== 'object') return;

    if (msg.type === '__bye') {
      this.removeClientPeer(fromId);
      return;
    }
    if (this.clientLastSeen.has(fromId)) this.clientLastSeen.set(fromId, performance.now());
    if (msg.type === '__hb') return;
    if (msg.type === '__ping') {
      this.bus?.send(fromId, { type: '__pong', t0: msg.t0 });
      return;
    }
    if (msg.type === '__pong') {
      const sample = Math.max(1, Math.round(performance.now() - msg.t0));
      if (sample < 5000) this.rttMs = this.rttMs > 0 ? Math.round(this.rttMs * 0.6 + sample * 0.4) : sample;
      return;
    }
    if (msg.type === '__rtc') {
      this.handleRtcSignal(fromId, msg);
      return;
    }

    if (msg.type === 'join_req') {
      const existing = this.lobby.members.find((m) => m.peerId === fromId);
      if (existing) {
        this.clientLastSeen.set(fromId, performance.now());
        this.bus?.send(fromId, { type: 'join_ack', ok: true, slot: existing.slot, lobby: this.lobby });
        this.ensureHostRtcOffer(fromId);
        return;
      }
      if (this.lobby.members.length >= 4) {
        this.bus?.send(fromId, { type: 'join_ack', ok: false, reason: '房间人数已满（最多 4 人）' });
        return;
      }
      if (this.lobby.inGame) {
        this.bus?.send(fromId, { type: 'join_ack', ok: false, reason: '战斗已经开始，无法中途加入' });
        return;
      }

      const used = new Set(this.lobby.members.map((m) => m.slot));
      let slot = 1;
      while (used.has(slot) && slot < 4) slot++;
      const member: LobbyMember = {
        peerId: fromId,
        slot,
        callsign: (msg.callsign || `P${slot + 1}`).slice(0, 12),
        heroClass: msg.heroClass || 'blademaster',
        color: SQUAD_COLORS[slot] || '#4ade80',
        ready: true,
        isHost: false,
      };
      this.clientLastSeen.set(fromId, performance.now());
      this.lobby.members.push(member);
      this.lobby.members.sort((a, b) => a.slot - b.slot);
      this.bus?.send(fromId, { type: 'join_ack', ok: true, slot, lobby: this.lobby });
      this.ensureHostRtcOffer(fromId);
      this.broadcastLobby();
      this.notifyLobby();
      return;
    }

    if (msg.type === 'member_update') {
      const mem = this.lobby.members.find((m) => m.peerId === fromId);
      if (mem) {
        mem.ready = msg.ready;
        if (msg.callsign) mem.callsign = msg.callsign.slice(0, 12);
        if (msg.heroClass) mem.heroClass = msg.heroClass;
        this.broadcastLobby();
        this.notifyLobby();
      }
      return;
    }

    if (this.clientLastSeen.has(fromId)) {
      this.onGameMessageCb?.(msg, fromId);
    }
  }

  private handleClientEnvelope(env: RoomWireEnvelope<BusPayload>): void {
    if (this.role !== 'client' || env.from !== this.hostPeerId) return;
    const msg = env.msg;
    if (!msg || typeof msg !== 'object') return;

    if (msg.type === '__bye') {
      window.clearInterval(this.joinRetryTimer);
      window.clearInterval(this.heartbeatTimer);
      this.status = 'error';
      this.errorMsg = '房主已离开房间';
      this.onPeerLeaveCb?.('host');
      this.notifyLobby();
      return;
    }

    this.hostLastSeen = performance.now();
    if (msg.type === '__hb') return;
    if (msg.type === '__ping') {
      this.bus?.send(this.hostPeerId, { type: '__pong', t0: msg.t0 });
      return;
    }
    if (msg.type === '__pong') {
      const sample = Math.max(1, Math.round(performance.now() - msg.t0));
      if (sample < 5000) this.rttMs = this.rttMs > 0 ? Math.round(this.rttMs * 0.6 + sample * 0.4) : sample;
      return;
    }
    if (msg.type === '__rtc') {
      this.handleRtcSignal(this.hostPeerId, msg);
      return;
    }

    if (msg.type === 'join_ack') {
      window.clearInterval(this.joinRetryTimer);
      if (!msg.ok || !msg.lobby) {
        this.status = 'error';
        this.errorMsg = msg.reason || '加入失败';
        this.notifyLobby();
        return;
      }
      this.status = 'ready';
      this.mySlot = msg.slot ?? 1;
      this.lobby = msg.lobby;
      this.startHeartbeatLoop();
      this.notifyLobby();
      return;
    }

    if (msg.type === 'lobby_state') {
      const me = msg.lobby.members.find((m) => m.peerId === this.myPeerId);
      if (me) {
        window.clearInterval(this.joinRetryTimer);
        if (this.status !== 'ready') this.startHeartbeatLoop();
        this.status = 'ready';
        this.mySlot = me.slot;
        this.lobby = msg.lobby;
        this.notifyLobby();
      }
      return;
    }

    if (msg.type === 'start_game') {
      if (!msg.lobby.members.some((m) => m.peerId === this.myPeerId)) return;
      if (this.inMatchTriggered) return;
      this.lobby = msg.lobby;
      this.lobby.inGame = true;
      this.inMatchTriggered = true;
      this.onMatchStartCb?.(this.lobby);
      return;
    }

    this.onGameMessageCb?.(msg, this.hostPeerId);
  }

  private removeClientPeer(peerId: string): void {
    const existed = this.clientLastSeen.delete(peerId);
    this.closeRtcPeer(peerId);
    this.bus?.forgetPeer(peerId);
    if (this.lobby) {
      this.lobby.members = this.lobby.members.filter((m) => m.peerId !== peerId);
      this.broadcastLobby();
      this.notifyLobby();
    }
    if (existed) this.onPeerLeaveCb?.(peerId);
  }

  private startHeartbeatLoop(): void {
    window.clearInterval(this.heartbeatTimer);
    this.hostLastSeen = performance.now();
    this.heartbeatTimer = window.setInterval(() => {
      if (!this.bus || this.role === 'offline') return;
      const now = performance.now();
      const timeoutMs = this.lobby?.inGame ? 18_000 : 45_000;
      if (this.role === 'host') {
        this.bus.send('*', { type: '__hb' });
        const first = this.clientLastSeen.keys().next().value as string | undefined;
        if (first) this.bus.send(first, { type: '__ping', t0: Math.round(now) });
        for (const [pid, t] of Array.from(this.clientLastSeen.entries())) {
          if (now - t > timeoutMs) this.removeClientPeer(pid);
        }
      } else if (this.role === 'client' && this.status === 'ready') {
        this.bus.send(this.hostPeerId, { type: '__hb' });
        this.bus.send(this.hostPeerId, { type: '__ping', t0: Math.round(now) });
        if (this.hostLastSeen > 0 && now - this.hostLastSeen > timeoutMs + 2000) {
          window.clearInterval(this.heartbeatTimer);
          this.status = 'error';
          this.errorMsg = '与房主断开连接';
          this.onPeerLeaveCb?.('host');
          this.notifyLobby();
        }
      }
    }, 2500);
  }

  private closeRtcPeer(peerId: string): void {
    const b = this.rtcPeers.get(peerId);
    if (!b) return;
    this.rtcPeers.delete(peerId);
    try { b.dcFast?.close(); } catch { /* ignore */ }
    try { b.dcRel?.close(); } catch { /* ignore */ }
    try { b.pc.close(); } catch { /* ignore */ }
  }

  private createRtcPeerBundle(peerId: string): PeerRtcBundle | null {
    if (typeof RTCPeerConnection === 'undefined') return null;
    this.closeRtcPeer(peerId);
    try {
      const pc = new RTCPeerConnection({ iceServers: RTC_ICE_SERVERS });
      const bundle: PeerRtcBundle = { pc, dcFast: null, dcRel: null, pendingCands: [], remoteDescSet: false };
      this.rtcPeers.set(peerId, bundle);
      pc.onicecandidate = (ev) => {
        if (ev.candidate && this.bus) this.bus.send(peerId, { type: '__rtc', cand: ev.candidate.toJSON() });
      };
      pc.ondatachannel = (ev) => this.bindRtcChannel(peerId, bundle, ev.channel);
      return bundle;
    } catch {
      return null;
    }
  }

  private bindRtcChannel(peerId: string, bundle: PeerRtcBundle, dc: RTCDataChannel): void {
    if (dc.label === 'fast') bundle.dcFast = dc;
    else bundle.dcRel = dc;

    dc.onmessage = (ev) => {
      if (typeof ev.data !== 'string') return;
      try {
        const parsed = JSON.parse(ev.data) as { f: string; m: CoopNetMessage };
        if (!parsed?.m) return;
        const now = performance.now();
        if (this.role === 'host' && this.clientLastSeen.has(peerId)) {
          this.clientLastSeen.set(peerId, now);
          this.onGameMessageCb?.(parsed.m, peerId);
        } else if (this.role === 'client') {
          this.hostLastSeen = now;
          this.onGameMessageCb?.(parsed.m, this.hostPeerId);
        }
      } catch {
        // ignore
      }
    };
  }

  private ensureHostRtcOffer(clientPeerId: string): void {
    if (this.role !== 'host' || typeof RTCPeerConnection === 'undefined') return;
    if (this.rtcPeers.has(clientPeerId)) return;
    const bundle = this.createRtcPeerBundle(clientPeerId);
    if (!bundle) return;
    try {
      const dcFast = bundle.pc.createDataChannel('fast', { ordered: false, maxRetransmits: 0 });
      const dcRel = bundle.pc.createDataChannel('rel', { ordered: true });
      this.bindRtcChannel(clientPeerId, bundle, dcFast);
      this.bindRtcChannel(clientPeerId, bundle, dcRel);
      bundle.pc.createOffer().then((offer) => bundle.pc.setLocalDescription(offer).then(() => offer)).then((offer) => {
        if (this.rtcPeers.get(clientPeerId) === bundle && this.bus) {
          this.bus.send(clientPeerId, { type: '__rtc', sdp: { type: offer.type, sdp: offer.sdp } });
        }
      }).catch(() => {});
    } catch {
      // ignore
    }
  }

  private handleRtcSignal(fromId: string, sig: { type: '__rtc'; sdp?: RTCSessionDescriptionInit; cand?: RTCIceCandidateInit }): void {
    let bundle = this.rtcPeers.get(fromId);
    if (sig.sdp) {
      if (sig.sdp.type === 'offer' && this.role === 'client') {
        bundle = this.createRtcPeerBundle(fromId) || undefined;
        if (!bundle) return;
        const bRef = bundle;
        bRef.pc.setRemoteDescription(sig.sdp).then(async () => {
          bRef.remoteDescSet = true;
          for (const c of bRef.pendingCands.splice(0)) await bRef.pc.addIceCandidate(c).catch(() => {});
          const ans = await bRef.pc.createAnswer();
          await bRef.pc.setLocalDescription(ans);
          this.bus?.send(fromId, { type: '__rtc', sdp: { type: ans.type, sdp: ans.sdp } });
        }).catch(() => {});
      } else if (sig.sdp.type === 'answer' && this.role === 'host' && bundle) {
        const bRef = bundle;
        bRef.pc.setRemoteDescription(sig.sdp).then(async () => {
          bRef.remoteDescSet = true;
          for (const c of bRef.pendingCands.splice(0)) await bRef.pc.addIceCandidate(c).catch(() => {});
        }).catch(() => {});
      }
      return;
    }
    if (sig.cand && sig.cand.candidate && bundle) {
      if (bundle.remoteDescSet) bundle.pc.addIceCandidate(sig.cand).catch(() => {});
      else bundle.pendingCands.push(sig.cand);
    }
  }

  private trySendRtc(peerId: string, msg: CoopNetMessage, preSerialized?: string): boolean {
    if (msg.type === 'lobby_state' || msg.type === 'start_game' || msg.type === 'join_req' || msg.type === 'join_ack') {
      return false;
    }
    const b = this.rtcPeers.get(peerId);
    if (!b) return false;
    const isFast = msg.type === 'world_snap' || msg.type === 'client_pos';
    const ch = isFast ? b.dcFast : b.dcRel;
    if (!ch || ch.readyState !== 'open') return false;
    if (ch.bufferedAmount > 32_768) return isFast;
    try {
      ch.send(preSerialized || JSON.stringify({ f: this.myPeerId, m: msg }));
      return true;
    } catch {
      return false;
    }
  }

  private notifyLobby(): void {
    this.onLobbyChangeCb?.();
  }
}

export const CoopManager = new CoopNetworkManager();
