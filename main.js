const chatMessages = document.getElementById('chatMessages');
const messageInput = document.getElementById('messageInput');
const sendButton = document.getElementById('sendButton');
const statusBar = document.getElementById('statusBar');
const statusMessage = document.getElementById('statusMessage');
const progressFill = document.getElementById('progressFill');
const newChatBtn = document.getElementById('newChatBtn');
const chatList = document.getElementById('chatList');
const openRouterKeyInput = document.getElementById('openRouterKeyInput');
const modelSelect = document.getElementById('modelSelect');
const saveOpenRouterBtn = document.getElementById('saveOpenRouterBtn');
const modelNameBadge = document.querySelector('.model-name');
const freeOnlyToggle = document.getElementById('freeOnlyToggle');
const freeOnlyHint = document.getElementById('freeOnlyHint');
let worker = null;
let isModelReady = false;
let isGenerating = false;
let conversationHistory = [];
let currentChatId = null;
let chatHistory = [];
const LS_KEY = 'midari-openrouter-key';
const LS_MODEL = 'midari-openrouter-model';
const LS_FREE_ONLY = 'midari-free-only';

const DEFAULT_MODELS = [
    { id: 'openrouter/auto', name: 'openrouter/auto (recomendado)', free: false },
    { id: 'mistralai/mistral-small', name: 'mistralai/mistral-small', free: false },
    { id: 'google/gemini-flash-1.5', name: 'google/gemini-flash-1.5', free: false },
    { id: 'anthropic/claude-3.5-haiku', name: 'anthropic/claude-3.5-haiku', free: false },
    { id: 'openai/gpt-4o-mini', name: 'openai/gpt-4o-mini', free: false },
];

function isModelFreeFromCatalogItem(item) {
    try {
        const pricing = item.pricing || item.prices || item.price || {};
        const prompt = pricing.prompt ?? pricing.input ?? pricing.prompt_cached ?? 0;
        const completion = pricing.completion ?? pricing.output ?? pricing.completion_cached ?? 0;
        const toNum = (v) => typeof v === 'string' ? parseFloat(v) : (typeof v === 'number' ? v : NaN);
        const p = toNum(prompt);
        const c = toNum(completion);
        if (!isNaN(p) && p === 0) return true;
        if (!isNaN(c) && c === 0) return true;
        return false;
    } catch (_) {
        return false;
    }
}

async function fetchOpenRouterModels() {
    try {
        const resp = await fetch('https://openrouter.ai/api/v1/models');
        if (!resp.ok) throw new Error('HTTP ' + resp.status);
        const data = await resp.json();
        const items = Array.isArray(data) ? data : (data?.data || data?.models || []);
        return items.map((m) => ({
            id: m.id || m.slug || m.model || '',
            name: m.name || m.id || '',
            free: isModelFreeFromCatalogItem(m),
        })).filter(x => x.id);
    } catch (e) {
        return DEFAULT_MODELS;
    }
}

function populateModelSelect(models, freeOnly, savedModel) {
    if (!modelSelect) return;
    modelSelect.innerHTML = '';
    const filtered = freeOnly ? models.filter(m => m.free) : models;
    if (filtered.length === 0) {
        const opt = document.createElement('option');
        opt.value = '';
        opt.textContent = 'No hay modelos gratis disponibles';
        modelSelect.appendChild(opt);
        modelSelect.disabled = true;
        if (freeOnlyHint) freeOnlyHint.textContent = 'No hay modelos gratis disponibles en este momento en OpenRouter.';
        return;
    }
    modelSelect.disabled = false;
    filtered.forEach(m => {
        const opt = document.createElement('option');
        opt.value = m.id;
        opt.textContent = m.name + (m.free ? ' (gratis)' : '');
        modelSelect.appendChild(opt);
    });
    if (savedModel && filtered.some(m => m.id === savedModel)) {
        modelSelect.value = savedModel;
    }
}

