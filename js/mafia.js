// js/mafia.js
const AvatarEngine = {
    seeds: ['Jack', 'Leo', 'Sam', 'Milo', 'Oliver', 'Max', 'Toby', 'Oscar', 'Mia', 'Zoe', 'Lily', 'Chloe', 'Ava', 'Ruby', 'Bella'],
    elements: [], currentIndex: 0,
    
    init() {
        this.seeds = this.seeds.sort(() => 0.5 - Math.random());
        const track = document.getElementById('carousel-track');
        track.innerHTML = '';
        
        this.seeds.forEach((seed) => {
            const img = document.createElement('img');
            img.src = `https://api.dicebear.com/9.x/avataaars/svg?seed=${seed}&backgroundColor=transparent`;
            img.className = `carousel-avatar carousel-out`; 
            track.appendChild(img);
            this.elements.push(img);
        });
        this.setupDragPhysics();
        this.updateView();
    },

    setupDragPhysics() {
        const container = document.getElementById('avatar-slider-container');
        let startX = 0; let isDragging = false;
        const startDrag = (e) => { isDragging = true; startX = e.type.includes('mouse') ? e.clientX : e.touches[0].clientX; };
        const drag = (e) => {
            if(!isDragging) return;
            const currentX = e.type.includes('mouse') ? e.clientX : e.touches[0].clientX;
            const diff = startX - currentX;
            if (diff > 40) { this.slide(1); startX = currentX; } 
            else if (diff < -40) { this.slide(-1); startX = currentX; }
        };
        const endDrag = () => { isDragging = false; };
        
        container.addEventListener('touchstart', startDrag, {passive: true});
        container.addEventListener('touchmove', drag, {passive: true});
        container.addEventListener('touchend', endDrag);
        container.addEventListener('mousedown', startDrag);
        document.addEventListener('mousemove', drag);
        document.addEventListener('mouseup', endDrag);
    },

    slide(dir) {
        this.currentIndex = (this.currentIndex + dir + this.seeds.length) % this.seeds.length;
        this.updateView();
    },

    updateView() {
        const len = this.seeds.length;
        this.elements.forEach((el, i) => {
            el.className = 'carousel-avatar'; 
            let diff = i - this.currentIndex;
            if (diff > len / 2) diff -= len;
            if (diff < -len / 2) diff += len;

            if (diff === 0) el.classList.add('carousel-pos-0');
            else if (diff === 1) el.classList.add('carousel-pos-1');
            else if (diff === -1) el.classList.add('carousel-pos-minus-1');
            else if (diff === 2) el.classList.add('carousel-pos-2');
            else if (diff === -2) el.classList.add('carousel-pos-minus-2');
            else el.classList.add('carousel-out'); 
        });
    },

    getSelectedSeed() { return this.seeds[this.currentIndex]; }
};

