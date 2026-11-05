// --- STORAGE LOCALE (localStorage) ---
// Ogni record ha id + updatedAt; le cancellazioni restano come "lapide" (deleted:true),
// così l'import di un backup unisce i dati senza sovrascrivere quelli più recenti.
const store = (() => {
    const KEY = 'migraine_db_v1';
    const listeners = new Set();
    const uuid = () => (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2));
    const live = list => list.filter(r => !r.deleted);

    let db = { entries: [], meds: [] };
    try {
        const r = JSON.parse(localStorage.getItem(KEY));
        if (r && Array.isArray(r.entries) && Array.isArray(r.meds)) db = r;
    } catch (e) {}

    const persist = () => {
        localStorage.setItem(KEY, JSON.stringify(db));
        listeners.forEach(fn => fn());
    };
    const upsert = (list, data, id) => {
        const i = id ? list.findIndex(r => r.id === id) : -1;
        if (i >= 0) { list[i] = { ...list[i], ...data, id, updatedAt: Date.now(), deleted: false }; return; }
        list.push({ ...data, id: id || uuid(), updatedAt: Date.now() });
    };
    const tombstone = (list, id) => {
        const r = list.find(x => x.id === id);
        if (r) { r.deleted = true; r.updatedAt = Date.now(); }
    };
    const mergeList = (local, incoming) => {
        const map = new Map(local.map(r => [r.id, r]));
        let applied = 0;
        for (const raw of incoming) {
            if (!raw || typeof raw !== 'object') continue;
            const r = { ...raw, id: raw.id || uuid(), updatedAt: Number(raw.updatedAt) || 0 };
            delete r.ownerUid; // eredità di Firebase
            const l = map.get(r.id);
            if (!l || r.updatedAt > l.updatedAt) { map.set(r.id, r); applied++; }
        }
        return { list: [...map.values()], applied };
    };

    return {
        getEntries: () => live(db.entries),
        getMeds: () => live(db.meds),
        saveEntry: (data, id) => { upsert(db.entries, data, id); persist(); },
        removeEntry: id => { tombstone(db.entries, id); persist(); },
        saveMed: (data, id) => { upsert(db.meds, data, id); persist(); },
        removeMed: id => { tombstone(db.meds, id); persist(); },
        onChange: fn => { listeners.add(fn); return () => listeners.delete(fn); },
        snapshot: () => JSON.parse(JSON.stringify(db)),
        // Unisce i dati di un backup: per ogni record vince il più recente. Ritorna quanti record sono stati applicati.
        merge: data => {
            const e = mergeList(db.entries, Array.isArray(data.entries) ? data.entries : []);
            const m = mergeList(db.meds, Array.isArray(data.meds) ? data.meds : []);
            db.entries = e.list; db.meds = m.list;
            if (e.applied + m.applied > 0) persist();
            return e.applied + m.applied;
        }
    };
})();

// --- STATO GLOBALE DEL MODULO ---
let containerEl = null;
let currentDate = new Date();
let entries = [];
let savedMeds = [];
let isModuleInitialized = false;
let unsubStore = null;

export async function init(container) {
    containerEl = container;
    
    injectStyles();
    buildMainUI();
    
    if (!isModuleInitialized) {
        buildModalsToBody();
        bindModalEvents();
        store.onChange(scheduleTelegramBackup);          // backup Telegram a ogni modifica
        window.addEventListener('online', flushTelegramBackup);
        flushTelegramBackup();                           // riprova un invio rimasto in sospeso
        isModuleInitialized = true;
    }
    
    bindCalendarEvents(); 
    initDataListeners();
}

// --- CALCOLO SANTI E FESTIVITA' ---
const santiDic = [
    ["Maria SS. Madre di Dio", "S. Basilio", "S. Genoveffa", "S. Ermete", "S. Amelia", "Epifania", "S. Luciano", "S. Massimo", "S. Giuliano", "S. Aldo", "S. Igino", "S. Modesto", "S. Ilario", "S. Felice", "S. Mauro", "S. Marcello", "S. Antonio abate", "S. Margherita", "S. Mario", "S. Sebastiano", "S. Agnese", "S. Vincenzo", "S. Emerenziana", "S. Francesco di Sales", "Conversione di S. Paolo", "S. Tito", "S. Angela Merici", "S. Tommaso d'Aquino", "S. Costanzo", "S. Martina", "S. Giovanni Bosco"],
    ["S. Verdiana", "Presentazione", "S. Biagio", "S. Gilberto", "S. Agata", "S. Paolo Miki", "S. Teodoro", "S. Girolamo Emiliani", "S. Apollonia", "S. Scolastica", "S. Dante", "S. Eulalia", "S. Maura", "S. Valentino", "S. Faustino", "S. Giuliana", "S. Donato", "S. Simone", "S. Mansueto", "S. Silvano", "S. Pier Damiani", "S. Margherita", "S. Renzo", "S. Edilberto", "S. Cesario", "S. Romeo", "S. Leandro", "S. Romano", "S. Giusto"],
    ["S. Albino", "S. Basileo", "S. Cunegonda", "S. Casimiro", "S. Adriano", "S. Giordano", "S. Perpetua", "S. Giovanni di Dio", "S. Francesca Romana", "S. Simplicio", "S. Costantino", "S. Massimiliano", "S. Arrigo", "S. Matilde", "S. Luisa", "S. Ilario", "S. Patrizio", "S. Cirillo", "S. Giuseppe", "S. Alessandra", "S. Benedetto", "S. Lea", "S. Turibio", "S. Romolo", "Annunciazione", "S. Emanuele", "S. Augusto", "S. Sisto III", "S. Secondo", "S. Amedeo", "S. Beniamino"],
    ["S. Ugo", "S. Francesco di Paola", "S. Riccardo", "S. Isidoro", "S. Vincenzo Ferrer", "S. Guglielmo", "S. Ermanno", "S. Alberto", "S. Maria Cleofe", "S. Terenzio", "S. Stanislao", "S. Giulio", "S. Martino", "S. Abbondio", "S. Annibale", "S. Lamberto", "S. Roberto", "S. Galdino", "S. Ermogene", "S. Adalgisa", "S. Anselmo", "S. Caio", "S. Giorgio", "S. Fedele", "S. Marco evangelista", "S. Marcellino", "S. Zita", "S. Valeria", "S. Caterina da Siena", "S. Pio V"],
    ["S. Giuseppe artigiano", "S. Cesare", "S. Filippo", "S. Silvano", "S. Pellegrino", "S. Giuditta", "S. Flavia", "S. Desiderato", "S. Pacomio", "S. Antonino", "S. Fabio", "S. Rossana", "S. Emma", "S. Mattia", "S. Torquato", "S. Ubaldo", "S. Pasquale", "S. Giovanni I", "S. Pietro di Morrone", "S. Bernardino", "S. Vittorio", "S. Rita da Cascia", "S. Desiderio", "Maria Ausiliatrice", "S. Beda", "S. Filippo Neri", "S. Agostino", "S. Emilio", "S. Massimino", "S. Ferdinando", "Visitazione di Maria"],
    ["S. Giustino", "S. Marcellino", "S. Carlo Lwanga", "S. Quirino", "S. Bonifacio", "S. Norberto", "S. Roberto", "S. Medardo", "S. Efrem", "S. Diana", "S. Barnaba", "S. Guido", "S. Antonio da Padova", "S. Eliseo", "S. Vito", "S. Aureliano", "S. Gregorio", "S. Marina", "S. Gervasio", "S. Silverio", "S. Luigi Gonzaga", "S. Paolino", "S. Lanfranco", "Natività S. Giovanni", "S. Guglielmo", "S. Vigilio", "S. Cirillo", "S. Ireneo", "SS. Pietro e Paolo", "Primi Martiri"],
    ["S. Teobaldo", "S. Ottone", "S. Tommaso apostolo", "S. Elisabetta", "S. Antonio M. Zaccaria", "S. Maria Goretti", "S. Edda", "S. Adriano", "S. Letizia", "S. Silvana", "S. Benedetto", "S. Fortunato", "S. Enrico", "S. Camillo", "S. Bonaventura", "Beata Vergine del Carmelo", "S. Alessio", "S. Federico", "S. Simmaco", "S. Margherita", "S. Lorenzo da Brindisi", "S. Maria Maddalena", "S. Brigida", "S. Cristina", "S. Giacomo apostolo", "S. Anna", "S. Liliana", "S. Nazario", "S. Marta", "S. Pietro Crisologo", "S. Ignazio di Loyola"],
    ["S. Alfonso", "S. Eusebio", "S. Lidia", "S. Nicodemo", "S. Osvaldo", "Trasfigurazione", "S. Gaetano", "S. Domenico", "S. Romano", "S. Lorenzo", "S. Chiara", "S. Ercolano", "S. Ippolito", "S. Alfredo", "Assunzione di Maria", "S. Rocco", "S. Giacinto", "S. Elena", "S. Giovanni Eudes", "S. Bernardo", "S. Pio X", "B.V. Maria Regina", "S. Rosa da Lima", "S. Bartolomeo", "S. Ludovico", "S. Alessandro", "S. Monica", "S. Agostino", "Martirio S. Giovanni B.", "S. Faustina", "S. Aristide"],
    ["S. Egidio", "S. Elpidio", "S. Gregorio", "S. Rosalia", "S. Teresa di Calcutta", "S. Umberto", "S. Regina", "Natività B.V. Maria", "S. Sergio", "S. Nicola da Tolentino", "S. Diomede", "Nome di Maria", "S. Maurilio", "Esaltazione della Croce", "B.V. Maria Addolorata", "S. Cornelio", "S. Roberto", "S. Sofia", "S. Gennaro", "S. Eustachio", "S. Matteo", "S. Maurizio", "S. Lino", "S. Pacifico", "S. Aurelia", "S. Cosimo", "S. Vincenzo", "S. Venceslao", "S. Michele", "S. Girolamo"],
    ["S. Teresa di G.B.", "Angeli Custodi", "S. Gerardo", "S. Francesco d'Assisi", "S. Placido", "S. Bruno", "B.V. Maria del Rosario", "S. Pelagia", "S. Dionigi", "S. Daniele", "S. Firmino", "S. Serafino", "S. Edoardo", "S. Callisto", "S. Teresa d'Avila", "S. Edvige", "S. Ignazio d'Antiochia", "S. Luca evangelista", "S. Isacco", "S. Irene", "S. Orsola", "S. Donato", "S. Giovanni da Capestrano", "S. Antonio M. Claret", "S. Crispino", "S. Evaristo", "S. Fiorenzo", "S. Simone", "S. Ermelinda", "S. Germano", "S. Lucilla"],
    ["Tutti i Santi", "Comm. Fedeli Defunti", "S. Silvia", "S. Carlo Borromeo", "S. Zaccaria", "S. Leonardo", "S. Ernesto", "S. Goffredo", "S. Oreste", "S. Leone Magno", "S. Martino di Tours", "S. Renato", "S. Diego", "S. Giocondo", "S. Alberto Magno", "S. Margherita", "S. Elisabetta", "S. Oddone", "S. Fausto", "S. Benigno", "Presentazione B.V. Maria", "S. Cecilia", "S. Clemente", "S. Flora", "S. Caterina d'Alessandria", "S. Corrado", "S. Virgilio", "S. Giacomo", "S. Saturnino", "S. Andrea apostolo"],
    ["S. Eligio", "S. Bibiana", "S. Francesco Saverio", "S. Barbara", "S. Giulio", "S. Nicola di Bari", "S. Ambrogio", "Immacolata Concezione", "S. Siro", "B.V. Maria di Loreto", "S. Damaso", "S. Giovanna", "S. Lucia", "S. Giovanni della Croce", "S. Valeriano", "S. Adelaide", "S. Lazzaro", "S. Graziano", "S. Fausta", "S. Liberato", "S. Pietro Canisio", "S. Francesca Cabrini", "S. Giovanni da Kety", "S. Adele", "Natale del Signore", "S. Stefano", "S. Giovanni apostolo", "SS. Innocenti", "S. Tommaso Becket", "S. Eugenio", "S. Silvestro"]
];

