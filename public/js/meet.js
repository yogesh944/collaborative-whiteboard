/* ═══════════════════════════════════════════════════
   Meet — WebRTC video/audio via simple-peer
   ═══════════════════════════════════════════════════ */

class MeetManager {
  constructor(socketManager) {
    this.sm = socketManager;           // SocketManager instance
    this.peers = new Map();            // peerId → SimplePeer
    this.localStream = null;
    this.inCall = false;
    this.audioMuted = false;
    this.videoOff = false;

    this._bindSocketEvents();
    this._bindUIEvents();
  }

  // ── Socket events ──────────────────────────────────
  _bindSocketEvents() {
    const socket = this.sm.socket;

    // Server tells us the peers already in the call
    socket.on('call-peers', (peerIds) => {
      peerIds.forEach(id => this._createPeer(id, true));
    });

    // A peer joined the call after us → they will initiate
    socket.on('call-user-joined', (peerId) => {
      // non-initiator: wait for their offer
      this._createPeer(peerId, false);
    });

    // Relay ICE / offer / answer
    socket.on('webrtc-signal', ({ from, signal }) => {
      const peer = this.peers.get(from);
      if (peer) {
        peer.signal(signal);
      }
    });

    // A peer left
    socket.on('call-user-left', (peerId) => {
      this._removePeer(peerId);
    });

    // When a whiteboard user fully disconnects, clean up video too
    socket.on('user-left', (userId) => {
      this._removePeer(userId);
    });
  }

  // ── UI button wiring ───────────────────────────────
  _bindUIEvents() {
    document.getElementById('btn-join-call').addEventListener('click', () => {
      if (this.inCall) this.leaveCall();
      else this.joinCall();
    });

    document.getElementById('btn-mute').addEventListener('click', () => this.toggleMute());
    document.getElementById('btn-camera').addEventListener('click', () => this.toggleCamera());
  }

  // ── Join / Leave ───────────────────────────────────
  async joinCall() {
    try {
      this.localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
    } catch (err) {
      alert('Could not access camera/microphone: ' + err.message);
      return;
    }

    this.inCall = true;
    this._setLocalVideo(this.localStream);
    document.getElementById('meet-panel').classList.add('active');
    document.getElementById('btn-join-call').innerHTML = this._leaveIcon() + '<span>Leave Call</span>';
    document.getElementById('btn-join-call').classList.add('danger');
    document.getElementById('meet-controls').style.display = 'flex';

    this.sm.emitCallJoin();
  }

  leaveCall() {
    this.inCall = false;
    this.sm.emitCallLeave();

    // Destroy all peers
    this.peers.forEach((peer, id) => this._removePeer(id));

    // Stop local tracks
    if (this.localStream) {
      this.localStream.getTracks().forEach(t => t.stop());
      this.localStream = null;
    }

    // Reset local preview
    const localVid = document.getElementById('local-video');
    if (localVid) localVid.srcObject = null;

    // Remove all remote tiles
    document.getElementById('remote-videos').innerHTML = '';

    document.getElementById('meet-panel').classList.remove('active');
    document.getElementById('btn-join-call').innerHTML = this._joinIcon() + '<span>Join Call</span>';
    document.getElementById('btn-join-call').classList.remove('danger');
    document.getElementById('meet-controls').style.display = 'none';

    this.audioMuted = false;
    this.videoOff = false;
    this._updateMuteBtn();
    this._updateCameraBtn();
  }

  // ── Peer management ────────────────────────────────
  _createPeer(peerId, initiator) {
    if (this.peers.has(peerId)) return;

    const peer = new SimplePeer({
      initiator,
      stream: this.localStream,
      trickle: true
    });

    peer.on('signal', (signal) => {
      this.sm.emitWebRTCSignal(peerId, signal);
    });

    peer.on('stream', (stream) => {
      this._addRemoteVideo(peerId, stream);
    });

    peer.on('close', () => this._removePeer(peerId));
    peer.on('error', () => this._removePeer(peerId));

    this.peers.set(peerId, peer);
  }