async function loadAndRenderModels() {
    const freeOnly = (localStorage.getItem(LS_FREE_ONLY) || 'true') === 'true';
    if (freeOnlyToggle) freeOnlyToggle.checked = freeOnly;
    const savedModel = localStorage.getItem(LS_MODEL) || 'openrouter/auto';
    const models = await fetchOpenRouterModels();
    const freeCount = models.filter(m => m.free).length;
    if (freeOnlyHint) {
        freeOnlyHint.textContent = freeOnly
            ? (freeCount > 0 ? `Modelos gratis disponibles: ${freeCount}` : 'No hay modelos gratis disponibles ahora.')
            : 'Muestra todos los modelos del catálogo público.';
    }
    populateModelSelect(models, freeOnly, savedModel);
}

function renderMarkdownSafe(markdown) {
    if (typeof window !== 'undefined' && window.marked && typeof window.marked.parse === 'function') {
        const html = window.marked.parse(markdown || '');
        if (window.DOMPurify && typeof window.DOMPurify.sanitize === 'function') {
            return window.DOMPurify.sanitize(html);
        }
        return html;
    }

    return null;
}
function injectThoughtMarkup(text) {
    try {
        if (!text) return text;
        const wrap = (inner) => `\n\n<details class="thought-block"><summary>Pensamiento del modelo</summary>\n\n${inner}\n\n</details>\n\n`;
        let out = text.replace(/<think>([\s\S]*?)<\/think>/gi, (_, p1) => wrap(p1.trim()))
                      .replace(/<thinking>([\s\S]*?)<\/thinking>/gi, (_, p1) => wrap(p1.trim()));
        return out;
    } catch (_) {
        return text;
    }
}

async function initializeApp() {
    try {
        worker = new Worker('./worker.js', { type: 'module' });
        worker.addEventListener('message', handleWorkerMessage);
        worker.addEventListener('error', handleWorkerError);
        worker.postMessage({ type: 'initialize' });
        loadChatHistory();
        setupInitialChat();
        newChatBtn.addEventListener('click', createNewChat);

        let savedKey = sessionStorage.getItem(LS_KEY) || '';
        if (!savedKey) {
            const legacyKey = localStorage.getItem(LS_KEY) || '';
            if (legacyKey) {
                savedKey = legacyKey;
                try {
                    sessionStorage.setItem(LS_KEY, legacyKey);
                    localStorage.removeItem(LS_KEY);
                } catch (_) {}
            }
        }
        const savedModel = localStorage.getItem(LS_MODEL) || 'openrouter/auto';
        if (openRouterKeyInput) openRouterKeyInput.value = savedKey;
        if (modelNameBadge) modelNameBadge.textContent = 'OpenRouter';

        await loadAndRenderModels();
        if (freeOnlyToggle) {
            freeOnlyToggle.addEventListener('change', async () => {
                const freeOnly = !!freeOnlyToggle.checked;
                localStorage.setItem(LS_FREE_ONLY, String(freeOnly));
                await loadAndRenderModels();
            });
        }

        if (savedKey) {
            const selectedModel = (modelSelect?.value) || '';
            if (!selectedModel) {
                updateStatus('No hay modelos gratis disponibles. Desactiva el filtro para ver todos los modelos.', 0);
            } else {
                localStorage.setItem(LS_MODEL, selectedModel);
                configureWorker(savedKey, selectedModel);
            }
        } else {
            updateStatus('Ingresa tu API key de OpenRouter para comenzar', 0);
        }

        if (saveOpenRouterBtn) {
            saveOpenRouterBtn.addEventListener('click', () => {
                const key = (openRouterKeyInput?.value || '').trim();
                const model = modelSelect?.value || '';
                if (!key) {
                    updateStatus('Por favor ingresa una API key válida', 0);
                    return;
                }
                if (!model) {
                    updateStatus('Selecciona un modelo válido. Si el filtro de gratis está activo y no hay disponibles, desactívalo temporalmente.', 0);
                    return;
                }
                try {
                    sessionStorage.setItem(LS_KEY, key);
                } catch (_) {}
                localStorage.setItem(LS_MODEL, model);
                configureWorker(key, model);
            });
        }
    } catch (error) {
        console.error('Error al inicializar:', error);
        updateStatus('Error al inicializar la aplicación', 0);
    }
}

