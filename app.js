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

// ===================== Persistência (Supabase = source of truth) =====================

function localKey(userId = null){
  return userId ? `${STORAGE_KEY}:cache:${userId}` : `${STORAGE_KEY}:guest`;
}

function notifyPersistenceError(action, error){
  const msg = error?.message || String(error);
  alert(`Falha ao ${action}. Verifique a conexão e tente novamente.\n\n${msg}`);
  console.error(`[cards] ${action}`, error);
}

function ensureCloudReady(actionLabel = "persistir card"){
  if (!(sb && sbUser)){
    const err = new Error("Você precisa entrar para salvar cards na nuvem.");
    notifyPersistenceError(actionLabel, err);
    throw err;
  }
}

function normalizeTask(task){
  return {
    id: task?.id || uid(),
    text: String(task?.text || ""),
    done: !!task?.done
  };
}

function normalizeTimeline(items){
  if (!Array.isArray(items)) return [];
  return items.map((it) => ({
    type: it?.type === "note" ? "note" : "log",
    ts: Number(it?.ts) || nowTs(),
    text: String(it?.text || "")
  }));
}

function rowToCard(row){
  const dueTs = row?.due_date ? startTsFromISO(row.due_date) : null;
  return {
    id: row.id,
    title: row.title || "",
    details: row.details || "",
    dueTs,
    createdAt: row.created_at ? new Date(row.created_at).getTime() : nowTs(),
    tasks: Array.isArray(row.checklist) ? row.checklist.map(normalizeTask) : [],
    timeline: normalizeTimeline(row.notes)
  };
}

function cardToPatch(card, extra = {}){
  return {
    title: card.title || "",
    details: card.details || "",
    due_date: card.dueTs ? dateISO(card.dueTs) : null,
    checklist: Array.isArray(card.tasks) ? card.tasks.map(normalizeTask) : [],
    notes: Array.isArray(card.timeline) ? card.timeline : [],
    ...extra
  };
}

function saveLocalCache(userId){
  if (!userId) return;
  try { localStorage.setItem(localKey(userId), JSON.stringify(state)); }
  catch(e){ console.warn("Não foi possível atualizar cache local.", e); }
}

function loadLocalCache(userId){
  if (!userId) return null;
  try{
    const raw = localStorage.getItem(localKey(userId));
    if (!raw) return null;
    return JSON.parse(raw);
  }catch(e){
    console.warn("Cache local inválido.", e);
    return null;
  }
}

// Data Layer Supabase: lista cards do usuário autenticado (RLS + user_id).
async function fetchCards({ includeArchived = false } = {}){
  ensureCloudReady("carregar cards");
  let query = sb
    .from("cards")
    .select("id,title,col,position,details,due_date,archived,checklist,notes,created_at")
    .eq("user_id", sbUser.id)
    .order("col", { ascending:true })
    .order("position", { ascending:true })
    .order("created_at", { ascending:true });

  if (!includeArchived) query = query.eq("archived", false);

  const { data, error } = await query;
  if (error) throw error;
  return data || [];
}

async function createCardCloud(card, colId, position = 0){
  ensureCloudReady("criar card");
  const payload = {
    user_id: sbUser.id,
    ...cardToPatch(card, {
      col: colId,
      position,
      archived: false
    })
  };

  const { data, error } = await sb.from("cards").insert(payload).select("*").single();
  if (error) throw error;
  return data;
}

async function updateCardCloud(id, patch){
  ensureCloudReady("atualizar card");
  const { data, error } = await sb
    .from("cards")
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq("id", id)
    .eq("user_id", sbUser.id)
    .select("*")
    .single();
  if (error) throw error;
  return data;
}

async function deleteCardCloud(id){
  ensureCloudReady("excluir card");
  const { error } = await sb.from("cards").delete().eq("id", id).eq("user_id", sbUser.id);
  if (error) throw error;
}

async function archiveCardCloud(id, archived = true){
  return updateCardCloud(id, { archived });
}

function stateFromRows(rows){
  const next = seed();
  for (const row of rows){
    const card = rowToCard(row);
    next.cards[card.id] = card;
    if (row.archived) next.archived.push(card.id);
    else (next.columns[row.col] || next.columns.todo).push(card.id);
  }
  return next;
}

