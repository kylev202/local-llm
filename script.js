// ===== CONFIG =====
const DEFAULT_OLLAMA_URL = "http://localhost:11434";
const DEFAULT_MODEL = "llama3";
const DEFAULT_SYSTEM = "You are a helpful assistant.";

// ===== STATE =====
let ollamaUrl = DEFAULT_OLLAMA_URL;
let conversations = [];
let activeConvId = null;
let isGenerating = false;
let memoryLibrary = []; // { id, key, value, category, timestamp, source }
let journalEntries = []; // { id, text, timestamp, source }
let modLog = []; // { id, text, timestamp, type }
let thinkingLog = []; // { id, text, timestamp }
let activeFilter = "all";

// ===== DOM =====
const $ = (sel) => document.querySelector(sel);
const sidebar = $("#sidebar");
const sidebarToggle = $("#sidebarToggle");
const newChatBtn = $("#newChatBtn");
const conversationList = $("#conversationList");
const modelSelect = $("#modelSelect");
const settingsBtn = $("#settingsBtn");
const settingsModal = $("#settingsModal");
const settingsClose = $("#settingsClose");
const chatArea = $("#chatArea");
const welcome = $("#welcome");
const messagesEl = $("#messages");
const inputForm = $("#inputForm");
const userInput = $("#userInput");
const sendBtn = $("#sendBtn");
const topbarTitle = $("#topbarTitle");
const statusDot = $("#statusDot");
const statusText = $("#statusText");
const tempSlider = $("#tempSlider");
const tempValue = $("#tempValue");
const ollamaUrlInput = $("#ollamaUrl");
const maxTokensInput = $("#maxTokens");
const systemPromptInput = $("#systemPrompt");
const pullModelBtn = $("#pullModelBtn");
const pullModelName = $("#pullModelName");
const pullProgress = $("#pullProgress");
const createModelBtn = $("#createModelBtn");
const modelfileContent = $("#modelfileContent");
const customModelName = $("#customModelName");
const createProgress = $("#createProgress");
const deleteModelBtn = $("#deleteModelBtn");
const deleteModelSelect = $("#deleteModelSelect");

// Training panel DOM
const trainingPanel = $("#trainingPanel");
const trainingPanelBtn = $("#trainingPanelBtn");
const trainingPanelClose = $("#trainingPanelClose");
const thinkingLogEl = $("#thinkingLog");
const thinkingLive = $("#thinkingLive");
const journalEntriesEl = $("#journalEntries");
const journalManualEntry = $("#journalManualEntry");
const addJournalEntryBtn = $("#addJournalEntry");
const modLogEl = $("#modLog");
const learningRateSlider = $("#learningRate");
const learningRateVal = $("#learningRateVal");
const autoLearnCheckbox = $("#autoLearn");
const autoJournalCheckbox = $("#autoJournal");
const resetTrainingBtn = $("#resetTrainingBtn");

// Memory panel DOM
const memoryPanel = $("#memoryPanel");
const memoryPanelBtn = $("#memoryPanelBtn");
const memoryPanelClose = $("#memoryPanelClose");
const memorySearchInput = $("#memorySearch");
const memoryKeyInput = $("#memoryKey");
const memoryValueInput = $("#memoryValue");
const memoryCategorySelect = $("#memoryCategory");
const addMemoryBtn = $("#addMemoryBtn");
const memoryListEl = $("#memoryList");
const memoryCountEl = $("#memoryCount");
const memoryFilters = $("#memoryFilters");
const clearAllMemoryBtn = $("#clearAllMemory");

// ===== INIT =====
async function initApp() {
    await loadSettings();
    await loadConversations();
    await loadMemory();
    await loadTraining();
    checkConnection();
    renderConversationList();
    renderChat();
    renderThinkingLog();
    renderJournal();
    renderModLog();
    renderMemoryList();
}
initApp();

// ===== OLLAMA API =====
async function ollamaFetch(path, options = {}) {
    const url = `${ollamaUrl}${path}`;
    return fetch(url, options);
}

async function checkConnection() {
    try {
        const res = await ollamaFetch("/api/tags");
        if (res.ok) {
            const data = await res.json();
            statusDot.className = "status-dot online";
            statusText.textContent = "Ollama connected";
            populateModels(data.models || []);
        } else {
            setOffline();
        }
    } catch {
        setOffline();
    }
}