const festeFisse = {
    "01-01": "Capodanno", "06-01": "Epifania", "25-04": "Festa della Liberazione", "01-05": "Festa dei Lavoratori", 
    "02-06": "Festa della Repubblica", "15-08": "Ferragosto", "01-11": "Tutti i Santi", "08-12": "Immacolata Concezione", 
    "25-12": "Natale", "26-12": "Santo Stefano"
};

function getPasqua(anno) {
    const C = Math.floor(anno/100);
    const N = anno - 19*Math.floor(anno/19);
    const K = Math.floor((C - 17)/25);
    let I = C - Math.floor(C/4) - Math.floor((C - K)/3) + 19*N + 15;
    I = I - 30*Math.floor((I/30));
    I = I - Math.floor(I/28)*(1 - Math.floor(I/28)*Math.floor(29/(I + 1))*Math.floor((21 - N)/11));
    let J = anno + Math.floor(anno/4) + I + 2 - C + Math.floor(C/4);
    J = J - 7*Math.floor(J/7);
    const L = I - J;
    const M = 3 + Math.floor((L + 40)/44);
    const D = L + 28 - 31*Math.floor(M/4);
    return { mese: M, giorno: D };
}

function getDayInfo(d, m, y) {
    const dateKey = `${String(d).padStart(2,'0')}-${String(m).padStart(2,'0')}`;
    let festa = festeFisse[dateKey] || null;
    
    const pasqua = getPasqua(y);
    if (d === pasqua.giorno && m === pasqua.mese) festa = "Pasqua";
    else {
        let pData = new Date(y, pasqua.mese - 1, pasqua.giorno + 1); 
        if (d === pData.getDate() && m === pData.getMonth() + 1) festa = "Pasquetta (Lunedì dell'Angelo)";
    }
    
    let santo = "Santo del giorno";
    if (santiDic[m - 1] && santiDic[m - 1][d - 1]) santo = santiDic[m - 1][d - 1];
    
    return { festa, santo };
}


// --- CSS SPECIFICO DEL MODULO ---
function injectStyles() {
    if (document.getElementById('migraine-styles')) return;
    const style = document.createElement('style');
    style.id = 'migraine-styles';
    style.innerHTML = `
        .cal-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 1rem; }
        .cal-nav { display: flex; align-items: center; gap: 1rem; }
        .cal-nav button { background: none; border: none; color: var(--text-primary); font-size: 1.5rem; cursor: pointer; }
        .cal-grid { display: grid; grid-template-columns: repeat(7, 1fr); gap: 4px; }
        .cal-day-header { text-align: center; font-size: 0.8rem; font-weight: bold; color: var(--text-secondary); padding-bottom: 0.5rem; }
        .cal-cell { min-height: 80px; background: rgba(150,150,150,0.05); border-radius: 8px; padding: 4px; display: flex; flex-direction: column; cursor: pointer; border: 1px solid transparent; transition: all 0.2s; position:relative;}
        .cal-cell:hover { border-color: var(--accent-color); }
        .cal-cell.today { background: rgba(239, 68, 68, 0.1); border-color: rgba(239, 68, 68, 0.3); }
        .cal-cell.other-month { opacity: 0.4; }
        .cal-date { font-size: 0.85rem; font-weight: bold; margin-bottom: 4px; text-align: right; pointer-events: none; }
        
        .cal-dots-container { display: flex; justify-content: flex-end; gap: 3px; margin-top: auto; padding: 2px; flex-wrap: wrap; pointer-events: none;}
        .cal-dot { width: 8px; height: 8px; border-radius: 50%; }
        .dot-red { background-color: #ef4444; }
        
        .episode-row { display: flex; justify-content: space-between; align-items: center; padding: 0.8rem; border-bottom: 1px solid var(--border-soft); background: rgba(150,150,150,0.03); border-radius: 8px; margin-bottom: 0.5rem; border-left: 4px solid #ef4444;}
        
        /* Form fields */
        .migraine-form-group { margin-bottom: 0.8rem; }
        .migraine-form-group label { display: block; font-size: 0.8rem; color: var(--text-secondary); margin-bottom: 0.2rem; }
        .migraine-input { width: 100%; padding: 0.5rem; border: 1px solid var(--border-soft); border-radius: 6px; background: var(--surface-light); color: var(--text-primary); }
        textarea.migraine-input { resize: vertical; min-height: 60px; }
        
        /* Accordions and Chips */
        .migraine-accordion { background: rgba(150,150,150,0.02); border: 1px solid var(--border-soft); border-radius: 8px; margin-bottom: 0.5rem; }
        .migraine-accordion-header { padding: 0.8rem; display: flex; justify-content: space-between; align-items: center; cursor: pointer; font-weight: bold; font-size: 0.9rem; }
        .migraine-accordion-header .chevron { transition: transform 0.3s; color: var(--text-secondary); }
        .migraine-accordion.open .chevron { transform: rotate(-180deg); }
        .migraine-accordion-content { display: none; padding: 0 0.8rem 0.8rem 0.8rem; flex-direction: column; gap: 0.8rem; }
        .migraine-accordion.open .migraine-accordion-content { display: flex; }
        
        .chip-group { display: flex; flex-wrap: wrap; gap: 0.5rem; }
        .selectable-chip { background: var(--surface-light); border: 1px solid var(--border-soft); border-radius: 16px; padding: 5px 12px; font-size: 0.85rem; cursor: pointer; transition: all 0.2s; user-select: none; }
        .selectable-chip.selected { background: #ef4444; color: white; border-color: #ef4444; }
        .selectable-chip.med-chip { background: rgba(150,150,150,0.1); }
        
        .med-row { display: flex; justify-content: space-between; align-items: center; padding: 0.5rem; background: rgba(150,150,150,0.05); border-radius: 6px; }
        
        /* Dynamic Meds List */
        .selected-med-row { display:flex; align-items:center; gap:0.5rem; background:rgba(150,150,150,0.05); padding:0.5rem; border-radius:6px; border:1px solid var(--border-soft); }
        .selected-med-row .med-name { flex:1; font-size:0.85rem; font-weight:bold; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .selected-med-row .med-time { width: auto; }
    `;
    document.head.appendChild(style);
}

// --- STRUTTURA HTML CALENDARIO ---
function buildMainUI() {
    containerEl.innerHTML = `
        <div class="module-wrapper" style="display:flex; flex-direction:column;">
            <div class="cal-header">
                <div class="cal-nav">
                    <button id="cal-prev"><span class="material-symbols-outlined">chevron_left</span></button>
                    <h2 id="cal-month-year" style="margin:0; font-size:1.2rem;">...</h2>
                    <button id="cal-next"><span class="material-symbols-outlined">chevron_right</span></button>
                </div>
                <div style="display:flex; gap:0.2rem;">
                    <button id="cal-menu-btn" class="icon-btn">
                        <span class="material-symbols-outlined">more_vert</span>
                    </button>
                </div>
            </div>

            <div class="cal-grid" id="cal-days-header">
                <div class="cal-day-header">Lun</div><div class="cal-day-header">Mar</div><div class="cal-day-header">Mer</div>
                <div class="cal-day-header">Gio</div><div class="cal-day-header">Ven</div><div class="cal-day-header">Sab</div><div class="cal-day-header">Dom</div>
            </div>
            
            <div class="cal-grid" id="cal-grid-body"></div>

            <p style="margin-top:auto; padding-top:2rem; font-size:0.75rem; line-height:1.4; text-align:center; color:var(--text-secondary);">
                <span class="material-symbols-outlined" style="font-size:14px; vertical-align:-2px; margin-right:3px;">lock</span>
                I tuoi dati restano nel dispositivo e nei backup che decidi tu di creare (file esportati o invii al tuo bot Telegram). <a href="privacy.html" target="_blank" rel="noopener" style="color:var(--accent-color); white-space:nowrap;">Informativa privacy</a>
            </p>
        </div>
    `;
}