async function load(){
  if (!(sbUser && sb)) return seed();
  try{
    const rows = await fetchCards({ includeArchived: true });
    const nextState = stateFromRows(rows);
    try { localStorage.setItem(localKey(sbUser.id), JSON.stringify(nextState)); } catch(e){}
    return nextState;
  }catch(e){
    const cached = loadLocalCache(sbUser.id);
    if (cached) return cached;
    throw e;
  }
}

let state = seed();


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

  // Sincroniza um card do state em memória para o Supabase (fonte da verdade).
  async function persistCardSnapshot(cardId, actionLabel){
    const c = state.cards[cardId];
    if (!c) return;
    const col = findCardColumn(cardId) || "todo";
    const position = state.columns[col]?.indexOf(cardId);
    try{
      await updateCardCloud(cardId, cardToPatch(c, { col, position: position < 0 ? 0 : position }));
      saveLocalCache(sbUser?.id);
    }catch(e){
      notifyPersistenceError(actionLabel, e);
      throw e;
    }
  }

  async function log(cardId, text){
    const c = state.cards[cardId];
    if (!c) return;
    c.timeline.unshift({ type:"log", ts: nowTs(), text });
    await persistCardSnapshot(cardId, "registrar alteração no card");
  }

  async function note(cardId, text){
    const c = state.cards[cardId];
    if (!c) return;
    c.timeline.unshift({ type:"note", ts: nowTs(), text });
    await persistCardSnapshot(cardId, "salvar nota");
  }

  async function createCard(title, colId, dueTs = null){
    const id = crypto?.randomUUID?.() || uid();
    const due = dueTs ?? null;
    const nextCard = {
      id,
      title,
      details:"",
      dueTs: due,
      createdAt: nowTs(),
      tasks: [],
      timeline: [
        { type:"log", ts: nowTs(), text:"Criou o card." },
        { type:"log", ts: nowTs(), text:`Adicionou o card na coluna ${colName(colId)}.` },
        ...(due ? [{ type:"log", ts: nowTs(), text:`Definiu o prazo do card para ${dueHuman(due)}.` }] : []),
      ]
    };

    const position = 0;
    try{
      const inserted = await createCardCloud(nextCard, colId, position);
      const savedId = inserted.id || id;
      state.cards[savedId] = rowToCard(inserted);
      state.columns[colId].unshift(savedId);
      render();
      saveLocalCache(sbUser?.id);
      return savedId;
    }catch(e){
      notifyPersistenceError("criar card", e);
      return null;
    }
  }

  function structuredCloneSafe(obj){
    try { return structuredClone(obj); }
    catch { return JSON.parse(JSON.stringify(obj)); }
  }

  async function duplicateCard(cardId){
    const c = state.cards[cardId];
    if (!c) return;
    const colId = findCardColumn(cardId) || "todo";

    const duplicated = {
      ...structuredCloneSafe(c),
      id: crypto?.randomUUID?.() || uid(),
      title: c.title + " (cópia)",
      createdAt: nowTs(),
      timeline: [
        { type:"log", ts: nowTs(), text:"Criou o card (duplicado)." },
        { type:"log", ts: nowTs(), text:`Adicionou o card na coluna ${colName(colId)}.` },
      ]
    };

    try{
      const inserted = await createCardCloud(duplicated, colId, 0);
      const savedId = inserted.id || duplicated.id;
      state.cards[savedId] = rowToCard(inserted);
      state.columns[colId].unshift(savedId);
      render();
      saveLocalCache(sbUser?.id);
    }catch(e){
      notifyPersistenceError("duplicar card", e);
    }
  }

  async function archiveCard(cardId){
    const c = state.cards[cardId];
    if (!c) return;
    const from = findCardColumn(cardId);

    c.timeline.unshift({ type:"log", ts: nowTs(), text:`Arquivou o card${from ? ` (veio de ${colName(from)})` : ""}.` });
    try{
      await archiveCardCloud(cardId, true);
      removeFromAllColumns(cardId);
      state.archived = [cardId, ...state.archived.filter(id => id !== cardId)];
      render();
      saveLocalCache(sbUser?.id);
    }catch(e){
      notifyPersistenceError("arquivar card", e);
    }
  }

  async function restoreCard(cardId, toCol="todo"){
    const c = state.cards[cardId];
    if (!c) return;

    c.timeline.unshift({ type:"log", ts: nowTs(), text:`Restaurou o card para ${colName(toCol)}.` });
    try{
      await updateCardCloud(cardId, cardToPatch(c, { archived:false, col: toCol, position:0 }));
      state.archived = state.archived.filter(id => id !== cardId);
      state.columns[toCol] = [cardId, ...state.columns[toCol].filter(id => id !== cardId)];
      render();
      saveLocalCache(sbUser?.id);
    }catch(e){
      notifyPersistenceError("restaurar card", e);
    }
  }

  async function deleteCard(cardId){
    try{
      await deleteCardCloud(cardId);
      removeFromAllColumns(cardId);
      state.archived = state.archived.filter(id => id !== cardId);
      delete state.cards[cardId];
      render();
      saveLocalCache(sbUser?.id);
    }catch(e){
      notifyPersistenceError("excluir card", e);
    }
  }

  async function moveCard(cardId, toCol){
    const from = findCardColumn(cardId);
    if (!from || from === toCol) return;

    const c = state.cards[cardId];
    c.timeline.unshift({ type:"log", ts: nowTs(), text:`Moveu o card de ${colName(from)} → ${colName(toCol)}.` });

    try{
      await updateCardCloud(cardId, cardToPatch(c, { col: toCol, position:0, archived:false }));
      const idx = state.columns[from].indexOf(cardId);
      if (idx >= 0) state.columns[from].splice(idx, 1);
      state.columns[toCol].unshift(cardId);
      render();
      saveLocalCache(sbUser?.id);

      if (activeCardId === cardId){
        document.getElementById("cardWhere").textContent = `Na coluna: ${colName(toCol)}`;
      }
    }catch(e){
      notifyPersistenceError("mover card", e);
    }
  }

  // DOM
  const board = document.getElementById("board");