function configureWorker(apiKey, model) {
    try {
        worker?.postMessage({ type: 'configure', data: { apiKey, model } });
        updateStatus('Conectando con OpenRouter...', 50);
        if (modelNameBadge) modelNameBadge.textContent = model || 'OpenRouter';
    } catch (e) {
        console.error('Error al configurar worker:', e);
    }
}

function setupInitialChat() {
    if (chatHistory.length === 0) {
        currentChatId = 'chat_' + Date.now();
        conversationHistory = [];
        renderChatList();
    } else {
        const latestChat = chatHistory[0];
        currentChatId = latestChat.id;
        conversationHistory = [...latestChat.messages];
        chatMessages.innerHTML = '';
        latestChat.messages.forEach(msg => {
            addMessage(msg.content, msg.role === 'user' ? 'user' : 'bot');
        });
        
        renderChatList();
    }
}
function handleWorkerMessage(event) {
    const { type, message, progress, ready, chunk, fullResponse, response } = event.data;
    
    switch (type) {
        case 'status':
            updateStatus(message, progress);
            if (ready) enableChat();
            break;
        case 'initialized':
            isModelReady = true;
            hideStatusBar();
            break;
        case 'response_chunk':
            updateStreamingResponse(chunk, fullResponse);
            break;
        case 'response_complete':
            completeResponse(response);
            break;
        case 'error':
            handleError(message);
            break;
    }
}
function handleWorkerError(error) {
    console.error('Error del worker:', error);
    updateStatus('Error en el procesamiento', 0);
    enableChat();
}
function updateStatus(message, progress) {
    statusMessage.textContent = message;
    progressFill.style.width = `${progress}%`;
    
    const progressText = document.querySelector('.progress-text');
    if (progressText) {
        progressText.textContent = `${Math.round(progress)}%`;
    }
    
    const statusDetail = document.querySelector('.status-detail');
    if (statusDetail) {
        if (progress < 50) {
            statusDetail.textContent = 'Descargando modelo desde la nube';
        } else if (progress < 90) {
            statusDetail.textContent = 'Cargando modelo en memoria';
        } else {
            statusDetail.textContent = 'Finalizando configuración';
        }
    }
}
function enableChat() {
    messageInput.disabled = false;
    sendButton.disabled = false;
    messageInput.placeholder = 'Haz una pregunta o pide ayuda con cualquier tema...';
    messageInput.focus();
    
    const modelStatus = document.querySelector('.model-status');
    if (modelStatus) {
        modelStatus.style.background = 'var(--accent-green)';
    }
}
function hideStatusBar() {
    statusBar.style.display = 'none';
    
    const welcomeSection = document.querySelector('.welcome-section');
    if (welcomeSection) {
        welcomeSection.remove();
        addMessage('¡Hola! Soy Midari AI, tu asistente personal. Ya estoy conectado a OpenRouter y listo para ayudarte. ¿En qué puedo ayudarte hoy?', 'bot');
    }
}

async function sendMessage() {
    const message = messageInput.value.trim();
    if (!message || !isModelReady || isGenerating) return;
    
    addMessage(message, 'user');
    conversationHistory.push({ role: 'user', content: message });
    
    saveCurrentChat(message);
    
    messageInput.value = '';
    adjustTextareaHeight();
    
    addTypingIndicator();
    
    isGenerating = true;
    messageInput.disabled = true;
    sendButton.disabled = true;
    
    worker.postMessage({
        type: 'generate',
        data: {
            message: message,
            history: conversationHistory.slice(-10)
        }
    });
}