function setOffline() {
    statusDot.className = "status-dot offline";
    statusText.textContent = "Ollama offline";
    modelSelect.innerHTML = '<option>No models</option>';
}

function populateModels(models) {
    const current = modelSelect.value;
    modelSelect.innerHTML = "";
    deleteModelSelect.innerHTML = "";
    if (models.length === 0) {
        modelSelect.innerHTML = '<option>No models found</option>';
        return;
    }
    models.forEach((m) => {
        const name = m.name;
        modelSelect.innerHTML += `<option value="${esc(name)}">${esc(name)}</option>`;
        deleteModelSelect.innerHTML += `<option value="${esc(name)}">${esc(name)}</option>`;
    });
    if (current && [...modelSelect.options].some((o) => o.value === current)) {
        modelSelect.value = current;
    }
}

// Build system prompt with memory context
function buildSystemPrompt() {
    let sys = systemPromptInput.value.trim() || DEFAULT_SYSTEM;

    if (memoryLibrary.length > 0) {
        sys += "\n\n[MEMORY CONTEXT — Use this to personalize responses]\n";
        memoryLibrary.forEach((m) => {
            sys += `- ${m.key}: ${m.value}\n`;
        });
        sys += "\nUse the above memory to recall user info when relevant. Do not repeat memories verbatim unless asked.";
    }

    sys += `\n\n[INSTRUCTIONS]
After your main response, on a NEW LINE, output a JSON block wrapped in <ai_meta>...</ai_meta> with:
{
  "thinking": "brief summary of your reasoning process",
  "memories_to_save": [{"key":"topic","value":"detail","category":"personal|preference|project|fact|other"}],
  "journal": "self-reflection on this interaction",
  "modification": "any behavioral adjustment you're making"
}
If nothing to report for a field, use null. Always include the <ai_meta> block.`;

    return sys;
}

async function streamChat(messages, onToken) {
    const model = modelSelect.value;
    const systemPrompt = buildSystemPrompt();
    const fullMessages = [{ role: "system", content: systemPrompt }, ...messages];

    const res = await ollamaFetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            model,
            messages: fullMessages,
            stream: true,
            options: {
                temperature: parseFloat(tempSlider.value),
                num_predict: parseInt(maxTokensInput.value),
            },
        }),
    });

    if (!res.ok) throw new Error(`Ollama error: ${res.status}`);

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";
        for (const line of lines) {
            if (!line.trim()) continue;
            try {
                const json = JSON.parse(line);
                if (json.message?.content) {
                    onToken(json.message.content);
                }
            } catch {}
        }
    }
}

// ===== AI META PROCESSING =====
function processAiMeta(fullText) {
    const metaMatch = fullText.match(/<ai_meta>([\s\S]*?)<\/ai_meta>/);
    let displayText = fullText.replace(/<ai_meta>[\s\S]*?<\/ai_meta>/, "").trim();

    if (!metaMatch) return displayText;

    try {
        const meta = JSON.parse(metaMatch[1]);
        const now = new Date();

        // Thinking
        if (meta.thinking) {
            addThinkingEntry(meta.thinking, now);
        }

        // Auto-save memories
        if (autoLearnCheckbox.checked && Array.isArray(meta.memories_to_save)) {
            meta.memories_to_save.forEach((m) => {
                if (m && m.key && m.value) {
                    // Check for existing memory with same key, update it
                    const existing = memoryLibrary.find(
                        (x) => x.key.toLowerCase() === m.key.toLowerCase()
                    );
                    if (existing) {
                        existing.value = m.value;
                        existing.timestamp = now.toISOString();
                        existing.source = "ai-updated";
                        addModLogEntry(`Updated memory: "${m.key}"`, now, "neutral");
                    } else {
                        memoryLibrary.push({
                            id: Date.now().toString() + Math.random().toString(36).slice(2, 6),
                            key: m.key,
                            value: m.value,
                            category: m.category || "other",
                            timestamp: now.toISOString(),
                            source: "ai",
                        });
                        addModLogEntry(`Learned new memory: "${m.key}"`, now, "positive");
                    }
                }
            });
            saveMemory();
            renderMemoryList();
        }

        // Journal
        if (autoJournalCheckbox.checked && meta.journal) {
            journalEntries.unshift({
                id: Date.now().toString(),
                text: meta.journal,
                timestamp: now.toISOString(),
                source: "ai",
            });
            saveTraining();
            renderJournal();
        }

        // Modification
        if (meta.modification) {
            addModLogEntry(meta.modification, now, "positive");
        }
    } catch {
        // AI didn't format JSON properly, that's OK
    }

    return displayText;
}