// --- COSTRUZIONE MODALI A LIVELLO DEL BODY ---
function buildModalsToBody() {
    const wrapper = document.createElement('div');
    wrapper.id = 'migraine-modals-wrapper';
    
    wrapper.innerHTML = `
        <!-- MENU MODALE -->
        <div id="cal-menu-modal" class="modal-overlay hidden" style="z-index: 2000;">
            <div class="modal-content">
                <div class="modal-header">
                    <h2>Opzioni Diario</h2>
                    <button id="btn-close-menu" class="icon-btn"><span class="material-symbols-outlined">close</span></button>
                </div>
                <div class="settings-section">
                    <button id="btn-open-meds" class="btn secondary outline" style="width:100%; margin-bottom:0.5rem;">
                        <span class="material-symbols-outlined" style="vertical-align:middle; margin-right:5px;">vaccines</span> Gestisci Farmaci
                    </button>
                    <button id="btn-open-stats" class="btn secondary outline" style="width:100%; margin-bottom:0.5rem;">
                        <span class="material-symbols-outlined" style="vertical-align:middle; margin-right:5px;">bar_chart</span> Statistiche
                    </button>
                    <button id="btn-open-export" class="btn secondary outline" style="width:100%; margin-bottom:1rem; border-color:var(--accent-color); color:var(--accent-color);">
                        <span class="material-symbols-outlined" style="vertical-align:middle; margin-right:5px;">picture_as_pdf</span> Esporta Diario PDF
                    </button>
                    <button id="btn-backup-export" class="btn secondary outline" style="width:100%; margin-bottom:0.5rem;">
                        <span class="material-symbols-outlined" style="vertical-align:middle; margin-right:5px;">ios_share</span> Esporta backup
                    </button>
                    <button id="btn-backup-import" class="btn secondary outline" style="width:100%;">
                        <span class="material-symbols-outlined" style="vertical-align:middle; margin-right:5px;">upload_file</span> Importa backup
                    </button>
                    <input type="file" id="backup-file" accept="application/json,.json" class="hidden">
                    <button id="btn-open-telegram" class="btn secondary outline" style="width:100%; margin-top:0.5rem;">
                        <span class="material-symbols-outlined" style="vertical-align:middle; margin-right:5px;">send</span> Backup su Telegram
                    </button>
                </div>
            </div>
        </div>

        <!-- MODALE BACKUP TELEGRAM -->
        <div id="cal-telegram-modal" class="modal-overlay hidden" style="z-index: 2060;">
            <div class="modal-content" style="max-height: 90vh; overflow-y: auto;">
                <div class="modal-header">
                    <h2>Backup su Telegram</h2>
                    <button id="btn-close-telegram" class="icon-btn"><span class="material-symbols-outlined">close</span></button>
                </div>
                <p style="font-size:0.85rem; color:var(--text-secondary); margin-bottom:1rem;">
                    A ogni modifica il diario viene inviato come file nella tua chat Telegram, tramite un bot creato da te. Token e ID restano solo in questo browser.
                </p>
                <details style="margin-bottom:1rem; font-size:0.85rem;">
                    <summary style="cursor:pointer; font-weight:600; margin-bottom:0.5rem;">Come si configura (3 minuti)</summary>
                    <ol style="padding-left:1.2rem; line-height:1.5; color:var(--text-secondary);">
                        <li><b>Crea il bot</b>: su Telegram cerca <b>@BotFather</b>, scrivi <code>/newbot</code>, scegli un nome e un username che finisca con <i>bot</i>. Ti risponde con un <b>token</b> lungo, tipo <code>123456789:AAH...</code>: copialo.</li>
                        <li><b>Avvia il bot</b>: apri il link al tuo nuovo bot e premi <b>Avvia</b> (<code>/start</code>). Senza questo passaggio il bot non può scriverti.</li>
                        <li><b>Trova il tuo ID</b>: cerca <b>@userinfobot</b> e premi Avvia. Ti risponde con un numero (<i>Id</i>): è il tuo ID utente.</li>
                        <li><b>Incolla</b> token e ID qui sotto, spunta l'invio automatico, premi <b>Salva</b> e poi <b>Invia prova</b>: dovresti ricevere il file nella chat con il bot.</li>
                    </ol>
                    <p style="margin-top:0.5rem; color:var(--text-secondary);">
                        Il token è come una password del bot: non condividerlo. Se finisce in mano ad altri, su @BotFather usa <code>/revoke</code> per cambiarlo. I messaggi dei bot non sono cifrati end-to-end.
                    </p>
                </details>
                <div class="migraine-form-group">
                    <label>Token del bot</label>
                    <input type="password" id="tg-token" class="migraine-input" placeholder="123456789:AA..." autocomplete="off" autocapitalize="off" spellcheck="false">
                </div>
                <div class="migraine-form-group">
                    <label>Il tuo ID utente (numero)</label>
                    <input type="text" id="tg-chat" class="migraine-input" inputmode="numeric" placeholder="123456789" autocomplete="off">
                </div>
                <label style="display:flex; align-items:center; gap:0.5rem; font-size:0.9rem; margin-bottom:1rem;">
                    <input type="checkbox" id="tg-enabled" checked> Invia un backup a ogni modifica
                </label>
                <div id="tg-status" style="font-size:0.8rem; color:var(--text-secondary); margin-bottom:1rem; min-height:1.2em;"></div>
                <div style="display:flex; gap:0.5rem; margin-bottom:0.5rem;">
                    <button id="btn-tg-save" class="btn primary">Salva</button>
                    <button id="btn-tg-test" class="btn secondary outline">Invia prova</button>
                </div>
                <button id="btn-tg-clear" class="btn danger outline" style="width:100%; font-size:0.85rem;">Rimuovi token e ID da questo dispositivo</button>
            </div>
        </div>

        <!-- MODALE STATISTICHE -->
        <div id="cal-stats-modal" class="modal-overlay hidden" style="z-index: 2050;">
            <div class="modal-content" style="max-height: 90vh; overflow-y: auto;">
                <div class="modal-header">
                    <h2>Statistiche</h2>
                    <button id="btn-close-stats" class="icon-btn"><span class="material-symbols-outlined">close</span></button>
                </div>
                <div style="margin-bottom: 1rem;">
                    <label style="font-size:0.8rem; display:block; margin-bottom:0.3rem;">Seleziona Periodo:</label>
                    <select id="stats-period-type" class="migraine-input" style="margin-bottom: 0.5rem;">
                        <option value="month">Mese specifico</option>
                        <option value="year">Anno specifico</option>
                        <option value="custom">Periodo personalizzato</option>
                    </select>
                    
                    <div id="stats-inputs-month" class="stats-input-group">
                        <input type="month" id="stats-month" class="migraine-input">
                    </div>
                    <div id="stats-inputs-year" class="stats-input-group" style="display:none;">
                        <input type="number" id="stats-year" placeholder="Es. 2026" class="migraine-input" min="2000" max="2100">
                    </div>
                    <div id="stats-inputs-custom" class="stats-input-group" style="display:none; gap:0.5rem;">
                        <input type="date" id="stats-date-from" class="migraine-input" style="flex:1;">
                        <input type="date" id="stats-date-to" class="migraine-input" style="flex:1;">
                    </div>
                    
                    <button id="btn-calc-stats" class="btn primary" style="width:100%; margin-top: 0.8rem;">Calcola Statistiche</button>
                </div>
                <div id="stats-results" style="display:flex; flex-direction:column; gap:1rem;">
                    <!-- Risultati generati qui -->
                </div>
            </div>
        </div>

        <!-- MODALE GESTIONE FARMACI -->
        <div id="cal-meds-modal" class="modal-overlay hidden" style="z-index: 2100;">
            <div class="modal-content">
                <div class="modal-header">
                    <h2>Farmaci Salvati</h2>
                    <button id="btn-close-meds" class="icon-btn"><span class="material-symbols-outlined">close</span></button>
                </div>
                <div style="display:flex; gap:0.5rem; margin-bottom: 1rem;">
                    <input type="text" id="new-med-name" placeholder="Nome farmaco" class="migraine-input" style="flex:2; margin:0;">
                    <input type="text" id="new-med-dose" placeholder="Dosaggio" class="migraine-input" style="flex:1; margin:0;">
                    <button id="btn-add-med" class="btn primary" style="padding:0 1rem;"><span class="material-symbols-outlined">add</span></button>
                </div>
                <div id="meds-list" style="display:flex; flex-direction:column; gap:0.5rem; max-height:40vh; overflow-y:auto;">
                    <!-- Lista farmaci caricata da Firebase -->
                </div>
            </div>
        </div>

        <!-- MODALE ESPORTA PDF -->
        <div id="cal-export-modal" class="modal-overlay hidden" style="z-index: 2050;">
            <div class="modal-content">
                <div class="modal-header">
                    <h2>Esporta in PDF</h2>
                    <button id="btn-close-export" class="icon-btn"><span class="material-symbols-outlined">close</span></button>
                </div>
                <p style="font-size:0.85rem; margin-bottom:1rem; color:var(--text-secondary);">Seleziona il periodo da esportare. Verrà generato un elenco dettagliato diviso per mesi e impaginato per la stampa.</p>
                
                <div style="display:flex; gap:0.5rem; margin-bottom: 1rem;">
                    <div style="flex:1;">
                        <label style="font-size:0.8rem;">Da Mese</label>
                        <input type="month" id="export-month-from" class="input-select" style="width:100%;">
                    </div>
                    <div style="flex:1;">
                        <label style="font-size:0.8rem;">A Mese</label>
                        <input type="month" id="export-month-to" class="input-select" style="width:100%;">
                    </div>
                </div>
                
                <button id="btn-do-export" class="btn primary" style="width:100%;">Genera e Scarica PDF</button>
            </div>
        </div>

        <!-- MODALE DETTAGLI DEL GIORNO -->
        <div id="cal-day-details-modal" class="modal-overlay hidden" style="z-index: 2000;">
            <div class="modal-content">
                <div class="modal-header" style="align-items:flex-start; margin-bottom: 0.5rem;">
                    <div>
                        <h2 id="day-details-title" style="margin-bottom: 0.2rem;">Episodi</h2>
                        <div id="day-details-subtitle" style="font-size:0.85rem; color:var(--text-secondary); line-height:1.2;"></div>
                    </div>
                    <div style="display:flex; gap: 0.5rem;">
                        <button id="btn-add-from-day" class="icon-btn" style="color:var(--accent-color); border-color:var(--accent-color);"><span class="material-symbols-outlined">add</span></button>
                        <button id="btn-close-day-details" class="icon-btn"><span class="material-symbols-outlined">close</span></button>
                    </div>
                </div>
                <div id="day-details-list" style="display:flex; flex-direction:column; gap:0.5rem; max-height: 60vh; overflow-y: auto;">
                    <!-- Gli eventi verranno caricati qui -->
                </div>
            </div>
        </div>

        <!-- MODALE AGGIUNGI / MODIFICA EPISODIO -->
        <div id="cal-add-modal" class="modal-overlay hidden" style="z-index: 2200;">
            <div class="modal-content" style="max-height: 90vh; overflow-y: auto;">
                <div class="modal-header">
                    <h2 id="add-modal-title">Registra Episodio</h2>
                    <button id="btn-close-add" class="icon-btn"><span class="material-symbols-outlined">close</span></button>
                </div>
                
                <input type="hidden" id="add-date">
                <input type="hidden" id="edit-entry-id">

                <div style="display:flex; gap:0.5rem; margin-bottom: 1rem;">
                    <div class="migraine-form-group" style="flex:1; margin-bottom:0;">
                        <label>Ora Inizio</label>
                        <input type="time" id="add-start" class="migraine-input">
                        <label style="display:flex; align-items:center; gap:0.3rem; margin-top:0.5rem; font-size:0.75rem; cursor:pointer;">
                            <input type="checkbox" id="add-started-sleep"> Iniziato nel sonno
                        </label>
                    </div>
                    <div class="migraine-form-group" style="flex:1; margin-bottom:0;">
                        <label>Fine (Data e Ora)</label>
                        <div style="display:flex; gap:0.2rem;">
                            <input type="date" id="add-end-date" class="migraine-input">
                            <input type="time" id="add-end" class="migraine-input">
                        </div>
                        <label style="display:flex; align-items:center; gap:0.3rem; margin-top:0.5rem; font-size:0.75rem; cursor:pointer;">
                            <input type="checkbox" id="add-ended-sleep"> Finito nel sonno
                        </label>
                    </div>
                </div>

                <!-- Intensità -->
                <div class="migraine-accordion">
                    <div class="migraine-accordion-header">
                        <span>Intensità (1-10)</span>
                        <span class="material-symbols-outlined chevron">expand_more</span>
                    </div>
                    <div class="migraine-accordion-content">
                        <input type="range" id="add-intensity" min="1" max="10" value="5" class="migraine-input" style="padding:0;">
                        <div style="text-align:center; font-weight:bold;">Valore: <span id="intensity-val">5</span></div>
                    </div>
                </div>

                <!-- Localizzazione -->
                <div class="migraine-accordion">
                    <div class="migraine-accordion-header">
                        <span>Localizzazione e Tipo Dolore</span>
                        <span class="material-symbols-outlined chevron">expand_more</span>
                    </div>
                    <div class="migraine-accordion-content">
                        <div class="chip-group" id="chips-location">
                            <div class="selectable-chip">Tempia Dx</div>
                            <div class="selectable-chip">Tempia Sx</div>
                            <div class="selectable-chip">Fronte</div>
                            <div class="selectable-chip">Nuca</div>
                            <div class="selectable-chip">Occhi</div>
                            <div class="selectable-chip">Diffuso</div>
                            <div class="selectable-chip">Pulsante</div>
                            <div class="selectable-chip">Oppressivo</div>
                            <div class="selectable-chip">Trafiggente</div>
                        </div>
                        <input type="text" id="add-location-other" placeholder="Altra localizzazione o tipo..." class="migraine-input">
                    </div>
                </div>

                <!-- Sintomi e Preavviso -->
                <div class="migraine-accordion">
                    <div class="migraine-accordion-header">
                        <span>Sintomi e Preavviso</span>
                        <span class="material-symbols-outlined chevron">expand_more</span>
                    </div>
                    <div class="migraine-accordion-content">
                        <div class="chip-group" id="chips-symptoms">
                            <div class="selectable-chip">Nausea</div>
                            <div class="selectable-chip">Vomito</div>
                            <div class="selectable-chip">Fotofobia (Luce)</div>
                            <div class="selectable-chip">Fonofobia (Suoni)</div>
                            <div class="selectable-chip">Osmofobia (Odori)</div>
                            <div class="selectable-chip">Aura visiva</div>
                            <div class="selectable-chip">Stanchezza</div>
                            <div class="selectable-chip">Sbadigli frequenti</div>
                            <div class="selectable-chip">Formicolio</div>
                            <div class="selectable-chip">Difficoltà concentrazione</div>
                        </div>
                        <input type="text" id="add-symptoms-other" placeholder="Altri sintomi..." class="migraine-input">
                    </div>
                </div>

                <!-- Fattori Scatenanti -->
                <div class="migraine-accordion">
                    <div class="migraine-accordion-header">
                        <span>Fattori Scatenanti (Trigger)</span>
                        <span class="material-symbols-outlined chevron">expand_more</span>
                    </div>
                    <div class="migraine-accordion-content">
                        <div class="chip-group" id="chips-triggers">
                            <div class="selectable-chip">Stress</div>
                            <div class="selectable-chip">Poco sonno</div>
                            <div class="selectable-chip">Troppo sonno</div>
                            <div class="selectable-chip">Sbalzo termico/Meteo</div>
                            <div class="selectable-chip">Ciclo mestruale</div>
                            <div class="selectable-chip">Alcol</div>
                            <div class="selectable-chip">Caffeina (eccesso/astinenza)</div>
                            <div class="selectable-chip">Digiuno</div>
                            <div class="selectable-chip">Sforzo fisico</div>
                        </div>
                        <input type="text" id="add-triggers-other" placeholder="Altri fattori scatenanti..." class="migraine-input">
                    </div>
                </div>

                <!-- Farmaci -->
                <div class="migraine-accordion">
                    <div class="migraine-accordion-header">
                        <span>Farmaci Assunti ed Efficacia</span>
                        <span class="material-symbols-outlined chevron">expand_more</span>
                    </div>
                    <div class="migraine-accordion-content">
                        <div style="font-size:0.8rem; color:var(--text-secondary); margin-bottom:0.2rem;">Tocca un farmaco salvato per aggiungerlo (anche più volte):</div>
                        <div class="chip-group" id="quick-meds-container" style="margin-bottom:0.5rem;">
                            <!-- Farmaci dinamici -->
                        </div>
                        
                        <div id="selected-meds-list" style="display:flex; flex-direction:column; gap:0.5rem; margin-bottom:0.5rem;">
                            <!-- Farmaci selezionati e relativi orari -->
                        </div>

                        <div style="display:flex; gap:0.5rem; margin-bottom: 0.5rem;">
                            <input type="text" id="add-custom-med-name" placeholder="Altro farmaco..." class="migraine-input" style="flex:1; margin:0;">
                            <input type="time" id="add-custom-med-time" class="migraine-input" style="width:auto; margin:0;">
                            <button type="button" id="btn-add-custom-med" class="btn primary" style="padding:0 0.8rem; margin:0;"><span class="material-symbols-outlined">add</span></button>
                        </div>

                        <input type="text" id="add-meds-other" placeholder="Note sui farmaci (es. Dolore passato dopo 2h)..." class="migraine-input">
                        <div style="margin-top: 0.5rem;">
                            <label style="display:block; font-size:0.8rem; color:var(--text-secondary); margin-bottom:0.2rem;">Efficacia del medicinale (1-10)</label>
                            <input type="range" id="add-med-efficacy" min="1" max="10" value="5" class="migraine-input" style="padding:0;">
                            <div style="text-align:center; font-weight:bold;">Valore: <span id="efficacy-val">5</span></div>
                        </div>
                    </div>
                </div>

                <!-- Note -->
                <div class="migraine-accordion">
                    <div class="migraine-accordion-header">
                        <span>Note Aggiuntive</span>
                        <span class="material-symbols-outlined chevron">expand_more</span>
                    </div>
                    <div class="migraine-accordion-content">
                        <textarea id="add-notes" placeholder="Impatto sulle attività, annotazioni libere..." class="migraine-input"></textarea>
                    </div>
                </div>

                <button id="btn-save-entry" class="btn primary" style="width:100%; margin-top:1rem;">Salva Episodio</button>
            </div>
        </div>
    `;
    
    document.body.appendChild(wrapper);
}


