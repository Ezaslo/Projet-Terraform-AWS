let selectedModel = null;
let selectedInstanceType = null;
let isDeploying = false;
let isDestroying = false;
let eventSource = null;

// =======================
// SSE : connexion au flux de logs backend
// =======================
function connectLogStream() {
    if (eventSource) return; // éviter plusieurs connexions

    eventSource = new EventSource('http://localhost:3001/api/stream');

    eventSource.onmessage = (event) => {
        try {
            const log = JSON.parse(event.data);
            handleLog(log);
        } catch (e) {
            console.error('Log SSE invalide', e, event.data);
        }
    };

    eventSource.onerror = (err) => {
        console.error('Erreur SSE', err);
        // EventSource gère la reconnexion automatiquement
    };
}

function handleLog(log) {
    // 1) Affichage dans la console
    const logsDiv = document.getElementById('logs');
    if (logsDiv) {
        const line = document.createElement('div');
        line.className = `log-line log-${log.type}`;
        line.textContent = `[${new Date(log.timestamp).toLocaleTimeString()}] ${log.message}`;
        logsDiv.appendChild(line);
        logsDiv.scrollTop = logsDiv.scrollHeight;
    }

    // Rendre visible la section logs si ce n'est pas déjà fait
    const logsSection = document.getElementById('logsSection');
    if (logsSection && logsSection.style.display === 'none') {
        logsSection.style.display = 'block';
    }

    // 2) Gestion du statut IA
    const iaStatus = document.getElementById('iaStatus');
    if (!iaStatus) return;

    if (log.type === 'info' && log.message.includes('Test de disponibilité IA')) {
        iaStatus.classList.remove('ready');
        iaStatus.classList.add('loading');
        iaStatus.innerHTML = `<span class="spinner"></span> Vérification de l'IA...`;
    }

    if (log.type === 'ia-ready') {
        iaStatus.classList.remove('loading');
        iaStatus.classList.add('ready');

        const match = log.message.match(/http:\/\/[^\s]+/);
        const url = match ? match[0] : null;

        if (url) {
            iaStatus.innerHTML = `🤖 IA prête : <a href="${url}" target="_blank" rel="noopener noreferrer">${url}</a>`;
        } else {
            iaStatus.textContent = '🤖 IA prête';
        }
    }
}

function addLog(message, type = 'info') {
    handleLog({
        message,
        type,
        timestamp: new Date().toISOString()
    });
}

function resetUiForNewOperation(op) {
    const logsDiv = document.getElementById('logs');
    const logsSection = document.getElementById('logsSection');
    const iaStatus = document.getElementById('iaStatus');

    // Nettoyer la console de logs
    if (logsDiv) {
        logsDiv.innerHTML = '';
    }

    // Toujours afficher la section logs quand on démarre une nouvelle op
    if (logsSection) {
        logsSection.style.display = 'block';
    }

    // Reset du statut IA
    if (iaStatus) {
        iaStatus.classList.remove('loading', 'ready');

        if (op === 'deploy') {
            iaStatus.textContent = 'Déploiement en cours...';
        } else if (op === 'destroy') {
            iaStatus.textContent = 'Destruction en cours...';
        } else {
            iaStatus.textContent = 'IA non déployée.';
        }
    }
}

// =======================
// Sélection du modèle IA
// =======================
function setupModelSelection() {
    const cards = document.querySelectorAll('.model-card');
    const selectedModelDiv = document.getElementById('selectedModel');
    const selectedModelNameSpan = document.getElementById('selectedModelName');

    cards.forEach(card => {
        card.addEventListener('click', () => {
            cards.forEach(c => c.classList.remove('selected'));
            card.classList.add('selected');

            selectedModel = card.dataset.model;
            selectedModelDiv.style.display = 'block';
            selectedModelNameSpan.textContent = card.querySelector('h3').textContent;
        });
    });

    // valeur par défaut : premier modèle
    if (cards.length > 0) {
        cards[0].click();
    }
}

