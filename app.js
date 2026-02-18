/* Alert simples pra qualquer erro (pra não ficar “tela em branco”) */
window.onerror = (msg, src, line, col, err) => {
  alert("Erro no Kanban:\n" + msg + "\nLinha: " + line + ":" + col);
  console.error(err || msg);
};

(() => {
  const STORAGE_KEY = "ummense_like_kanban_dark_v1";

  const COLS = [
    { id:"backlog", title:"Backlog", icon:"📥" },
    { id:"todo",    title:"A fazer", icon:"🎯" },
    { id:"doing",   title:"Em andamento", icon:"⏳" },
    { id:"review",  title:"Revisão", icon:"🔎" },
    { id:"done",    title:"Concluído", icon:"🏁" },
  ];

  const nowTs = () => Date.now();
  const pad = n => String(n).padStart(2,"0");
  const fmt = (ts) => {
    const d = new Date(ts);
    const dd = pad(d.getDate()), mm = pad(d.getMonth()+1), yyyy = d.getFullYear();
    const hh = pad(d.getHours()), mi = pad(d.getMinutes());
    return `${dd}/${mm}/${yyyy} ${hh}:${mi}`;
  };

  const startOfDay = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const dateISO = (ts) => {
    const d = new Date(ts);
    return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
  };

  function dueHuman(dueTs){
    if (!dueTs) return "Sem prazo";
    const today = startOfDay(new Date());
    const d = startOfDay(new Date(dueTs));
    const diff = Math.round((d - today) / (24*3600*1000));
    if (diff === 0) return "Hoje";
    if (diff === 1) return "Amanhã";
    if (diff === -1) return "Ontem";
    if (diff > 1) return `Em ${diff} dias`;
    return `Atrasado (${Math.abs(diff)}d)`;
  }

  function dueClass(dueTs){
    if (!dueTs) return "none";
    const today = startOfDay(new Date());
    const d = startOfDay(new Date(dueTs));
    const diff = Math.round((d - today) / (24*3600*1000));
    if (diff === 0) return "today";
    if (diff > 0) return "future";
    return "overdue";
  }

  function uid(){
    return Math.random().toString(16).slice(2) + "-" + Math.random().toString(16).slice(2);
  }

  function colName(colId){
    return (COLS.find(c=>c.id===colId)?.title) || colId;
  }

  function escapeHtml(str){
    return String(str)
      .replaceAll("&","&amp;")
      .replaceAll("<","&lt;")
      .replaceAll(">","&gt;")
      .replaceAll('"',"&quot;")
      .replaceAll("'","&#039;");
  }

  function seed(){
    return {
      cards: {},
      columns: { backlog:[], todo:[], doing:[], review:[], done:[] },
      archived: []
    };
  }

  function seedWithExamples(){
    const s = seed();

    const make = (title, col, dueKind) => {
      const id = uid();
      let due = null;
      const base = startOfDay(new Date());

      if (dueKind === "today") due = base;
      if (dueKind === "tomorrow") due = base + 1*24*3600*1000;
      if (dueKind === "overdue") due = base - 1*24*3600*1000;

      s.cards[id] = {
        id, title,
        details: "",
        dueTs: due,
        createdAt: nowTs(),
        tasks: [],
        timeline: [
          { type:"log", ts: nowTs(), text:"Criou o card." },
          { type:"log", ts: nowTs(), text:`Adicionou o card na coluna ${colName(col)}.` },
          ...(dueKind ? [{ type:"log", ts: nowTs(), text:`Definiu o prazo do card para ${dueHuman(due)}.` }] : [])
        ]
      };
      s.columns[col].push(id);
    };

    make("[3D Cure] Cadastrar tarefas TaskRush", "todo", "today");
    make("[Under] Verificar orçamentos/campanhas/URLs ativas", "todo", "today");
    make("[Paytrack] Novos públicos LinkedIn", "todo", "tomorrow");
    make("[Paytrack] Otimização de ads", "review", "overdue");
    make("[TODOS] atualizar planilhas de clientes", "doing", null);
    make("[Sestini] Demandas reunião", "done", null);

    return s;
  }

// ===================== Persistência (local + online) =====================

function loadLocal(){
  try{
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return seedWithExamples();
    const parsed = JSON.parse(raw);

    parsed.cards ||= {};
    parsed.columns ||= {};
    parsed.archived ||= [];

    // garantir colunas
    for (const c of COLS) parsed.columns[c.id] ||= [];

    return parsed;
  }catch(e){
    return seedWithExamples();
  }
}

async function loadOnline(){
  if (!(sbUser && sb)) return null;
  try{
    const { data, error } = await sb
      .from("boards")
      .select("data")
      .eq("user_id", sbUser.id)
      .maybeSingle();

    if (error) return null;
    if (data && data.data) return data.data;
    return null;
  }catch(e){
    return null;
  }
}

async function load(){
  // se estiver logado → tenta carregar online, senão cai pro local
  const online = await loadOnline();
  if (online) return online;
  return loadLocal();
}

function saveLocal(){
  try{
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  }catch(e){}
}

async function saveOnline(){
  if (!(sbUser && sb)) return;
  try{
    await sb
      .from("boards")
      .upsert({
        user_id: sbUser.id,
        data: state,
        updated_at: new Date().toISOString()
      });
  }catch(e){}
}

// salva sem travar o app (debounce)
let _saveT = null;
function saveSoon(){
  clearTimeout(_saveT);
  _saveT = setTimeout(() => { save(); }, 350);
}

function save(){
  // se estiver logado → salva online; senão salva local
  if (sbUser && sb){
    saveOnline();
  }else{
    saveLocal();
  }
}

let state = loadLocal();


  // ✅ sanitiza para nunca quebrar por id órfão
  function sanitizeState(){
    for (const c of COLS){
      const arr = state.columns[c.id] || [];
      state.columns[c.id] = arr.filter(id => state.cards && state.cards[id]);
    }
    state.archived = (state.archived || []).filter(id => state.cards && state.cards[id]);
  }
  sanitizeState();

  function updateArchivedSidebar(){
    const archBadge = document.getElementById("archBadge");
    const archCount = document.getElementById("archCount");
    if (!archBadge || !archCount) return;
    const n = state.archived.length;
    archBadge.textContent = n;
    archCount.textContent = n;
  }


// (save antigo removido)



  // Helpers
  function findCardColumn(cardId){
    for (const col of COLS){
      const arr = state.columns[col.id];
      const idx = arr.indexOf(cardId);
      if (idx >= 0) return col.id;
    }
    return null;
  }
  function removeFromAllColumns(cardId){
    for (const col of COLS){
      const arr = state.columns[col.id];
      const i = arr.indexOf(cardId);
      if (i >= 0) arr.splice(i, 1);
    }
  }

  function log(cardId, text){
    const c = state.cards[cardId];
    if (!c) return;
    c.timeline.unshift({ type:"log", ts: nowTs(), text });
    save();
  }
  function note(cardId, text){
    const c = state.cards[cardId];
    if (!c) return;
    c.timeline.unshift({ type:"note", ts: nowTs(), text });
    save();
  }

  function createCard(title, colId){
    const id = uid();
    const due = null; // default: sem prazo
    state.cards[id] = {
      id,
      title,
      details:"",
      dueTs: due,
      createdAt: nowTs(),
      tasks: [],
      timeline: [
        { type:"log", ts: nowTs(), text:"Criou o card." },
        { type:"log", ts: nowTs(), text:`Adicionou o card na coluna ${colName(colId)}.` },
      ]
    };
    state.columns[colId].unshift(id);
    save();
    render();
    return id;
  }

  function structuredCloneSafe(obj){
    try { return structuredClone(obj); }
    catch { return JSON.parse(JSON.stringify(obj)); }
  }

  function duplicateCard(cardId){
    const c = state.cards[cardId];
    if (!c) return;
    const colId = findCardColumn(cardId) || "todo";
    const id = uid();

    state.cards[id] = {
      ...structuredCloneSafe(c),
      id,
      title: c.title + " (cópia)",
      createdAt: nowTs(),
      timeline: [
        { type:"log", ts: nowTs(), text:"Criou o card (duplicado)." },
        { type:"log", ts: nowTs(), text:`Adicionou o card na coluna ${colName(colId)}.` },
      ]
    };
    state.columns[colId].unshift(id);
    save();
    render();
  }

  function archiveCard(cardId){
    const c = state.cards[cardId];
    if (!c) return;
    const from = findCardColumn(cardId);

    removeFromAllColumns(cardId);
    if (!state.archived.includes(cardId)) state.archived.unshift(cardId);

    log(cardId, `Arquivou o card${from ? ` (veio de ${colName(from)})` : ""}.`);
    save();
    render();
  }

  function restoreCard(cardId, toCol="todo"){
    const c = state.cards[cardId];
    if (!c) return;

    state.archived = state.archived.filter(id => id !== cardId);
    state.columns[toCol].unshift(cardId);
    log(cardId, `Restaurou o card para ${colName(toCol)}.`);
    save();
    render();
  }

  function deleteCard(cardId){
    removeFromAllColumns(cardId);
    state.archived = state.archived.filter(id => id !== cardId);
    delete state.cards[cardId];
    save();
    render();
  }

  function moveCard(cardId, toCol){
    const from = findCardColumn(cardId);
    if (!from || from === toCol) return;

    const idx = state.columns[from].indexOf(cardId);
    if (idx >= 0) state.columns[from].splice(idx, 1);
    state.columns[toCol].unshift(cardId);

    log(cardId, `Moveu o card de ${colName(from)} → ${colName(toCol)}.`);
    save();
    render();

    if (activeCardId === cardId){
      document.getElementById("cardWhere").textContent = `Na coluna: ${colName(toCol)}`;
    }
  }

  // DOM
  const board = document.getElementById("board");
  const archiveDrop = document.getElementById("archiveDrop");
  const viewArchivedBtn = document.getElementById("viewArchivedBtn");

  // =====================
// Supabase (Login)
// =====================
const SUPABASE_URL = "https://bknethktrrecdfllndyo.supabase.co/";
const SUPABASE_ANON_KEY = "sb_publishable_9v3vkdV27tpLF059ehpi8A_trs8Lymo";
let sb = null;
let sbUser = null;

function setGateUI(){
  const gate = document.getElementById("loginGate");
  const board = document.getElementById("board");
  const topbar = document.querySelector(".topbar");

  const logged = !!sbUser;

  if (gate) gate.classList.toggle("open", !logged);
  if (board) board.style.display = logged ? "" : "none";
  if (topbar) topbar.style.display = logged ? "" : "none";
}
    
const authBtn = document.getElementById("authBtn");
const authStatus = document.getElementById("authStatus");


// Tela de login (gate)
const authGate = document.getElementById("authGate");
const loginEmail = document.getElementById("loginEmail");
const loginPass = document.getElementById("loginPass");
const loginBtn = document.getElementById("loginBtn");
const signupBtn = document.getElementById("signupBtn");

function lockApp(){
  document.body.classList.add("auth-locked");
}

function unlockApp(){
  document.body.classList.remove("auth-locked");
}


async function signInWithPassword(email, password){
  if (!sb) return;
  const { error } = await sb.auth.signInWithPassword({ email, password });
  if (error) throw error;
}

async function signUpWithPassword(email, password){
  if (!sb) return;
  const { error } = await sb.auth.signUp({ email, password });
  if (error) throw error;
}

let signingUp = false;

signupBtn?.addEventListener("click", async () => {
  if (signingUp) return;
  signingUp = true;
  signupBtn.disabled = true;

  const email = (loginEmail?.value || "").trim();
  const pass  = (loginPass?.value || "").trim();
  if (!email || !pass) {
    alert("Preencha email e senha.");
    signupBtn.disabled = false;
    signingUp = false;
    return;
  }

  try {
    await signUpWithPassword(email, pass);
    alert("Conta criada! Agora clique em Entrar.");
  } catch (e) {
    const msg = (e?.message || String(e));
    if (msg.toLowerCase().includes("duplicate") || msg.toLowerCase().includes("already")) {
      alert("Esse email já tem conta. Clique em Entrar.");
    } else {
      alert("Não consegui criar a conta: " + msg);
    }
  } finally {
    signupBtn.disabled = false;
    signingUp = false;
  }
});

// Enter no campo de senha = entrar
loginPass?.addEventListener("keydown", (e) => {
  if (e.key === "Enter") loginBtn?.click();
});

function setAuthUI(){
  if (!authBtn) return;

  if (sbUser){
    authBtn.textContent = "Sair";
    authBtn.title = "Sair da conta";
    if (authStatus) authStatus.textContent = sbUser.email || "Logado";
  } else {
    authBtn.textContent = "Entrar";
    authBtn.title = "Entrar para sincronizar";
    if (authStatus) authStatus.textContent = "";
  }
}

function initSupabase(){
  setGateUI(); // mostra a tela de login enquanto não estiver logado
  if (!window.supabase) return;
  if (!SUPABASE_URL.includes("http")) return; // ainda não colou as keys
  
  sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

    // ---- Login Gate (email/senha)
  const loginBtn = document.getElementById("loginBtn");
  const signupBtn = document.getElementById("signupBtn");
  const loginEmail = document.getElementById("loginEmail");
  const loginPass = document.getElementById("loginPass");

  async function doLogin(){
    const email = (loginEmail?.value || "").trim();
    const password = (loginPass?.value || "").trim();
    if (!email || !password) { alert("Preencha email e senha."); return; }

    const { error } = await sb.auth.signInWithPassword({ email, password });
    if (error) alert("Erro ao entrar: " + error.message);
  }

  async function doSignup(){
    const email = (loginEmail?.value || "").trim();
    const password = (loginPass?.value || "").trim();
    if (!email || !password) { alert("Preencha email e senha."); return; }

    const { error } = await sb.auth.signUp({ email, password });
    if (error) alert("Erro ao criar conta: " + error.message);
    else alert("Conta criada! Agora clique em Entrar.");
  }

 loginBtn?.addEventListener("click", doLogin);
signupBtn?.addEventListener("click", doSignup);

  loginPass?.addEventListener("keydown", (e) => {
    if (e.key === "Enter") doLogin();
  });

  // sessão atual
  sb.auth.getSession().then(async ({ data })=>{
    sbUser = data?.session?.user || null;
    setAuthUI();

    if (sbUser){
      setGateUI();
      state = await load();
      sanitizeState();
      render();
    } else {
      setGateUI();
    }
  });

// mudanças de sessão (login/logout)
  sb.auth.onAuthStateChange(async (_event, session)=>{
    sbUser = session?.user || null;
    setAuthUI();

    if (sbUser){
      setGateUI();
      state = await load();
      sanitizeState();
      render();
      saveSoon?.(); // se existir, não quebra
    } else {
      setGateUI();
    }
  });


  setAuthUI();
}

async function signInWithEmail(){
  if (!sb){
    alert("Supabase ainda não configurado. Cole SUPABASE_URL e SUPABASE_ANON_KEY no app.js.");
    return;
  }
  const email = prompt("Digite seu email para receber o link de login:");
  if (!email) return;

  const redirectTo = window.location.origin + window.location.pathname; // volta pro /taskfy
  const { error } = await sb.auth.signInWithOtp({
    email,
    options: { emailRedirectTo: redirectTo }
  });

  if (error){
    alert("Erro ao enviar link: " + error.message);
    return;
  }
  alert("Link enviado! Abra seu email e clique no link para entrar.");
}

async function signOut(){
  if (!sb) return;
  await sb.auth.signOut();
}


  // Card modal refs
  const overlay = document.getElementById("overlay");
  const modalTitle = document.getElementById("modalTitle");
  modalTitle?.addEventListener("keydown", (e) => {
  if (e.key === "Enter"){
    e.preventDefault();
    closeCard();
  }
});
  const details = document.getElementById("details");
  const cardWhere = document.getElementById("cardWhere");
  const timelineEl = document.getElementById("timeline");
  const duePill = document.getElementById("duePill");
  const dueLabel = document.getElementById("dueLabel");
  const dueDate = document.getElementById("dueDate");
  const duePop = document.getElementById("duePop");
  const duePrev = document.getElementById("duePrev");
  const dueNext = document.getElementById("dueNext");
  const dueMonth = document.getElementById("dueMonth");
  const dueGrid = document.getElementById("dueGrid");
  const dueTodayBtn = document.getElementById("dueToday");
  const dueClearBtn = document.getElementById("dueClear");
  const newNote = document.getElementById("newNote");
  const addNoteBtn = document.getElementById("addNoteBtn");
  const saveDetailsBtn = document.getElementById("saveDetailsBtn");
  const deleteCardBtn = document.getElementById("deleteCardBtn");
  const closeModal = document.getElementById("closeModal");
  const archiveFromModalBtn = document.getElementById("archiveFromModalBtn");

  const newTask = document.getElementById("newTask");
  const addTaskBtn = document.getElementById("addTaskBtn");
  const taskList = document.getElementById("taskList");

  // Archive modal refs
  const archOverlay = document.getElementById("archOverlay");
  const closeArch = document.getElementById("closeArch");
  const archList = document.getElementById("archList");
  const clearArchivedBtn = document.getElementById("clearArchivedBtn");

  let activeCardId = null;
  let activeTab = "all";

  // Menus
  function closeAllMenus(){
    document.querySelectorAll(".menu.open").forEach(m => m.classList.remove("open"));
  }
  document.addEventListener("click", closeAllMenus);

  function openMovePrompt(cardId){
    const options = COLS.map((c,i)=> `${i+1}) ${c.title}`).join("\n");
    const ans = prompt("Mover para qual coluna?\n\n" + options + "\n\nDigite o número:");
    if (!ans) return;
    const idx = Number(ans) - 1;
    if (Number.isNaN(idx) || idx < 0 || idx >= COLS.length) return;
    moveCard(cardId, COLS[idx].id);
  }

  // Render board
  function render(){
    board.innerHTML = "";

    for (const col of COLS){
      const colEl = document.createElement("div");
      colEl.className = "col";
      colEl.dataset.col = col.id;

      colEl.innerHTML = `
        <div class="col-head">
          <span class="col-title">${col.icon} ${col.title}</span>
          <span class="badge">${state.columns[col.id].length}</span>
          <div class="col-tools">
            <button class="mini" title="Config">≡</button>
            <button class="mini" title="Mais">⋯</button>
          </div>
        </div>

        <div class="add-row">
          <button class="add-plus" title="Adicionar card">+</button>
          <input class="add-input" placeholder="Adicionar um card..." />
        </div>

        <div class="cards" data-drop="${col.id}"></div>
      `;

      // Add card
      const plus = colEl.querySelector(".add-plus");
      const input = colEl.querySelector(".add-input");
      plus?.addEventListener("click", () => {
        // abre a janela, mas NÃO cria card ainda
        openCard(null, col.id);
        // opcional: já foca no campo de detalhes
        setTimeout(() => {
  modalTitle?.focus?.();
  modalTitle?.select?.();
}, 0);
      });
      input?.addEventListener("keydown", (e) => {
        if (e.key === "Enter"){
          const t = input.value.trim();
          if (!t) return;
          createCard(t, col.id);
          input.value = "";
        }
      });

      // Drop area
const list = colEl.querySelector(".cards");
list?.addEventListener("dragover", (e) => e.preventDefault());
list?.addEventListener("drop", (e) => {
  e.stopPropagation();
  onDropToColumn(e, col.id);
});;


      // Cards
      for (const id of state.columns[col.id]){
        const c = state.cards[id];
        if (!c) continue;

        const cardEl = document.createElement("div");
        cardEl.className = "card";
        cardEl.draggable = true;
        cardEl.dataset.id = id;

        const chip = c.dueTs
  ? `<span class="chip ${dueClass(c.dueTs)}">📅 ${dueHuman(c.dueTs)}</span>`
  : "";

        cardEl.innerHTML = `
          <div class="card-top">
            <div class="avatar"></div>
            <div class="title">${escapeHtml(c.title)}</div>
            <button class="kebab" title="Ações" data-kebab>⋮</button>

            <div class="menu" data-menu>
              <button data-act="dup">📄 Duplicar</button>
              <button data-act="move">📦 Mover…</button>
              <div class="sep"></div>
              <button data-act="arch">🗄️ Arquivar</button>
              <button data-act="del" class="danger">🗑️ Excluir</button>
            </div>
          </div>
          <div class="meta">
            ${chip}
            <div class="icons">
              <div class="linkicon" title="Link (demo)">↗</div>
              <div class="linkicon" title="Info">i</div>
            </div>
          </div>
        `;

        const kebab = cardEl.querySelector("[data-kebab]");
        const menu  = cardEl.querySelector("[data-menu]");

        kebab?.addEventListener("click", (ev)=>{
          ev.stopPropagation();
          closeAllMenus();
          menu.classList.toggle("open");
        });

        menu?.addEventListener("click", (ev)=>{
          ev.stopPropagation();
          const act = ev.target?.dataset?.act;
          if (!act) return;
          menu.classList.remove("open");

          if (act === "dup") return duplicateCard(id);
          if (act === "move") return openMovePrompt(id);
          if (act === "arch") return archiveCard(id);
          if (act === "del"){
            if (!confirm("Excluir este card?")) return;
            if (activeCardId === id) closeCard();
            return deleteCard(id);
          }
        });

        cardEl?.addEventListener("click", ()=>{
          closeAllMenus();
          openCard(id, col.id);
        });

        cardEl?.addEventListener("dragstart", (e)=>{
          closeAllMenus();
          cardEl.classList.add("dragging");
          e.dataTransfer.setData("text/plain", JSON.stringify({ cardId:id, from: col.id }));
        });
        cardEl?.addEventListener("dragend", ()=> cardEl.classList.remove("dragging"));

        list.appendChild(cardEl);
      }

      board.appendChild(colEl);
    }

    updateArchivedSidebar();
  }

function onDropToColumn(e, toCol){
  e.preventDefault();

  try{
    const payload = JSON.parse(e.dataTransfer.getData("text/plain") || "{}");
    const { cardId, from } = payload;
    if (!cardId || !from) return;

    // remove da coluna antiga
    const fromIdx = state.columns[from].indexOf(cardId);
    if (fromIdx >= 0) state.columns[from].splice(fromIdx, 1);
    state.columns[toCol] = state.columns[toCol].filter(id => id !== cardId);

    // encontra onde soltar baseado na posição do mouse
    const columnEl = document.querySelector(`[data-col="${toCol}"] .cards`);
    const cards = [...columnEl.querySelectorAll(".card")];

    let inserted = false;

    for (const cardEl of cards){
      const rect = cardEl.getBoundingClientRect();
      if (e.clientY < rect.top + rect.height / 2){
        const beforeId = cardEl.dataset.id;
        const idx = state.columns[toCol].indexOf(beforeId);
        state.columns[toCol].splice(idx, 0, cardId);
        inserted = true;
        break;
      }
    }

    if (!inserted){
      state.columns[toCol].push(cardId);
    }

    log(cardId, `Moveu o card para ${colName(toCol)}.`);
    save();
    render();

  }catch{}
}

  // Archive as dropzone
  if (archiveDrop){
    archiveDrop?.addEventListener("dragover", (e)=> e.preventDefault());
    archiveDrop?.addEventListener("dragenter", ()=> archiveDrop.classList.add("drop-active"));
    archiveDrop?.addEventListener("dragleave", ()=> archiveDrop.classList.remove("drop-active"));
    archiveDrop?.addEventListener("drop", (e)=>{
      e.preventDefault();
      archiveDrop.classList.remove("drop-active");
      try{
        const payload = JSON.parse(e.dataTransfer.getData("text/plain") || "{}");
        const { cardId } = payload;
        if (!cardId) return;
        archiveCard(cardId);
      }catch{}
    });
  }

  // Card modal
  function openCard(cardId, colId){
    activeCardId = cardId;
    activeTab = "all";
    document.querySelectorAll(".tab").forEach(t=>t.classList.remove("active"));
    document.querySelector('.tab[data-tab="all"]')?.classList.add("active");

// NOVO CARD (ainda não existe)
if (!cardId){
  modalTitle.value = "";
  details.value = "";
  cardWhere.textContent = `Na coluna: ${colName(colId)}`;

  dueLabel.textContent = "Prazo";
  dueDate.value = "";

  overlay.dataset.newcol = colId;
  overlay.classList.add("open");
  return;
}

// CARD EXISTENTE
const c = state.cards[cardId];
modalTitle.value = c.title || "";
details.value = c.details || "";
cardWhere.textContent = `Na coluna: ${colName(colId)}`;

dueLabel.textContent = c.dueTs ? dueHuman(c.dueTs) : "Prazo";
dueDate.value = c.dueTs ? dateISO(c.dueTs) : "";

renderTimeline();
renderTasks();

overlay.classList.add("open");

  }

function closeCard(){

  // se estava criando um novo card
  if (!activeCardId && overlay.dataset.newcol){
    const title = modalTitle.value.trim();

    if (title) {
      const colId = overlay.dataset.newcol;
      createCard(title, colId);
    }

    delete overlay.dataset.newcol;
  }

  overlay.classList.remove("open");
  activeCardId = null;
  newNote.value = "";
  newTask.value = "";
}

  closeModal?.addEventListener("click", closeCard);
  overlay?.addEventListener("click", (e)=>{ if (e.target === overlay) closeCard(); });
  document.addEventListener("keydown", (e)=>{ if (e.key === "Escape" && overlay.classList.contains("open")) closeCard(); });

  saveDetailsBtn?.addEventListener("click", ()=>{
    if (!activeCardId) return;
    const c = state.cards[activeCardId];
    const prev = c.details || "";
    const next = details.value || "";
    c.details = next;
    if (prev !== next) log(activeCardId, "Atualizou os detalhes do card.");
    save();
    render();
  });

  archiveFromModalBtn?.addEventListener("click", ()=>{
    if (!activeCardId) return;
    const id = activeCardId;
    closeCard();
    archiveCard(id);
  });

  deleteCardBtn?.addEventListener("click", ()=>{
    if (!activeCardId) return;
    if (!confirm("Excluir este card?")) return;
    const id = activeCardId;
    closeCard();
    deleteCard(id);
  });

  // Tabs
  document.querySelectorAll(".tab").forEach(tab=>{
    tab?.addEventListener("click", ()=>{
      document.querySelectorAll(".tab").forEach(t=>t.classList.remove("active"));
      tab.classList.add("active");
      activeTab = tab.dataset.tab;
      renderTimeline();
    });
  });

  // Notes
  addNoteBtn?.addEventListener("click", ()=>{
    if (!activeCardId) return;
    const t = newNote.value.trim();
    if (!t) return;
    note(activeCardId, t);
    newNote.value = "";
    renderTimeline();
  });
  newNote?.addEventListener("keydown", (e)=>{
    if (e.key === "Enter"){
      e.preventDefault();
      addNoteBtn.click();
    }
  });

// ===== Mini calendário do Prazo =====
let dueView = new Date(); // mês que o popup está mostrando

function pad2(n){ return String(n).padStart(2,"0"); }
function isoFromDate(dt){
  return `${dt.getFullYear()}-${pad2(dt.getMonth()+1)}-${pad2(dt.getDate())}`;
}
function startTsFromISO(v){
  const [y,m,d] = v.split("-").map(Number);
  return startOfDay(new Date(y, m-1, d));
}
function monthLabel(dt){
  const names = ["Jan","Fev","Mar","Abr","Mai","Jun","Jul","Ago","Set","Out","Nov","Dez"];
  return `${names[dt.getMonth()]} ${dt.getFullYear()}`;
}

function openDuePop(){
  duePop.classList.add("open");
  duePop.setAttribute("aria-hidden","false");
  renderDuePop();
}

function closeDuePop(){
  duePop.classList.remove("open");
  duePop.setAttribute("aria-hidden","true");
}

function renderDuePop(){
  dueMonth.textContent = monthLabel(dueView);
  dueGrid.innerHTML = "";

  const y = dueView.getFullYear();
  const m = dueView.getMonth();

  const first = new Date(y, m, 1);
  const startDow = first.getDay(); // 0=Dom
  const daysInMonth = new Date(y, m+1, 0).getDate();

  // para marcar selecionado (se tiver)
  const selectedISO = dueDate.value || "";

  // 1) dias “vazios” do começo (mostra do mês anterior, bem apagado)
  for (let i=0; i<startDow; i++){
    const btn = document.createElement("button");
    btn.className = "due-day muted";
    btn.type = "button";
    btn.textContent = "·";
    btn?.addEventListener("click", ()=>{});
    dueGrid.appendChild(btn);
  }

  // 2) dias do mês
  for (let d=1; d<=daysInMonth; d++){
    const dt = new Date(y, m, d);
    const iso = isoFromDate(dt);

    const btn = document.createElement("button");
    btn.className = "due-day" + (iso === selectedISO ? " sel" : "");
    btn.type = "button";
    btn.textContent = String(d);

    btn?.addEventListener("click", ()=>{
      dueDate.value = iso;
      dueDate.dispatchEvent(new Event("change", { bubbles:true }));
      closeDuePop();
    });

    dueGrid.appendChild(btn);
  }
}

// abrir no clique do “Prazo”
duePill?.addEventListener("click", (e)=>{
  e.stopPropagation();

  // define o mês mostrado: se já existe data, abre naquele mês; senão, mês atual
  if (dueDate.value){
    const [yy,mm,dd] = dueDate.value.split("-").map(Number);
    dueView = new Date(yy, mm-1, 1);
  } else {
    const now = new Date();
    dueView = new Date(now.getFullYear(), now.getMonth(), 1);
  }

  if (duePop.classList.contains("open")) closeDuePop();
  else openDuePop();
});

// navegar meses
duePrev?.addEventListener("click", (e)=>{
  e.stopPropagation();
  dueView = new Date(dueView.getFullYear(), dueView.getMonth()-1, 1);
  renderDuePop();
});
dueNext?.addEventListener("click", (e)=>{
  e.stopPropagation();
  dueView = new Date(dueView.getFullYear(), dueView.getMonth()+1, 1);
  renderDuePop();
});

// Hoje
dueTodayBtn?.addEventListener("click", (e)=>{
  e.stopPropagation();
  const now = new Date();
  const iso = isoFromDate(now);
  dueDate.value = iso;
  dueDate.dispatchEvent(new Event("change", { bubbles:true }));
  closeDuePop();
});

// Sem data
dueClearBtn?.addEventListener("click", (e)=>{
  e.stopPropagation();
  dueDate.value = "";
  dueDate.dispatchEvent(new Event("change", { bubbles:true }));
  closeDuePop();
});

// clicar fora fecha
document.addEventListener("click", () => {
  if (duePop?.classList.contains("open")) closeDuePop();
});
duePop?.addEventListener("click", (e)=> e.stopPropagation());
  
  dueDate?.addEventListener("change", ()=>{
    if (!activeCardId) return;
    const c = state.cards[activeCardId];
    const v = dueDate.value;
    const before = c.dueTs;

    if (!v){
      c.dueTs = null;
      log(activeCardId, "Removeu o prazo do card.");
    } else {
      const [y,m,d] = v.split("-").map(Number);
      const ts = startOfDay(new Date(y, m-1, d));
      c.dueTs = ts;
      if (before !== ts) log(activeCardId, `Definiu o prazo do card para ${dueHuman(ts)} (${v}).`);
    }

    dueLabel.textContent = c.dueTs ? dueHuman(c.dueTs) : "Prazo";
    save();
    render();
    renderTimeline();
  });

  // Checklist
  addTaskBtn?.addEventListener("click", ()=>{
    if (!activeCardId) return;
    const t = newTask.value.trim();
    if (!t) return;
    const c = state.cards[activeCardId];
    c.tasks.push({ id: uid(), text: t, done:false });
    log(activeCardId, "Adicionou uma tarefa no checklist.");
    newTask.value = "";
    save();
    renderTasks();
    renderTimeline();
  });

  function renderTasks(){
    if (!activeCardId) return;
    const c = state.cards[activeCardId];
    taskList.innerHTML = "";

    if (!c.tasks.length){
      taskList.innerHTML = `<div class="muted" style="font-weight:1000;font-size:12px;">Sem tarefas no checklist.</div>`;
      return;
    }

    for (const t of c.tasks){
      const row = document.createElement("div");
      row.style.display = "flex";
      row.style.alignItems = "center";
      row.style.gap = "8px";
      row.style.border = "1px solid rgba(148,163,184,.18)";
      row.style.borderRadius = "12px";
      row.style.padding = "8px";
      row.style.background = "rgba(148,163,184,.06)";

      row.innerHTML = `
        <input type="checkbox" ${t.done ? "checked":""} />
        <div style="flex:1;font-size:13px;${t.done ? "text-decoration:line-through;color:#94a3b8":""}">${escapeHtml(t.text)}</div>
        <button class="btn" style="padding:6px 8px;border-radius:12px" title="Excluir">🗑️</button>
      `;

      const cb = row.querySelector("input");
      cb?.addEventListener("change", ()=>{
        t.done = cb.checked;
        log(activeCardId, t.done ? "Concluiu uma tarefa do checklist." : "Reabriu uma tarefa do checklist.");
        save();
        renderTasks();
        renderTimeline();
      });

      const del = row.querySelector("button");
      del?.addEventListener("click", ()=>{
        if (!confirm("Excluir esta tarefa?")) return;
        c.tasks = c.tasks.filter(x=>x.id!==t.id);
        log(activeCardId, "Excluiu uma tarefa do checklist.");
        save();
        renderTasks();
        renderTimeline();
      });

      taskList.appendChild(row);
    }
  }

  function renderTimeline(){
    if (!activeCardId) return;
    const c = state.cards[activeCardId];
    timelineEl.innerHTML = "";

    const items = c.timeline.filter(it => {
      if (activeTab === "all") return true;
      if (activeTab === "notes") return it.type === "note";
      if (activeTab === "logs") return it.type === "log";
      return true;
    });

    if (!items.length){
      timelineEl.innerHTML = `<div class="muted" style="font-weight:1000;font-size:12px;">Sem itens aqui.</div>`;
      return;
    }

    for (const it of items){
      const el = document.createElement("div");
      el.className = "entry";
      el.innerHTML = `
        <div class="bub">${it.type === "note" ? "📝" : "⏱️"}</div>
        <div class="bubble">
          <div class="meta2">
            <span>${it.type === "note" ? "Eliel Costa" : "Sistema"}</span>
            <span>${fmt(it.ts)}</span>
          </div>
          <div class="txt">${escapeHtml(it.text)}</div>
        </div>
      `;
      timelineEl.appendChild(el);
    }
  }

  // Arquivados modal
  function openArchivedModal(){
    renderArchivedList();
    archOverlay.classList.add("open");
  }
  function closeArchivedModal(){
    archOverlay.classList.remove("open");
  }

  viewArchivedBtn?.addEventListener("click", openArchivedModal);
  closeArch?.addEventListener("click", closeArchivedModal);
  archOverlay?.addEventListener("click", (e)=>{ if (e.target === archOverlay) closeArchivedModal(); });
  document.addEventListener("keydown", (e)=>{ if (e.key === "Escape" && archOverlay.classList.contains("open")) closeArchivedModal(); });

  clearArchivedBtn?.addEventListener("click", ()=>{
    if (!state.archived.length) return;
    if (!confirm("Limpar todos os arquivados? (eles serão EXCLUÍDOS)")) return;
    for (const id of [...state.archived]){
      delete state.cards[id];
    }
    state.archived = [];
    save();
    renderArchivedList();
  });

  function renderArchivedList(){
    archList.innerHTML = "";
    if (!state.archived.length){
      archList.innerHTML = `<div class="muted" style="font-weight:1000;font-size:12px;">Nenhum card arquivado.</div>`;
      return;
    }

    for (const id of state.archived){
      const c = state.cards[id];
      if (!c) continue;

      const item = document.createElement("div");
      item.className = "arch-item";
      item.innerHTML = `
        <div class="avatar" style="margin-top:2px;">E</div>
        <div style="min-width:0;">
          <div style="font-weight:1000;color:#e5e7eb;">${escapeHtml(c.title)}</div>
          <div class="meta3">Prazo: ${dueHuman(c.dueTs)} • Criado: ${fmt(c.createdAt)}</div>
        </div>
        <div class="actions">
          <button data-act="restore">↩ Restaurar</button>
          <button data-act="open">🔎 Abrir</button>
          <button data-act="del" style="color:#fca5a5;border-color:rgba(239,68,68,.35);">🗑 Excluir</button>
        </div>
      `;

      item.querySelector('[data-act="restore"]')?.addEventListener("click", ()=>{
        restoreCard(id, "todo");
        renderArchivedList();
      });

      item.querySelector('[data-act="open"]')?.addEventListener("click", ()=>{
        // abre o card restaurando em todo
        restoreCard(id, "todo");
        renderArchivedList();
        closeArchivedModal();
        openCard(id, "todo");
      });

      item.querySelector('[data-act="del"]')?.addEventListener("click", ()=>{
        if (!confirm("Excluir esse card arquivado?")) return;
        deleteCard(id);
        renderArchivedList();
      });

      archList.appendChild(item);
    }
  }

document.getElementById("createCardBtn")?.addEventListener("click", closeCard);


  // Botão Entrar/Sair
authBtn?.addEventListener("click", ()=>{
  if (sbUser) {
    signOut();
  } else {
    setGateUI();
    setTimeout(()=> loginEmail?.focus?.(), 0);
  }
});

// Start
  lockApp();
  setGateUI();
  initSupabase();
  // (render acontece após login, dentro do initSupabase)

})();