function saveCurrentChat(firstMessage = null) {
    let currentChat = chatHistory.find(c => c.id === currentChatId);
    
    if (!currentChat) {
        currentChat = {
            id: currentChatId,
            title: firstMessage ? (firstMessage.slice(0, 50) + (firstMessage.length > 50 ? '...' : '')) : 'Nuevo Chat',
            messages: [...conversationHistory],
            createdAt: new Date().toISOString()
        };
        chatHistory.unshift(currentChat);
    } else {
        currentChat.messages = [...conversationHistory];
        if (firstMessage && currentChat.title === 'Nuevo Chat') {
            currentChat.title = firstMessage.slice(0, 50) + (firstMessage.length > 50 ? '...' : '');
        }
    }
    
    saveChatHistory();
    renderChatList();
}

function addMessage(content, sender) {
    const messageDiv = document.createElement('div');
    messageDiv.className = `message ${sender}-message`;
    
    const contentDiv = document.createElement('div');
    contentDiv.className = 'message-content';
    if (sender === 'bot') {
        const sanitized = renderMarkdownSafe(injectThoughtMarkup(content));
        if (sanitized !== null && sanitized !== undefined) {
            contentDiv.innerHTML = sanitized;
        } else {
            contentDiv.textContent = content || '';
        }
    } else {
        contentDiv.textContent = content || '';
    }
    
    messageDiv.appendChild(contentDiv);
    chatMessages.appendChild(messageDiv);
    scrollToBottom();
    return messageDiv;
}
function addTypingIndicator() {
    const typingDiv = document.createElement('div');
    typingDiv.className = 'message bot-message';
    typingDiv.id = 'typing-indicator';
    
    const typingContent = document.createElement('div');
    typingContent.className = 'typing-indicator';
    typingContent.innerHTML = `
        <span>Escribiendo</span>
        <div class="typing-dots">
            <div class="typing-dot"></div>
            <div class="typing-dot"></div>
            <div class="typing-dot"></div>
        </div>
    `;
    
    typingDiv.appendChild(typingContent);
    chatMessages.appendChild(typingDiv);
    scrollToBottom();
}
function updateStreamingResponse(chunk, fullResponse) {
    let responseDiv = document.getElementById('streaming-response');
    
    if (!responseDiv) {
        const typingIndicator = document.getElementById('typing-indicator');
        if (typingIndicator) typingIndicator.remove();
        
        responseDiv = document.createElement('div');
        responseDiv.className = 'message bot-message';
        responseDiv.id = 'streaming-response';
        
        const contentDiv = document.createElement('div');
        contentDiv.className = 'message-content';
        contentDiv.id = 'streaming-content';
        
        responseDiv.appendChild(contentDiv);
        chatMessages.appendChild(responseDiv);
    }
    
    const contentDiv = document.getElementById('streaming-content');
    const sanitized = renderMarkdownSafe(injectThoughtMarkup(fullResponse));
    if (sanitized !== null && sanitized !== undefined) {
        contentDiv.innerHTML = sanitized;
    } else {
        contentDiv.textContent = fullResponse || '';
    }
    scrollToBottom();
}
function completeResponse(response) {
    const responseDiv = document.getElementById('streaming-response');
    if (responseDiv) {
        responseDiv.id = '';
        const contentDiv = responseDiv.querySelector('.message-content');
        contentDiv.id = '';
    }
    
    conversationHistory.push({ role: 'assistant', content: response });
    saveCurrentChat();
    
    isGenerating = false;
    messageInput.disabled = false;
    sendButton.disabled = false;
    messageInput.focus();
}
function handleError(errorMessage) {
    const typingIndicator = document.getElementById('typing-indicator');
    if (typingIndicator) typingIndicator.remove();
    
    addMessage(`Error: ${errorMessage}`, 'bot');
    
    isGenerating = false;
    messageInput.disabled = false;
    sendButton.disabled = false;
}
function scrollToBottom() {
    chatMessages.scrollTop = chatMessages.scrollHeight;
}
function adjustTextareaHeight() {
    messageInput.style.height = 'auto';
    messageInput.style.height = Math.min(messageInput.scrollHeight, 120) + 'px';
}
function loadChatHistory() {
    const saved = localStorage.getItem('midari-chat-history');
    if (saved) {
        try {
            chatHistory = JSON.parse(saved);
        } catch (e) {
            chatHistory = [];
        }
    }
}

