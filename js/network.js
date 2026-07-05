// js/network.js
const NetworkEngine = {
    client: null,
    roomCode: null,
    role: 'host',
    gameType: null,
    throttleTimer: null,
    spectatorName: '', 
    viewers: [],
    joinTimeout: null,
    
    // Heartbeat properties
    heartbeatInterval: null,
    heartbeatMonitor: null,
    lastPingReceived: 0,
    isHostConnected: false,

    generateRoomCode() { return Math.random().toString(36).substring(2, 6).toUpperCase(); },

// Add this to NetworkEngine
async probeRoom(code) {
    // This is a "light" MQTT connection to just look at the room status
    // If the topic 'gamehub/ROOM/gameType' returns 'mafia', we know it's mafia.
    return new Promise((resolve) => {
        const client = mqtt.connect('wss://broker.emqx.io:8084/mqtt');
        client.on('connect', () => {
            client.subscribe(`gamehub/${code}`);
            // If we receive a message with the game type, we resolve the game
            client.on('message', (t, m) => {
                const p = JSON.parse(m.toString());
                client.end();
                resolve(p.game); // Returns 'mafia', 'kachuful', etc.
            });
        });
        setTimeout(() => { client.end(); resolve(null); }, 3000);
    });
},



    // --- SESSION HYDRATION ---
    saveSession() {
        const sessionData = {
            roomCode: this.roomCode,
            role: this.role,
            gameType: this.gameType,
            spectatorName: this.spectatorName,
            timestamp: Date.now()
        };
        localStorage.setItem('gamehub_network_session', JSON.stringify(sessionData));
    },

    restoreSession() {
        const raw = localStorage.getItem('gamehub_network_session');
        if (!raw) return false;
        
        try {
            const data = JSON.parse(raw);
            // Expire sessions older than 12 hours
            if (Date.now() - data.timestamp > 43200000) {
                this.clearSession();
                return false;
            }
            
            this.roomCode = data.roomCode;
            this.role = data.role;
            this.gameType = data.gameType;
            this.spectatorName = data.spectatorName;
            return true;
        } catch (e) {
            this.clearSession();
            return false;
        }
    },

    clearSession() {
        localStorage.removeItem('gamehub_network_session');
        localStorage.removeItem('gamehub_room_data'); // Legacy cleanup
        if (this.client) {
            if (this.role === 'host') this.client.publish(`gamehub/${this.roomCode}`, null, { retain: true });
            this.client.end();
        }
        this.stopHeartbeat();
    },

    // --- INITIALIZATION ---
    initHost(gameId) {
        this.role = 'host';
        this.gameType = gameId;
        
        // Check if we are recovering an active host session
        if (!this.restoreSession() || this.role !== 'host') {
            this.roomCode = this.generateRoomCode();
        }
        
        this.saveSession();
        this.updateHeaderCode();
        this.connect();
    },

    joinAsSpectator(forceReconnect = false) {
        if (!forceReconnect) {
            const code = document.getElementById('join-room-code').value.toUpperCase().trim();
            const name = document.getElementById('join-player-name').value.trim();
            
            if (code.length !== 4) return alert("Invalid Code");
            if (!name) return alert("Please enter your name");
            
            this.role = 'spectator';
            this.roomCode = code;
            this.spectatorName = name;
        }
        
        this.saveSession();
        
        const btn = document.getElementById('btn-join-spectator');
        if (btn) {
            btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i>';
            btn.disabled = true;
        }

        if(this.joinTimeout) clearTimeout(this.joinTimeout);
        this.joinTimeout = setTimeout(() => {
            alert(`Error: Room ${this.roomCode} not found or Host is disconnected.`);
            if (btn) { btn.innerHTML = 'JOIN'; btn.disabled = false; }
            this.clearSession();
        }, 6000); // Slightly longer timeout to account for MQTT handshake

        this.updateHeaderCode();
        this.connect(btn);
    },
    
    updateHeaderCode() {
        const headerCodeVal = document.getElementById('header-room-code-val');
        const headerCodeContainer = document.getElementById('header-room-code');
        if (headerCodeVal && headerCodeContainer) {
            headerCodeVal.innerText = this.roomCode;
            headerCodeContainer.style.display = 'block';
        }
    },

    // --- CONNECTION & ROUTING ---
    connect(joinBtnElement = null) {
        if (this.client) this.client.end(); // Clean slate
        this.client = mqtt.connect('wss://broker.emqx.io:8084/mqtt', { reconnectPeriod: 3000 });
        
        this.client.on('connect', () => {
            const indicator = document.getElementById('live-indicator');
            if (indicator) indicator.classList.add('active');
            
            const topic = `gamehub/${this.roomCode}`;
            this.client.subscribe(topic);
            
            if (this.role === 'host') {
                this.client.subscribe(`${topic}/host`);
                this.startHostHeartbeat();
                // Broadcast current state in case clients are waiting
                this.forceStateBroadcast();
            } else if (this.role === 'spectator') {
                this.startClientHeartbeatMonitor();
                // Instead of just joining, we explicitly ask the host for the current state
                this.client.publish(`${topic}/host`, JSON.stringify({ action: 'RECONNECT_PULL', name: this.spectatorName }));
            }
        });

        this.client.on('error', (err) => { 
            console.error("MQTT Error:", err); 
            const indicator = document.getElementById('live-indicator');
            if (indicator) indicator.classList.remove('active'); 
        });
        
        this.client.on('offline', () => { 
            const indicator = document.getElementById('live-indicator');
            if (indicator) indicator.classList.remove('active'); 
        });

        this.client.on('message', (topic, message) => {
            const msgStr = message.toString();

            if (!message || message.length === 0 || msgStr === 'null') {
                if (this.role === 'spectator') HubEngine.finishGame(true);
                return;
            }

            try {
                const payload = JSON.parse(msgStr);
                
                // HOST ROUTING
                if (this.role === 'host' && topic.endsWith('/host')) {
                    if (payload.action === 'SPECTATOR_JOIN' || payload.action === 'RECONNECT_PULL') {
                        if(payload.name && !this.viewers.includes(payload.name)) {
                            this.viewers.push(payload.name);
                            this.updateViewersUI();
                        }
                        // Host MUST reply to a pull request with the full state
                        this.forceStateBroadcast();
                    }
                } 
                // SPECTATOR ROUTING
                else if (this.role === 'spectator' && !topic.endsWith('/host')) {
                    if (payload.action === 'PING') {
                        this.lastPingReceived = Date.now();
                        this.isHostConnected = true;
                        return;
                    }

                    if (this.joinTimeout) {
                        clearTimeout(this.joinTimeout);
                        this.joinTimeout = null;
                        if (joinBtnElement) { joinBtnElement.innerHTML = 'JOIN'; joinBtnElement.disabled = false; }
                    }

                    if (payload.action === 'GAME_OVER') { 
                        HubEngine.finishGame(true); 
                        this.clearSession();
                    } else if (payload.state) { 
                        this.handleSpectatorUpdate(payload); 
                    }
                }
            } catch (err) {
                console.error("GameHub MQTT Parsing Error:", err);
            }
        });
    },

    updateViewersUI() {
        const viewerBtn = document.getElementById('header-viewers');
        if (!viewerBtn) return;
        
        const eyeIcon = viewerBtn.querySelector('i');
        document.getElementById('v-count').innerText = this.viewers.length;
        viewerBtn.classList.remove('hidden');
        viewerBtn.classList.add('active');
        
        eyeIcon.className = 'fa-solid fa-eye fa-beat';
        setTimeout(() => { eyeIcon.className = 'fa-solid fa-eye fa-fade'; }, 3000);
    },

    // --- HEARTBEAT SYSTEM ---
    startHostHeartbeat() {
        this.stopHeartbeat();
        this.heartbeatInterval = setInterval(() => {
            if (this.client && this.client.connected) {
                this.client.publish(`gamehub/${this.roomCode}`, JSON.stringify({ action: 'PING' }));
            }
        }, 5000);
    },

    startClientHeartbeatMonitor() {
        this.stopHeartbeat();
        this.lastPingReceived = Date.now();
        this.isHostConnected = true;
        
        this.heartbeatMonitor = setInterval(() => {
            // Give the host a 15-second grace period
            if (Date.now() - this.lastPingReceived > 15000) {
                if (this.isHostConnected) {
                    this.isHostConnected = false;
                    console.warn("Host disconnected. Waiting for reconnect...");
                    // Optional: You could trigger a UI banner here in the future
                }
            }
        }, 5000);
    },

    stopHeartbeat() {
        if (this.heartbeatInterval) clearInterval(this.heartbeatInterval);
        if (this.heartbeatMonitor) clearInterval(this.heartbeatMonitor);
    },

    // --- STATE BROADCASTING ---
    forceStateBroadcast() {
        let state = null;
        if (HubEngine.state.currentView === 'kachuful' && typeof KFEngine !== 'undefined') state = KFEngine.state;
        else if (HubEngine.state.currentView === 'kalitiri' && typeof KTEngine !== 'undefined') state = KTEngine.state;
        else if (HubEngine.state.currentView === 'lobby') state = { isLobby: true };

        if(state) this.broadcastState(state);
    },

    broadcastState(stateObj) {
        if (this.role !== 'host' || !this.client) return;
        clearTimeout(this.throttleTimer);
        this.throttleTimer = setTimeout(() => {
            const payload = { game: this.gameType, hostName: HubEngine.state.hostName, state: stateObj };
            this.client.publish(`gamehub/${this.roomCode}`, JSON.stringify(payload), { retain: true });
        }, 150); 
    },

    broadcastGameOver() {
        if (this.role !== 'host' || !this.client) return;
        this.client.publish(`gamehub/${this.roomCode}`, JSON.stringify({ action: 'GAME_OVER' }), { retain: true });
    },

    // --- SPECTATOR HANDLING ---
    handleSpectatorUpdate(payload) {
        if (!payload || !payload.state) return;
        document.body.classList.add('spectator-mode');
        
        // Trap the spectator in the lounge if the host is explicitly in the lobby or setup phase
        if (payload.state.isLobby) {
            HubEngine.switchView('spectator-wait');
            return;
        }

        let isSetupPhase = false;
        if (payload.game === 'kachuful' || payload.game === 'kalitiri') {
            isSetupPhase = (!payload.state.players || payload.state.players.length === 0);
        }

        if (isSetupPhase) {
            HubEngine.switchView('spectator-wait');
            const waitTitle = document.getElementById('wait-host-title');
            const waitSub = document.getElementById('wait-host-sub');
            if (waitTitle && waitSub) {
                const gameName = payload.game === 'kachuful' ? 'Kachuful' : (payload.game === 'kalitiri' ? 'Kali Tiri' : payload.game.toUpperCase());
                const hName = payload.hostName || 'Host';
                waitTitle.innerText = `${gameName.toUpperCase()} LOBBY`;
                waitSub.innerHTML = `<i class="fa-solid fa-gear fa-spin mr-2" style="color:var(--gold);"></i> ${hName} is setting up the game...`;
            }
            return; 
        }
        
        if (payload.game === 'kachuful' && typeof KFEngine !== 'undefined') { 
            HubEngine.switchView('kachuful'); 
            KFEngine.receiveSurgicalUpdate(payload.state); 
        } else if (payload.game === 'kalitiri' && typeof KTEngine !== 'undefined') { 
            HubEngine.switchView('kalitiri'); 
            KTEngine.receiveSurgicalUpdate(payload.state); 
        }
    }
};