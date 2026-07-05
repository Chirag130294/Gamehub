const GujaratLoader = {
    places: [
        { t: "Atal Bridge, Ahmedabad", d: "A spectacular pedestrian bridge over the Sabarmati River inspired by vibrant kite festivals.", img: "assets/img/places/atal_bridge.jpg" },
        { t: "Sabarmati Riverfront", d: "Ahmedabad's iconic waterfront promenade, beautifully blending modern urban design with nature.", img: "assets/img/places/sabarmati.jpg" },
        { t: "Statue of Unity, Kevadia", d: "The world's tallest statue, standing proudly on the Narmada River.", img: "assets/img/places/unity.jpg" },
        { t: "Modhera Sun Temple", d: "An architectural masterpiece from the 11th century designed to catch the first rays of the sun.", img: "assets/img/places/modhera.jpg" },
        { t: "Adalaj Stepwell", d: "A stunning five-story deep stepwell with intricate Indo-Islamic architecture.", img: "assets/img/places/adalaj.jpg" },
        { t: "Laxmi Vilas Palace, Vadodara", d: "A majestic royal residence, reportedly four times the size of Buckingham Palace.", img: "assets/img/places/laxmi.jpg" },
        { t: "Somnath Temple", d: "The legendary first among the twelve Aadi Jyotirlingas of India, positioned by the Arabian Sea.", img: "assets/img/places/somnath.jpg" },
        { t: "Rann of Kutch", d: "A mesmerizing expanse of pristine white salt desert glowing brightly under the moonlight.", img: "assets/img/places/kutch.jpg" }
    ],
    idx: 0,
    interval: null,
    
    start() {
        this.idx = Math.floor(Math.random() * this.places.length);
        this.update();
        if(this.interval) clearInterval(this.interval);
        
        this.interval = setInterval(() => {
            this.idx = (this.idx + 1) % this.places.length;
            this.update();
        }, 8500); 
    },
    
  update() {
        const currentPlace = this.places[this.idx];
        const img = new Image();
        
        const updateDOM = (opacity, bgImage = null) => {
            document.querySelectorAll('.gujarat-loader-title, #gujarat-loader-title').forEach(el => { el.style.opacity = opacity; if(opacity===1) el.innerText = currentPlace.t; });
            document.querySelectorAll('.gujarat-loader-desc, #gujarat-loader-desc').forEach(el => { el.style.opacity = opacity; if(opacity===1) el.innerText = currentPlace.d; });
            document.querySelectorAll('.gujarat-loader-bg, #gujarat-loader-bg').forEach(el => { el.style.opacity = opacity; if(opacity===1 && bgImage) el.style.backgroundImage = bgImage; });
        };

        img.onload = () => {
            updateDOM(0);
            setTimeout(() => { updateDOM(1, `url('${currentPlace.img}')`); }, 1000); 
        };

        img.onerror = () => {
            updateDOM(0);
            setTimeout(() => { updateDOM(1, `linear-gradient(to bottom, #1a202c, #0d1117)`); }, 1000);
        };

        img.src = currentPlace.img; 
    },
    
    stop() {
        if(this.interval) clearInterval(this.interval);
    }
};

