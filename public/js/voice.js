/* ═══════════════════════════════════════════════════
   Voice — WebRTC mesh for room audio chat
   ═══════════════════════════════════════════════════ */

class VoiceManager {
  constructor(app) {
    this.app = app;
    this.socket = null;
    this.localStream = null;
    this.peerConnections = new Map();
    this.remoteAudios = new Map();
    this.enabled = false;
    this.boundSocketEvents = false;
    this.localAudio = null;
  }

  bindSocket(socket) {
    if (this.socket !== socket) {
      this.boundSocketEvents = false;
    }
    this.socket = socket;
    this._bindSocketEvents();
    if (this.enabled) {
      this._announcePresence();
    }
  }

  async toggle() {
    if (this.enabled) {
      await this.leave();
      return;
    }
    await this.join();
  }

  async join() {
    if (!this.socket) {
      this.app.showToast('Connect to a room before joining voice');
      return;
    }
    if (!navigator.mediaDevices?.getUserMedia) {
      this.app.showToast('Voice chat is not supported in this browser');
      return;
    }

    try {
      this.localStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
      this.enabled = true;
      this._ensureLocalAudio();
      this._setStatus('Voice active');
      this._announcePresence();
      this.app.showToast('Voice chat connected');
    } catch (error) {
      this.app.showToast('Microphone access is required for voice chat');
      this.enabled = false;
      this.localStream = null;
    }
  }

  async leave() {
    this.enabled = false;
    if (this.socket) {
      this.socket.emit('voice-leave');
    }

    for (const track of this.localStream?.getTracks?.() || []) {
      track.stop();
    }
    this.localStream = null;

    for (const [remoteId, peer] of this.peerConnections.entries()) {
      peer.close();
      this._removeRemoteAudio(remoteId);
    }
    this.peerConnections.clear();
    this._setStatus('Voice muted');
    this.app.showToast('Voice chat left');
  }

  handlePeerJoined(payload) {
    if (!this.enabled || !this.localStream || !this.socket) {
      return;
    }
    if (payload.userId === this.socket.id) {
      return;
    }
    this._createPeer(payload.userId, true);
  }

  handlePeerLeft(payload) {
    const remoteId = payload.userId;
    const peer = this.peerConnections.get(remoteId);
    if (peer) {
      peer.close();
      this.peerConnections.delete(remoteId);
    }
    this._removeRemoteAudio(remoteId);
  }

  async handleOffer(payload) {
    if (!this.enabled || !this.localStream || !this.socket) return;
    const peer = this._createPeer(payload.fromId, false);
    await peer.setRemoteDescription(new RTCSessionDescription(payload.offer));
    const answer = await peer.createAnswer();
    await peer.setLocalDescription(answer);
    this.socket.emit('voice-answer', {
      targetId: payload.fromId,
      answer: peer.localDescription
    });
  }

  async handleAnswer(payload) {
    const peer = this.peerConnections.get(payload.fromId);
    if (!peer) return;
    await peer.setRemoteDescription(new RTCSessionDescription(payload.answer));
  }

  async handleIce(payload) {
    const peer = this.peerConnections.get(payload.fromId);
    if (!peer || !payload.candidate) return;
    try {
      await peer.addIceCandidate(new RTCIceCandidate(payload.candidate));
    } catch (error) {
      // Ignore stale ICE candidates from peers that already closed.
    }
  }

  syncAfterReconnect() {
    if (this.enabled && this.socket) {
      this._announcePresence();
    }
  }

  _bindSocketEvents() {
    if (!this.socket || this.boundSocketEvents) {
      return;
    }

    this.socket.on('voice-user-joined', (payload) => this.handlePeerJoined(payload));
    this.socket.on('voice-user-left', (payload) => this.handlePeerLeft(payload));
    this.socket.on('voice-offer', (payload) => this.handleOffer(payload));
    this.socket.on('voice-answer', (payload) => this.handleAnswer(payload));
    this.socket.on('voice-ice', (payload) => this.handleIce(payload));
    this.boundSocketEvents = true;
  }

  _announcePresence() {
    if (this.socket) {
      this.socket.emit('voice-ready');
    }
    this._setStatus('Voice active');
  }

  _createPeer(remoteId, initiator) {
    const existingPeer = this.peerConnections.get(remoteId);
    if (existingPeer) {
      return existingPeer;
    }

    const peer = new RTCPeerConnection({
      iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' }
      ]
    });

    for (const track of this.localStream.getTracks()) {
      peer.addTrack(track, this.localStream);
    }

    peer.onicecandidate = (event) => {
      if (event.candidate && this.socket) {
        this.socket.emit('voice-ice', {
          targetId: remoteId,
          candidate: event.candidate
        });
      }
    };

    peer.ontrack = (event) => {
      const stream = event.streams[0];
      if (stream) {
        this._attachRemoteStream(remoteId, stream);
      }
    };

    peer.onconnectionstatechange = () => {
      if (['failed', 'closed', 'disconnected'].includes(peer.connectionState)) {
        this._removeRemoteAudio(remoteId);
      }
    };

    this.peerConnections.set(remoteId, peer);

    if (initiator) {
      peer.createOffer()
        .then((offer) => peer.setLocalDescription(offer))
        .then(() => {
          if (this.socket) {
            this.socket.emit('voice-offer', {
              targetId: remoteId,
              offer: peer.localDescription
            });
          }
        })
        .catch(() => {
          this.peerConnections.delete(remoteId);
        });
    }

    return peer;
  }

  _ensureLocalAudio() {
    if (this.localAudio) {
      this.localAudio.srcObject = this.localStream;
      return;
    }

    this.localAudio = document.createElement('audio');
    this.localAudio.autoplay = true;
    this.localAudio.muted = true;
    this.localAudio.playsInline = true;
    this.localAudio.srcObject = this.localStream;
    this.app.voiceMedia.appendChild(this.localAudio);
  }

  _attachRemoteStream(remoteId, stream) {
    let audio = this.remoteAudios.get(remoteId);
    if (!audio) {
      audio = document.createElement('audio');
      audio.autoplay = true;
      audio.playsInline = true;
      audio.dataset.remoteId = remoteId;
      this.app.voiceMedia.appendChild(audio);
      this.remoteAudios.set(remoteId, audio);
    }
    audio.srcObject = stream;
  }

  _removeRemoteAudio(remoteId) {
    const audio = this.remoteAudios.get(remoteId);
    if (audio) {
      audio.srcObject = null;
      audio.remove();
      this.remoteAudios.delete(remoteId);
    }
  }

  _setStatus(label) {
    this.app.setVoiceStatus(label);
  }
}

window.VoiceManager = VoiceManager;