// =====================
// Supabase (Login) - FIX ESTÁVEL
// =====================
const SUPABASE_URL = "https://bknethktrrecdfllndyo.supabase.co/";
const SUPABASE_ANON_KEY = "sb_publishable_9v3vkdV27tpLF059ehpi8A_trs8Lymo";

let sb = null;
let sbUser = null;

const authBtn = document.getElementById("authBtn");
const authStatus = document.getElementById("authStatus");

// elementos do gate
const authGate = document.getElementById("authGate"); // overlay (se existir)
const loginGate = document.getElementById("loginGate"); // seu gate no HTML
const loginEmail = document.getElementById("loginEmail");
const loginPass  = document.getElementById("loginPass");
const loginBtn   = document.getElementById("loginBtn");
const signupBtn  = document.getElementById("signupBtn");

function lockApp(){ document.body.classList.add("auth-locked"); }
function unlockApp(){ document.body.classList.remove("auth-locked"); }

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

function setGateUI(){
  const gate = document.getElementById("loginGate");
  const board = document.getElementById("board");
  const topbar = document.querySelector(".topbar");

  const logged = !!sbUser;

  // 1) a regra-mãe do seu CSS
  document.body.classList.toggle("auth-locked", !logged);

  // 2) mostra/esconde gate (não depende de .open nem de CSS)
  if (gate) gate.style.display = logged ? "none" : "flex";

  // 3) libera UI do app
  if (board) board.style.display = logged ? "" : "none";
  if (topbar) topbar.style.display = logged ? "" : "none";
}

function ensureSb(){
  if (!window.supabase) throw new Error("Biblioteca do Supabase não carregou. Recarregue (Ctrl+Shift+R).");
  if (!SUPABASE_URL.includes("http")) throw new Error("SUPABASE_URL inválida.");
  if (!SUPABASE_ANON_KEY) throw new Error("SUPABASE_ANON_KEY vazia.");

  if (!sb){
    sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true
      }
    });
  }
  return sb;
}

function clearInMemoryState(){
  state = seed();
  activeCardId = null;
  pendingNewCardDueTs = null;
  if (overlay) overlay.classList.remove("open");
}

async function doPostLogin(){
  const { data, error } = await sb.auth.getSession();
  if (error) throw error;

  sbUser = data?.session?.user || null;

  setAuthUI?.();
  setGateUI?.();

  if (sbUser){
    try{
      state = await load();
      sanitizeState?.();
      render();
    }catch(e){
      notifyPersistenceError("carregar cards", e);
      clearInMemoryState();
    }
  } else {
    clearInMemoryState();
  }
}

let loggingIn = false;
let signingUp = false;