// --- LOGICA E DATABASE ---
function initDataListeners() {
    if (unsubStore) unsubStore();
    const refresh = () => {
        entries = store.getEntries();
        savedMeds = store.getMeds();

        const addDateInput = document.getElementById('add-date');
        if (addDateInput) {
            const dateStr = addDateInput.value;
            const detailsModal = document.getElementById('cal-day-details-modal');
            if (detailsModal && !detailsModal.classList.contains('hidden') && dateStr) {
                openDayDetails(dateStr);
            }
        }

        renderCalendar();
        renderMedsList();
        renderQuickMeds();
    };
    unsubStore = store.onChange(refresh);
    refresh();
}

// --- FUNZIONI UTILI PER LETTURA/SCRITTURA DELLE CATEGORIE CON CHIP ---
function getCategoryData(containerId, otherInputId) {
    let selected = [];
    const container = document.getElementById(containerId);
    if (container) {
        container.querySelectorAll('.selectable-chip.selected').forEach(c => {
            selected.push(c.innerText);
        });
    }
    if (otherInputId) {
        const other = document.getElementById(otherInputId);
        if (other && other.value.trim() !== '') {
            selected.push(other.value.trim());
        }
    }
    return selected.join(', ');
}

function setCategoryData(containerId, otherInputId, fullString) {
    const container = document.getElementById(containerId);
    const otherInput = document.getElementById(otherInputId);
    
    if (container) {
        container.querySelectorAll('.selectable-chip').forEach(c => c.classList.remove('selected'));
    }
    if (otherInput) otherInput.value = '';
    
    if (!fullString) return;
    
    let parts = fullString.split(',').map(s => s.trim());
    let leftovers = [];
    
    parts.forEach(part => {
        let found = false;
        if (container) {
            container.querySelectorAll('.selectable-chip').forEach(chip => {
                if (chip.innerText === part) {
                    chip.classList.add('selected');
                    found = true;
                }
            });
        }
        if (!found && part !== '') leftovers.push(part);
    });
    
    if (otherInput && leftovers.length > 0) {
        otherInput.value = leftovers.join(', ');
    }
}

// --- FUNZIONE PER AGGIUNGERE UN FARMACO ALLA LISTA DINAMICA ---
function addMedInstance(name, time = '') {
    const list = document.getElementById('selected-meds-list');
    const row = document.createElement('div');
    row.className = 'selected-med-row';
    row.innerHTML = `
        <div class="med-name" title="${name}">${name}</div>
        <input type="time" class="migraine-input med-time" style="padding: 0.3rem; font-size: 0.85rem; width: auto; margin:0;" value="${time}">
        <button type="button" class="icon-btn btn-del-med-instance" style="color:#ef4444; width:28px; height:28px; min-width:28px; margin:0;"><span class="material-symbols-outlined" style="font-size:1.1rem;">close</span></button>
    `;
    row.querySelector('.btn-del-med-instance').addEventListener('click', () => {
        row.remove();
    });
    list.appendChild(row);
}