// ===== THINKING LOG =====
function addThinkingEntry(text, date) {
    thinkingLog.unshift({
        id: Date.now().toString(),
        text,
        timestamp: date.toISOString(),
    });
    if (thinkingLog.length > 50) thinkingLog.pop();
    saveTraining();
    renderThinkingLog();
}

function renderThinkingLog() {
    if (thinkingLog.length === 0) {
        thinkingLogEl.innerHTML = '<p class="empty-state">Start a conversation to see AI thinking…</p>';
        return;
    }
    const entries = thinkingLog.slice(0, 20).slice().reverse();
    thinkingLogEl.innerHTML = entries
        .map(
            (t, i) => `<div class="thinking-entry${i === entries.length - 1 ? ' newest' : ''}">
            <span class="thinking-time">${fmtTime(t.timestamp)}</span>
            <div>${esc(t.text)}</div>
        </div>`
        )
        .join("");
    thinkingLogEl.scrollTop = thinkingLogEl.scrollHeight;
}

// ===== JOURNAL =====
function renderJournal() {
    if (journalEntries.length === 0) {
        journalEntriesEl.innerHTML = '<p class="empty-state">No journal entries yet.</p>';
        return;
    }
    const entries = journalEntries.slice().reverse();
    journalEntriesEl.innerHTML = entries
        .map(
            (j, i) => `<div class="journal-entry${i === entries.length - 1 ? ' newest' : ''}" data-id="${j.id}">
            <button class="journal-delete" data-id="${j.id}">&times;</button>
            <span class="journal-time">${fmtTime(j.timestamp)}</span>
            <div class="journal-text">${esc(j.text)}</div>
            <span class="journal-source">${j.source === "ai" ? "AI" : "Manual"}</span>
        </div>`
        )
        .join("");
    journalEntriesEl.scrollTop = journalEntriesEl.scrollHeight;
}

journalEntriesEl.addEventListener("click", (e) => {
    if (e.target.classList.contains("journal-delete")) {
        const id = e.target.dataset.id;
        journalEntries = journalEntries.filter((j) => j.id !== id);
        saveTraining();
        renderJournal();
    }
});

addJournalEntryBtn.addEventListener("click", () => {
    const text = journalManualEntry.value.trim();
    if (!text) return;
    journalEntries.unshift({
        id: Date.now().toString(),
        text,
        timestamp: new Date().toISOString(),
        source: "user",
    });
    journalManualEntry.value = "";
    saveTraining();
    renderJournal();
});

// ===== MODIFICATION LOG =====
function addModLogEntry(text, date, type) {
    modLog.unshift({
        id: Date.now().toString(),
        text,
        timestamp: date.toISOString(),
        type,
    });
    if (modLog.length > 100) modLog.pop();
    saveTraining();
    renderModLog();
}

function renderModLog() {
    if (modLog.length === 0) {
        modLogEl.innerHTML = '<p class="empty-state">No modifications yet.</p>';
        return;
    }
    const entries = modLog.slice(0, 30).slice().reverse();
    modLogEl.innerHTML = entries
        .map(
            (m, i) => `<div class="mod-entry mod-${m.type}${i === entries.length - 1 ? ' newest' : ''}">
            <span class="mod-time">${fmtTime(m.timestamp)}</span>
            <div>${esc(m.text)}</div>
        </div>`
        )
        .join("");
    modLogEl.scrollTop = modLogEl.scrollHeight;
}

// ===== MEMORY LIBRARY =====
function renderMemoryList() {
    const search = memorySearchInput.value.toLowerCase();
    let filtered = memoryLibrary;
    if (activeFilter !== "all") {
        filtered = filtered.filter((m) => m.category === activeFilter);
    }
    if (search) {
        filtered = filtered.filter(
            (m) =>
                m.key.toLowerCase().includes(search) ||
                m.value.toLowerCase().includes(search)
        );
    }

    memoryCountEl.textContent = `(${memoryLibrary.length})`;

    if (filtered.length === 0) {
        memoryListEl.innerHTML =
            '<p class="empty-state">No memories found.</p>';
        return;
    }

    memoryListEl.innerHTML = filtered
        .map(
            (m) => `<div class="memory-item" data-id="${m.id}">
            <div class="memory-actions">
                <button class="mem-edit" data-id="${m.id}" title="Edit">✎</button>
                <button class="mem-delete" data-id="${m.id}" title="Delete">×</button>
            </div>
            <span class="memory-cat">${esc(m.category)}</span>
            <div class="memory-key">${esc(m.key)}</div>
            <div class="memory-val">${esc(m.value)}</div>
            <div class="memory-time">${fmtTime(m.timestamp)} · ${m.source === "ai" ? "Noted by AI" : m.source === "ai-updated" ? "Updated by AI" : "Added by you"}</div>
        </div>`
        )
        .join("");
}