async function signInWithPassword(email, password){
  ensureSb();
  const { data, error } = await sb.auth.signInWithPassword({ email, password });
  if (error) throw error;
  return data;
}

async function signUpWithPassword(email, password){
  ensureSb();
  const { data, error } = await sb.auth.signUp({ email, password });
  if (error) throw error;
  return data;
}

loginBtn?.addEventListener("click", async () => {
  if (loggingIn) return;
  loggingIn = true;
  loginBtn.disabled = true;

  const email = (loginEmail?.value || "").trim();
  const pass  = (loginPass?.value || "").trim();

  try{
    if (!email || !pass) throw new Error("Preencha email e senha.");

    const res = await signInWithPassword(email, pass);

    // se logou, atualiza tudo na marra (sem depender de evento)
    
    await doPostLogin();

    // se ainda assim não tiver user, explica
    if (!sbUser) throw new Error("Login não retornou usuário. Se sua conta exige confirmação de e-mail, confirme primeiro.");
  }catch(e){
    alert("Erro ao entrar: " + (e?.message || String(e)));
  }finally{
    loginBtn.disabled = false;
    loggingIn = false;
  }
});

signupBtn?.addEventListener("click", async () => {
  if (signingUp) return;
  signingUp = true;
  signupBtn.disabled = true;

  const email = (loginEmail?.value || "").trim();
  const pass  = (loginPass?.value || "").trim();

  try {
    if (!email || !pass) throw new Error("Preencha email e senha.");

    await signUpWithPassword(email, pass);

    // tenta logar automaticamente
    await signInWithPassword(email, pass);
    await doPostLogin();

    if (!sbUser) {
      alert("Conta criada, mas seu projeto exige confirmação de email. Confirme no email e depois clique em Entrar.");
    }
  } catch (e) {
    const msg = (e?.message || String(e));
    if (msg.toLowerCase().includes("already") || msg.toLowerCase().includes("duplicate")) {
      alert("Esse e-mail já tem conta. Clique em Entrar.");
    } else {
      alert("Erro ao criar conta: " + msg);
    }
  } finally {
    signupBtn.disabled = false;
    signingUp = false;
  }
});

// Enter no campo senha = entrar
loginPass?.addEventListener("keydown", (e) => {
  if (e.key === "Enter") loginBtn?.click();
});

// Botão Entrar/Sair do topo
authBtn?.addEventListener("click", async ()=>{
  try{
    ensureSb();
    if (sbUser){
      await sb.auth.signOut();
      sbUser = null;
      clearInMemoryState();
      setAuthUI();
      setGateUI();
    } else {
      setGateUI();
      setTimeout(()=> loginEmail?.focus?.(), 0);
    }
  }catch(e){
    alert(e?.message || String(e));
  }
});