// =======================
// Sélection du type d'instance
// =======================
function setupInstanceSelection() {
    const cards = document.querySelectorAll('.instance-card');
    const selectedInstanceDiv = document.getElementById('selectedInstance');
    const selectedInstanceNameSpan = document.getElementById('selectedInstanceName');

    // Valeur par défaut : t3.medium si présent
    const defaultCard = Array.from(cards).find(c => c.dataset.instance === 't3.medium') || cards[0];
    if (defaultCard) {
        defaultCard.classList.add('selected');
        selectedInstanceType = defaultCard.dataset.instance;
        selectedInstanceDiv.style.display = 'block';
        selectedInstanceNameSpan.textContent = selectedInstanceType;
    }

    cards.forEach(card => {
        card.addEventListener('click', () => {
            cards.forEach(c => c.classList.remove('selected'));
            card.classList.add('selected');

            selectedInstanceType = card.dataset.instance;
            selectedInstanceDiv.style.display = 'block';
            selectedInstanceNameSpan.textContent = selectedInstanceType;
        });
    });
}

// =======================
// Bouton Déployer
// =======================
function setupDeployButton() {
    const deployBtn = document.getElementById('deployBtn');
    const logsSection = document.getElementById('logsSection');

    deployBtn.addEventListener('click', async () => {
        if (!selectedModel || !selectedInstanceType || isDeploying) return;
        resetUiForNewOperation('deploy');
        isDeploying = true;
        deployBtn.disabled = true;
        deployBtn.classList.add('running');
        deployBtn.textContent = '🚀 Déploiement en cours...';

        if (logsSection) {
            logsSection.style.display = 'block';
        }

        addLog(`Déploiement demandé (modèle=${selectedModel}, instance=${selectedInstanceType})`, 'info');

        try {
            const res = await fetch('http://localhost:3001/api/deploy', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    aiChoice: selectedModel,
                    instanceType: selectedInstanceType
                })
            });

            if (!res.ok) {
                addLog('❌ Erreur backend deploy', 'error');
                alert('Erreur côté backend (deploy). Regarde les logs.');
            } else {
                addLog('✅ Commande de déploiement envoyée. Suis la progression dans les logs.', 'success');
            }
        } catch (e) {
            addLog(`❌ Erreur de connexion backend : ${e.message}`, 'error');
            alert('Erreur de connexion au backend.');
        } finally {
            isDeploying = false;
            deployBtn.disabled = false;
            deployBtn.classList.remove('running');
            deployBtn.textContent = '🚀 Déployer';
        }
    });
}

// =======================
// Bouton Détruire
// =======================
function setupDestroyButton() {
    const destroyBtn = document.getElementById('destroyBtn');
    const logsSection = document.getElementById('logsSection');

    destroyBtn.addEventListener('click', async () => {
        if (isDestroying) return;

        if (!confirm('Tu es sûr de vouloir détruire l\'infrastructure ?')) {
            return;
        }
        resetUiForNewOperation('deploy');
        isDestroying = true;
        destroyBtn.disabled = true;
        destroyBtn.classList.add('running');
        destroyBtn.textContent = '💣 Destruction en cours...';

        if (logsSection) {
            logsSection.style.display = 'block';
        }

        addLog('Commande de destruction envoyée.', 'info');

        try {
            const res = await fetch('http://localhost:3001/api/destroy', {
                method: 'POST'
            });

            if (!res.ok) {
                addLog('❌ Erreur backend destroy', 'error');
                alert('Erreur côté backend (destroy). Regarde les logs.');
            } else {
                addLog('✅ Destruction demandée. Suis la progression dans les logs.', 'success');
            }
        } catch (e) {
            addLog(`❌ Erreur de connexion backend : ${e.message}`, 'error');
            alert('Erreur de connexion au backend.');
        } finally {
            isDestroying = false;
            destroyBtn.disabled = false;
            destroyBtn.classList.remove('running');
            destroyBtn.textContent = '💣 Détruire';
        }
    });
}

// =======================
// Init
// =======================
document.addEventListener('DOMContentLoaded', () => {
    connectLogStream();
    setupModelSelection();
    setupInstanceSelection();
    setupDeployButton();
    setupDestroyButton();
});