memoryListEl.addEventListener("click", (e) => {
    const btn = e.target.closest("button");
    if (!btn) return;
    const id = btn.dataset.id;

    if (btn.classList.contains("mem-delete")) {
        memoryLibrary = memoryLibrary.filter((m) => m.id !== id);
        saveMemory();
        renderMemoryList();
    } else if (btn.classList.contains("mem-edit")) {
        const mem = memoryLibrary.find((m) => m.id === id);
        if (!mem) return;
        memoryKeyInput.value = mem.key;
        memoryValueInput.value = mem.value;
        memoryCategorySelect.value = mem.category;
        // Remove old, user will re-save
        memoryLibrary = memoryLibrary.filter((m) => m.id !== id);
        saveMemory();
        renderMemoryList();
    }
});

addMemoryBtn.addEventListener("click", () => {
    const key = memoryKeyInput.value.trim();
    const value = memoryValueInput.value.trim();
    if (!key || !value) return;
    memoryLibrary.push({
        id: Date.now().toString() + Math.random().toString(36).slice(2, 6),
        key,
        value,
        category: memoryCategorySelect.value,
        timestamp: new Date().toISOString(),
        source: "user",
    });
    memoryKeyInput.value = "";
    memoryValueInput.value = "";
    saveMemory();
    renderMemoryList();
});

memorySearchInput.addEventListener("input", renderMemoryList);

memoryFilters.addEventListener("click", (e) => {
    const chip = e.target.closest(".filter-chip");
    if (!chip) return;
    memoryFilters.querySelectorAll(".filter-chip").forEach((c) => c.classList.remove("active"));
    chip.classList.add("active");
    activeFilter = chip.dataset.cat;
    renderMemoryList();
});

clearAllMemoryBtn.addEventListener("click", () => {
    if (!confirm("Delete all memories? This cannot be undone.")) return;
    memoryLibrary = [];
    saveMemory();
    renderMemoryList();
});

// ===== MODEL MANAGEMENT =====
pullModelBtn.addEventListener("click", async () => {
    const name = pullModelName.value.trim();
    if (!name) return;
    pullProgress.textContent = `Pulling ${name}…`;
    try {
        const res = await ollamaFetch("/api/pull", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ name, stream: true }),
        });
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buf = "";
        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            buf += decoder.decode(value, { stream: true });
            const lines = buf.split("\n");
            buf = lines.pop() || "";
            for (const l of lines) {
                if (!l.trim()) continue;
                try {
                    const j = JSON.parse(l);
                    pullProgress.textContent = j.status || "Pulling…";
                } catch {}
            }
        }
        pullProgress.textContent = `Done! ${name} is ready.`;
        checkConnection();
    } catch (e) {
        pullProgress.textContent = `Error: ${e.message}`;
    }
});

createModelBtn.addEventListener("click", async () => {
    const name = customModelName.value.trim();
    const modelfile = modelfileContent.value.trim();
    if (!name || !modelfile) return;
    createProgress.textContent = `Creating ${name}…`;
    try {
        const res = await ollamaFetch("/api/create", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ name, modelfile, stream: true }),
        });
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buf = "";
        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            buf += decoder.decode(value, { stream: true });
            const lines = buf.split("\n");
            buf = lines.pop() || "";
            for (const l of lines) {
                if (!l.trim()) continue;
                try {
                    const j = JSON.parse(l);
                    createProgress.textContent = j.status || "Creating…";
                } catch {}
            }
        }
        createProgress.textContent = `Done! ${name} created.`;
        checkConnection();
    } catch (e) {
        createProgress.textContent = `Error: ${e.message}`;
    }
});