  _removePeer(peerId) {
    const peer = this.peers.get(peerId);
    if (peer) {
      try { peer.destroy(); } catch {}
      this.peers.delete(peerId);
    }
    const tile = document.getElementById('video-tile-' + peerId);
    if (tile) tile.remove();
  }

  // ── Video tile helpers ─────────────────────────────
  _setLocalVideo(stream) {
    const vid = document.getElementById('local-video');
    vid.srcObject = stream;
    vid.muted = true;
    vid.play().catch(() => {});
  }

  _addRemoteVideo(peerId, stream) {
    const container = document.getElementById('remote-videos');
    // Remove existing tile for this peer if any
    const existing = document.getElementById('video-tile-' + peerId);
    if (existing) existing.remove();

    const tile = document.createElement('div');
    tile.className = 'video-tile';
    tile.id = 'video-tile-' + peerId;

    const vid = document.createElement('video');
    vid.autoplay = true;
    vid.playsinline = true;
    vid.srcObject = stream;

    tile.appendChild(vid);
    container.appendChild(tile);
  }

  // ── Audio / Video toggles ──────────────────────────
  toggleMute() {
    if (!this.localStream) return;
    this.audioMuted = !this.audioMuted;
    this.localStream.getAudioTracks().forEach(t => { t.enabled = !this.audioMuted; });
    this._updateMuteBtn();
  }

  toggleCamera() {
    if (!this.localStream) return;
    this.videoOff = !this.videoOff;
    this.localStream.getVideoTracks().forEach(t => { t.enabled = !this.videoOff; });
    this._updateCameraBtn();
  }

  _updateMuteBtn() {
    const btn = document.getElementById('btn-mute');
    btn.classList.toggle('active-control', this.audioMuted);
    btn.title = this.audioMuted ? 'Unmute' : 'Mute';
    btn.innerHTML = this.audioMuted ? this._muteOnIcon() : this._muteOffIcon();
  }

  _updateCameraBtn() {
    const btn = document.getElementById('btn-camera');
    btn.classList.toggle('active-control', this.videoOff);
    btn.title = this.videoOff ? 'Turn camera on' : 'Turn camera off';
    btn.innerHTML = this.videoOff ? this._cameraOffIcon() : this._cameraOnIcon();
  }

  // ── SVG icon helpers ───────────────────────────────
  _joinIcon() {
    return `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M23 7l-7 5 7 5V7z"/><rect x="1" y="5" width="15" height="14" rx="2"/></svg>`;
  }

  _leaveIcon() {
    return `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M23 7l-7 5 7 5V7z"/><rect x="1" y="5" width="15" height="14" rx="2"/><line x1="1" y1="1" x2="23" y2="23" stroke="currentColor" stroke-width="2"/></svg>`;
  }

  _muteOffIcon() {
    return `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="23"/><line x1="8" y1="23" x2="16" y2="23"/></svg>`;
  }

  _muteOnIcon() {
    return `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="1" y1="1" x2="23" y2="23"/><path d="M9 9v3a3 3 0 0 0 5.12 2.12M15 9.34V4a3 3 0 0 0-5.94-.6"/><path d="M17 16.95A7 7 0 0 1 5 12v-2m14 0v2a7 7 0 0 1-.11 1.23"/><line x1="12" y1="19" x2="12" y2="23"/><line x1="8" y1="23" x2="16" y2="23"/></svg>`;
  }

  _cameraOnIcon() {
    return `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M23 7l-7 5 7 5V7z"/><rect x="1" y="5" width="15" height="14" rx="2"/></svg>`;
  }

  _cameraOffIcon() {
    return `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M16 16v1a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h2m5.66 0H14a2 2 0 0 1 2 2v3.34l1 1L23 7v10"/><line x1="1" y1="1" x2="23" y2="23"/></svg>`;
  }
}

window.MeetManager = MeetManager;
