const KFEngine = {
    state: { 
        players: [], names: [], max: 5, round: 1, bids: [], misses: [], 
        phase: 'bid', history: [], suspendedState: null, editingOldRecordData: null 
    },
    suits: [{s:'♠',c:'var(--suit-black)'},{s:'♦',c:'var(--suit-red)'},{s:'♣',c:'var(--suit-black)'},{s:'♥',c:'var(--suit-red)'}],
    isFirstRender: true,

    validateAndSetup() {
        const input = document.getElementById('kf-players-input').value;
        const names = input.split(/[\s,]+/).filter(Boolean).map(HubEngine.titleCase);
        
        if(names.length < 2) return alert("Enter at least 2 players");

        let counts = {}; let duplicates = [];
        names.forEach(n => { counts[n] = (counts[n] || 0) + 1; if (counts[n] === 2) duplicates.push(n); });

        if (duplicates.length > 0) {
            HubEngine.state.pendingNames = names;
            document.getElementById('dup-msg').innerText = `Duplicates found: ${duplicates.join(', ')}`;
            document.getElementById('modal-duplicates').classList.remove('hidden');
        } else {
            HubEngine.savePlayers(names);
            this.startNewGame(names);
        }
    },

    startNewGame(names) {
        this.state.names = names;
        this.state.max = parseInt(document.getElementById('setup-maxcards').value) || 5;
        this.state.players = this.state.names.map(n => ({name: n, score: 0}));
        this.state.bids = new Array(this.state.names.length).fill(0);
        this.state.misses = new Array(this.state.names.length).fill(false);
        this.state.round = 1;
        this.state.phase = 'bid';
        this.state.history = [];
        this.state.suspendedState = null;
        this.state.editingOldRecordData = null;
        
        document.getElementById('btn-finish-game').style.display = 'block';
        this.isFirstRender = true;
        this.renderBoard();
        this.sync();
    },

    calcCards() {
        if (this.state.max <= 1) return 1;
        const cycle = (this.state.max - 1) * 2;
        const pos = (this.state.round - 1) % cycle;
        return pos < this.state.max ? pos + 1 : cycle - pos + 1;
    },

    renderBoard() {
        document.getElementById('kf-setup-panel').style.display = 'none';
        document.getElementById('kf-active-panel').style.display = 'block';

        document.documentElement.style.setProperty('--p-count', Math.max(5, this.state.players.length));

        const cards = this.calcCards();
        const trump = this.suits[(this.state.round - 1) % 4];

        document.getElementById('kf-card-symbol').innerText = trump.s;
        document.getElementById('kf-card-symbol').style.color = trump.c;
        document.getElementById('kf-card-count').innerText = `${cards} Cards`;
        
        if (this.state.suspendedState) {
            document.getElementById('kf-round-label').innerHTML = `<span style="color:var(--red);">EDITING R${this.state.round}</span>`;
        } else {
            document.getElementById('kf-round-label').innerText = `R${this.state.round}`;
        }

        const btnAction = document.getElementById('kf-btn-action');
        const warn = document.getElementById('kf-warning-msg');
        
        let currTot = this.state.bids.slice(0, -1).reduce((a,b)=>a+b, 0); 
        let restricted = cards - currTot; 
        let lastIdx = this.state.players.length - 1;

        if (this.state.phase === 'bid') {
            btnAction.className = "action-icon-btn btn-lock";
            btnAction.innerHTML = '<i class="fa-solid fa-lock"></i>';
            
            if (restricted >= 0 && restricted <= cards) { 
                warn.innerText = `⚠️ ${this.state.players[lastIdx].name} CANNOT bid ${restricted}`; 
                warn.classList.remove('hidden');
                if (typeof NetworkEngine !== 'undefined' && NetworkEngine.role === 'host') btnAction.disabled = (this.state.bids[lastIdx] === restricted);
            } else {
                warn.classList.add('hidden');
                if (typeof NetworkEngine !== 'undefined' && NetworkEngine.role === 'host') btnAction.disabled = false;
            }
        } else {
            btnAction.className = "action-icon-btn btn-record";
            btnAction.innerHTML = '<i class="fa-solid fa-check"></i>';
            warn.classList.add('hidden');
            if (typeof NetworkEngine !== 'undefined' && NetworkEngine.role === 'host') btnAction.disabled = false;
        }

        const rowsContainer = document.getElementById('kf-player-rows');
        
        if (this.isFirstRender || rowsContainer.children.length === 0) {
            rowsContainer.innerHTML = '';
            this.state.players.forEach((p, i) => {
                let html = `<div class="kf-player-row"><div class="kf-name" id="kf-name-${i}">${p.name}</div>`;
                html += `<div class="stepper host-only">
                            <button class="btn-minus" onclick="KFEngine.adjBid(${i}, -1)">−</button>
                            <span id="kf-bid-${i}">${this.state.bids[i]}</span>
                            <button class="btn-plus" onclick="KFEngine.adjBid(${i}, 1)">+</button>
                         </div>`;
                html += `<button id="kf-status-${i}" class="status-pill host-only" style="display:none;" onclick="KFEngine.togMiss(${i})"></button>`;
                html += `<div class="spectator-only" style="display:none;" id="kf-spec-${i}"></div></div>`;
                rowsContainer.innerHTML += html;
            });
            this.isFirstRender = false;
        }

        this.state.players.forEach((p, i) => {
            const bidSpan = document.getElementById(`kf-bid-${i}`);
            const statBtn = document.getElementById(`kf-status-${i}`);
            const specSpan = document.getElementById(`kf-spec-${i}`);
            const nameEl = document.getElementById(`kf-name-${i}`); 

            if(bidSpan && bidSpan.innerText !== this.state.bids[i].toString()) {
                bidSpan.innerText = this.state.bids[i];
            }

            if(statBtn && typeof NetworkEngine !== 'undefined' && NetworkEngine.role === 'host') {
                if (this.state.phase === 'bid') {
                    nameEl.style.display = 'block'; 
                    statBtn.style.display = 'none';
                    bidSpan.parentElement.style.display = 'flex';
                } else {
                    nameEl.style.display = 'none'; 
                    bidSpan.parentElement.style.display = 'none';
                    
                    statBtn.style.display = 'flex';
                    statBtn.style.width = '100%';
                    statBtn.style.justifyContent = 'space-between';
                    statBtn.style.alignItems = 'center';
                    statBtn.style.padding = '12px 15px'; 
                    statBtn.style.fontSize = '1.1rem';
                    
                    statBtn.className = `status-pill ${this.state.misses[i] ? 'pill-miss' : 'pill-made'} host-only`;
                    statBtn.innerHTML = `<span style="font-weight:900;">${p.name}</span> <span>${this.state.misses[i] ? '<i class="fa-solid fa-xmark"></i> Miss' : '<i class="fa-solid fa-check"></i> Made'} ${this.state.bids[i]}</span>`;
                }
            }

            if(specSpan && typeof NetworkEngine !== 'undefined' && NetworkEngine.role === 'spectator') {
                nameEl.style.display = 'block'; 
                specSpan.style.display = 'block';
                specSpan.style.fontWeight = '900';
                specSpan.style.fontSize = '1.2rem';
                
                specSpan.innerText = this.state.bids[i];
                specSpan.style.color = '#fff';

                if (this.state.phase === 'score') {
                    // FIX: Show red cross if the host marked them as missed, otherwise green lock
                    if (this.state.misses[i]) {
                        specSpan.innerHTML = `${this.state.bids[i]} <span style="font-size:0.9rem; color:var(--red); margin-left:8px;"><i class="fa-solid fa-xmark"></i></span>`;
                    } else {
                        specSpan.innerHTML = `${this.state.bids[i]} <span style="font-size:0.9rem; color:var(--green); margin-left:8px;"><i class="fa-solid fa-lock"></i></span>`;
                    }
                }
            }
        });

        document.getElementById('kf-leaderboard').innerHTML = [...this.state.players].sort((a,b)=>b.score-a.score).map((p,i) => 
            `<div style="background:rgba(0,0,0,0.5); padding:4px 10px; border-radius:15px; font-size:0.8rem; font-weight:700;"><span style="color:var(--gold);">#${i+1}</span> ${p.name}: ${p.score}</div>`
        ).join('');

        this.renderHistory();
    },

    renderHistory() {
        document.getElementById('kf-history-head').innerHTML = `<tr><th>R</th>${this.state.names.map(n=>`<th>${n.substring(0,3)}</th>`).join('')}<th>Act</th></tr>`;
        document.getElementById('kf-history-body').innerHTML = [...this.state.history].reverse().map((g, revIdx) => {
            const actualIdx = this.state.history.length - 1 - revIdx;
            let tr = `<tr style="${g.status === 'deleted' ? 'text-decoration: line-through; opacity: 0.4;' : ''}"><td>${g.round}</td>`;
            this.state.names.forEach(n => { 
                let d = g.data[n]; 
                tr += d ? `<td class="${d.made?'score-made':'score-miss'}">${d.b}${d.made?'✓':'✗'} <br><span style="font-size:0.6rem; color:gray;">+${d.pts}</span></td>` : `<td>-</td>`; 
            });
            
            tr += `<td class="host-only">${g.status === 'active' && !this.state.suspendedState ? `
                <div style="display:flex; gap:8px; justify-content:center;">
                    <button style="color:var(--blue); font-size:1.1rem; padding:4px;" onclick="KFEngine.editRound(${actualIdx})" title="Edit"><i class="fa-solid fa-pen-to-square"></i></button>
                    <button style="color:var(--red); font-size:1.1rem; padding:4px;" onclick="KFEngine.voidRound(${actualIdx})" title="Delete"><i class="fa-solid fa-trash-can"></i></button>
                </div>` : '-'}</td></tr>`;
            return tr;
        }).join('');
    },

    adjBid(i, dir) {
        if(this.state.phase !== 'bid') return;
        this.state.bids[i] = Math.max(0, Math.min(this.calcCards(), this.state.bids[i] + dir));
        this.renderBoard();
        this.sync();
    },

    togMiss(i) {
        if(this.state.phase !== 'score') return;
        this.state.misses[i] = !this.state.misses[i];
        this.renderBoard();
        this.sync();
    },

    handleAction() {
        if (this.state.phase === 'bid') {
            this.state.phase = 'score';
            
            if (this.state.editingOldRecordData) {
                this.state.players.forEach((p, i) => {
                    const oldMiss = this.state.editingOldRecordData[p.name] ? !this.state.editingOldRecordData[p.name].made : false;
                    this.state.misses[i] = oldMiss;
                });
                this.state.editingOldRecordData = null; 
            }
        } else {
            let rec = { round: this.state.round, status: 'active', data: {} };
            this.state.players.forEach((p, i) => {
                const b = this.state.bids[i];
                const made = !this.state.misses[i];
                const pts = made ? (b === 0 ? 10 : b * 11) : 0;
                p.score += pts;
                rec.data[p.name] = { b, made, pts };
            });
            
            this.state.history.push(rec);
            
            if (this.state.suspendedState) {
                const s = this.state.suspendedState;
                this.state.round = s.round;
                this.state.phase = s.phase;
                this.state.bids = [...s.bids];
                this.state.misses = [...s.misses];
                
                let suspendedPlayers = JSON.parse(JSON.stringify(s.players));
                suspendedPlayers.forEach(sp => {
                    let currentP = this.state.players.find(x => x.name === sp.name);
                    if (currentP) sp.score = currentP.score; 
                });
                this.state.players = suspendedPlayers;
                this.state.suspendedState = null;
            } else {
                this.state.players.push(this.state.players.shift());
                this.state.round++;
                this.state.phase = 'bid';
                this.state.bids.fill(0);
                this.state.misses.fill(false);
            }
            this.isFirstRender = true;
        }
        this.renderBoard();
        this.sync();
    },

    editRound(idx) {
        if(this.state.suspendedState) return alert("You are already editing a round.");
        if(!confirm("Edit this round? This will replay its bids and misses, then return you to your current round.")) return;
        
        const rec = this.state.history[idx];
        
        this.state.suspendedState = {
            round: this.state.round,
            phase: this.state.phase,
            bids: [...this.state.bids],
            misses: [...this.state.misses],
            players: JSON.parse(JSON.stringify(this.state.players))
        };
        
        this.state.names.forEach(n => {
            let p = this.state.players.find(x => x.name === n);
            if (p && rec.data[n]) p.score -= rec.data[n].pts;
        });
        rec.status = 'deleted';
        
        this.state.round = rec.round;
        this.state.phase = 'bid';
        
        let shiftedPlayers = JSON.parse(JSON.stringify(this.state.players));
        shiftedPlayers.sort((a, b) => this.state.names.indexOf(a.name) - this.state.names.indexOf(b.name));
        const shifts = (rec.round - 1) % this.state.names.length;
        for(let i=0; i < shifts; i++) {
            shiftedPlayers.push(shiftedPlayers.shift());
        }
        this.state.players = shiftedPlayers;
        
        this.state.bids = this.state.players.map(p => rec.data[p.name] ? rec.data[p.name].b : 0);
        this.state.misses = new Array(this.state.players.length).fill(false);
        this.state.editingOldRecordData = rec.data;
        
        this.isFirstRender = true;
        this.renderBoard();
        this.sync();
        window.scrollTo({ top: 0, behavior: 'smooth' });
    },

    voidRound(idx) {
        if(confirm("Void this round completely?")) {
            let rec = this.state.history[idx];
            this.state.names.forEach(n => {
                let p = this.state.players.find(x => x.name === n);
                if (p && rec.data[n]) p.score -= rec.data[n].pts;
            });
            rec.status = 'deleted';
            this.renderBoard();
            this.sync();
        }
    },

    sync() {
        this.saveState();
        if (typeof NetworkEngine !== 'undefined') NetworkEngine.broadcastState(this.state);
    },

receiveSurgicalUpdate(newState) {
        // --- NEW: Force re-render if host enters/exits editing mode ---
        const wasSuspended = !!this.state.suspendedState;
        const isSuspended = !!newState.suspendedState;
        
        if(this.state.round !== newState.round || this.state.phase !== newState.phase || wasSuspended !== isSuspended) {
            this.isFirstRender = true;
        }
        // --------------------------------------------------------------

this.state = newState;
        this.renderBoard();
        
        if(this.state.players.length > 0 && typeof NetworkEngine !== 'undefined' && NetworkEngine.role === 'host') {
            document.getElementById('btn-finish-game').style.display = 'block';
        }
        
        localStorage.setItem('kf_spectator_state', JSON.stringify(this.state));
    },

    loadState() {
        const raw = localStorage.getItem((typeof NetworkEngine !== 'undefined' && NetworkEngine.role === 'host') ? 'kf_host_state' : 'kf_spectator_state');
        if (raw) {
            try {
                this.state = JSON.parse(raw);
                if(this.state.players.length > 0) {
                    this.isFirstRender = true;
                    this.renderBoard();
                    document.getElementById('header-room-code-val').innerText = (typeof NetworkEngine !== 'undefined') ? NetworkEngine.roomCode : '';
                    document.getElementById('header-room-code').style.display = 'block';
                    
                    if(typeof NetworkEngine !== 'undefined' && NetworkEngine.role === 'host') {
                        document.getElementById('btn-finish-game').style.display = 'block';
                    }
                }
            } catch (e) {}
        }
    },

    saveState() {
        if(typeof NetworkEngine !== 'undefined' && NetworkEngine.role === 'host') localStorage.setItem('kf_host_state', JSON.stringify(this.state));
    }
};