deleteModelBtn.addEventListener("click", async () => {
    const name = deleteModelSelect.value;
    if (!name || !confirm(`Delete model "${name}"? This cannot be undone.`)) return;
    try {
        await ollamaFetch("/api/delete", {
            method: "DELETE",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ name }),
        });
        checkConnection();
    } catch (e) {
        alert(`Error: ${e.message}`);
    }
});

// ===== CONVERSATIONS =====
function newConversation() {
    const conv = {
        id: Date.now().toString(),
        title: "New Chat",
        messages: [],
    };
    conversations.unshift(conv);
    activeConvId = conv.id;
    saveConversations();
    renderConversationList();
    renderChat();
}

function getActiveConv() {
    return conversations.find((c) => c.id === activeConvId);
}

function renderConversationList() {
    conversationList.innerHTML = "";
    conversations.forEach((c) => {
        const div = document.createElement("div");
        div.className = `conv-item${c.id === activeConvId ? " active" : ""}`;

        const titleSpan = document.createElement("span");
        titleSpan.className = "conv-title";
        titleSpan.textContent = c.title;

        const actions = document.createElement("span");
        actions.className = "conv-actions";

        const renameBtn = document.createElement("button");
        renameBtn.className = "conv-action-btn";
        renameBtn.textContent = "✏️";
        renameBtn.title = "Rename";
        renameBtn.addEventListener("click", (e) => {
            e.stopPropagation();
            const newTitle = prompt("Rename chat:", c.title);
            if (newTitle !== null && newTitle.trim()) {
                c.title = newTitle.trim();
                saveConversations();
                renderConversationList();
                if (c.id === activeConvId) topbarTitle.textContent = c.title;
            }
        });

        const deleteBtn = document.createElement("button");
        deleteBtn.className = "conv-action-btn conv-delete-btn";
        deleteBtn.textContent = "🗑️";
        deleteBtn.title = "Delete";
        deleteBtn.addEventListener("click", (e) => {
            e.stopPropagation();
            if (!confirm("Delete this chat?")) return;
            conversations = conversations.filter((x) => x.id !== c.id);
            if (activeConvId === c.id) {
                activeConvId = conversations.length > 0 ? conversations[0].id : null;
            }
            saveConversations();
            renderConversationList();
            renderChat();
        });

        actions.appendChild(renameBtn);
        actions.appendChild(deleteBtn);
        div.appendChild(titleSpan);
        div.appendChild(actions);

        div.addEventListener("click", () => {
            activeConvId = c.id;
            renderConversationList();
            renderChat();
        });
        conversationList.appendChild(div);
    });
}

function renderChat() {
    const conv = getActiveConv();
    if (!conv || conv.messages.length === 0) {
        welcome.style.display = "";
        messagesEl.innerHTML = "";
        topbarTitle.textContent = "New Chat";
        return;
    }
    welcome.style.display = "none";
    topbarTitle.textContent = conv.title;
    messagesEl.innerHTML = "";
    conv.messages.forEach((m) => {
        // Strip meta from display
        const display =
            m.role === "assistant"
                ? m.content.replace(/<ai_meta>[\s\S]*?<\/ai_meta>/, "").trim()
                : m.content;
        appendMessage(m.role, display);
    });
    scrollToBottom();
}

function appendMessage(role, content) {
    const div = document.createElement("div");
    div.className = `msg ${role}`;
    const avatar = role === "user" ? "Y" : "AI";
    div.innerHTML = `
        <div class="msg-avatar">${avatar}</div>
        <div class="msg-content">
            <div class="msg-role">${role === "user" ? "You" : "Local LLM"}</div>
            <div class="msg-text">${esc(content)}</div>
        </div>`;
    messagesEl.appendChild(div);
    return div;
}

function appendTypingIndicator() {
    const div = document.createElement("div");
    div.className = "msg assistant";
    div.id = "typing";
    div.innerHTML = `
        <div class="msg-avatar">AI</div>
        <div class="msg-content">
            <div class="msg-role">Local LLM</div>
            <div class="msg-text"><div class="typing-indicator"><span></span><span></span><span></span></div></div>
        </div>`;
    messagesEl.appendChild(div);
    scrollToBottom();
    return div;
}

function scrollToBottom() {
    chatArea.scrollTop = chatArea.scrollHeight;
}

function esc(str) {
    const d = document.createElement("div");
    d.textContent = str;
    return d.innerHTML;
}

function fmtTime(iso) {
    const d = new Date(iso);
    return d.toLocaleString(undefined, {
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
    });
}

