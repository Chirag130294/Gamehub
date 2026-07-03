const KTEngine = {
    state: { players: [], trump: [], opp: [], score: 250, win: "", history: [] },

    validateAndSetup() {
        const input = document.getElementById('kt-players-input').value;
        const names = input.split(/[\s,]+/).filter(Boolean).map(HubEngine.titleCase);
        
        if(names.length < 2) return alert("Enter at least 2 players");

        let counts = {}; let duplicates = [];
        names.forEach(n => { counts[n] = (counts[n] || 0) + 1; if (counts[n] === 2) duplicates.push(n); });

        if (duplicates.length > 0) {
            HubEngine.state.pendingNames = names;
            document.getElementById('dup-msg').innerText = `Duplicates found: ${duplicates.join(', ')}`;
            document.getElementById('modal-duplicates').classList.remove('hidden');
        } else {
            this.finalizeSetup(names);
        }
    },

    finalizeSetup(names) {
        this.state.players = names;
        this.state.history = [];
        HubEngine.savePlayers(names); // Saves names globally to Hub memory
        
        document.getElementById('btn-finish-game').style.display = 'block';
        this.resetRound();
    },

    resetRound() {
        this.state.trump = [];
        this.state.opp = [...this.state.players];
        this.state.score = 250;
        this.state.win = "";
        this.renderBoard();
        this.sync();
    },

    togTeam(p) {
        if(this.state.trump.includes(p)) {
            this.state.trump = this.state.trump.filter(x => x !== p);
            this.state.opp.push(p);
        } else {
            this.state.trump.push(p);
            this.state.opp = this.state.opp.filter(x => x !== p);
        }
        this.renderBoard();
        this.sync();
    },

    adjustScore(d) {
        // Lowered minimum to 5 to accommodate the new -5 button
        this.state.score = Math.max(5, this.state.score + d);
        this.renderBoard();
        this.sync();
    },

    setWinner(w) {
        this.state.win = w;
        this.renderBoard();
        this.sync();
    },

    recordScore() {
        if(!this.state.win || this.state.trump.length === 0 || this.state.opp.length === 0) return alert("Select a Trump Team and a Winner.");
        this.state.history.push({ t: [...this.state.trump], o: [...this.state.opp], s: this.state.score, w: this.state.win, status: 'active' });
        this.resetRound();
    },

    editRound(idx) {
        if(confirm("Edit this record? This will load the values into your active setup and remove this record from history.")) {
            const r = this.state.history[idx];
            this.state.trump = [...r.t];
            this.state.opp = [...r.o];
            this.state.score = r.s;
            this.state.win = r.w;
            this.state.history[idx].status = 'deleted';
            this.renderBoard();
            this.sync();
            window.scrollTo({ top: 0, behavior: 'smooth' });
        }
    },

    voidRound(idx) {
        if(confirm("Delete this record permanently?")) {
            this.state.history[idx].status = 'deleted';
            this.renderBoard();
            this.sync();
        }
    },

renderBoard() {
        document.getElementById('kt-setup-panel').style.display = 'none';
        
        let activeHtml = `
            <div class="panel">
                <div style="display:flex; justify-content:space-between; margin-bottom:10px;">
                    <h3>Team Selection</h3>
                    <button class="host-only" style="color:var(--text-muted); font-size:0.8rem; font-weight:700;" onclick="KTEngine.resetRound()">Reset Round</button>
                </div>
                
                <div style="display:flex; flex-wrap:wrap; gap:8px; pointer-events:${(typeof NetworkEngine !== 'undefined' && NetworkEngine.role === 'spectator') ? 'none' : 'auto'};">
                    ${this.state.players.map(p => {
                        const isTrump = this.state.trump.includes(p);
                        return `<button style="padding:6px 12px; border-radius:var(--radius-pill); font-weight:700; border:1px solid ${isTrump?'var(--blue)':'rgba(255,255,255,0.2)'}; background:${isTrump?'var(--blue)':'transparent'};" onclick="KTEngine.togTeam('${p}')">${p}</button>`;
                    }).join('')}
                </div>
                
                <h3 style="margin:15px 0 10px;">Agreed Score</h3>
                <div style="background:rgba(0,0,0,0.4); padding:15px; border-radius:var(--radius-md); text-align:center;">
                    <div style="font-weight:900; font-size:2.5rem; color:var(--gold); margin-bottom:15px; line-height:1;">${this.state.score}</div>
                    
                    <div class="host-only" style="display:flex; flex-direction:column; gap:8px;">
                        <div style="display:flex; gap:8px;">
                            <button class="btn-plus" style="flex:1; padding:12px 0; border-radius:6px; font-weight:900; font-size:1.1rem;" onclick="KTEngine.adjustScore(5)">+ 5</button>
                            <button class="btn-plus" style="flex:1; padding:12px 0; border-radius:6px; font-weight:900; font-size:1.1rem;" onclick="KTEngine.adjustScore(10)">+ 10</button>
                            <button class="btn-plus" style="flex:1; padding:12px 0; border-radius:6px; font-weight:900; font-size:1.1rem;" onclick="KTEngine.adjustScore(20)">+ 20</button>
                        </div>
                        <div style="display:flex; gap:8px;">
                            <button class="btn-minus" style="flex:1; padding:12px 0; border-radius:6px; font-weight:900; font-size:1.1rem;" onclick="KTEngine.adjustScore(-5)">- 5</button>
                            <button class="btn-minus" style="flex:1; padding:12px 0; border-radius:6px; font-weight:900; font-size:1.1rem;" onclick="KTEngine.adjustScore(-10)">- 10</button>
                            <button class="btn-minus" style="flex:1; padding:12px 0; border-radius:6px; font-weight:900; font-size:1.1rem;" onclick="KTEngine.adjustScore(-20)">- 20</button>
                        </div>
                    </div>
                </div>

                <div class="host-only">
                    <h3 style="margin:15px 0 10px;">Select Winner</h3>
                    <div style="display:flex; gap:10px;">
                        <button style="flex:1; padding:12px; font-weight:700; border-radius:var(--radius-md); border:1px solid rgba(255,255,255,0.2); background:${this.state.win==='trump'?'var(--blue)':'transparent'};" onclick="KTEngine.setWinner('trump')">Trump</button>
                        <button style="flex:1; padding:12px; font-weight:700; border-radius:var(--radius-md); border:1px solid rgba(255,255,255,0.2); background:${this.state.win==='opp'?'var(--red)':'transparent'};" onclick="KTEngine.setWinner('opp')">Opp</button>
                    </div>
                    <button class="action-icon-btn btn-record" style="margin-top:15px;" onclick="KTEngine.recordScore()"><i class="fa-solid fa-check"></i></button>
                </div>
            </div>`;

        let s = {}, g = {}, w = {};
        this.state.players.forEach(p => { s[p] = 0; g[p] = 0; w[p] = 0; });
        this.state.history.filter(x => x.status === 'active').forEach(r => {
            r.t.forEach(p => { g[p]++; if(r.w === 'trump'){ s[p] += r.s; w[p]++; } });
            r.o.forEach(p => { g[p]++; if(r.w === 'opp'){ s[p] += (r.s * 2); w[p]++; } });
        });

        activeHtml += `
            <div class="panel">
                <h3 style="font-size:1rem; border-bottom:1px solid rgba(255,255,255,0.1); padding-bottom:5px;">Leaderboard</h3>
                <div style="overflow-x:auto;">
                    <table style="width:100%; text-align:left; font-size:0.85rem; margin-top:10px;">
                        <thead><tr style="color:var(--text-muted); border-bottom:1px solid rgba(255,255,255,0.2);"><th style="padding:8px;">Player</th><th style="padding:8px;">Score</th><th style="padding:8px;">W%</th></tr></thead>
                        <tbody>
                            ${[...this.state.players].sort((a,b) => s[b] - s[a]).map(p => `
                                <tr style="border-bottom:1px solid rgba(255,255,255,0.05);">
                                    <td style="padding:8px; font-weight:700;">${p}</td>
                                    <td style="padding:8px; font-weight:900; color:var(--green);">${s[p]}</td>
                                    <td style="padding:8px; color:var(--gold);">${g[p]?((w[p]/g[p])*100).toFixed(0):0}%</td>
                                </tr>`).join('')}
                        </tbody>
                    </table>
                </div>
            </div>`;

        // Render History Table
        activeHtml += `
            <div class="panel history-accordion">
                <details>
                    <summary>Game History Log <i class="fa-solid fa-chevron-down"></i></summary>
                    <div class="table-wrapper">
                        <table style="width:100%; margin-top:10px; text-align:center;">
                            <thead><tr style="color:var(--text-muted);"><th>#</th>${this.state.players.map(n=>`<th>${n.substring(0,3)}</th>`).join('')}<th>Act</th></tr></thead>
                            <tbody>
                                ${[...this.state.history].reverse().map((r, revIdx) => {
                                    const i = this.state.history.length - 1 - revIdx; 
                                    let tr = `<tr style="border-bottom:1px solid rgba(255,255,255,0.05); ${r.status==='deleted'?'text-decoration:line-through; opacity:0.4;':''}"><td>${i+1}</td>`;
                                    this.state.players.forEach(p => { 
                                        let scr = "-"; 
                                        if(r.t.includes(p) && r.w==='trump') scr = `<span class="score-made">+${r.s}</span>`; 
                                        if(r.o.includes(p) && r.w==='opp') scr = `<span class="score-made">+${r.s*2}</span>`; 
                                        tr += `<td>${scr}</td>`; 
                                    });
                                    
                                    // Added the new Edit and Delete icons
                                    tr += `<td class="host-only">${r.status==='active' ? `
                                        <div style="display:flex; gap:8px; justify-content:center;">
                                            <button style="color:var(--blue); font-size:1.1rem; padding:4px;" onclick="KTEngine.editRound(${i})" title="Edit"><i class="fa-solid fa-pen-to-square"></i></button>
                                            <button style="color:var(--red); font-size:1.1rem; padding:4px;" onclick="KTEngine.voidRound(${i})" title="Delete"><i class="fa-solid fa-trash-can"></i></button>
                                        </div>` : '-'}</td></tr>`;
                                    return tr;
                                }).join('')}
                            </tbody>
                        </table>
                    </div>
                </details>
            </div>`;

        const activePanel = document.getElementById('kt-active-panel');
        activePanel.innerHTML = activeHtml;
        activePanel.style.display = 'block';
    },

    sync() {
        this.saveState();
        if (typeof NetworkEngine !== 'undefined') NetworkEngine.broadcastState(this.state);
    },

    receiveSurgicalUpdate(newState) {
        this.state = newState;
        this.renderBoard();
        localStorage.setItem('kt_spectator_state', JSON.stringify(this.state));
    },

    loadState() {
        const raw = localStorage.getItem((typeof NetworkEngine !== 'undefined' && NetworkEngine.role === 'host') ? 'kt_host_state' : 'kt_spectator_state');
        if (raw) {
            try {
                this.state = JSON.parse(raw);
                if(this.state.players.length > 0) {
                    this.renderBoard();
                    document.getElementById('btn-finish-game').style.display = 'block';
                }
            } catch (e) {}
        }
    },

    saveState() {
        if(typeof NetworkEngine !== 'undefined' && NetworkEngine.role === 'host') localStorage.setItem('kt_host_state', JSON.stringify(this.state));
    }
};