// --- RENDERING CALENDARIO CON PUNTINI ---
function renderCalendar() {
    const mYearLabel = document.getElementById('cal-month-year');
    if (!mYearLabel) return; 

    const year = currentDate.getFullYear();
    const month = currentDate.getMonth();
    
    const monthNames = ["Gennaio", "Febbraio", "Marzo", "Aprile", "Maggio", "Giugno", "Luglio", "Agosto", "Settembre", "Ottobre", "Novembre", "Dicembre"];
    mYearLabel.innerText = `${monthNames[month]} ${year}`;
    
    const firstDay = new Date(year, month, 1).getDay();
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    
    let startOffset = firstDay === 0 ? 6 : firstDay - 1; 
    
    const grid = document.getElementById('cal-grid-body');
    grid.innerHTML = '';
    
    const today = new Date();

    for (let i = 0; i < startOffset; i++) {
        const cell = document.createElement('div');
        cell.className = 'cal-cell other-month';
        grid.appendChild(cell);
    }
    
    for (let i = 1; i <= daysInMonth; i++) {
        const cell = document.createElement('div');
        cell.className = 'cal-cell';
        
        if (i === today.getDate() && month === today.getMonth() && year === today.getFullYear()) {
            cell.classList.add('today');
        }
        
        const dateStr = `${year}-${String(month+1).padStart(2, '0')}-${String(i).padStart(2, '0')}`;
        cell.dataset.date = dateStr;
        
        const dayInfo = getDayInfo(i, month + 1, year);
        let holiMarker = dayInfo.festa ? `<span style="color:#ef4444; font-size:1.2rem; line-height:0.5; vertical-align: middle;">•</span>` : '';

        const dayEntries = entries.filter(e => e.date === dateStr);
        let dotsHtml = '<div class="cal-dots-container">';
        if (dayEntries.length > 0) {
            dotsHtml += '<div class="cal-dot dot-red"></div>';
        }
        dotsHtml += '</div>';

        cell.innerHTML = `<div class="cal-date">${holiMarker} ${i}</div> ${dotsHtml}`;
        cell.addEventListener('click', () => openDayDetails(dateStr));
        grid.appendChild(cell);
    }
}


function openDayDetails(dateStr) {
    document.getElementById('add-date').value = dateStr;
    const [y, m, d] = dateStr.split('-');
    
    document.getElementById('day-details-title').innerText = `${d}/${m}/${y}`;
    
    const dayInfo = getDayInfo(parseInt(d), parseInt(m), parseInt(y));
    let subtitleHtml = dayInfo.santo;
    if (dayInfo.festa) subtitleHtml += ` <br><span style="color:#ef4444; font-weight:bold;">${dayInfo.festa}</span>`;
    document.getElementById('day-details-subtitle').innerHTML = subtitleHtml;
    
    const cont = document.getElementById('day-details-list');
    cont.innerHTML = '';
    
    const dayEntries = entries.filter(e => e.date === dateStr);
    
    dayEntries.sort((a,b) => {
        if (!a.startTime) return -1;
        if (!b.startTime) return 1;
        return a.startTime.localeCompare(b.startTime);
    });
    
    if (dayEntries.length === 0) {
        cont.innerHTML = '<p style="text-align:center; color:var(--text-secondary); margin-top:1rem;">Nessun episodio registrato.</p>';
    } else {
        dayEntries.forEach(entry => {
            const div = document.createElement('div');
            div.className = `episode-row`;
            
            let timeText = entry.startedInSleep ? 'Nel sonno' : (entry.startTime ? `${entry.startTime}` : 'Ora non specificata');
            
            if (entry.endTime || entry.endedInSleep || (entry.endDate && entry.endDate !== entry.date)) {
                let endStr = entry.endedInSleep ? 'Nel sonno' : (entry.endTime ? entry.endTime : 'N/D');
                if (entry.endDate && entry.endDate !== entry.date) {
                    const [ey, em, ed] = entry.endDate.split('-');
                    endStr += ` (del ${ed}/${em})`;
                }
                timeText += ` - ${endStr}`;
            }
            
            let summaryStr = [];
            if (entry.intensity) summaryStr.push(`Intensità: ${entry.intensity}`);
            if (entry.medEfficacy && entry.meds && entry.meds.trim() !== '') summaryStr.push(`Efficacia: ${entry.medEfficacy}`);
            if (entry.location) summaryStr.push(entry.location);
            
            let actionsHtml = `
                <div style="display:flex; gap:0.4rem; align-items:center;">
                    <button class="icon-btn btn-edit-entry" data-id="${entry.id}" style="color:var(--accent-color); width:32px; height:32px; min-width:32px;"><span class="material-symbols-outlined" style="font-size:1.1rem;">edit</span></button>
                    <button class="icon-btn btn-del-entry" data-id="${entry.id}" style="color:#ef4444; width:32px; height:32px; min-width:32px;"><span class="material-symbols-outlined" style="font-size:1.1rem;">delete</span></button>
                </div>
            `;

            div.innerHTML = `
                <div style="flex:1;">
                    <div style="font-weight:bold; margin-bottom:0.2rem;">${timeText}</div>
                    <div style="font-size:0.8rem; color:var(--text-secondary);">
                        ${summaryStr.length > 0 ? summaryStr.join(' | ') : 'Nessun dettaglio aggiuntivo'}
                    </div>
                </div>
                ${actionsHtml}
            `;
            cont.appendChild(div);
        });

        // EDIT EVENTO
        document.querySelectorAll('.btn-edit-entry').forEach(b => {
            b.addEventListener('click', (e) => {
                const entryId = e.currentTarget.dataset.id;
                const entry = entries.find(x => x.id === entryId);
                if (!entry) return;

                document.getElementById('edit-entry-id').value = entry.id;
                document.getElementById('add-date').value = entry.date;
                
                document.getElementById('add-start').value = entry.startTime || '';
                document.getElementById('add-end-date').value = entry.endDate || '';
                document.getElementById('add-end').value = entry.endTime || '';
                
                document.getElementById('add-started-sleep').checked = entry.startedInSleep || false;
                document.getElementById('add-ended-sleep').checked = entry.endedInSleep || false;
                
                // Popola i campi tramite la funzione di set
                const intInput = document.getElementById('add-intensity');
                intInput.value = entry.intensity || 5;
                document.getElementById('intensity-val').innerText = intInput.value;

                const effInput = document.getElementById('add-med-efficacy');
                effInput.value = entry.medEfficacy || 5;
                document.getElementById('efficacy-val').innerText = effInput.value;

                setCategoryData('chips-location', 'add-location-other', entry.location);
                setCategoryData('chips-symptoms', 'add-symptoms-other', entry.symptoms);
                setCategoryData('chips-triggers', 'add-triggers-other', entry.triggers);
                document.getElementById('add-notes').value = entry.notes || '';
                
                // Popolamento lista farmaci
                document.getElementById('selected-meds-list').innerHTML = '';
                document.getElementById('add-custom-med-name').value = '';
                document.getElementById('add-custom-med-time').value = '';
                
                if (entry.medicationDetails) {
                    entry.medicationDetails.forEach(m => addMedInstance(m.name, m.time));
                    document.getElementById('add-meds-other').value = entry.medNotes || '';
                } else if (entry.meds) {
                    // Fallback di retrocompatibilità per leggere le vecchie stringhe formattate a virgola
                    let parts = entry.meds.split(',').map(s => s.trim());
                    let leftovers = [];
                    parts.forEach(part => {
                        let found = savedMeds.find(sm => sm.name === part || `${sm.name} (${sm.dosage})` === part);
                        if (found) {
                            addMedInstance(found.name ? (found.dosage ? `${found.name} (${found.dosage})` : found.name) : part);
                        } else if (part !== '') {
                            leftovers.push(part);
                        }
                    });
                    document.getElementById('add-meds-other').value = leftovers.join(', ');
                } else {
                    document.getElementById('add-meds-other').value = '';
                }
                
                // Chiudi tutte le schede per pulizia visiva
                document.querySelectorAll('.migraine-accordion').forEach(acc => acc.classList.remove('open'));

                document.getElementById('add-modal-title').innerText = "Modifica Episodio";
                
                document.getElementById('cal-day-details-modal').classList.add('hidden');
                document.getElementById('cal-add-modal').classList.remove('hidden');
            });
        });

        // ELIMINA EVENTO
        document.querySelectorAll('.btn-del-entry').forEach(b => {
            b.addEventListener('click', async (e) => {
                if(confirm("Sei sicuro di voler eliminare questo episodio?")) {
                    const entryId = e.currentTarget.dataset.id;
                    store.removeEntry(entryId);
                }
            });
        });
    }
    
    document.getElementById('cal-day-details-modal').classList.remove('hidden');
}


// --- RENDERING FARMACI ---
function renderMedsList() {
    const cont = document.getElementById('meds-list');
    if (!cont) return;
    cont.innerHTML = '';

    if (savedMeds.length === 0) {
        cont.innerHTML = '<p style="text-align:center; color:var(--text-secondary); margin-top:1rem; font-size:0.9rem;">Nessun farmaco salvato.</p>';
        return;
    }

    savedMeds.forEach(med => {
        const div = document.createElement('div');
        div.className = 'med-row';
        div.innerHTML = `
            <div>
                <strong>${med.name}</strong> 
                <span style="color:var(--text-secondary); font-size:0.85rem;">${med.dosage ? ' - ' + med.dosage : ''}</span>
            </div>
            <button class="icon-btn btn-del-med" data-id="${med.id}" style="color:#ef4444; width:32px; height:32px; min-width:32px;"><span class="material-symbols-outlined" style="font-size:1.1rem;">delete</span></button>
        `;
        cont.appendChild(div);
    });

    document.querySelectorAll('.btn-del-med').forEach(b => {
        b.addEventListener('click', async (e) => {
            const id = e.currentTarget.dataset.id;
            store.removeMed(id);
        });
    });
}