// ===== SEND MESSAGE =====
async function sendMessage(text) {
    if (isGenerating || !text.trim()) return;

    if (!activeConvId) newConversation();
    const conv = getActiveConv();

    welcome.style.display = "none";
    conv.messages.push({ role: "user", content: text.trim() });

    if (conv.messages.length === 1) {
        conv.title =
            text.trim().slice(0, 40) + (text.trim().length > 40 ? "…" : "");
        renderConversationList();
        topbarTitle.textContent = conv.title;
    }

    appendMessage("user", text.trim());
    scrollToBottom();
    saveConversations();

    isGenerating = true;
    sendBtn.disabled = true;
    thinkingLive.classList.add("active");
    const typing = appendTypingIndicator();

    let aiText = "";

    try {
        await streamChat(conv.messages, (token) => {
            if (typing.parentNode) typing.remove();
            aiText += token;
            // Show text without meta tags in real time
            const displayText = aiText.replace(/<ai_meta>[\s\S]*$/, "").trim();
            let aiMsg = messagesEl.querySelector(
                ".msg.assistant:last-child .msg-text"
            );
            if (!aiMsg || aiMsg.closest(".msg").id === "typing") {
                const el = appendMessage("assistant", "");
                aiMsg = el.querySelector(".msg-text");
            }
            aiMsg.textContent = displayText;
            scrollToBottom();
        });
    } catch (e) {
        if (typing.parentNode) typing.remove();
        aiText = `Error: ${e.message}. Make sure Ollama is running.`;
        appendMessage("assistant", aiText);
    }

    thinkingLive.classList.remove("active");

    // Process AI meta (memories, journal, thinking, mods)
    const displayText = processAiMeta(aiText);

    // Update displayed message to clean version
    const lastMsg = messagesEl.querySelector(
        ".msg.assistant:last-child .msg-text"
    );
    if (lastMsg) lastMsg.textContent = displayText;

    conv.messages.push({ role: "assistant", content: aiText });
    saveConversations();
    isGenerating = false;
    sendBtn.disabled = !userInput.value.trim();
}

// ===== PANEL TOGGLES =====
function togglePanel(panel, btn) {
    const isOpen = panel.classList.contains("open");
    // Close all panels first
    trainingPanel.classList.remove("open");
    memoryPanel.classList.remove("open");
    trainingPanelBtn.classList.remove("active");
    memoryPanelBtn.classList.remove("active");
    if (!isOpen) {
        panel.classList.add("open");
        btn.classList.add("active");
    }
}

trainingPanelBtn.addEventListener("click", () =>
    togglePanel(trainingPanel, trainingPanelBtn)
);
memoryPanelBtn.addEventListener("click", () =>
    togglePanel(memoryPanel, memoryPanelBtn)
);
trainingPanelClose.addEventListener("click", () => {
    trainingPanel.classList.remove("open");
    trainingPanelBtn.classList.remove("active");
});
memoryPanelClose.addEventListener("click", () => {
    memoryPanel.classList.remove("open");
    memoryPanelBtn.classList.remove("active");
});

// Learning rate display
learningRateSlider.addEventListener("input", () => {
    learningRateVal.textContent = learningRateSlider.value;
});

// Reset training
resetTrainingBtn.addEventListener("click", () => {
    if (!confirm("Reset all training data (thinking, journal, modifications)? This cannot be undone.")) return;
    thinkingLog = [];
    journalEntries = [];
    modLog = [];
    saveTraining();
    renderThinkingLog();
    renderJournal();
    renderModLog();
});

// ===== EVENT LISTENERS =====
inputForm.addEventListener("submit", (e) => {
    e.preventDefault();
    const text = userInput.value;
    userInput.value = "";
    userInput.style.height = "auto";
    sendBtn.disabled = true;
    sendMessage(text);
});

userInput.addEventListener("input", () => {
    sendBtn.disabled = !userInput.value.trim() || isGenerating;
    userInput.style.height = "auto";
    userInput.style.height = Math.min(userInput.scrollHeight, 160) + "px";
});

userInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        inputForm.dispatchEvent(new Event("submit"));
    }
});

newChatBtn.addEventListener("click", () => {
    newConversation();
    userInput.focus();
});

sidebarToggle.addEventListener("click", () => {
    sidebar.classList.toggle("collapsed");
});