function initSupabase(){
  try{
    ensureSb();

    // sessão atual
    doPostLogin();

    // reage a mudanças de sessão
    sb.auth.onAuthStateChange(async (_event, session)=>{
      sbUser = session?.user || null;
      setAuthUI();
      setGateUI();
      if (sbUser){
        try{
          state = await load();
          sanitizeState?.();
          render();
        }catch(e){
          notifyPersistenceError("recarregar cards", e);
          clearInMemoryState();
        }
      } else {
        clearInMemoryState();
      }
    });

    setAuthUI();
    setGateUI();
  }catch(e){
    // se falhar aqui, você vai ver claramente o motivo
    console.error(e);
    setAuthUI();
    setGateUI();
  }
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
  const dueQuick = document.getElementById("dueQuick");
  const duePop = document.getElementById("duePop");
  const duePrev = document.getElementById("duePrev");
  const dueNext = document.getElementById("dueNext");
  const dueMonth = document.getElementById("dueMonth");
  const dueGrid = document.getElementById("dueGrid");
  const dueTodayBtn = document.getElementById("dueToday");
  const dueTomorrowBtn = document.getElementById("dueTomorrow");
  const dueClearBtn = document.getElementById("dueClear");
  const dueRemoveBtn = document.getElementById("dueRemove");
  const dueApplyBtn = document.getElementById("dueApply");
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
  let pendingNewCardDueTs = null;
  const cardPatchTimers = new Map();

  function scheduleCardPatch(cardId, buildPatch, actionLabel, delay = 450){
    clearTimeout(cardPatchTimers.get(cardId));
    const timer = setTimeout(async ()=>{
      try{
        const patch = buildPatch();
        if (!patch) return;
        await updateCardCloud(cardId, patch);
        saveLocalCache(sbUser?.id);
      }catch(e){
        notifyPersistenceError(actionLabel, e);
      }
    }, delay);
    cardPatchTimers.set(cardId, timer);
  }

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
    if (!board) return;
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

    const archivedCol = document.createElement("div");
    archivedCol.className = "col archived-col";
    archivedCol.innerHTML = `
      <div class="col-head">
        <span class="col-title">🗃️ Arquivado</span>
        <span class="badge">${state.archived.length}</span>
      </div>
      <div class="archived-drop-zone" data-drop-archive>
        <div class="archived-icon">✓</div>
        <div class="archived-muted">Quantidade de cards finalizados</div>
        <div class="archived-count">${state.archived.length} cards</div>
        <button class="mini archived-view-btn" id="viewArchivedBtn" type="button">Visualizar todos</button>
      </div>
    `;

    const archivedDrop = archivedCol.querySelector("[data-drop-archive]");
    archivedDrop?.addEventListener("dragover", (e)=> e.preventDefault());
    archivedDrop?.addEventListener("dragenter", ()=> archivedDrop.classList.add("drop-active"));
    archivedDrop?.addEventListener("dragleave", ()=> archivedDrop.classList.remove("drop-active"));
    archivedDrop?.addEventListener("drop", (e)=>{
      e.preventDefault();
      archivedDrop.classList.remove("drop-active");
      try{
        const payload = JSON.parse(e.dataTransfer.getData("text/plain") || "{}");
        const { cardId } = payload;
        if (!cardId) return;
        archiveCard(cardId);
      }catch{}
    });

    archivedCol.querySelector("#viewArchivedBtn")?.addEventListener("click", openArchivedModal);
    board.appendChild(archivedCol);

    updateArchivedSidebar();
  }

async function onDropToColumn(e, toCol){
  e.preventDefault();

  try{
    const payload = JSON.parse(e.dataTransfer.getData("text/plain") || "{}");
    const { cardId, from } = payload;
    if (!cardId || !from) return;

    const fromIdx = state.columns[from].indexOf(cardId);
    if (fromIdx >= 0) state.columns[from].splice(fromIdx, 1);
    state.columns[toCol] = state.columns[toCol].filter(id => id !== cardId);

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

    if (!inserted) state.columns[toCol].push(cardId);

    const c = state.cards[cardId];
    c.timeline.unshift({ type:"log", ts: nowTs(), text:`Moveu o card para ${colName(toCol)}.` });
    const position = state.columns[toCol].indexOf(cardId);
    await updateCardCloud(cardId, cardToPatch(c, { col: toCol, position, archived:false }));

    render();
    saveLocalCache(sbUser?.id);
  }catch(err){
    notifyPersistenceError("mover card", err);
  }
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
  pendingNewCardDueTs = null;

  dueLabel.textContent = "Prazo";
  if (duePill) duePill.textContent = "📅 Sem prazo";
  if (dueDate) dueDate.value = "";

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
if (duePill) duePill.textContent = c.dueTs ? `📅 ${dueHuman(c.dueTs)}` : "📅 Sem prazo";
if (dueDate) dueDate.value = c.dueTs ? dateISO(c.dueTs) : "";

renderTimeline();
renderTasks();

overlay.classList.add("open");

  }

