const KFEngine = {
    state: { 
        players: [], names: [], max: 5, round: 1, bids: [], misses: [], 
        phase: 'bid', history: [], suspendedState: null, editingOldRecordData: null 
    },
    suits: [{s:'♠',c:'var(--suit-black)'},{s:'♦',c:'var(--suit-red)'},{s:'♣',c:'var(--suit-black)'},{s:'♥',c:'var(--suit-red)'}],
    isFirstRender: true,
    lastToggledMiss: null, 
    pendingAdminAction: null,

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
        this.lastToggledMiss = null;
        
        document.getElementById('btn-finish-game').style.display = 'block';
        this.isFirstRender = true;
        this.triggerSplash(); 
        this.renderBoard();
        this.sync();
    },

    triggerSplash() {
        setTimeout(() => {
            const trumpCardEl = document.getElementById('kf-trump-card');
            if (trumpCardEl) {
                trumpCardEl.style.animation = 'none'; 
                trumpCardEl.classList.remove('splash-active');
                void trumpCardEl.offsetWidth; 
                trumpCardEl.style.animation = ''; 
                trumpCardEl.classList.add('splash-active');
            }
        }, 150); 
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

        // Keyboard Trap Shield: Auto-scroll when typing on mobile
        const inputEl = document.getElementById('kf-players-input');
        if (inputEl && !inputEl.hasAttribute('data-scroll-bound')) {
            inputEl.addEventListener('focus', (e) => { setTimeout(() => e.target.scrollIntoView({behavior: 'smooth', block: 'center'}), 300); });
            inputEl.setAttribute('data-scroll-bound', 'true');
        }

        const trumpCardEl = document.getElementById('kf-trump-card');
        const playersColEl = document.getElementById('kf-player-rows');
        if (trumpCardEl && playersColEl && trumpCardEl.parentElement !== playersColEl) {
            playersColEl.appendChild(trumpCardEl);
        }

        const cards = this.calcCards();
        const trump = this.suits[(this.state.round - 1) % 4];
        const symbolEl = document.getElementById('kf-card-symbol');
        
        if (symbolEl && symbolEl.innerText !== trump.s) {
            symbolEl.innerText = trump.s;
            symbolEl.style.color = trump.c;
        }

        document.getElementById('kf-card-count').innerText = `${cards}`; 
        
        if (this.state.suspendedState) {
            document.getElementById('kf-round-label').innerHTML = `<span style="color:var(--red);">EDITING R${this.state.round}</span>`;
        } else {
            document.getElementById('kf-round-label').innerText = `R${this.state.round}`;
        }

        const btnAction = document.getElementById('kf-btn-action');
        const warn = document.getElementById('kf-warning-msg');
        let currTot = this.state.bids.reduce((a,b)=>a+b, 0); 
        let restricted = cards - this.state.bids.slice(0, -1).reduce((a,b)=>a+b, 0); 
        let lastIdx = this.state.players.length - 1;

        let totalBidsContainer = document.getElementById('kf-total-bids-container');
        if (!totalBidsContainer) {
            totalBidsContainer = document.createElement('div');
            totalBidsContainer.id = 'kf-total-bids-container';
            totalBidsContainer.className = 'total-bids-container';
            totalBidsContainer.innerHTML = `<div class="total-bids-text">Total Bids</div><div class="total-bids-numbers" id="kf-total-bids-val">0</div>`;
            btnAction.parentElement.insertAdjacentElement('beforebegin', totalBidsContainer);
        }
        
        document.getElementById('kf-total-bids-val').innerText = `${currTot}`;
        
        if (this.state.phase === 'bid') {
            if (currTot >= cards) totalBidsContainer.classList.add('danger-zone');
            else totalBidsContainer.classList.remove('danger-zone');
        } else {
            totalBidsContainer.classList.remove('danger-zone');
        }

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

        let minScore = 0; let maxScore = 0;
        if (this.state.players.length > 0) {
            const scores = this.state.players.map(p => p.score);
            minScore = Math.min(...scores);
            maxScore = Math.max(...scores);
        }

        const rowsContainer = document.getElementById('kf-player-rows');
        
        if (this.isFirstRender || rowsContainer.children.length === 0 || (trumpCardEl && rowsContainer.children.length === 1)) {
            Array.from(rowsContainer.children).forEach(child => {
                if(child.id !== 'kf-trump-card') child.remove();
            });

            this.state.players.forEach((p, i) => {
                let html = `<div class="kf-player-row" id="kf-row-${i}">
                                <div class="kf-player-info-group">
                                    <div class="kf-name" id="kf-name-${i}">${p.name}</div>
                                    <div class="kf-progress-track"><div id="kf-prog-${i}" class="kf-progress-fill" style="width:33%;"></div></div>
                                </div>
                                
                                <div class="stepper host-only" id="kf-stepper-${i}">
                                    <button class="btn-minus" onclick="KFEngine.adjBid(${i}, -1)">−</button>
                                    <div style="display:flex; align-items:center; min-width:35px; justify-content:flex-start;">
                                        <span class="kf-bid-num" id="kf-bid-${i}">${this.state.bids[i]}</span>
                                        <span class="arrow-slot" id="kf-arrow-${i}"></span>
                                    </div>
                                    <button class="btn-plus" onclick="KFEngine.adjBid(${i}, 1)">+</button>
                                </div>
                                <button id="kf-status-${i}" class="status-pill host-only" style="display:none;"></button>
                                
                                <div class="spectator-only" style="display:none;" id="kf-spec-wrapper-${i}">
                                    <div style="display:none; align-items:center;" id="kf-spec-bid-box-${i}">
                                        <span id="kf-spec-${i}" style="font-weight:900; font-size:1.5rem; color:#fff;">${this.state.bids[i]}</span>
                                        <span class="arrow-slot" id="kf-spec-arrow-${i}"></span>
                                    </div>
                                    <div style="display:none;" id="kf-spec-stamp-${i}"></div>
                                </div>
                            </div>`;
                
                if (trumpCardEl && trumpCardEl.parentElement === rowsContainer) trumpCardEl.insertAdjacentHTML('beforebegin', html);
                else rowsContainer.innerHTML += html;
            });
            this.isFirstRender = false;
        }

        this.state.players.forEach((p, i) => {
            const rowEl = document.getElementById(`kf-row-${i}`);
            const nameEl = document.getElementById(`kf-name-${i}`);
            const bidSpan = document.getElementById(`kf-bid-${i}`);
            const specBidSpan = document.getElementById(`kf-spec-${i}`);
            const statBtn = document.getElementById(`kf-status-${i}`);
            const stepper = document.getElementById(`kf-stepper-${i}`);
            const progFill = document.getElementById(`kf-prog-${i}`);
            const specWrapper = document.getElementById(`kf-spec-wrapper-${i}`);
            const specBidBox = document.getElementById(`kf-spec-bid-box-${i}`);
            const specStamp = document.getElementById(`kf-spec-stamp-${i}`);
            
            if (progFill) {
                let pWidth = 33; 
                if (maxScore > minScore) pWidth = 33 + ((p.score - minScore) / (maxScore - minScore)) * 67;
                progFill.style.width = `${Math.min(100, pWidth)}%`;
            }

            if(bidSpan && bidSpan.innerText !== this.state.bids[i].toString()) bidSpan.innerText = this.state.bids[i];
            if(specBidSpan && specBidSpan.innerText !== this.state.bids[i].toString()) specBidSpan.innerText = this.state.bids[i];

            if (this.state.phase === 'bid') {
                if (statBtn) statBtn.style.display = 'none';
                if (stepper) stepper.style.display = 'flex';
                if (rowEl) rowEl.onclick = null;
                if (nameEl) { nameEl.onclick = null; nameEl.classList.remove('clickable-name'); }
                
                if (specWrapper && typeof NetworkEngine !== 'undefined' && NetworkEngine.role === 'spectator') {
                    specWrapper.style.display = 'flex';
                    specWrapper.className = 'spectator-only';
                    if (specBidBox) specBidBox.style.display = 'flex';
                    if (specStamp) specStamp.style.display = 'none';
                }
            } else {
                if (stepper) stepper.style.display = 'none';
                if (statBtn && typeof NetworkEngine !== 'undefined' && NetworkEngine.role === 'host') {
                    statBtn.style.display = 'inline-block';
                    statBtn.className = `status-pill host-only ${this.state.misses[i] ? 'pill-miss' : 'pill-made'}`;
                    if (this.lastToggledMiss === i) {
                        statBtn.classList.remove('animate-stamp'); void statBtn.offsetWidth; statBtn.classList.add('animate-stamp');
                    }
                    statBtn.innerHTML = `<span>${this.state.misses[i] ? 'MISS' : 'MADE'} ${this.state.bids[i]}</span>`;

                    if (rowEl) rowEl.onclick = null;
                    if (nameEl) {
                        nameEl.onclick = () => KFEngine.togMiss(i);
                        nameEl.classList.add('clickable-name'); 
                    }
                    statBtn.onclick = (e) => { e.stopPropagation(); KFEngine.togMiss(i); };
                }
                
                if (specWrapper && typeof NetworkEngine !== 'undefined' && NetworkEngine.role === 'spectator') {
                    specWrapper.style.display = 'inline-block';
                    if (specBidBox) specBidBox.style.display = 'none';
                    if (specStamp) {
                        specStamp.style.display = 'inline-block';
                        specStamp.className = `status-pill ${this.state.misses[i] ? 'pill-miss' : 'pill-made'}`;
                        if (this.lastToggledMiss === i) {
                            specStamp.classList.remove('animate-stamp'); void specStamp.offsetWidth; specStamp.classList.add('animate-stamp');
                        }
                        specStamp.innerHTML = `<span>${this.state.misses[i] ? 'MISS' : 'MADE'} ${this.state.bids[i]}</span>`;
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
                    <button style="color:var(--blue); font-size:1.1rem; padding:4px;" onclick="KFEngine.requestSlideAction({type:'EDIT_ROUND', id:${actualIdx}})" title="Edit"><i class="fa-solid fa-pen-to-square"></i></button>
                    <button style="color:var(--red); font-size:1.1rem; padding:4px;" onclick="KFEngine.requestSlideAction({type:'VOID_ROUND', id:${actualIdx}})" title="Delete"><i class="fa-solid fa-trash-can"></i></button>
                </div>` : '-'}</td></tr>`;
            return tr;
        }).join('');
    },

    triggerTextPing(idx, dir) {
        const nameEl = document.getElementById(`kf-name-${idx}`);
        const hostBid = document.getElementById(`kf-bid-${idx}`);
        const specBid = document.getElementById(`kf-spec-${idx}`);
        const hostArrow = document.getElementById(`kf-arrow-${idx}`);
        const specArrow = document.getElementById(`kf-spec-arrow-${idx}`);

        [nameEl, hostBid, specBid].forEach(el => {
            if (el) { el.classList.remove('text-ping'); void el.offsetWidth; el.classList.add('text-ping'); }
        });

        if (dir !== 0) {
            const isUp = dir > 0;
            const arrowIcon = isUp ? '<i class="fa-solid fa-caret-up"></i>' : '<i class="fa-solid fa-caret-down"></i>';
            const arrowClass = `arrow-slot active ${isUp ? 'up' : 'down'}`;

            [hostArrow, specArrow].forEach(el => {
                if (el) { el.innerHTML = arrowIcon; el.className = arrowClass; void el.offsetWidth; }
            });
        }
    },

    adjBid(i, dir) {
        if(this.state.phase !== 'bid') return;
        const maxLimit = this.calcCards();
        const newBid = Math.max(0, Math.min(maxLimit, this.state.bids[i] + dir));
        
        if (newBid !== this.state.bids[i]) {
            const actualDir = newBid - this.state.bids[i];
            this.state.bids[i] = newBid;
            this.triggerTextPing(i, actualDir);

            const counterContainer = document.getElementById('kf-total-bids-container');
            if (counterContainer) {
                counterContainer.classList.remove('counter-pop');
                void counterContainer.offsetWidth;
                counterContainer.classList.add('counter-pop');
            }
        }
        this.renderBoard(); this.sync();
    },

    togMiss(i) {
        if(this.state.phase !== 'score') return;
        this.state.misses[i] = !this.state.misses[i];
        this.lastToggledMiss = i; 
        this.renderBoard(); this.sync();
        this.lastToggledMiss = null; 
    },

    handleAction() {
        if (this.state.phase === 'bid') {
            this.state.phase = 'score';
            const activePanel = document.getElementById('kf-active-panel');
            activePanel.classList.remove('phase-locked'); void activePanel.offsetWidth; activePanel.classList.add('phase-locked');
            setTimeout(() => activePanel.classList.remove('phase-locked'), 400);

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

                if (pts > 0) {
                    const nameEl = document.getElementById(`kf-name-${i}`);
                    if (nameEl) {
                        const rect = nameEl.getBoundingClientRect();
                        const particle = document.createElement('div');
                        particle.className = 'floating-points'; particle.innerText = `+${pts}`;
                        document.body.appendChild(particle);
                        particle.style.left = `${rect.left + (rect.width / 2) - 15}px`;
                        particle.style.top = `${rect.top - 10}px`;
                        setTimeout(() => particle.remove(), 1600); 
                    }
                }
            });
            
            this.state.history.push(rec);
            
            if (this.state.suspendedState) {
                const s = this.state.suspendedState;
                this.state.round = s.round; this.state.phase = s.phase;
                this.state.bids = [...s.bids]; this.state.misses = [...s.misses];
                
                let suspendedPlayers = JSON.parse(JSON.stringify(s.players));
                suspendedPlayers.forEach(sp => {
                    let currentP = this.state.players.find(x => x.name === sp.name);
                    if (currentP) sp.score = currentP.score; 
                });
                this.state.players = suspendedPlayers;
                this.state.suspendedState = null;
            } else {
                this.state.players.push(this.state.players.shift());
                this.state.round++; this.state.phase = 'bid';
                this.state.bids.fill(0); this.state.misses.fill(false);
                this.triggerSplash();
            }
            this.isFirstRender = true;
        }
        this.renderBoard(); this.sync();
    },

    // SLIDER ENGINE FOR DESTRUCTIVE ACTIONS
    requestSlideAction(actionObj) {
        this.pendingAdminAction = actionObj;
        let title = "Confirm Action";
        if (actionObj.type === 'VOID_ROUND') title = "Void Round (Delete)";
        else if (actionObj.type === 'EDIT_ROUND') title = "Edit Round Data";
        else if (actionObj.type === 'DESTROY_SERVER') title = "Erase Active Game";

        document.getElementById('kf-slide-modal-title').innerText = title;
        document.getElementById('kf-slide-modal').classList.remove('hidden');

        let slideIsDragging = false; let slideStartX = 0;
        const thumb = document.getElementById('kf-slide-thumb');
        const track = document.getElementById('kf-slide-track');
        const prog = document.getElementById('kf-slide-progress');
        
        const endDrag = () => {
            if (!slideIsDragging) return;
            slideIsDragging = false;
            thumb.style.transition = 'transform 0.3s ease'; prog.style.transition = 'width 0.3s ease';
            thumb.style.transform = `translateX(0px)`; prog.style.width = `0px`;
        };

        const execute = () => {
            endDrag();
            this.cancelSlide();
            const act = this.pendingAdminAction;
            if (act.type === 'VOID_ROUND') this.voidRound(act.id);
            else if (act.type === 'EDIT_ROUND') this.editRound(act.id);
            else if (act.type === 'DESTROY_SERVER') {
                if(typeof NetworkEngine !== 'undefined') NetworkEngine.broadcastGameOver();
                localStorage.removeItem('kf_host_state'); localStorage.removeItem('kf_spectator_state');
                HubEngine.switchView('hub');
            }
        };

        const startDrag = (e) => {
            slideIsDragging = true;
            slideStartX = e.type.includes('mouse') ? e.clientX : e.touches[0].clientX;
            thumb.style.transition = 'none'; prog.style.transition = 'none';
        };

        const drag = (e) => {
            if (!slideIsDragging) return;
            const currentX = e.type.includes('mouse') ? e.clientX : e.touches[0].clientX;
            let deltaX = currentX - slideStartX;
            const maxDelta = track.offsetWidth - thumb.offsetWidth - 8;
            if (deltaX < 0) deltaX = 0; 
            if (deltaX > maxDelta) deltaX = maxDelta;
            
            thumb.style.transform = `translateX(${deltaX}px)`; prog.style.width = `${deltaX + 20}px`;

            if (deltaX > maxDelta * 0.95) { execute(); }
        };

        thumb.onmousedown = startDrag; thumb.ontouchstart = startDrag;
        document.onmousemove = drag; document.ontouchmove = drag;
        document.onmouseup = endDrag; document.ontouchend = endDrag;
    },

    cancelSlide() {
        document.getElementById('kf-slide-modal').classList.add('hidden');
        document.onmousemove = null; document.ontouchmove = null;
        document.onmouseup = null; document.ontouchend = null;
        this.pendingAdminAction = null;
    },

    editRound(idx) {
        if(this.state.suspendedState) return alert("You are already editing a round.");
        const rec = this.state.history[idx];
        
        this.state.suspendedState = {
            round: this.state.round, phase: this.state.phase, bids: [...this.state.bids], misses: [...this.state.misses], players: JSON.parse(JSON.stringify(this.state.players))
        };
        
        this.state.names.forEach(n => {
            let p = this.state.players.find(x => x.name === n);
            if (p && rec.data[n]) p.score -= rec.data[n].pts;
        });
        rec.status = 'deleted';
        this.state.round = rec.round; this.state.phase = 'bid';
        
        let shiftedPlayers = JSON.parse(JSON.stringify(this.state.players));
        shiftedPlayers.sort((a, b) => this.state.names.indexOf(a.name) - this.state.names.indexOf(b.name));
        const shifts = (rec.round - 1) % this.state.names.length;
        for(let i=0; i < shifts; i++) shiftedPlayers.push(shiftedPlayers.shift());
        
        this.state.players = shiftedPlayers;
        this.state.bids = this.state.players.map(p => rec.data[p.name] ? rec.data[p.name].b : 0);
        this.state.misses = new Array(this.state.players.length).fill(false);
        this.state.editingOldRecordData = rec.data;
        
        this.isFirstRender = true; this.triggerSplash(); this.renderBoard(); this.sync(); window.scrollTo({ top: 0, behavior: 'smooth' });
    },

    voidRound(idx) {
        let rec = this.state.history[idx];
        this.state.names.forEach(n => {
            let p = this.state.players.find(x => x.name === n);
            if (p && rec.data[n]) p.score -= rec.data[n].pts;
        });
        rec.status = 'deleted';
        this.renderBoard(); this.sync();
    },

    sync() {
        if(typeof HubEngine !== 'undefined') HubEngine.pingAction(); 
        this.saveState();
        if (typeof NetworkEngine !== 'undefined') NetworkEngine.broadcastState(this.state);
    },

    receiveSurgicalUpdate(newState) {
        const wasSuspended = !!this.state.suspendedState;
        const isSuspended = !!newState.suspendedState;
        if(this.state.round !== newState.round || this.state.phase !== newState.phase || wasSuspended !== isSuspended) { this.isFirstRender = true; }

        if (this.state.phase === 'bid' && newState.phase === 'score') {
            const activePanel = document.getElementById('kf-active-panel');
            if(activePanel) {
                activePanel.classList.remove('phase-locked'); void activePanel.offsetWidth; activePanel.classList.add('phase-locked');
                setTimeout(() => activePanel.classList.remove('phase-locked'), 400);
            }
        }

        if (this.state.phase === 'score' && newState.phase === 'score') {
            newState.misses.forEach((m, i) => { if (m !== this.state.misses[i]) this.lastToggledMiss = i; });
        }
        
        if (this.state.phase === 'score' && newState.phase === 'bid' && newState.round > this.state.round) {
            this.triggerSplash();
            this.state.players.forEach((oldP, i) => {
                const b = this.state.bids[i]; const made = !this.state.misses[i]; const pts = made ? (b === 0 ? 10 : b * 11) : 0;
                if (pts > 0) {
                    const nameEl = document.getElementById(`kf-name-${i}`);
                    if (nameEl) {
                        const rect = nameEl.getBoundingClientRect(); const particle = document.createElement('div');
                        particle.className = 'floating-points'; particle.innerText = `+${pts}`;
                        document.body.appendChild(particle);
                        particle.style.left = `${rect.left + (rect.width / 2) - 15}px`; particle.style.top = `${rect.top - 10}px`;
                        setTimeout(() => particle.remove(), 1600); 
                    }
                }
            });
        }

        if (newState.phase === 'bid') {
            newState.bids.forEach((newBid, i) => {
                if (newBid !== this.state.bids[i]) { const dir = newBid - this.state.bids[i]; this.triggerTextPing(i, dir); }
            });
        }

        const oldTot = this.state.bids.reduce((a,b)=>a+b, 0); const newTot = newState.bids.reduce((a,b)=>a+b, 0);
        if (oldTot !== newTot && newState.phase === 'bid') {
            const counterContainer = document.getElementById('kf-total-bids-container');
            if (counterContainer) {
                counterContainer.classList.remove('counter-pop'); void counterContainer.offsetWidth; counterContainer.classList.add('counter-pop');
            }
        }

        this.state = newState; this.renderBoard(); this.lastToggledMiss = null; 
        
        if(this.state.players.length > 0 && typeof NetworkEngine !== 'undefined' && NetworkEngine.role === 'host') document.getElementById('btn-finish-game').style.display = 'block';
        localStorage.setItem('kf_spectator_state', JSON.stringify(this.state));
    },

    loadState() {
        const raw = localStorage.getItem((typeof NetworkEngine !== 'undefined' && NetworkEngine.role === 'host') ? 'kf_host_state' : 'kf_spectator_state');
        if (raw) {
            try {
                this.state = JSON.parse(raw);
                if(this.state.players.length > 0) {
                    this.isFirstRender = true; this.renderBoard();
                    document.getElementById('header-room-code-val').innerText = (typeof NetworkEngine !== 'undefined') ? NetworkEngine.roomCode : '';
                    document.getElementById('header-room-code').style.display = 'block';
                    if(typeof NetworkEngine !== 'undefined' && NetworkEngine.role === 'host') document.getElementById('btn-finish-game').style.display = 'block';
                }
            } catch (e) {}
        }
    },

    saveState() {
        if(typeof NetworkEngine !== 'undefined' && NetworkEngine.role === 'host') localStorage.setItem('kf_host_state', JSON.stringify(this.state));
    }
};