const MafiaEngine = {
    mqttClient: null, isHost: false, myId: null, roomId: null, adminPendingAction: null, clientAnimFrame: null, revealTimeout: null,
    player: { id: null, name: '', persona: '', avatar: '', role: null, status: 'LOBBY', stats: { kills: 0, saves: 0, finds: 0, guesses: 0 } },
    gameState: {
        hostName: 'Host', phase: 'LOBBY', players: {}, nightInputs: {}, voteInputs: {}, roundSnapshot: {},
        dayEndTime: 0, totalDayTime: 90000, lastKilledName: null, lastEliminatedName: null, lastEliminatedRole: null, lastVoteTallies: [],
        winnerTitle: null, winnerMessage: null, winnerIcon: null, winnerColor: null
    },

   init() {
        try {
            // Only load Avatar mechanics if the HTML actually exists
            if (document.getElementById('carousel-track')) {
                AvatarEngine.init();
            }
            // Only setup the slider if the modal exists
            if (document.getElementById('mafia-slide-thumb')) {
                this.setupAdminSlider();
            }
            this.checkForSavedSession();
        } catch (e) {
            console.error("MafiaEngine Init Error:", e);
        }
    },

    setupAdminSlider() {
        let slideIsDragging = false; let slideStartX = 0;
        const thumb = document.getElementById('mafia-slide-thumb');
        const track = document.getElementById('mafia-slide-track');
        const prog = document.getElementById('mafia-slide-progress');
        
        const startDrag = (e) => {
            slideIsDragging = true;
            slideStartX = e.type.includes('mouse') ? e.clientX : e.touches[0].clientX;
            thumb.style.transition = 'none'; prog.style.transition = 'none';
        };
        const drag = (e) => {
            if (!slideIsDragging) return;
            const currentX = e.type.includes('mouse') ? e.clientX : e.touches[0].clientX;
            let deltaX = currentX - slideStartX;
            
            // --- NEW: Dynamic width calculation prevents mobile resize lockouts ---
            const maxDelta = track.offsetWidth - thumb.offsetWidth - 8;
            if (deltaX < 0) deltaX = 0; 
            if (deltaX > maxDelta) deltaX = maxDelta;
            // --------------------------------------------------------------------
            
            thumb.style.transform = `translateX(${deltaX}px)`; prog.style.width = `${deltaX + 20}px`;

            if (deltaX > maxDelta * 0.95) {
                slideIsDragging = false;
                thumb.style.transform = `translateX(0px)`; prog.style.width = `0px`;
                thumb.style.transition = 'transform 0.3s ease';
                this.executeAdminAction();
            }
        };
        const endDrag = () => {
            if (!slideIsDragging) return;
            slideIsDragging = false;
            thumb.style.transition = 'transform 0.3s ease'; prog.style.transition = 'width 0.3s ease';
            thumb.style.transform = `translateX(0px)`; prog.style.width = `0px`;
        };

        thumb.addEventListener('mousedown', startDrag); thumb.addEventListener('touchstart', startDrag, {passive: true});
        document.addEventListener('mousemove', drag); document.addEventListener('touchmove', drag, {passive: true});
        document.addEventListener('mouseup', endDrag); document.addEventListener('touchend', endDrag);
    },

    saveHostState() {
        if(!this.isHost) return;
        localStorage.setItem('mafia_host_state', JSON.stringify({ roomId: this.roomId, state: this.gameState }));
    },
    savePlayerSession() { localStorage.setItem('mafia_player_session', JSON.stringify({ roomId: this.roomId, myId: this.myId, player: this.player })); },
    clearSession() {
        localStorage.removeItem('mafia_host_state'); localStorage.removeItem('mafia_player_session');
        document.getElementById('mafia-reconnect-banner').classList.add('hidden');
    },

    checkForSavedSession() {
        const urlParams = new URLSearchParams(window.location.search);
        if (urlParams.get('room')) { document.getElementById('mafia-join-code').value = urlParams.get('room').toUpperCase(); return; }

        const savedHost = localStorage.getItem('mafia_host_state');
        const savedPlayer = localStorage.getItem('mafia_player_session');
        if (savedHost) {
            document.getElementById('mafia-reconnect-banner').classList.remove('hidden');
            document.getElementById('mafia-reconnect-text').innerText = "Recover Host Room?";
        } else if (savedPlayer) {
            const pd = JSON.parse(savedPlayer);
            document.getElementById('mafia-reconnect-banner').classList.remove('hidden');
            document.getElementById('mafia-reconnect-text').innerText = `Rejoin as ${pd.player.name}?`;
        }
    },

    reconnectPlayer() {
        document.getElementById('mafia-reconnect-banner').classList.add('hidden');
        if (localStorage.getItem('mafia_host_state')) {
            const hd = JSON.parse(localStorage.getItem('mafia_host_state'));
            this.isHost = true; this.roomId = hd.roomId; this.gameState = hd.state;
            this.connectMQTT('HOST_RECONNECT');
        } else if (localStorage.getItem('mafia_player_session')) {
            const pd = JSON.parse(localStorage.getItem('mafia_player_session'));
            this.isHost = false; this.roomId = pd.roomId; this.myId = pd.myId; this.player = pd.player;
            this.connectMQTT('PLAYER_RECONNECT');
        }
    },

    createRoom() {
        const hName = document.getElementById('mafia-host-name').value.trim();
        if(!hName) return alert("Please enter a Host Name!");
        this.gameState.hostName = hName;
        
        const btn = document.getElementById('btn-mafia-create');
        btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> CONNECTING...'; btn.disabled = true;

        this.isHost = true;
        this.roomId = Math.random().toString(36).substring(2, 6).toUpperCase();
        this.connectMQTT('HOST_NEW', btn);
    },

    joinRoom() {
        const name = document.getElementById('mafia-player-name').value.trim();
        const code = document.getElementById('mafia-join-code').value.toUpperCase().trim(); 
        const btn = document.getElementById('btn-mafia-join');

        if (!name) return alert("Please enter your name!");
        if (code.length !== 4) return alert("Invalid Code!");

        btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i>'; btn.disabled = true;

        this.isHost = false; this.roomId = code;
        this.myId = 'P_' + Math.random().toString(36).substring(2, 9);
        this.player = {
            id: this.myId, name: name, persona: document.getElementById('mafia-player-persona').value,
            avatar: `https://api.dicebear.com/9.x/avataaars/svg?seed=${AvatarEngine.getSelectedSeed()}&backgroundColor=transparent`,
            status: 'LOBBY', role: null, stats: { kills: 0, saves: 0, finds: 0, guesses: 0 }
        };
        this.connectMQTT('PLAYER_NEW', btn);
    },

    connectMQTT(mode, btnElement = null) {
        this.mqttClient = mqtt.connect('wss://broker.emqx.io:8084/mqtt', { reconnectPeriod: 3000 }); 
        let isFirstConnect = true;

        this.mqttClient.on('connect', () => {
            if (this.isHost) {
                this.mqttClient.subscribe(`gujmafia/${this.roomId}/host`);
                if(btnElement) { btnElement.innerHTML = '<i class="fa-solid fa-chess-board text-xl"></i> CREATE GAME BOARD'; btnElement.disabled = false; }
                
                // --- NEW: Intelligent Host Routing ---
                if (this.gameState.phase === 'LOBBY') {
                    this.renderHostLobby(); 
                } else {
                    // If the host recovered a mid-game session, force the UI to render the active phase
                    this.handleClientReceivesData({ type: 'STATE_UPDATE', data: this.gameState, event: 'RECONNECT' });
                    // Re-broadcast the state so any waiting clients get synced instantly
                    this.broadcastState();
                }
                this.saveHostState();
                // ------------------------------------
            } else {
                this.mqttClient.subscribe(`gujmafia/${this.roomId}/players`);
                this.savePlayerSession();
                
                document.getElementById('mafia-header-brand').classList.add('hidden');
                document.getElementById('mafia-header-player-profile').classList.remove('hidden');
                document.getElementById('mafia-header-avatar').src = this.player.avatar;
                document.getElementById('mafia-header-name').innerText = this.player.name;
                document.getElementById('mafia-header-persona').innerText = this.player.persona !== 'Silent Observer' ? this.player.persona : '';

                if (isFirstConnect && mode === 'PLAYER_NEW') {
                    this.sendToHost({ type: 'JOIN', data: this.player });
                    this.showScreen('mafia-screen-lobby');
                    document.getElementById('mafia-room-badge').classList.remove('hidden');
                    document.getElementById('mafia-display-room-code').innerText = this.roomId;
                } else {
                    this.sendToHost({ type: 'RECONNECT_PULL', data: this.player });
                }
                isFirstConnect = false;
            }
        });

        this.mqttClient.on('message', (topic, message) => {
            const payload = JSON.parse(message.toString());
            if (this.isHost && topic === `gujmafia/${this.roomId}/host`) this.handleHostReceivesData(payload.peerId, payload.data);
            if (!this.isHost && topic === `gujmafia/${this.roomId}/players`) this.handleClientReceivesData(payload);
        });

        this.mqttClient.on('error', () => { if(btnElement) { btnElement.innerHTML = 'JOIN'; btnElement.disabled = false; } });
    },

    sendToHost(msg) { if(this.mqttClient) this.mqttClient.publish(`gujmafia/${this.roomId}/host`, JSON.stringify({ peerId: this.myId, data: msg })); },

renderHostLobby() {
    this.showScreen('mafia-screen-lobby');
    document.getElementById('mafia-host-header-panel').classList.remove('hidden');
    document.getElementById('mafia-lobby-welcome-msg').innerText = `Welcome to ${this.gameState.hostName}'s Pol`;
    document.getElementById('mafia-lobby-room-code-display').innerText = this.roomId;
    document.getElementById('mafia-room-badge').classList.remove('hidden');
    document.getElementById('mafia-display-room-code').innerText = this.roomId;
    document.getElementById('mafia-host-lobby-controls').classList.remove('hidden');
    document.getElementById('btn-mafia-host-settings').classList.remove('hidden');

    const joinUrl = window.location.protocol + "//" + window.location.host + window.location.pathname + '?room=' + this.roomId;
    
    // Change 'qr-image' to 'mafia-qr-image' to match your HTML
    const qrImg = document.getElementById('mafia-qr-image');
    if (qrImg) {
        qrImg.src = `https://api.qrserver.com/v1/create-qr-code/?size=160x160&data=${encodeURIComponent(joinUrl)}`;
        qrImg.classList.remove('hidden'); 
    } else {
        console.error("Could not find element with ID: mafia-qr-image");
    }
    
    if(this.gameState.phase !== 'LOBBY') this.broadcastState(); 
},

    handleHostReceivesData(peerId, msg) {
        if (msg.type === 'JOIN') { 
            if (!this.gameState.players[peerId] || this.gameState.phase === 'LOBBY') { this.gameState.players[peerId] = msg.data; }
            this.broadcastState(); 
        }
        if (msg.type === 'RECONNECT_PULL') this.broadcastState(); 
        if (msg.type === 'NIGHT_ACTION') { this.gameState.nightInputs[peerId] = msg.data; this.checkNightProgress(); }
        if (msg.type === 'VOTE_ACTION') { this.gameState.voteInputs[peerId] = msg.data; this.checkVoteProgress(); }
    },

    broadcastState(actionEvent = null) {
        if(!this.isHost || !this.mqttClient) return;
        this.saveHostState(); 
        const payload = { type: 'STATE_UPDATE', data: this.gameState, event: actionEvent };
        this.mqttClient.publish(`gujmafia/${this.roomId}/players`, JSON.stringify(payload), { retain: true });
        this.handleClientReceivesData(payload); 
    },

    startGame() {
        if (!this.isHost) return;
        const pIds = Object.keys(this.gameState.players);
        if (pIds.length < 3) return alert("You need at least 3 players to start MAFIA.");

        let roles = ['Mafia', 'Doctor', 'Detective'];
        let assignedRoles = [];
        for(let i=0; i<pIds.length; i++) assignedRoles.push(roles[i] || 'Villager');
        assignedRoles = assignedRoles.sort(() => Math.random() - 0.5);

        pIds.forEach((id, index) => {
            this.gameState.players[id].role = assignedRoles[index];
            this.gameState.players[id].status = 'ALIVE';
            this.gameState.players[id].stats = { kills: 0, saves: 0, finds: 0, guesses: 0 };
        });
        this.startNightPhase();
    },

    startNightPhase() {
        this.gameState.phase = 'NIGHT';
        this.gameState.roundSnapshot = JSON.parse(JSON.stringify(this.gameState.players));
        this.gameState.nightInputs = {}; this.gameState.voteInputs = {};
        this.gameState.lastKilledName = null; this.gameState.lastEliminatedName = null; this.gameState.lastEliminatedRole = null; this.gameState.lastVoteTallies = [];
        this.broadcastState();
    },

    checkNightProgress() {
        const alivePlayers = Object.values(this.gameState.players).filter(p => p.status === 'ALIVE').length;
        if (Object.keys(this.gameState.nightInputs).length >= alivePlayers) this.processNightLogic();
        else this.broadcastState(); 
    },

    processNightLogic() {
        let mafiaTarget = null; let doctorSave = null;
        let mafiaIds = []; let doctorIds = []; let detInputs = {}; let vilInputs = {};

        Object.entries(this.gameState.nightInputs).forEach(([peerId, targetId]) => {
            const role = this.gameState.players[peerId].role;
            if (role === 'Mafia') { mafiaTarget = targetId; mafiaIds.push(peerId); }
            if (role === 'Doctor') { doctorSave = targetId; doctorIds.push(peerId); }
            if (role === 'Detective') { detInputs[peerId] = targetId; }
            if (role === 'Villager') { vilInputs[peerId] = targetId; }
        });

        if (mafiaTarget && mafiaTarget !== 'SKIP') {
            if (mafiaTarget === doctorSave) {
                doctorIds.forEach(id => this.gameState.players[id].stats.saves++); 
                this.gameState.lastKilledName = "NO ONE"; 
            } else {
                mafiaIds.forEach(id => this.gameState.players[id].stats.kills++); 
                this.gameState.players[mafiaTarget].status = 'DEAD';
                this.gameState.lastKilledName = this.gameState.players[mafiaTarget].name;
            }
        } else { this.gameState.lastKilledName = "NO ONE"; }

        Object.entries(detInputs).forEach(([dId, tId]) => {
            if(tId !== 'SKIP' && this.gameState.players[tId] && this.gameState.players[tId].role === 'Mafia') this.gameState.players[dId].stats.finds++;
        });
        Object.entries(vilInputs).forEach(([vId, tId]) => {
            if(tId !== 'SKIP' && tId === mafiaTarget) this.gameState.players[vId].stats.guesses++;
        });

        if (this.checkWinCondition()) return;
        this.gameState.phase = 'DAY';
        this.gameState.totalDayTime = 90000;
        this.gameState.dayEndTime = Date.now() + this.gameState.totalDayTime;
        this.broadcastState();
    },

    addTime() {
        if (!this.isHost) return;
        this.gameState.totalDayTime += 30000; this.gameState.dayEndTime += 30000;
        this.broadcastState('ADD_TIME');
    },

    startVotingPhase() {
        this.gameState.phase = 'VOTE'; this.gameState.voteInputs = {};
        this.broadcastState();
    },

    checkVoteProgress() {
        const alivePlayers = Object.values(this.gameState.players).filter(p => p.status === 'ALIVE').length;
        if (Object.keys(this.gameState.voteInputs).length >= alivePlayers) this.processVoteLogic();
        else this.broadcastState(); 
    },

    processVoteLogic() {
        let tallies = {};
        Object.values(this.gameState.voteInputs).forEach(voteId => {
            if(voteId === 'SKIP') return;
            tallies[voteId] = (tallies[voteId] || 0) + 1;
        });

        let tallyDisplay = [];
        for (const [id, count] of Object.entries(tallies)) tallyDisplay.push({ name: this.gameState.players[id].name, count: count });
        this.gameState.lastVoteTallies = tallyDisplay.sort((a,b) => b.count - a.count);

        let maxVotes = 0; let votedOutId = null; let isTie = false;
        for (const [id, count] of Object.entries(tallies)) {
            if (count > maxVotes) { maxVotes = count; votedOutId = id; isTie = false; }
            else if (count === maxVotes) { isTie = true; }
        }

        this.gameState.phase = 'RESULT';
        if (votedOutId && !isTie) {
            this.gameState.players[votedOutId].status = 'DEAD';
            this.gameState.lastEliminatedName = this.gameState.players[votedOutId].name;
            const actualRole = this.gameState.players[votedOutId].role;
            this.gameState.lastEliminatedRole = (actualRole === 'Mafia') ? 'Mafia' : 'Villager';
            this.gameState.winnerTitle = 'ELIMINATED'; this.gameState.winnerIcon = 'fa-skull text-red-500'; this.gameState.winnerColor = 'text-red-500';
        } else {
            this.gameState.lastEliminatedName = null;
            this.gameState.winnerTitle = 'TIED VOTE'; this.gameState.winnerMessage = `The Pol was undecided. No one was eliminated.`;
            this.gameState.winnerIcon = 'fa-scale-balanced text-gray-400'; this.gameState.winnerColor = 'text-gray-300';
        }

        if(!this.checkWinCondition()) this.broadcastState();
    },

    checkWinCondition() {
        const alive = Object.values(this.gameState.players).filter(p => p.status === 'ALIVE');
        const aliveMafia = alive.filter(p => p.role === 'Mafia').length;
        const aliveVillagers = alive.length - aliveMafia;

        if (aliveMafia === 0) { this.endGame('VILLAGERS WIN', 'The Kaali Toli is destroyed.', 'fa-sun text-yellow-500', 'text-yellow-500'); return true; } 
        else if (aliveMafia >= aliveVillagers) { this.endGame('MAFIA WINS', 'The Pol has been taken over.', 'fa-user-secret text-red-600', 'text-red-500'); return true; }
        return false;
    },

    endGame(title, msg, icon, color) {
        this.gameState.phase = 'END';
        this.gameState.winnerMessage = msg; this.gameState.winnerTitle = title;
        this.gameState.winnerIcon = icon; this.gameState.winnerColor = color;
        this.gameState.lastEliminatedName = null; this.gameState.lastVoteTallies = [];
        this.broadcastState();
    },

    nextRoundOrEnd() {
        if (!this.isHost) return;
        if(this.gameState.phase === 'RESULT') this.startNightPhase();
        else if (this.gameState.phase === 'END') {
            this.gameState.phase = 'LOBBY';
            Object.keys(this.gameState.players).forEach(id => { this.gameState.players[id].status = 'LOBBY'; this.gameState.players[id].role = null; });
            this.broadcastState();
        }
    },

    openHostSettings() { document.getElementById('mafia-host-settings-modal').classList.remove('hidden'); },
    
    requestAdminAction(actionType) {
        document.getElementById('mafia-host-settings-modal').classList.add('hidden');
        this.adminPendingAction = actionType;
        const labels = {
            'ADMIN_FORCE_VOTE': 'Force Vote Phase', 'ADMIN_FORCE_DAY': 'Force Day Phase', 'ADMIN_FORCE_RESULT': 'Force Results',
            'RESET_ROUND': 'Restart Current Round', 'RESET_GAME': 'Reset to Lobby', 'END_SESSION': 'End Session & Show Stats'
        };
        document.getElementById('mafia-slide-modal-title').innerText = `CONFIRM: ${labels[actionType]}`;
        document.getElementById('mafia-slide-modal').classList.remove('hidden');
    },
    
    cancelSlide() { document.getElementById('mafia-slide-modal').classList.add('hidden'); },
    
    executeAdminAction() {
        this.cancelSlide();
        if(!this.isHost) return;
        const action = this.adminPendingAction;
        if(action === 'ADMIN_FORCE_VOTE') this.startVotingPhase();
        else if(action === 'ADMIN_FORCE_DAY') this.processNightLogic();
        else if(action === 'ADMIN_FORCE_RESULT') this.processVoteLogic();
        else if(action === 'RESET_ROUND') {
            this.gameState.players = JSON.parse(JSON.stringify(this.gameState.roundSnapshot));
            this.gameState.phase = 'NIGHT'; this.gameState.nightInputs = {}; this.gameState.voteInputs = {};
            this.broadcastState();
        }
        else if(action === 'RESET_GAME') {
            this.gameState.phase = 'LOBBY';
            Object.keys(this.gameState.players).forEach(id => { this.gameState.players[id].status = 'LOBBY'; this.gameState.players[id].role = null; this.gameState.players[id].stats = { kills: 0, saves: 0, finds: 0, guesses: 0 }; });
            this.broadcastState();
        }
        else if(action === 'END_SESSION') { this.endGame('SESSION CONCLUDED', 'The Host has ended the game early.', 'fa-flag-checkered text-blue-500', 'text-blue-500'); }
    },

    shareStats() {
        if (this.isHost) return;
        const p = this.player;
        const shareText = `I survived the Pol playing MAFIA - Gujarati Edition as ${p.persona}! \n\n🎯 Kills: ${p.stats.kills} \n💊 Saves: ${p.stats.saves} \n🕵️‍♂️ Mafia Found: ${p.stats.finds} \n🧠 Correct Guesses: ${p.stats.guesses}\n\nCan you survive the Pol?`;
        if (navigator.share) navigator.share({ title: 'My Mafia Stats', text: shareText }).catch(err => console.log("Sharing cancelled", err));
        else alert("Share not supported on this browser.\n\n" + shareText);
    },

    handleClientReceivesData(msg) {
        if (msg.type !== 'STATE_UPDATE') return;
        this.gameState = msg.data;
        
        document.getElementById('mafia-room-badge').classList.remove('hidden');
        document.getElementById('mafia-display-room-code').innerText = this.roomId;
        
        const fab = document.getElementById('fab-role-reveal');
        if(!this.isHost && ['NIGHT', 'DAY', 'VOTE'].includes(this.gameState.phase)) fab.classList.remove('hidden');
        else fab.classList.add('hidden');

        if (this.gameState.phase === 'LOBBY') this.renderLobby();
        if (this.gameState.phase === 'NIGHT') this.renderNight();
        if (this.gameState.phase === 'DAY') this.renderDay(msg.event);
        if (this.gameState.phase === 'VOTE') this.renderVote();
        if (this.gameState.phase === 'RESULT' || this.gameState.phase === 'END') this.renderResult();
    },

    tapRevealRole() {
        const popup = document.getElementById('fab-role-popup');
        const myData = this.gameState.players[this.myId];
        if(!myData) return;
        clearTimeout(this.revealTimeout);
        const mapRole = { 'Mafia': 'Mafia (Kaali Toli)', 'Doctor': 'Doctor (Vaidya)', 'Detective': 'Detective (Batmi-dar)', 'Villager': 'Villager (Gamwalo)' };
        popup.innerText = mapRole[myData.role] || myData.role;
        popup.classList.remove('hidden');
        this.revealTimeout = setTimeout(() => { popup.classList.add('hidden'); }, 1000);
    },

    renderLobby() {
        this.showScreen('mafia-screen-lobby');
        const list = document.getElementById('mafia-player-list');
        list.innerHTML = ''; let count = 0;
        
        if (!this.isHost) {
             document.getElementById('mafia-lobby-welcome-msg').innerText = `Welcome to ${this.gameState.hostName}'s Pol`;
             document.getElementById('mafia-host-header-panel').classList.remove('hidden');
        }

        Object.values(this.gameState.players).forEach((p) => {
            count++;
            list.innerHTML += `<li class="bg-gray-800/80 p-3 border border-gray-700 rounded-xl flex items-center gap-4 shadow-lg">
                <img src="${p.avatar}" class="w-14 h-14 rounded-full bg-gray-900 border-2 border-gray-600"><div class="flex-grow"><span class="font-black text-gray-100 block tracking-wide">${p.name}</span><span class="text-[10px] text-yellow-500 font-bold uppercase tracking-widest">${p.persona}</span></div></li>`;
        });
        document.getElementById('mafia-player-count').innerText = count;
    },

    renderNight() {
        this.showScreen('mafia-screen-night');
        document.getElementById('khari-plate').classList.remove('khari-visible'); 
        
        const actionPanel = document.getElementById('mafia-night-action-panel');
        const lockedPanel = document.getElementById('mafia-night-locked-panel');
        actionPanel.classList.remove('hidden'); lockedPanel.classList.add('hidden');
        
        let selectedTargetId = null; 
        const list = document.getElementById('mafia-night-target-list');
        list.innerHTML = '';

        if (this.isHost) {
            document.getElementById('mafia-night-instructions').classList.add('hidden');
            document.getElementById('btn-confirm-night').classList.add('hidden');
            Object.values(this.gameState.players).filter(p => p.status === 'ALIVE').forEach(p => {
                const hasActed = !!this.gameState.nightInputs[p.id];
                list.innerHTML += `<li class="p-3 mb-2 border border-gray-700 rounded-xl bg-gray-800 flex justify-between items-center shadow">
                    <span class="text-white font-bold">${p.name}</span><span class="${hasActed ? 'text-green-500' : 'text-yellow-500'} text-xs font-black tracking-widest uppercase">${hasActed ? 'LOCKED IN' : 'THINKING...'}</span></li>`;
            });
            list.innerHTML += `<li class="mt-6"><button onclick="MafiaEngine.requestAdminAction('ADMIN_FORCE_DAY')" class="w-full px-6 py-4 bg-red-900 border border-red-600 text-white rounded-xl shadow-lg font-black tracking-widest uppercase">Force Next (Override)</button></li>`;
            return;
        }

        const myData = this.gameState.players[this.myId];
        if (!myData || myData.status === 'DEAD' || this.gameState.nightInputs[this.myId]) {
            actionPanel.classList.add('hidden'); lockedPanel.classList.remove('hidden');
            if (myData && myData.status === 'DEAD') {
                lockedPanel.innerHTML = `<div class="text-6xl text-red-500 mb-6"><i class="fa-solid fa-skull"></i></div><h2 class="text-2xl font-black tracking-widest text-red-500">YOU ARE DEAD</h2><p class="text-gray-500 text-xs mt-2 uppercase tracking-widest font-bold">Spectating...</p>`;
            }
            return;
        }

        document.getElementById('mafia-night-instructions').classList.remove('hidden');
        document.getElementById('btn-confirm-night').classList.remove('hidden');
        document.getElementById('btn-confirm-night').disabled = true; document.getElementById('btn-confirm-night').classList.add('opacity-50', 'cursor-not-allowed');

        let aliveTargets = Object.values(this.gameState.players).filter(p => p.status === 'ALIVE' && p.id !== this.myId).sort(() => Math.random() - 0.5);

        aliveTargets.forEach(p => {
            const li = document.createElement('li');
            li.className = "list-item-btn p-4 border border-gray-600 rounded-xl cursor-pointer bg-gray-900 font-bold text-gray-300 text-lg shadow-sm relative";
            li.innerText = p.name;
            li.onclick = () => {
                document.querySelectorAll('#mafia-night-target-list .list-item-btn').forEach(el => el.classList.remove('selected'));
                li.classList.add('selected');
                this.selectedTargetId = p.id;
                document.getElementById('btn-confirm-night').disabled = false; document.getElementById('btn-confirm-night').classList.remove('opacity-50', 'cursor-not-allowed');
            };
            list.appendChild(li);
        });
    },

    submitNightAction() {
        if (!this.selectedTargetId) return;
        const myData = this.gameState.players[this.myId];
        const actionPanel = document.getElementById('mafia-night-action-panel');
        const btnConfirm = document.getElementById('btn-confirm-night');
        btnConfirm.disabled = true; btnConfirm.classList.add('opacity-50', 'cursor-not-allowed');
        
        let popupHtml = ''; let borderClass = 'border-gray-600';
        if (myData.role === 'Detective') {
            const isMafia = this.gameState.players[this.selectedTargetId].role === 'Mafia';
            popupHtml = `<span class="text-sm font-black tracking-widest ${isMafia ? "text-red-500" : "text-green-500"}">RESULT: ${isMafia ? "MAFIA" : "VILLAGER"}</span>`;
            borderClass = isMafia ? "border-red-500" : "border-green-500";
        } else {
            popupHtml = `<span class="text-sm font-bold tracking-widest text-gray-400"><i class="fa-solid fa-spinner fa-spin mr-2"></i> LOCKING...</span>`;
        }

        const popup = document.createElement('div');
        popup.className = `absolute bottom-24 left-1/2 transform -translate-x-1/2 bg-gray-900 border-2 ${borderClass} px-6 py-2 rounded-xl shadow-2xl z-50 whitespace-nowrap transition-all`;
        popup.innerHTML = popupHtml;
        actionPanel.classList.add('relative'); actionPanel.appendChild(popup);
        
        setTimeout(() => {
            popup.remove();
            document.getElementById('mafia-night-action-panel').classList.add('hidden');
            document.getElementById('mafia-night-locked-panel').classList.remove('hidden');
            this.sendToHost({ type: 'NIGHT_ACTION', data: this.selectedTargetId });
        }, 2000);
    },

    renderDay(event) {
        this.showScreen('mafia-screen-vibe');
        if (event === 'ADD_TIME') document.getElementById('khari-plate').classList.add('khari-visible');
        
        let news = `<h4 class="font-black text-red-500 tracking-widest">MORNING NEWS</h4>`;
        if (this.gameState.lastKilledName === "NO ONE") news += `<p class="text-sm text-gray-300 mt-1 font-bold">The Pol was quiet. <span class="text-green-500">No one died!</span></p>`;
        else news += `<p class="text-sm text-gray-300 mt-1 font-bold">Tragedy struck. <span class="text-red-500 font-black">${this.gameState.lastKilledName}</span> was eliminated!</p>`;
        document.getElementById('mafia-morning-announcement').innerHTML = news;
        
        if (this.isHost) document.getElementById('mafia-host-override-panel').classList.remove('hidden');

        if(this.clientAnimFrame) cancelAnimationFrame(this.clientAnimFrame);
        const updateTimer = () => {
            if(this.gameState.phase !== 'DAY') return;
            const remaining = this.gameState.dayEndTime - Date.now();
            if (remaining <= 0) {
                document.getElementById('mafia-timer-display').innerText = "00:00";
                document.getElementById('chai-liquid').style.height = "0%";
                if(this.isHost) this.startVotingPhase();
                return;
            }
            const secs = Math.ceil(remaining / 1000);
            document.getElementById('mafia-timer-display').innerText = `${Math.floor(secs/60).toString().padStart(2,'0')}:${(secs%60).toString().padStart(2,'0')}`;
            document.getElementById('chai-liquid').style.height = `${Math.max(0, (remaining / this.gameState.totalDayTime) * 100)}%`;
            this.clientAnimFrame = requestAnimationFrame(updateTimer);
        };
        updateTimer();
    },

    renderVote() {
        this.showScreen('mafia-screen-vote');
        const actionPanel = document.getElementById('mafia-vote-action-panel');
        const lockedPanel = document.getElementById('mafia-vote-locked-panel');
        actionPanel.classList.remove('hidden'); lockedPanel.classList.add('hidden');
        
        this.selectedTargetId = null; 
        const list = document.getElementById('mafia-vote-target-list');
        list.innerHTML = '';
        
        if (this.isHost) {
            document.getElementById('btn-confirm-vote').classList.add('hidden');
            Object.values(this.gameState.players).filter(p => p.status === 'ALIVE').forEach(p => {
                const hasVoted = !!this.gameState.voteInputs[p.id];
                list.innerHTML += `<li class="p-3 mb-2 border border-gray-700 rounded-xl bg-gray-800 flex justify-between items-center shadow">
                    <span class="text-white font-bold">${p.name}</span><span class="${hasVoted ? 'text-green-500' : 'text-yellow-500'} text-xs font-black tracking-widest uppercase">${hasVoted ? 'VOTED' : 'DECIDING...'}</span></li>`;
            });
            list.innerHTML += `<li class="mt-6"><button onclick="MafiaEngine.requestAdminAction('ADMIN_FORCE_RESULT')" class="w-full px-6 py-4 bg-orange-900 border border-orange-600 text-white rounded-xl shadow-lg font-black tracking-widest uppercase">Force Next (Override)</button></li>`;
            return;
        }

        const myData = this.gameState.players[this.myId];
        if (!myData || myData.status === 'DEAD' || this.gameState.voteInputs[this.myId]) {
            actionPanel.classList.add('hidden'); lockedPanel.classList.remove('hidden');
            if (myData && myData.status === 'DEAD') {
                lockedPanel.innerHTML = `<div class="text-6xl text-red-500 mb-6"><i class="fa-solid fa-skull"></i></div><h2 class="text-2xl font-black tracking-widest text-red-500">YOU ARE DEAD</h2><p class="text-gray-500 text-xs mt-2 uppercase tracking-widest font-bold">Spectating...</p>`;
            }
            return;
        }

        document.getElementById('btn-confirm-vote').classList.remove('hidden');
        document.getElementById('btn-confirm-vote').disabled = true; document.getElementById('btn-confirm-vote').classList.add('opacity-50', 'cursor-not-allowed');

        let skipLi = document.createElement('li');
        skipLi.className = "list-item-btn p-4 border border-gray-600 rounded-xl cursor-pointer bg-gray-900 font-bold text-gray-400 text-lg shadow-sm mb-4";
        skipLi.innerText = "SKIP VOTE";
        skipLi.onclick = () => {
            document.querySelectorAll('#mafia-vote-target-list .list-item-btn').forEach(el => el.classList.remove('selected'));
            skipLi.classList.add('selected'); this.selectedTargetId = 'SKIP';
            document.getElementById('btn-confirm-vote').disabled = false; document.getElementById('btn-confirm-vote').classList.remove('opacity-50', 'cursor-not-allowed');
        };
        list.appendChild(skipLi);

        Object.values(this.gameState.players).filter(p => p.status === 'ALIVE').sort(() => Math.random() - 0.5).forEach(p => {
            const li = document.createElement('li');
            li.className = "list-item-btn p-4 border border-gray-600 rounded-xl cursor-pointer bg-gray-900 font-bold text-gray-200 text-lg shadow-sm";
            li.innerText = p.name;
            li.onclick = () => {
                document.querySelectorAll('#mafia-vote-target-list .list-item-btn').forEach(el => el.classList.remove('selected'));
                li.classList.add('selected'); this.selectedTargetId = p.id;
                document.getElementById('btn-confirm-vote').disabled = false; document.getElementById('btn-confirm-vote').classList.remove('opacity-50', 'cursor-not-allowed');
            };
            list.appendChild(li);
        });
    },

    submitVote() {
        if (!this.selectedTargetId) return;
        document.getElementById('mafia-vote-action-panel').classList.add('hidden'); document.getElementById('mafia-vote-locked-panel').classList.remove('hidden');
        this.sendToHost({ type: 'VOTE_ACTION', data: this.selectedTargetId });
    },

    renderResult() {
        this.showScreen('mafia-screen-result');
        const icon = document.getElementById('mafia-result-icon'); const title = document.getElementById('mafia-result-title');
        const reveal = document.getElementById('mafia-elimination-reveal'); const talliesCont = document.getElementById('mafia-vote-tallies-container');
        const endStatsCont = document.getElementById('mafia-end-stats-container'); const btnShare = document.getElementById('btn-mafia-share-stats');
        
        icon.classList.remove('scale-in'); title.classList.remove('fade-in'); reveal.classList.remove('fade-in');

        title.innerText = this.gameState.winnerTitle;
        title.className = `text-4xl font-black tracking-widest mb-4 drop-shadow-lg transition-opacity duration-1000 delay-300 opacity-0 ${this.gameState.winnerColor}`;
        icon.innerHTML = `<i class="fa-solid ${this.gameState.winnerIcon}"></i>`;
        
        if (this.gameState.lastVoteTallies && this.gameState.lastVoteTallies.length > 0 && this.gameState.phase === 'RESULT') {
            const tallyList = document.getElementById('mafia-vote-tallies-list'); tallyList.innerHTML = '';
            this.gameState.lastVoteTallies.forEach(t => { tallyList.innerHTML += `<li class="flex justify-between border-b border-gray-700 py-1 last:border-0"><span>${t.name}</span> <span class="text-orange-500">${t.count} Votes</span></li>`; });
            talliesCont.classList.remove('hidden');
        } else { talliesCont.classList.add('hidden'); }

        if (this.gameState.lastEliminatedName) {
            document.getElementById('mafia-result-subtitle').innerHTML = `<span class="text-2xl font-black text-white">${this.gameState.lastEliminatedName} / ${this.gameState.lastEliminatedRole === 'Mafia' ? 'Mafia' : 'Villager'}</span><br>was eliminated.`;
            reveal.classList.remove('hidden');
        } else {
            reveal.classList.add('hidden');
            document.getElementById('mafia-result-subtitle').innerText = this.gameState.winnerMessage || "";
        }

        if (this.gameState.phase === 'END') {
            endStatsCont.classList.remove('hidden'); if(!this.isHost) btnShare.classList.remove('hidden');
            const slist = document.getElementById('mafia-end-stats-list'); slist.innerHTML = '';
            
            let bestKiller = {n:'', s:0}; let bestSaver = {n:'', s:0}; let bestDet = {n:'', s:0}; let bestGuess = {n:'', s:0};
            Object.values(this.gameState.players).forEach(p => {
                if(p.stats.kills > bestKiller.s) { bestKiller = {n: p.name, s: p.stats.kills}; }
                if(p.stats.saves > bestSaver.s) { bestSaver = {n: p.name, s: p.stats.saves}; }
                if(p.stats.finds > bestDet.s) { bestDet = {n: p.name, s: p.stats.finds}; }
                if(p.stats.guesses > bestGuess.s) { bestGuess = {n: p.name, s: p.stats.guesses}; }
            });

            if(bestKiller.s > 0) slist.innerHTML += `<li><i class="fa-solid fa-skull text-red-500 w-6"></i> <span class="text-gray-400">Top Killer:</span> <span class="text-white">${bestKiller.n} (${bestKiller.s} Kills)</span></li>`;
            if(bestSaver.s > 0) slist.innerHTML += `<li><i class="fa-solid fa-user-doctor text-blue-500 w-6"></i> <span class="text-gray-400">Top Savior:</span> <span class="text-white">${bestSaver.n} (${bestSaver.s} Saves)</span></li>`;
            if(bestDet.s > 0) slist.innerHTML += `<li><i class="fa-solid fa-magnifying-glass text-purple-500 w-6"></i> <span class="text-gray-400">Top Detective:</span> <span class="text-white">${bestDet.n} (${bestDet.s} Finds)</span></li>`;
            if(bestGuess.s > 0) slist.innerHTML += `<li><i class="fa-solid fa-brain text-yellow-500 w-6"></i> <span class="text-gray-400">Best Guesser:</span> <span class="text-white">${bestGuess.n} (${bestGuess.s} Correct)</span></li>`;
            if(slist.innerHTML === '') slist.innerHTML = '<li class="text-gray-500 text-center">No notable stats this round.</li>';
        } else {
            endStatsCont.classList.add('hidden'); btnShare.classList.add('hidden');
        }

        setTimeout(() => { icon.classList.add('scale-in'); }, 100);
        setTimeout(() => { title.classList.add('fade-in'); }, 100);
        setTimeout(() => { reveal.classList.add('fade-in'); }, 100);
        if (this.isHost) document.getElementById('mafia-host-result-controls').classList.remove('hidden');
    },

    showScreen(screenId) {
        document.querySelectorAll('#view-mafia div[id^="mafia-screen-"]').forEach(el => { el.classList.add('screen-hidden'); el.classList.remove('screen-active'); });
        const target = document.getElementById(screenId);
        if(target) {
            target.classList.remove('screen-hidden'); target.classList.add('screen-active');
            target.animate([{ opacity: 0, transform: 'scale(0.98)' }, { opacity: 1, transform: 'scale(1)' }], { duration: 300, easing: 'ease-out' });
        }
    }
};

document.addEventListener('DOMContentLoaded', () => MafiaEngine.init());