async function closeCard(){

  // se estava criando um novo card
  if (!activeCardId && overlay.dataset.newcol){
    const title = modalTitle.value.trim();

    if (title) {
      const colId = overlay.dataset.newcol;
      await createCard(title, colId, pendingNewCardDueTs);
    }

    delete overlay.dataset.newcol;
  }

  overlay.classList.remove("open");
  activeCardId = null;
  pendingNewCardDueTs = null;
  newNote.value = "";
  newTask.value = "";
}

  closeModal?.addEventListener("click", closeCard);
  overlay?.addEventListener("click", (e)=>{ if (e.target === overlay) closeCard(); });
  document.addEventListener("keydown", (e)=>{ if (e.key === "Escape" && overlay.classList.contains("open")) closeCard(); });

  saveDetailsBtn?.addEventListener("click", async ()=>{
    if (!activeCardId) return;
    const c = state.cards[activeCardId];
    const prev = c.details || "";
    const next = details.value || "";
    c.details = next;
    if (prev !== next) c.timeline.unshift({ type:"log", ts: nowTs(), text:"Atualizou os detalhes do card." });
    await persistCardSnapshot(activeCardId, "salvar detalhes do card");
    render();
  });

  modalTitle?.addEventListener("input", ()=>{
    if (!activeCardId) return;
    const c = state.cards[activeCardId];
    c.title = modalTitle.value;
    scheduleCardPatch(activeCardId, () => cardToPatch(c), "salvar título do card", 500);
    render();
  });

  details?.addEventListener("input", ()=>{
    if (!activeCardId) return;
    const c = state.cards[activeCardId];
    c.details = details.value;
    scheduleCardPatch(activeCardId, () => cardToPatch(c), "salvar detalhes do card", 700);
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
  addNoteBtn?.addEventListener("click", async ()=>{
    if (!activeCardId) return;
    const t = newNote.value.trim();
    if (!t) return;
    await note(activeCardId, t);
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
  if (!duePop) return;
  duePop.classList.add("open");
  duePop.setAttribute("aria-hidden","false");
  renderDuePop();
}

function closeDuePop(){
  if (!duePop) return;
  duePop.classList.remove("open");
  duePop.setAttribute("aria-hidden","true");
}

function renderDuePop(){
  if (!dueMonth || !dueGrid || !dueDate) return;
  dueMonth.textContent = monthLabel(dueView);
  dueGrid.innerHTML = "";

  const y = dueView.getFullYear();
  const m = dueView.getMonth();

  const first = new Date(y, m, 1);
  const startDow = first.getDay(); // 0=Dom
  const daysInMonth = new Date(y, m+1, 0).getDate();

  // para marcar selecionado (se tiver)
  const selectedISO = dueDate.value || "";
  dueTodayBtn?.classList.toggle("active", selectedISO === isoFromDate(new Date()));
  const tm = new Date(); tm.setDate(tm.getDate()+1);
  dueTomorrowBtn?.classList.toggle("active", selectedISO === isoFromDate(tm));
  dueClearBtn?.classList.toggle("active", !selectedISO);

  // 1) dias “vazios” do começo (mostra do mês anterior, bem apagado)
  for (let i=0; i<startDow; i++){
    const btn = document.createElement("button");
    btn.className = "due-day muted";
    btn.type = "button";
    btn.textContent = "";
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

  if (!dueDate || !duePop) return;

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
  if (!dueGrid || !dueMonth) return;
  dueView = new Date(dueView.getFullYear(), dueView.getMonth()-1, 1);
  renderDuePop();
});
dueNext?.addEventListener("click", (e)=>{
  e.stopPropagation();
  if (!dueGrid || !dueMonth) return;
  dueView = new Date(dueView.getFullYear(), dueView.getMonth()+1, 1);
  renderDuePop();
});

// Hoje
dueTodayBtn?.addEventListener("click", (e)=>{
  e.stopPropagation();
  if (!dueDate) return;
  const now = new Date();
  const iso = isoFromDate(now);
  dueDate.value = iso;
  dueDate.dispatchEvent(new Event("change", { bubbles:true }));
  closeDuePop();
});

dueTomorrowBtn?.addEventListener("click", (e)=>{
  e.stopPropagation();
  if (!dueDate) return;
  const d = new Date();
  d.setDate(d.getDate()+1);
  dueDate.value = isoFromDate(d);
  dueDate.dispatchEvent(new Event("change", { bubbles:true }));
  closeDuePop();
});

// Sem data
dueClearBtn?.addEventListener("click", (e)=>{
  e.stopPropagation();
  if (!dueDate) return;
  dueDate.value = "";
  dueDate.dispatchEvent(new Event("change", { bubbles:true }));
  closeDuePop();
});

dueRemoveBtn?.addEventListener("click", (e)=>{
  e.stopPropagation();
  if (!dueDate) return;
  dueDate.value = "";
  dueDate.dispatchEvent(new Event("change", { bubbles:true }));
  closeDuePop();
});

dueApplyBtn?.addEventListener("click", (e)=>{
  e.stopPropagation();
  closeDuePop();
});

// clicar fora fecha
document.addEventListener("click", () => {
  if (duePop?.classList.contains("open")) closeDuePop();
});
duePop?.addEventListener("click", (e)=> e.stopPropagation());
  
  dueDate?.addEventListener("change", async ()=>{
    const v = dueDate.value;
    const nextDueTs = v ? startTsFromISO(v) : null;

    // Durante criação (card ainda não existe): só guarda valor temporário
    if (!activeCardId && overlay?.dataset?.newcol){
      pendingNewCardDueTs = nextDueTs;
      dueLabel.textContent = nextDueTs ? dueHuman(nextDueTs) : "Prazo";
      if (duePill) duePill.textContent = nextDueTs ? `📅 ${dueHuman(nextDueTs)}` : "📅 Sem prazo";
      return;
    }

    if (!activeCardId) return;
    const c = state.cards[activeCardId];
    const before = c.dueTs;

    if (!v){
      c.dueTs = null;
      c.timeline.unshift({ type:"log", ts: nowTs(), text:"Removeu o prazo do card." });
    } else {
      const ts = nextDueTs;
      c.dueTs = ts;
      if (before !== ts) c.timeline.unshift({ type:"log", ts: nowTs(), text:`Definiu o prazo do card para ${dueHuman(ts)} (${v}).` });
    }

    dueLabel.textContent = c.dueTs ? dueHuman(c.dueTs) : "Prazo";
    if (duePill) duePill.textContent = c.dueTs ? `📅 ${dueHuman(c.dueTs)}` : "📅 Sem prazo";
    await persistCardSnapshot(activeCardId, "salvar prazo do card");
    render();
    renderTimeline();
  });


  // Checklist
  addTaskBtn?.addEventListener("click", async ()=>{
    if (!activeCardId) return;
    const t = newTask.value.trim();
    if (!t) return;
    const c = state.cards[activeCardId];
    c.tasks.push({ id: uid(), text: t, done:false });
    c.timeline.unshift({ type:"log", ts: nowTs(), text:"Adicionou uma tarefa no checklist." });
    newTask.value = "";
    await persistCardSnapshot(activeCardId, "salvar checklist");
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
      cb?.addEventListener("change", async ()=>{
        t.done = cb.checked;
        c.timeline.unshift({ type:"log", ts: nowTs(), text: t.done ? "Concluiu uma tarefa do checklist." : "Reabriu uma tarefa do checklist." });
        await persistCardSnapshot(activeCardId, "atualizar checklist");
        renderTasks();
        renderTimeline();
      });

      const del = row.querySelector("button");
      del?.addEventListener("click", async ()=>{
        if (!confirm("Excluir esta tarefa?")) return;
        c.tasks = c.tasks.filter(x=>x.id!==t.id);
        c.timeline.unshift({ type:"log", ts: nowTs(), text:"Excluiu uma tarefa do checklist." });
        await persistCardSnapshot(activeCardId, "remover item do checklist");
        renderTasks();
        renderTimeline();
      });

      taskList.appendChild(row);
    }
  }

  function renderTimeline(){
    if (!timelineEl) return;
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

  closeArch?.addEventListener("click", closeArchivedModal);
  archOverlay?.addEventListener("click", (e)=>{ if (e.target === archOverlay) closeArchivedModal(); });
  document.addEventListener("keydown", (e)=>{ if (e.key === "Escape" && archOverlay.classList.contains("open")) closeArchivedModal(); });

  clearArchivedBtn?.addEventListener("click", async ()=>{
    if (!state.archived.length) return;
    if (!confirm("Limpar todos os arquivados? (eles serão EXCLUÍDOS)")) return;
    for (const id of [...state.archived]){
      await deleteCard(id);
    }
    renderArchivedList();
  });

  function renderArchivedList(){
    if (!archList) return;
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

      item.querySelector('[data-act="restore"]')?.addEventListener("click", async ()=>{
        await restoreCard(id, "todo");
        renderArchivedList();
      });

      item.querySelector('[data-act="open"]')?.addEventListener("click", async ()=>{
        // abre o card restaurando em todo
        await restoreCard(id, "todo");
        renderArchivedList();
        closeArchivedModal();
        openCard(id, "todo");
      });

      item.querySelector('[data-act="del"]')?.addEventListener("click", async ()=>{
        if (!confirm("Excluir esse card arquivado?")) return;
        await deleteCard(id);
        renderArchivedList();
      });

      archList.appendChild(item);
    }
  }

document.getElementById("createCardBtn")?.addEventListener("click", closeCard);


// Start
  lockApp();
  setGateUI();
  initSupabase();
  // (render acontece após login, dentro do initSupabase)

})();