function renderQuickMeds() {
    const cont = document.getElementById('quick-meds-container');
    if (!cont) return;
    cont.innerHTML = '';
    
    if (savedMeds.length === 0) {
        cont.innerHTML = '<span style="font-size:0.8rem; color:var(--text-secondary);">Nessun farmaco configurato. Aggiungili dalle Opzioni Diario.</span>';
        return;
    }

    savedMeds.forEach(med => {
        const chip = document.createElement('div');
        chip.className = 'selectable-chip med-chip';
        chip.innerText = `${med.name} ${med.dosage ? '('+med.dosage+')' : ''}`;
        cont.appendChild(chip);
    });
    
    // Il binding del click aggiungerà il farmaco come riga istanziata, invece di attivare solo la selezione
    cont.querySelectorAll('.selectable-chip').forEach(chip => {
        chip.addEventListener('click', () => {
            addMedInstance(chip.innerText);
        });
    });
}


// --- EVENTI CALENDARIO BASE ---
// --- BACKUP ---
function buildBackupFile(withTime) {
    const data = { app: 'diario-emicrania', version: 1, exportedAt: new Date().toISOString(), ...store.snapshot() };
    const d = new Date();
    const p = n => String(n).padStart(2, '0');
    const stamp = `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}` + (withTime ? `_${p(d.getHours())}-${p(d.getMinutes())}` : '');
    return new File([JSON.stringify(data, null, 2)], `backup_emicrania_${stamp}.json`, { type: 'application/json' });
}

async function exportBackup() {
    const file = buildBackupFile(false);

    // Foglio di condivisione del telefono (Salva su Drive, WhatsApp, ecc.)
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
        try { await navigator.share({ files: [file], title: file.name }); return; }
        catch (e) { if (e.name === 'AbortError') return; }
    }
    // Altrimenti download normale
    const url = URL.createObjectURL(file);
    const a = document.createElement('a');
    a.href = url; a.download = file.name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// --- BACKUP SU TELEGRAM (bot di ogni utente: token e ID restano solo in questo browser) ---
const TG_KEY = 'migraine_tg_v1';
const TG_PENDING = 'migraine_tg_pending';
const TG_LAST = 'migraine_tg_last';
let tgTimer = null, tgBusy = false;

function tgLoad() { try { return JSON.parse(localStorage.getItem(TG_KEY)) || {}; } catch (e) { return {}; } }
function tgSave(cfg) { localStorage.setItem(TG_KEY, JSON.stringify(cfg)); }

function tgStatus(state, msg) {
    const el = document.getElementById('tg-status');
    if (!el) return;
    const last = Number(localStorage.getItem(TG_LAST));
    const quando = last ? 'Ultimo invio riuscito: ' + new Date(last).toLocaleString('it-IT') : 'Nessun invio ancora.';
    if (state === 'error') { el.style.color = '#ef4444'; el.innerText = 'Errore: ' + msg + (last ? ' — ' + quando : ''); }
    else { el.style.color = ''; el.innerText = quando; }
}

async function sendTelegramBackup() {
    const cfg = tgLoad();
    if (!/^\d+:[\w-]+$/.test(cfg.token || '') || !/^-?\d+$/.test(cfg.chatId || '')) throw new Error('Token o ID non configurati.');
    const file = buildBackupFile(true);
    const form = new FormData();
    form.append('chat_id', cfg.chatId);
    form.append('caption', `Backup diario – ${new Date().toLocaleString('it-IT')} – ${store.getEntries().length} episodi`);
    form.append('document', file);

    let r, j;
    try {
        r = await fetch(`https://api.telegram.org/bot${cfg.token}/sendDocument`, { method: 'POST', body: form });
        j = await r.json().catch(() => ({}));
    } catch (e) { throw new Error('connessione non disponibile.'); }
    if (!r.ok || !j.ok) {
        const d = j.description || ('codice ' + r.status);
        if (r.status === 401) throw new Error('token non valido.');
        if (/chat not found|initiate|blocked/i.test(d)) throw new Error('apri il tuo bot e premi Avvia (oppure controlla l\'ID).');
        throw new Error(d);
    }
    localStorage.setItem(TG_LAST, String(Date.now()));
}

// Dopo ogni modifica attende 5 secondi (così più modifiche ravvicinate fanno un solo invio).
function scheduleTelegramBackup() {
    if (tgLoad().enabled === false || !tgLoad().token) return;
    localStorage.setItem(TG_PENDING, '1');
    clearTimeout(tgTimer);
    tgTimer = setTimeout(flushTelegramBackup, 5000);
}

async function flushTelegramBackup() {
    const cfg = tgLoad();
    if (!cfg.token || cfg.enabled === false || !localStorage.getItem(TG_PENDING)) return;
    if (tgBusy) { clearTimeout(tgTimer); tgTimer = setTimeout(flushTelegramBackup, 3000); return; }
    tgBusy = true;
    localStorage.removeItem(TG_PENDING);   // se arriva una modifica durante l'invio, il flag viene rimesso
    try { await sendTelegramBackup(); tgStatus('ok'); }
    catch (e) { localStorage.setItem(TG_PENDING, '1'); tgStatus('error', e.message); }   // resta in sospeso: riprova alla prossima modifica o quando torna la rete
    finally { tgBusy = false; }
}

async function importBackup(file) {
    try {
        const data = JSON.parse(await file.text());
        if (!data || (!Array.isArray(data.entries) && !Array.isArray(data.meds))) throw new Error('formato');
        const n = store.merge(data);
        alert(n > 0
            ? `Importazione completata: ${n} element${n === 1 ? 'o aggiunto o aggiornato' : 'i aggiunti o aggiornati'}.`
            : 'Il backup non contiene nulla di più recente dei dati già presenti.');
    } catch (e) {
        alert('File non valido: scegli un backup esportato da questa app.');
    }
}

function bindCalendarEvents() {
    document.getElementById('cal-prev').addEventListener('click', () => { currentDate.setMonth(currentDate.getMonth() - 1); renderCalendar(); });
    document.getElementById('cal-next').addEventListener('click', () => { currentDate.setMonth(currentDate.getMonth() + 1); renderCalendar(); });
    document.getElementById('cal-menu-btn').addEventListener('click', () => document.getElementById('cal-menu-modal').classList.remove('hidden'));
}