const HubEngine = {
    // 1. Add hostName to state
    state: { currentView: 'hub', pendingNames: [], pendingGame: null, hostName: null },
    html5QrcodeScanner: null,
    wakeLock: null,

    async requestWakeLock() {
        if ('wakeLock' in navigator) {
            try { 
                // Only request if we don't already have an active lock
                if (this.wakeLock !== null && !this.wakeLock.released) return;
                this.wakeLock = await navigator.wakeLock.request('screen'); 
                console.log("Wake Lock active");
            } 
            catch (err) { console.warn("Wake Lock Failed:", err); }
        }
    },

   init() {
        // Attempt on load (often blocked, but good to try)
        this.requestWakeLock();
        
        // The foolproof method: bind to any user interaction globally
        const lockHandler = () => {
            this.requestWakeLock();
        };
        
        document.addEventListener('click', lockHandler, { passive: true });
        document.addEventListener('touchstart', lockHandler, { passive: true });

        document.addEventListener('visibilitychange', () => {
            if (document.visibilityState === 'visible') this.requestWakeLock();
        });

        const raw = localStorage.getItem('hub_master_config');
        if (raw) { try { this.state = JSON.parse(raw); } catch (e) {} }
        
        this.setGreeting(); 

        // Auto-fill Room Code if clicked from a shared link
        const urlParams = new URLSearchParams(window.location.search);
        const roomParam = urlParams.get('room');
        if (roomParam) {
            const joinInput = document.getElementById('join-room-code');
            if (joinInput) joinInput.value = roomParam.toUpperCase();
        }

        // --- NEW: Network Session Hydration Hook ---
        if (typeof NetworkEngine !== 'undefined') {
            if (NetworkEngine.restoreSession()) {
                if (NetworkEngine.role === 'host') {
                    NetworkEngine.initHost(NetworkEngine.gameType);
                } else {
                    NetworkEngine.joinAsSpectator(true); // true = force reconnect
                }
            }
        }
        // -------------------------------------------

        this.switchView(this.state.currentView);
    },

    // 2. New function to save the global host
    saveGlobalHost() {
        const name = document.getElementById('global-host-name').value.trim();
        if (!name) return alert("Please enter a host name.");
        
        this.state.hostName = name;
        localStorage.setItem('hub_master_config', JSON.stringify(this.state));
        document.getElementById('modal-host-setup').classList.add('hidden');
        
        if (this.state.pendingGame) {
            this.initLobby(this.state.pendingGame);
        }
    },

    setGreeting() {
        const hr = new Date().getHours();
        let g = "Good Evening";
        if(hr >= 5 && hr < 12) g = "Good Morning";
        else if(hr >= 12 && hr < 17) g = "Good Afternoon";
        
        const greetingEl = document.getElementById('hub-greeting');
        if(greetingEl) greetingEl.innerText = g;
    },

    loadSavedPlayers() { return JSON.parse(localStorage.getItem('hub_saved_players') || '[]'); },
    
    savePlayers(names) {
        let saved = this.loadSavedPlayers();
        let baseNames = names.map(n => n.replace(/\s\d+$/, '')); 
        saved = [...new Set([...baseNames, ...saved])].slice(0, 15); 
        localStorage.setItem('hub_saved_players', JSON.stringify(saved));
    },

    renderSavedPlayers(gamePrefix) {
        const saved = this.loadSavedPlayers();
        const container = document.getElementById(`${gamePrefix}-saved-players-container`);
        const list = document.getElementById(`${gamePrefix}-saved-players-list`);
        if (saved.length > 0 && container && list) {
            container.style.display = 'block';
            list.innerHTML = saved.map(p => `<button class="pill" type="button" onclick="HubEngine.appendPlayer('${gamePrefix}', '${p}')">+ ${p}</button>`).join('');
        }
    },

    appendPlayer(gamePrefix, name) {
        const input = document.getElementById(`${gamePrefix}-players-input`);
        if(input) input.value = input.value ? input.value + ' ' + name : name;
    },

    titleCase(str) { return str.charAt(0).toUpperCase() + str.slice(1).toLowerCase(); },

    toggleMenu() {
        document.getElementById('ladder-menu').classList.toggle('open');
        document.getElementById('menu-overlay').classList.toggle('open');
    },

initLobby(gameId) {
        // --- NEW: Intercept for Global Host Identity ---
        if (!this.state.hostName && typeof NetworkEngine !== 'undefined' && NetworkEngine.role === 'host') {
            this.state.pendingGame = gameId;
            document.getElementById('modal-host-setup').classList.remove('hidden');
            return;
        }
        // -----------------------------------------------

        // ... rest of your existing initLobby code ...
        // FIX: Deep wipe engine state AND reset visual DOM panels to guarantee clean start
        if (gameId === 'kachuful' && typeof KFEngine !== 'undefined') {
            KFEngine.state = { players: [], names: [], max: 5, round: 1, bids: [], misses: [], phase: 'bid', history: [], suspendedState: null, editingOldRecordData: null };
            localStorage.removeItem('kf_host_state');
            document.getElementById('kf-active-panel').style.display = 'none';
            document.getElementById('kf-setup-panel').style.display = 'block';
            document.getElementById('kf-players-input').value = ''; // Optional: clears old input
        }
        if (gameId === 'kalitiri' && typeof KTEngine !== 'undefined') {
            KTEngine.state = { players: [], trump: [], opp: [], score: 250, win: "", history: [] };
            localStorage.removeItem('kt_host_state');
            document.getElementById('kt-active-panel').style.display = 'none';
            document.getElementById('kt-setup-panel').style.display = 'block';
            document.getElementById('kt-players-input').value = ''; // Optional: clears old input
        }
        
        this.state.pendingGame = gameId;
        this.switchView('lobby');
        if (typeof NetworkEngine !== 'undefined') NetworkEngine.initHost(gameId); 
        
        const titleEl = document.getElementById('lobby-title');
        const displayEl = document.getElementById('lobby-room-display');
        
        if (titleEl) titleEl.innerText = gameId.toUpperCase() + " LOBBY";
        if (displayEl && typeof NetworkEngine !== 'undefined') displayEl.innerText = NetworkEngine.roomCode;
        
        const qrContainer = document.getElementById('lobby-qr');
        if (qrContainer) {
            qrContainer.innerHTML = '';
            if (typeof QRCode !== 'undefined' && typeof NetworkEngine !== 'undefined') {
                new QRCode(qrContainer, {
                    text: window.location.origin + window.location.pathname + '?room=' + NetworkEngine.roomCode,
                    width: 160, height: 160, colorDark: "#000000", colorLight: "#ffffff"
                });
            } else {
                qrContainer.innerHTML = '<span style="color:var(--text-muted); font-size:0.8rem;">QR Library blocked or missing</span>';
            }
        }
    },

 continueToSetup() { 
        this.switchView(this.state.pendingGame); 

        // If transitioning to Mafia from the QR Lobby, auto-start the host engine silently
        if (this.state.pendingGame === 'mafia' && typeof MafiaEngine !== 'undefined') {
            MafiaEngine.gameState.hostName = this.state.hostName;
            MafiaEngine.isHost = true;
            // Sync Mafia's room ID with the one just generated by the Hub's NetworkEngine
            MafiaEngine.roomId = NetworkEngine.roomCode; 
            MafiaEngine.connectMQTT('HOST_NEW');
        }
    },

    showViewers() {
        const list = document.getElementById('viewer-list');
        if (typeof NetworkEngine !== 'undefined') {
            if (NetworkEngine.viewers.length === 0) {
                list.innerHTML = `<li style="padding:10px; color:var(--text-muted);">No viewers joined yet.</li>`;
            } else {
                list.innerHTML = NetworkEngine.viewers.map(v => `<li style="padding:10px; border-bottom:1px solid rgba(255,255,255,0.05); font-weight:bold;">${v}</li>`).join('');
            }
        }
        document.getElementById('modal-viewers').classList.remove('hidden');
    },

showRoomPanel() {
        const panel = document.getElementById('room-manage-panel');
        let code = '';
        
        // --- NEW: Smart Room Code Detection ---
        if (this.state.currentView === 'mafia' && typeof MafiaEngine !== 'undefined') code = MafiaEngine.roomId;
        else if (typeof NetworkEngine !== 'undefined') code = NetworkEngine.roomCode;
        
        if (code) {
            document.getElementById('room-code-display').innerText = `ROOM: ${code}`;
            const qrContainer = document.getElementById('room-qr');
            qrContainer.innerHTML = '';
            new QRCode(qrContainer, {
                text: window.location.origin + window.location.pathname + '?room=' + code,
                width: 160, height: 160
            });
        }
        panel.classList.remove('hidden');
    },

// --- NEW: Hybrid Join Logic ---
    async joinAsSpectator() {
        const codeInput = document.getElementById('join-room-code');
        const nameInput = document.getElementById('join-player-name');
        
        const code = codeInput ? codeInput.value.toUpperCase().trim() : '';
        const name = nameInput ? nameInput.value.trim() : '';

        if (!code) return alert("Please enter a room code.");
        if (!name) return alert("Please enter your name.");

        // Probe the room to see what game is running
        const game = await NetworkEngine.probeRoom(code);
        
        if (game === 'mafia') {
            // Redirect to Mafia setup view and pre-fill both code AND name
            this.switchView('mafia');
            const joinCodeInput = document.getElementById('mafia-join-code');
            const joinNameInput = document.getElementById('mafia-player-name');
            
            if(joinCodeInput) joinCodeInput.value = code;
            if(joinNameInput) joinNameInput.value = name;
            return;
        }

        // Default: Fallback to existing Kachuful/Kali Tiri flow
        if (typeof NetworkEngine !== 'undefined') NetworkEngine.joinAsSpectator();
    },    

// ------------------------------

    shareRoomLink() {
        if (typeof NetworkEngine === 'undefined') return;
        const url = window.location.origin + window.location.pathname + '?room=' + NetworkEngine.roomCode;
        if (navigator.share) navigator.share({ title: 'Join My Game', text: 'Click to watch live:', url: url });
        else alert("Copy this link: " + url);
    },

    switchView(viewId) {
        this.state.currentView = viewId;
        localStorage.setItem('hub_master_config', JSON.stringify(this.state));

        document.querySelectorAll('.modal, [id^="modal-"], #room-manage-panel, #mafia-host-settings-modal, #mafia-slide-modal').forEach(m => {
            if(m) m.classList.add('hidden');
        });

        document.querySelectorAll('.view-section').forEach(el => el.classList.remove('active'));
        const activeSection = document.getElementById(`view-${viewId}`);
        if (activeSection) activeSection.classList.add('active');

        if (viewId === 'spectator-wait') {
            GujaratLoader.start();
        } else {
            GujaratLoader.stop();
        }

        const titleEl = document.getElementById('global-title');
        const slotEl = document.getElementById('header-symbol-slot');
        const finishBtn = document.getElementById('btn-finish-game');
        
        if (slotEl) slotEl.innerHTML = ''; 
        if (finishBtn) finishBtn.style.display = 'none';

        if (viewId === 'hub' && titleEl) { titleEl.innerText = "Game Hub"; slotEl.innerHTML = `<div class="symbol-gh">GH</div>`; } 
        else if (viewId === 'spectator-wait' && titleEl) { titleEl.innerText = "Lobby"; slotEl.innerHTML = `<div class="symbol-gh"><i class="fa-solid fa-users"></i></div>`; }
        else if (viewId === 'lobby' && titleEl) { titleEl.innerText = "Lobby"; slotEl.innerHTML = `<div class="symbol-gh"><i class="fa-solid fa-users"></i></div>`; }
        else if (viewId === 'kachuful' && titleEl) { 
            titleEl.innerText = "Kachuful"; 
            slotEl.innerHTML = `<div class="symbol-kf"><span style="color:var(--suit-black);">♠</span><span style="color:var(--suit-red);">♥</span><span style="color:var(--suit-red);">♦</span><span style="color:var(--suit-black);">♣</span></div>`; 
            if(typeof KFEngine !== 'undefined' && typeof NetworkEngine !== 'undefined' && KFEngine.state.players.length > 0 && NetworkEngine.role === 'host') finishBtn.style.display = 'block';
            this.renderSavedPlayers('kf'); 
        } 
        else if (viewId === 'kalitiri' && titleEl) { 
            titleEl.innerText = "Kali Tiri"; 
            slotEl.innerHTML = `<div class="symbol-kt"><div class="card-corner">3<br>♠</div><div style="display:flex; flex-direction:column; align-items:center; justify-content:space-evenly; height:100%; width:100%; margin-top:2px;"><span style="font-size:0.9rem; line-height:1;">♠</span><span style="font-size:0.9rem; line-height:1;">♠</span><span style="font-size:0.9rem; line-height:1; transform:rotate(180deg);">♠</span></div><div class="card-corner" style="bottom: 1px; right: 3px; top: auto; left: auto; transform: rotate(180deg);">3<br>♠</div></div>`; 
            if(typeof KTEngine !== 'undefined' && typeof NetworkEngine !== 'undefined' && KTEngine.state.players.length > 0 && NetworkEngine.role === 'host') finishBtn.style.display = 'block';
            this.renderSavedPlayers('kt'); 
        }
        else if (viewId === 'mafia' && titleEl) { 
            titleEl.innerText = "Mafia"; 
            slotEl.innerHTML = `<div class="symbol-mf"><i class="fa-solid fa-user-secret"></i></div>`; 
        }

        const menu = document.getElementById('ladder-menu');
        if(menu && menu.classList.contains('open')) this.toggleMenu();
        
        if (viewId === 'kachuful' && typeof KFEngine !== 'undefined') KFEngine.loadState();
        if (viewId === 'kalitiri' && typeof KTEngine !== 'undefined') KTEngine.loadState();
    },

    resolveDuplicates(action) {
        document.getElementById('modal-duplicates').classList.add('hidden');
        let finalNames = [];
        if (action === 'keep') {
            let seen = {};
            this.state.pendingNames.forEach(n => {
                if (seen[n]) { seen[n]++; finalNames.push(`${n} ${seen[n]}`); } 
                else { seen[n] = 1; finalNames.push(n); }
            });
        } else { finalNames = [...new Set(this.state.pendingNames)]; }
        
        this.savePlayers(finalNames); 
        
        if (this.state.currentView === 'kachuful' && typeof KFEngine !== 'undefined') KFEngine.startNewGame(finalNames);
        if (this.state.currentView === 'kalitiri' && typeof KTEngine !== 'undefined') KTEngine.startNewGame(finalNames);
    },

    finishGame(isRemoteTrigger = false) {
        if (!isRemoteTrigger && typeof NetworkEngine !== 'undefined' && NetworkEngine.role === 'host') NetworkEngine.broadcastGameOver();

        let sorted = [];
        const resContainer = document.getElementById('endgame-results');
        
        if (this.state.currentView === 'kachuful') {
            document.getElementById('endgame-title').innerText = "KACHUFUL";
            document.getElementById('endgame-logo').className = "symbol-kf";
            document.getElementById('endgame-logo').innerHTML = `<span style="color:var(--suit-black);">♠</span><span style="color:var(--suit-red);">♥</span><span style="color:var(--suit-red);">♦</span><span style="color:var(--suit-black);">♣</span>`;
            if (typeof KFEngine !== 'undefined') sorted = [...KFEngine.state.players].sort((a,b)=>b.score-a.score).map(p => ({ n: p.name, s: p.score }));
            localStorage.removeItem('kf_host_state');
            localStorage.removeItem('kf_spectator_state');
        } else if (this.state.currentView === 'kalitiri') {
            document.getElementById('endgame-title').innerText = "KALI TIRI";
            document.getElementById('endgame-logo').className = "symbol-kt";
            document.getElementById('endgame-logo').innerHTML = `<div class="card-corner">3<br>♠</div><span style="font-size:1.1rem; margin-top:10px;">♠</span>`;
            
            if (typeof KTEngine !== 'undefined') {
                let s = {}; KTEngine.state.players.forEach(p => s[p] = 0);
                KTEngine.state.history.forEach(r => {
                    r.t.forEach(p => { if(r.w==='trump') s[p] += r.s; });
                    r.o.forEach(p => { if(r.w==='opp') s[p] += (r.s * 2); });
                });
                sorted = [...KTEngine.state.players].sort((a,b)=>s[b]-s[a]).map(p => ({ n: p, s: s[p] }));
            }
            localStorage.removeItem('kt_host_state');
            localStorage.removeItem('kt_spectator_state');
        } else if (this.state.currentView === 'mafia') {
            localStorage.removeItem('mafia_host_state');
            localStorage.removeItem('mafia_player_session');
        }
        
        resContainer.innerHTML = sorted.map((p, i) => {
            let medal = i===0?'🥇':(i===1?'🥈':(i===2?'🥉':`#${i+1}`)); 
            return `<div style="display:flex; justify-content:space-between; align-items:center; background:rgba(255,255,255,0.05); padding:8px 12px; border-radius:6px;">
                        <span style="font-weight:800; font-size:1.1rem;">${medal} ${p.n}</span>
                        <span style="font-weight:900; font-size:1.2rem; color:var(--green);">${p.s}</span>
                    </div>`;
        }).join('');

        document.getElementById('modal-share').classList.remove('hidden');
        document.getElementById('btn-finish-game').style.display = 'none';
    },

    restartGame(keepPlayers) {
        document.getElementById('modal-share').classList.add('hidden');
        if (keepPlayers) {
            if (this.state.currentView === 'kachuful') KFEngine.startNewGame(KFEngine.state.names);
            if (this.state.currentView === 'kalitiri') KTEngine.startNewGame(KTEngine.state.players);
        } else {
            // FIX: Purge game engines explicitly so Edit starts completely fresh
            if (this.state.currentView === 'kachuful' && typeof KFEngine !== 'undefined') {
                KFEngine.state = { players: [], names: [], max: 5, round: 1, bids: [], misses: [], phase: 'bid', history: [], suspendedState: null, editingOldRecordData: null };
                KFEngine.sync();
            }
            if (this.state.currentView === 'kalitiri' && typeof KTEngine !== 'undefined') {
                KTEngine.state = { players: [], trump: [], opp: [], score: 250, win: "", history: [] };
                KTEngine.sync();
            }

            document.getElementById('kf-active-panel').style.display = 'none';
            document.getElementById('kf-setup-panel').style.display = 'block';
            document.getElementById('kt-active-panel').style.display = 'none';
            document.getElementById('kt-setup-panel').style.display = 'block';
        }
    },

    shareScreenshot() {
        const snap = document.getElementById('shareable-content');
        document.getElementById('endgame-actions').style.display = 'none';
        
        html2canvas(snap, { backgroundColor: '#0d1117', scale: 2 }).then(canvas => {
            canvas.toBlob(blob => {
                const file = new File([blob], 'Game-Standings.png', { type: 'image/png' });
                if (navigator.canShare && navigator.canShare({ files: [file] })) navigator.share({ title: 'Game Standings', files: [file] });
                else alert("Sharing not supported. Long press image to save.");
            });
            document.getElementById('endgame-actions').style.display = 'flex';
        });
    },

startQRScanner() {
        document.getElementById('qr-reader').style.display = 'block';
        this.html5QrcodeScanner = new Html5QrcodeScanner("qr-reader", { fps: 10, qrbox: {width: 250, height: 250} }, false);
        this.html5QrcodeScanner.render((decodedText) => {
            // Smart Extraction: Pull code whether it's raw text or a full URL
            let code = decodedText;
            if (decodedText.includes('?room=')) {
                try { code = new URL(decodedText).searchParams.get('room'); } catch(e) {}
            }
            document.getElementById('join-room-code').value = code.toUpperCase();
            this.html5QrcodeScanner.clear();
            document.getElementById('qr-reader').style.display = 'none';
            
            // Require name before auto-joining
            const nameInput = document.getElementById('join-player-name');
            if (!nameInput.value.trim()) {
                alert("Room detected! Please enter your name to join.");
                nameInput.focus();
            } else if (typeof NetworkEngine !== 'undefined') {
                NetworkEngine.joinAsSpectator();
            }
        }, (error) => {});
    },

// --- NEW: Safe Network Shutdown ---
    exitToHome() {
        if (typeof NetworkEngine !== 'undefined') NetworkEngine.clearSession();
        if (typeof MafiaEngine !== 'undefined' && MafiaEngine.mqttClient) {
            MafiaEngine.mqttClient.end();
            MafiaEngine.clearSession();
        }
        document.getElementById('modal-share').classList.add('hidden');
        this.switchView('hub');
    },

    wipeAllData() {
        const modal = document.getElementById('modal-wipe-security');
        const num1 = Math.floor(Math.random() * 10) + 1;
        const num2 = Math.floor(Math.random() * 10) + 1;
        const answer = num1 + num2;
        
        document.getElementById('math-challenge').innerText = `${num1} + ${num2} = ?`;
        modal.classList.remove('hidden');

        let slideProgress = 0;
        const thumb = document.getElementById('slide-thumb');

        const moveHandler = (clientX) => {
            slideProgress = Math.min(200, Math.max(0, clientX - 100));
            thumb.style.transform = `translateX(${slideProgress}px)`;
            if (slideProgress >= 180) { 
                const userAnswer = document.getElementById('math-answer').value;
                if (parseInt(userAnswer) === answer) {
                    localStorage.clear();
                    location.reload();
                } else {
                    alert("Incorrect Math Answer!");
                    modal.classList.add('hidden');
                }
                document.onmousemove = document.ontouchmove = null;
            }
        };

        thumb.onmousedown = () => {
            document.onmousemove = (e) => moveHandler(e.clientX);
            document.onmouseup = () => { document.onmousemove = null; thumb.style.transform = 'translateX(0)'; };
        };

        thumb.ontouchstart = () => {
            document.ontouchmove = (e) => moveHandler(e.touches[0].clientX);
            document.ontouchend = () => { document.ontouchmove = null; thumb.style.transform = 'translateX(0)'; };
        };
    }
};

document.addEventListener('DOMContentLoaded', () => HubEngine.init());