function saveChatHistory() {
    localStorage.setItem('midari-chat-history', JSON.stringify(chatHistory));
}

function createNewChat() {
    if (isGenerating) return;
    
    currentChatId = 'chat_' + Date.now();
    conversationHistory = [];
    
    chatMessages.innerHTML = '';
    
    if (isModelReady) {
        addMessage('¡Hola! Soy Midari AI, tu asistente personal. Ya estoy conectado a OpenRouter y listo para ayudarte. ¿En qué puedo ayudarte hoy?', 'bot');
    } else {
        const welcomeSection = document.createElement('div');
        welcomeSection.className = 'welcome-section';
        welcomeSection.innerHTML = `
            <div class="welcome-card">
                <div class="welcome-icon">
                    <svg width="48" height="48" viewBox="0 0 24 24" fill="none">
                        <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5" stroke="url(#welcomeGradient)" stroke-width="2" fill="none"/>
                        <defs>
                            <linearGradient id="welcomeGradient" x1="0%" y1="0%" x2="100%" y2="100%">
                                <stop offset="0%" style="stop-color:#667eea"/>
                                <stop offset="100%" style="stop-color:#764ba2"/>
                            </linearGradient>
                        </defs>
                    </svg>
                </div>
                <h2>Bienvenido a Midari AI</h2>
                <p>Tu asistente de IA personal. Conecta tu API key de OpenRouter para empezar a chatear.</p>
            </div>
        `;
        chatMessages.appendChild(welcomeSection);
    }
    
    renderChatList();
}

function switchToChat(chatId) {
    if (isGenerating) return;
    
    const chat = chatHistory.find(c => c.id === chatId);
    if (!chat) return;
    
    currentChatId = chatId;
    conversationHistory = [...chat.messages];
    
    chatMessages.innerHTML = '';
    chat.messages.forEach(msg => {
        addMessage(msg.content, msg.role === 'user' ? 'user' : 'bot');
    });
    
    renderChatList();
}

function deleteChat(chatId) {
    if (isGenerating) return;
    
    chatHistory = chatHistory.filter(c => c.id !== chatId);
    
    if (currentChatId === chatId) {
        if (chatHistory.length > 0) {
            switchToChat(chatHistory[0].id);
        } else {
            createNewChat();
        }
    }
    
    saveChatHistory();
    renderChatList();
}

function renderChatList() {
    chatList.innerHTML = '';
    
    chatHistory.forEach(chat => {
        const chatItem = document.createElement('div');
        chatItem.className = `chat-item ${chat.id === currentChatId ? 'active' : ''}`;
        
        const preview = chat.messages.length > 0 
            ? chat.messages[chat.messages.length - 1].content.slice(0, 50) + '...'
            : 'Chat vacío';
            
        chatItem.innerHTML = `
            <div class="chat-title">${chat.title}</div>
            <div class="chat-preview">${preview}</div>
            <button class="chat-delete" onclick="deleteChat('${chat.id}')">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none">
                    <path d="M18 6L6 18M6 6l12 12" stroke="currentColor" stroke-width="2"/>
                </svg>
            </button>
        `;
        
        chatItem.addEventListener('click', (e) => {
            if (!e.target.closest('.chat-delete')) {
                switchToChat(chat.id);
            }
        });
        
        chatList.appendChild(chatItem);
    });
}
window.deleteChat = deleteChat;
sendButton.addEventListener('click', sendMessage);

messageInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        sendMessage();
    }
});

messageInput.addEventListener('input', adjustTextareaHeight);
document.addEventListener('DOMContentLoaded', initializeApp);