// --- EVENTI MODALI ---
function bindModalEvents() {
    // Gestione input range per Intensità ed Efficacia
    document.getElementById('add-intensity').addEventListener('input', (e) => {
        document.getElementById('intensity-val').innerText = e.target.value;
    });
    document.getElementById('add-med-efficacy').addEventListener('input', (e) => {
        document.getElementById('efficacy-val').innerText = e.target.value;
    });

    document.getElementById('btn-close-menu').addEventListener('click', () => document.getElementById('cal-menu-modal').classList.add('hidden'));

    // BACKUP: ESPORTA / IMPORTA JSON
    document.getElementById('btn-backup-export').addEventListener('click', exportBackup);
    const backupFile = document.getElementById('backup-file');
    document.getElementById('btn-backup-import').addEventListener('click', () => backupFile.click());
    backupFile.addEventListener('change', async () => {
        const f = backupFile.files[0];
        backupFile.value = '';
        if (f) await importBackup(f);
    });

    // BACKUP SU TELEGRAM
    const tgModal = document.getElementById('cal-telegram-modal');
    const tgToken = document.getElementById('tg-token');
    const tgChat = document.getElementById('tg-chat');
    const tgEnabled = document.getElementById('tg-enabled');
    document.getElementById('btn-open-telegram').addEventListener('click', () => {
        const cfg = tgLoad();
        tgToken.value = cfg.token || '';
        tgChat.value = cfg.chatId || '';
        tgEnabled.checked = cfg.token ? cfg.enabled !== false : true;
        tgStatus();
        document.getElementById('cal-menu-modal').classList.add('hidden');
        tgModal.classList.remove('hidden');
    });
    document.getElementById('btn-close-telegram').addEventListener('click', () => tgModal.classList.add('hidden'));

    const saveTgForm = () => {
        const token = tgToken.value.trim();
        const chatId = tgChat.value.trim();
        if (!/^\d+:[\w-]+$/.test(token)) { alert('Il token non sembra valido: deve essere simile a 123456789:AAH... (lo ricevi da @BotFather).'); return false; }
        if (!/^-?\d+$/.test(chatId)) { alert('L\'ID deve essere solo un numero (lo ricevi da @userinfobot).'); return false; }
        tgSave({ token, chatId, enabled: tgEnabled.checked });
        return true;
    };
    document.getElementById('btn-tg-save').addEventListener('click', () => {
        if (saveTgForm()) { tgStatus(); alert('Impostazioni salvate.'); }
    });
    document.getElementById('btn-tg-test').addEventListener('click', async (e) => {
        if (!saveTgForm()) return;
        const btn = e.currentTarget;
        const old = btn.innerText;
        btn.disabled = true; btn.innerText = 'Invio...';
        try { await sendTelegramBackup(); tgStatus('ok'); }
        catch (err) { tgStatus('error', err.message); }
        finally { btn.disabled = false; btn.innerText = old; }
    });
    document.getElementById('btn-tg-clear').addEventListener('click', () => {
        if (!confirm('Rimuovere token e ID da questo dispositivo? I dati del diario restano.')) return;
        [TG_KEY, TG_PENDING, TG_LAST].forEach(k => localStorage.removeItem(k));
        tgToken.value = ''; tgChat.value = ''; tgEnabled.checked = true;
        tgStatus();
    });
    document.getElementById('btn-close-add').addEventListener('click', () => document.getElementById('cal-add-modal').classList.add('hidden'));
    document.getElementById('btn-close-day-details').addEventListener('click', () => document.getElementById('cal-day-details-modal').classList.add('hidden'));
    
    // Gestione Aggiunta Farmaco Custom con orario
    document.getElementById('btn-add-custom-med').addEventListener('click', () => {
        const name = document.getElementById('add-custom-med-name').value.trim();
        const time = document.getElementById('add-custom-med-time').value;
        if (name) {
            addMedInstance(name, time);
            document.getElementById('add-custom-med-name').value = '';
            document.getElementById('add-custom-med-time').value = '';
        }
    });
    
    // Gestione Accordion e Chip Generici (Statici)
    document.querySelectorAll('.migraine-accordion-header').forEach(header => {
        header.addEventListener('click', () => {
            header.parentElement.classList.toggle('open');
        });
    });

    // Per localizzazione, sintomi, e trigger (esclude i farmaci che hanno ora logica custom)
    document.querySelectorAll('#chips-location .selectable-chip, #chips-symptoms .selectable-chip, #chips-triggers .selectable-chip').forEach(chip => {
        chip.addEventListener('click', () => {
            if (chip.classList.contains('single-select')) {
                chip.parentElement.querySelectorAll('.single-select').forEach(c => c.classList.remove('selected'));
                chip.classList.add('selected');
            } else {
                chip.classList.toggle('selected');
            }
        });
    });

    // GESTIONE FARMACI MODALE
    document.getElementById('btn-open-meds').addEventListener('click', () => {
        document.getElementById('cal-meds-modal').classList.remove('hidden');
        document.getElementById('cal-menu-modal').classList.add('hidden');
    });
    document.getElementById('btn-close-meds').addEventListener('click', () => document.getElementById('cal-meds-modal').classList.add('hidden'));
    
    document.getElementById('btn-add-med').addEventListener('click', async () => {
        const name = document.getElementById('new-med-name').value.trim();
        const dosage = document.getElementById('new-med-dose').value.trim();
        if (!name) return alert("Inserisci il nome del farmaco.");
        
        try {
            store.saveMed({ name, dosage });
            document.getElementById('new-med-name').value = '';
            document.getElementById('new-med-dose').value = '';
        } catch (e) {
            console.error(e);
            alert("Errore salvataggio farmaco.");
        }
    });

    // GESTIONE STATISTICHE MODALE
    document.getElementById('btn-open-stats').addEventListener('click', () => {
        const mm = String(currentDate.getMonth() + 1).padStart(2, '0');
        const yyyy = currentDate.getFullYear();
        document.getElementById('stats-month').value = `${yyyy}-${mm}`;
        document.getElementById('stats-year').value = yyyy;
        
        document.getElementById('cal-stats-modal').classList.remove('hidden');
        document.getElementById('cal-menu-modal').classList.add('hidden');
        document.getElementById('stats-results').innerHTML = ''; 
    });

    document.getElementById('btn-close-stats').addEventListener('click', () => {
        document.getElementById('cal-stats-modal').classList.add('hidden');
    });

    document.getElementById('stats-period-type').addEventListener('change', (e) => {
        document.getElementById('stats-inputs-month').style.display = 'none';
        document.getElementById('stats-inputs-year').style.display = 'none';
        document.getElementById('stats-inputs-custom').style.display = 'none';
        
        if(e.target.value === 'month') document.getElementById('stats-inputs-month').style.display = 'block';
        if(e.target.value === 'year') document.getElementById('stats-inputs-year').style.display = 'block';
        if(e.target.value === 'custom') document.getElementById('stats-inputs-custom').style.display = 'flex';
    });

    document.getElementById('btn-calc-stats').addEventListener('click', () => {
        const periodType = document.getElementById('stats-period-type').value;
        let filtered = [];

        if (periodType === 'month') {
            const val = document.getElementById('stats-month').value;
            if (!val) return alert("Seleziona un mese.");
            filtered = entries.filter(e => e.date.startsWith(val));
        } else if (periodType === 'year') {
            const val = document.getElementById('stats-year').value;
            if (!val) return alert("Inserisci un anno.");
            filtered = entries.filter(e => e.date.startsWith(val));
        } else if (periodType === 'custom') {
            const from = document.getElementById('stats-date-from').value;
            const to = document.getElementById('stats-date-to').value;
            if (!from || !to) return alert("Seleziona data di inizio e fine.");
            if (from > to) return alert("La data di inizio non può superare la data di fine.");
            filtered = entries.filter(e => e.date >= from && e.date <= to);
        }

        const resContainer = document.getElementById('stats-results');
        if (filtered.length === 0) {
            resContainer.innerHTML = '<p style="text-align:center; color:var(--text-secondary);">Nessun episodio in questo periodo.</p>';
            return;
        }

        const total = filtered.length;
        
        let intensityCounts = {};
        let medsTakenCount = 0;
        let locations = {};
        let symptoms = {};
        let triggers = {};

        filtered.forEach(e => {
            if(e.intensity) {
                intensityCounts[e.intensity] = (intensityCounts[e.intensity] || 0) + 1;
            }
            
            // Questo gestisce perfettamente anche le nuove stringhe "Farmaco (Ora)" elaborate sotto
            if (e.meds && e.meds.trim() !== '') {
                const mList = e.meds.split(',').filter(x => x.trim() !== '');
                medsTakenCount += mList.length;
            }

            const countItems = (str, targetObj) => {
                if (!str) return;
                str.split(',').forEach(item => {
                    let val = item.trim();
                    if(val !== '') targetObj[val] = (targetObj[val] || 0) + 1;
                });
            };

            countItems(e.location, locations);
            countItems(e.symptoms, symptoms);
            countItems(e.triggers, triggers);
        });

        const renderBar = (label, count, maxVal) => {
            const pct = Math.round((count / Math.max(maxVal, 1)) * 100);
            return `
                <div style="margin-bottom: 4px; font-size: 0.85rem; display:flex; justify-content:space-between;">
                    <span>${label}</span>
                    <span>${count} (${pct}%)</span>
                </div>
                <div style="width: 100%; background: var(--border-soft); height: 6px; border-radius: 3px; margin-bottom: 8px;">
                    <div style="width: ${pct}%; background: var(--accent-color, #ef4444); height: 100%; border-radius: 3px;"></div>
                </div>
            `;
        };

        const generateSectionHtml = (title, dataObj, totalReference) => {
            const keys = Object.keys(dataObj).sort((a,b) => dataObj[b] - dataObj[a]);
            if(keys.length === 0) return '';
            let html = `<div style="background: rgba(150,150,150,0.05); padding: 10px; border-radius: 8px; margin-bottom: 10px;">
                            <strong style="display:block; margin-bottom: 8px;">${title}</strong>`;
            keys.forEach(k => {
                html += renderBar(k, dataObj[k], totalReference);
            });
            html += `</div>`;
            return html;
        };

        let html = `
            <div style="display:flex; gap:0.5rem; justify-content:center;">
                <div style="flex:1; text-align:center; padding: 10px; background: rgba(239, 68, 68, 0.1); border: 1px solid rgba(239, 68, 68, 0.3); border-radius: 8px;">
                    <h3 style="margin: 0; color: #ef4444;">${total}</h3>
                    <span style="font-size:0.8rem;">Episodi Totali</span>
                </div>
                <div style="flex:1; text-align:center; padding: 10px; background: rgba(150, 150, 150, 0.1); border: 1px solid var(--border-soft); border-radius: 8px;">
                    <h3 style="margin: 0;">${medsTakenCount}</h3>
                    <span style="font-size:0.8rem;">Farmaci Assunti</span>
                </div>
            </div>
        `;

        html += generateSectionHtml("Intensità Registrate", intensityCounts, total);
        html += generateSectionHtml("Localizzazione e Tipo", locations, total);
        html += generateSectionHtml("Sintomi e Preavviso", symptoms, total);
        html += generateSectionHtml("Fattori Scatenanti", triggers, total);

        resContainer.innerHTML = html;
    });

    // Apre la finestra di aggiunta nuova
    document.getElementById('btn-add-from-day').addEventListener('click', () => {
        document.getElementById('edit-entry-id').value = ''; 
        
        // Svuota form
        document.getElementById('add-start').value = '';
        document.getElementById('add-end-date').value = '';
        document.getElementById('add-end').value = '';
        
        document.getElementById('add-started-sleep').checked = false;
        document.getElementById('add-ended-sleep').checked = false;
        
        document.getElementById('add-intensity').value = 5;
        document.getElementById('intensity-val').innerText = 5;
        document.getElementById('add-med-efficacy').value = 5;
        document.getElementById('efficacy-val').innerText = 5;

        setCategoryData('chips-location', 'add-location-other', '');
        setCategoryData('chips-symptoms', 'add-symptoms-other', '');
        setCategoryData('chips-triggers', 'add-triggers-other', '');
        document.getElementById('add-notes').value = '';
        
        // Svuota sezione farmaci
        document.getElementById('selected-meds-list').innerHTML = '';
        document.getElementById('add-custom-med-name').value = '';
        document.getElementById('add-custom-med-time').value = '';
        document.getElementById('add-meds-other').value = '';

        // Chiude gli accordion
        document.querySelectorAll('.migraine-accordion').forEach(acc => acc.classList.remove('open'));

        document.getElementById('add-modal-title').innerText = "Registra Episodio";
        
        document.getElementById('cal-day-details-modal').classList.add('hidden');
        document.getElementById('cal-add-modal').classList.remove('hidden');
    });

    // GESTIONE ESPORTAZIONE PDF
    document.getElementById('btn-open-export').addEventListener('click', () => {
        const mm = String(currentDate.getMonth() + 1).padStart(2, '0');
        const yyyy = currentDate.getFullYear();
        document.getElementById('export-month-from').value = `${yyyy}-${mm}`;
        document.getElementById('export-month-to').value = `${yyyy}-${mm}`;
        
        document.getElementById('cal-export-modal').classList.remove('hidden');
        document.getElementById('cal-menu-modal').classList.add('hidden');
    });
    
    document.getElementById('btn-close-export').addEventListener('click', () => {
        document.getElementById('cal-export-modal').classList.add('hidden');
    });

    document.getElementById('btn-do-export').addEventListener('click', async () => {
        const valFrom = document.getElementById('export-month-from').value; 
        const valTo = document.getElementById('export-month-to').value; 
        
        if (!valFrom || !valTo) return alert("Seleziona il periodo di esportazione.");
        if (valFrom > valTo) return alert("Il mese di fine non può precedere quello di inizio.");

        const epsToExport = entries.filter(e => {
            const entryMonthStr = e.date.substring(0, 7); 
            return entryMonthStr >= valFrom && entryMonthStr <= valTo;
        });
        
        epsToExport.sort((a,b) => {
            if (a.date !== b.date) return a.date.localeCompare(b.date);
            if (!a.startTime) return -1;
            if (!b.startTime) return 1;
            return a.startTime.localeCompare(b.startTime);
        });
        
        const btn = document.getElementById('btn-do-export');
        const oldText = btn.innerText;
        btn.innerText = "Creazione PDF in corso...";
        btn.disabled = true;

        try {
            if (typeof html2pdf === 'undefined') {
                await new Promise((resolve, reject) => {
                    const script = document.createElement('script');
                    script.src = 'https://cdnjs.cloudflare.com/ajax/libs/html2pdf.js/0.10.1/html2pdf.bundle.min.js';
                    script.onload = resolve;
                    script.onerror = reject;
                    document.head.appendChild(script);
                });
            }

            const monthNames = ["Gennaio", "Febbraio", "Marzo", "Aprile", "Maggio", "Giugno", "Luglio", "Agosto", "Settembre", "Ottobre", "Novembre", "Dicembre"];
            
            // Per gestire correttamente le pagine formattiamo il codice DOM invisibile 
            const wrapper = document.createElement('div');
            wrapper.style.position = 'absolute';
            wrapper.style.left = '-9999px';
            wrapper.style.top = '0';
            wrapper.style.width = '794px'; 
            wrapper.style.background = '#fff';
            document.body.appendChild(wrapper);

            let finalHtml = '';

            if (epsToExport.length === 0) {
                finalHtml = `
                    <div class="pdf-page" style="width:794px; height:1123px; padding:40px; box-sizing:border-box; background:#fff; font-family:sans-serif; position:relative;">
                        <h1 style="text-align:center; color:#ef4444; margin: 0 0 20px 0; font-size: 24px;">Diario Emicrania</h1>
                        <p style="text-align:center; font-size: 14px; margin-bottom:30px; color:#64748b;">Periodo: da ${valFrom} a ${valTo}</p>
                        <p style="text-align:center;">Nessun episodio registrato in questo periodo.</p>
                    </div>
                `;
            } else {
                // Raggruppo gli episodi per mese
                const grouped = {};
                epsToExport.forEach(ep => {
                    const monthKey = ep.date.substring(0, 7); 
                    if(!grouped[monthKey]) grouped[monthKey] = [];
                    grouped[monthKey].push(ep);
                });
                const monthKeys = Object.keys(grouped).sort();

                for (const mk of monthKeys) {
                    const [yy, mm] = mk.split('-');
                    const mName = `${monthNames[parseInt(mm, 10)-1]} ${yy}`;
                    
                    let pageNum = 1;
                    
                    // Funzione per generare una nuova pagina A4 (794x1123 pixel, circa 210x297mm)
                    function createPage(isCont) {
                        const page = document.createElement('div');
                        page.className = 'pdf-page';
                        page.style.width = '794px';
                        page.style.height = '1123px';
                        page.style.padding = '40px';
                        page.style.boxSizing = 'border-box';
                        page.style.position = 'relative';
                        page.style.pageBreakAfter = 'always';
                        page.style.fontFamily = 'sans-serif';
                        page.style.background = '#fff';
                        page.style.color = '#000';
                        
                        const header = document.createElement('div');
                        if (!isCont) {
                            header.innerHTML = `<h1 style="text-align:center; color:#ef4444; margin: 0 0 20px 0; font-size: 24px;">${mName}</h1>`;
                        } else {
                            header.innerHTML = `<h3 style="text-align:center; color:#ef4444; margin: 0 0 20px 0; font-size: 18px;">${mName} (continua)</h3>`;
                        }
                        
                        const content = document.createElement('div');
                        content.style.maxHeight = '980px'; 
                        
                        const footer = document.createElement('div');
                        footer.style.position = 'absolute';
                        footer.style.bottom = '40px';
                        footer.style.right = '40px';
                        footer.style.fontSize = '12px';
                        footer.style.color = '#64748b';
                        footer.innerText = `Pagina ${pageNum}`;
                        
                        page.appendChild(header);
                        page.appendChild(content);
                        page.appendChild(footer);
                        
                        return { el: page, content: content };
                    }
                    
                    let curr = createPage(false);
                    wrapper.appendChild(curr.el);
                    
                    for (const ep of grouped[mk]) {
                        const [y, m, d] = ep.date.split('-');
                        
                        let timeStr = ep.startedInSleep ? 'Nel sonno' : (ep.startTime ? ep.startTime : 'N/D');
                        if (ep.endTime || ep.endedInSleep || (ep.endDate && ep.endDate !== ep.date)) {
                            let endStr = ep.endedInSleep ? 'Nel sonno' : (ep.endTime ? ep.endTime : 'N/D');
                            if (ep.endDate && ep.endDate !== ep.date) {
                                const [ey, em, ed] = ep.endDate.split('-');
                                endStr += ` (del ${ed}/${em})`;
                            }
                            timeStr += ` - ${endStr}`;
                        }

                        const epHtml = `
                            <div style="border: 1px solid #cbd5e1; border-left: 5px solid #ef4444; border-radius: 6px; padding: 10px 15px; margin-bottom: 15px; background: #f8fafc;">
                                <div style="display:flex; justify-content:space-between; margin-bottom:8px; border-bottom:1px solid #e2e8f0; padding-bottom:5px;">
                                    <strong style="font-size:16px;">Data: ${d}/${m}/${y}</strong>
                                    <span style="font-size:14px; font-weight:bold; color:#ef4444;">Orario: ${timeStr}</span>
                                </div>
                                <table style="width:100%; font-size:13px; line-height:1.5;">
                                    ${ep.intensity ? `<tr><td style="width:30%; font-weight:bold; color:#475569;">Intensità:</td><td>${ep.intensity} / 10</td></tr>` : ''}
                                    ${(ep.medEfficacy && ep.meds && ep.meds.trim() !== '') ? `<tr><td style="font-weight:bold; color:#475569;">Efficacia Farmaco:</td><td>${ep.medEfficacy} / 10</td></tr>` : ''}
                                    ${ep.location ? `<tr><td style="font-weight:bold; color:#475569;">Localizzazione/Tipo:</td><td>${ep.location}</td></tr>` : ''}
                                    ${ep.symptoms ? `<tr><td style="font-weight:bold; color:#475569;">Sintomi/Preavviso:</td><td>${ep.symptoms}</td></tr>` : ''}
                                    ${ep.triggers ? `<tr><td style="font-weight:bold; color:#475569;">Fattori Scatenanti:</td><td>${ep.triggers}</td></tr>` : ''}
                                    ${ep.meds ? `<tr><td style="font-weight:bold; color:#475569;">Farmaci:</td><td>${ep.meds}</td></tr>` : ''}
                                    ${ep.notes ? `<tr><td style="font-weight:bold; color:#475569; vertical-align:top;">Note:</td><td>${ep.notes}</td></tr>` : ''}
                                </table>
                            </div>
                        `;
                        
                        const tempDiv = document.createElement('div');
                        tempDiv.innerHTML = epHtml;
                        const node = tempDiv.firstElementChild;
                        
                        curr.content.appendChild(node);
                        
                        // Sistema di impaginazione automatico per non sbordare dalla pagina
                        if (curr.content.scrollHeight > 980) {
                            curr.content.removeChild(node); // Sforato, lo rimuovo
                            
                            // Caso in cui la singola nota è già troppo grande anche da sola
                            if (curr.content.children.length === 0) {
                                curr.content.appendChild(node);
                                finalHtml += curr.el.outerHTML;
                                wrapper.removeChild(curr.el);
                                pageNum++;
                                curr = createPage(true);
                                wrapper.appendChild(curr.el);
                            } else {
                                // Salva pagina attuale e creane un'altra
                                finalHtml += curr.el.outerHTML;
                                wrapper.removeChild(curr.el);
                                pageNum++;
                                curr = createPage(true);
                                wrapper.appendChild(curr.el);
                                curr.content.appendChild(node);
                                
                                // Controllo sicurezza aggiuntivo
                                if (curr.content.scrollHeight > 980) {
                                    finalHtml += curr.el.outerHTML;
                                    wrapper.removeChild(curr.el);
                                    pageNum++;
                                    curr = createPage(true);
                                    wrapper.appendChild(curr.el);
                                }
                            }
                        }
                    }
                    // Aggiungo la coda finale di questo mese
                    finalHtml += curr.el.outerHTML;
                    wrapper.removeChild(curr.el);
                }
            }
            
            document.body.removeChild(wrapper);

            const element = document.createElement('div');
            element.innerHTML = finalHtml;

            const opt = {
              margin:       0, // Zero margini perché li abbiamo già nel nostro CSS custom
              filename:     `Diario_Emicrania_${valFrom}_${valTo}.pdf`,
              image:        { type: 'jpeg', quality: 0.98 },
              html2canvas:  { scale: 2 },
              jsPDF:        { unit: 'px', format: [794, 1123], orientation: 'portrait' } 
            };

            await html2pdf().set(opt).from(element).save();

            document.getElementById('cal-export-modal').classList.add('hidden');
        } catch(err) {
            console.error(err);
            alert("Errore generazione PDF");
        } finally {
            btn.innerText = oldText;
            btn.disabled = false;
        }
    });

    // SALVATAGGIO EVENTO 
    document.getElementById('btn-save-entry').addEventListener('click', async () => {
        const editId = document.getElementById('edit-entry-id').value; 
        const date = document.getElementById('add-date').value;
        
        // Estrai dati farmaci dinamici
        const medRows = Array.from(document.getElementById('selected-meds-list').children);
        const medicationDetails = medRows.map(row => {
            return {
                name: row.querySelector('.med-name').innerText,
                time: row.querySelector('.med-time').value
            };
        });
        const medNotes = document.getElementById('add-meds-other').value.trim();
        
        // Genera la stringa compatibile 'meds' combinando nome e orario
        const medsFormat = medicationDetails.map(m => m.time ? `${m.name} (${m.time})` : m.name);
        if (medNotes) medsFormat.push(medNotes);
        
        const payload = {
            date: date,
            startTime: document.getElementById('add-start').value,
            startedInSleep: document.getElementById('add-started-sleep').checked,
            endDate: document.getElementById('add-end-date').value,
            endTime: document.getElementById('add-end').value,
            endedInSleep: document.getElementById('add-ended-sleep').checked,
            intensity: document.getElementById('add-intensity').value,
            medEfficacy: document.getElementById('add-med-efficacy').value,
            location: getCategoryData('chips-location', 'add-location-other'),
            symptoms: getCategoryData('chips-symptoms', 'add-symptoms-other'),
            triggers: getCategoryData('chips-triggers', 'add-triggers-other'),
            medicationDetails: medicationDetails, // Struttura ad array
            medNotes: medNotes,
            meds: medsFormat.join(', '), // Mantiene compatibilità perfetta con visualizzazione PDF e statistiche
            notes: document.getElementById('add-notes').value.trim()
        };

        try {
            store.saveEntry(payload, editId || undefined);
            
            document.getElementById('cal-add-modal').classList.add('hidden');
        } catch (e) {
            console.error(e);
            alert("Errore durante il salvataggio.");
        }
    });
}