document.querySelectorAll(".prompt-chip").forEach((chip) => {
    chip.addEventListener("click", () => {
        userInput.value = chip.dataset.prompt;
        sendBtn.disabled = false;
        inputForm.dispatchEvent(new Event("submit"));
    });
});

settingsBtn.addEventListener("click", () => settingsModal.classList.add("open"));
settingsClose.addEventListener("click", () => {
    settingsModal.classList.remove("open");
    saveSettings();
});
settingsModal.addEventListener("click", (e) => {
    if (e.target === settingsModal) {
        settingsModal.classList.remove("open");
        saveSettings();
    }
});

tempSlider.addEventListener("input", () => {
    tempValue.textContent = tempSlider.value;
});

ollamaUrlInput.addEventListener("change", () => {
    ollamaUrl = ollamaUrlInput.value.replace(/\/+$/, "");
    saveSettings();
    checkConnection();
});

// ===== PERSISTENCE (localStorage + file sync) =====
const hasFileAPI = typeof window.fileAPI !== 'undefined';

function syncToFile(filename, data) {
    if (hasFileAPI) {
        window.fileAPI.saveData(filename, data).catch(() => {});
    }
}

async function loadFromFile(filename) {
    if (!hasFileAPI) return null;
    try {
        const result = await window.fileAPI.loadData(filename);
        if (result.ok && result.data !== null) return result.data;
    } catch {}
    return null;
}

function saveConversations() {
    localStorage.setItem("llama_conversations", JSON.stringify(conversations));
    syncToFile("chats/conversations.json", conversations);
}

async function loadConversations() {
    try {
        let data = await loadFromFile("chats/conversations.json");
        if (!data) {
            data = JSON.parse(localStorage.getItem("llama_conversations"));
        }
        if (Array.isArray(data)) {
            conversations = data;
            if (conversations.length > 0) activeConvId = conversations[0].id;
        }
    } catch {}
}

function saveSettings() {
    const settings = {
        ollamaUrl: ollamaUrlInput.value.replace(/\/+$/, ""),
        temperature: tempSlider.value,
        maxTokens: maxTokensInput.value,
        systemPrompt: systemPromptInput.value,
    };
    localStorage.setItem("llama_settings", JSON.stringify(settings));
    syncToFile("settings.json", settings);
    ollamaUrl = settings.ollamaUrl;
}

async function loadSettings() {
    try {
        let s = await loadFromFile("settings.json");
        if (!s) {
            s = JSON.parse(localStorage.getItem("llama_settings"));
        }
        if (s) {
            ollamaUrl = s.ollamaUrl || DEFAULT_OLLAMA_URL;
            ollamaUrlInput.value = ollamaUrl;
            tempSlider.value = s.temperature || "0.7";
            tempValue.textContent = tempSlider.value;
            maxTokensInput.value = s.maxTokens || "2048";
            systemPromptInput.value = s.systemPrompt || "";
        }
    } catch {}
}

function saveMemory() {
    localStorage.setItem("llama_memory", JSON.stringify(memoryLibrary));
    syncToFile("memory/library.json", memoryLibrary);
}

async function loadMemory() {
    try {
        let data = await loadFromFile("memory/library.json");
        if (!data) {
            data = JSON.parse(localStorage.getItem("llama_memory"));
        }
        if (Array.isArray(data)) memoryLibrary = data;
    } catch {}
}

function saveTraining() {
    const trainingData = { thinkingLog, journalEntries, modLog };
    localStorage.setItem("llama_training", JSON.stringify(trainingData));
    syncToFile("training/thinking-log.json", thinkingLog);
    syncToFile("training/journal.json", journalEntries);
    syncToFile("training/mod-log.json", modLog);
}

async function loadTraining() {
    try {
        // Try loading individual files first
        const [thinking, journal, mods] = await Promise.all([
            loadFromFile("training/thinking-log.json"),
            loadFromFile("training/journal.json"),
            loadFromFile("training/mod-log.json"),
        ]);
        if (thinking || journal || mods) {
            thinkingLog = thinking || [];
            journalEntries = journal || [];
            modLog = mods || [];
            return;
        }
        // Fallback to localStorage
        const data = JSON.parse(localStorage.getItem("llama_training"));
        if (data) {
            thinkingLog = data.thinkingLog || [];
            journalEntries = data.journalEntries || [];
            modLog = data.modLog || [];
        }
    } catch {}
}

// ===== RENDER INITIAL STATE =====
// (Moved to initApp() for async loading)
