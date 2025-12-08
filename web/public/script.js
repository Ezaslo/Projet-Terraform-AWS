const catalog = {
    "qwen-mini": "qwen2.5:0.5b (ultra léger, FR ok)",
    "llama3-1b": "llama3.2:1b (polyvalent)",
    "phi3-mini": "phi3:mini (compact)",
    "phi4-mini": "phi4-mini (modèle plus puissant, toujours local)"
};

let selectedModel = null;
let isDeploying = false;

// Initialiser l'interface
document.addEventListener('DOMContentLoaded', () => {
    setupModelSelection(); // ← Nouvelle fonction
    setupDeployButton();
    setupDestroyButton(); // ← Ajouter destroy
});

// Nouvelle fonction pour gérer la sélection des cartes existantes
function setupModelSelection() {
    const modelCards = document.querySelectorAll('.model-card');
    
    modelCards.forEach(card => {
        card.addEventListener('click', () => {
            if (isDeploying) return;

            // Retirer la sélection de toutes les cartes
            modelCards.forEach(c => c.classList.remove('selected'));
            
            // Ajouter la sélection à la carte cliquée
            card.classList.add('selected');
            
            // Récupérer le modèle depuis data-model
            selectedModel = card.dataset.model;
            
            console.log('Modèle sélectionné:', selectedModel);
            
            // Activer le bouton de déploiement
            document.getElementById('deployBtn').disabled = false;
        });
    });
}

function setupDeployButton() {
    const deployBtn = document.getElementById('deployBtn');

    deployBtn.addEventListener('click', async () => {
        if (!selectedModel || isDeploying) return;

        isDeploying = true;
        deployBtn.disabled = true;
        deployBtn.classList.add('running');
        deployBtn.innerHTML = '<span class="spinning">⟳</span> Déploiement en cours...';

        // Afficher la console
        const logsSection = document.getElementById('logsSection');
        logsSection.style.display = 'block';

        const logsDiv = document.getElementById('logs');
        logsDiv.innerHTML = '';

        const statusMessage = document.getElementById('statusMessage');
        statusMessage.style.display = 'none';
        statusMessage.className = 'status-message';

        try {
            const response = await fetch('http://localhost:3001/api/deploy', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ aiChoice: selectedModel })
            });

            const reader = response.body.getReader();
            const decoder = new TextDecoder();

            while (true) {
                const { done, value } = await reader.read();
                if (done) break;

                const chunk = decoder.decode(value);
                const lines = chunk.split('\n\n');

                lines.forEach(line => {
                    if (line.startsWith('data: ')) {
                        const data = line.substring(6);

                        if (data === '[DONE]') {
                            showSuccess();
                            return;
                        }

                        if (data === '[ERROR]') {
                            showError();
                            return;
                        }

                        try {
                            const log = JSON.parse(data);
                            addLog(log.message, log.type, log.timestamp);
                        } catch (e) {
                            // Ignorer les erreurs de parsing
                        }
                    }
                });
            }

        } catch (error) {
            addLog(`❌ Erreur de connexion : ${error.message}`, 'error', new Date().toLocaleTimeString());
            showError();
        }
    });
}

// Nouvelle fonction pour le bouton destroy
function setupDestroyButton() {
    const destroyBtn = document.getElementById('destroyBtn');

    destroyBtn.addEventListener('click', async () => {
        if (isDeploying) {
            alert('Un déploiement est en cours, veuillez attendre...');
            return;
        }

        const confirmed = confirm('⚠️ ATTENTION !\n\nÊtes-vous sûr de vouloir détruire TOUTES les ressources AWS ?\n\nCette action est IRRÉVERSIBLE !');
        
        if (!confirmed) return;

        const logsSection = document.getElementById('logsSection');
        const logsDiv = document.getElementById('logs');
        const statusMessage = document.getElementById('statusMessage');

        // Désactiver les boutons
        isDeploying = true;
        destroyBtn.disabled = true;
        destroyBtn.classList.add('running');
        destroyBtn.innerHTML = '<span class="spinning">⟳</span> Destruction en cours...';
        document.getElementById('deployBtn').disabled = true;

        // Afficher la console
        logsSection.style.display = 'block';
        logsDiv.innerHTML = '';
        statusMessage.style.display = 'none';
        statusMessage.className = 'status-message';

        try {
            const response = await fetch('http://localhost:3001/api/destroy', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' }
            });

            const reader = response.body.getReader();
            const decoder = new TextDecoder();

            while (true) {
                const { done, value } = await reader.read();
                if (done) break;

                const chunk = decoder.decode(value);
                const lines = chunk.split('\n\n');

                lines.forEach(line => {
                    if (line.startsWith('data: ')) {
                        const data = line.substring(6);

                        if (data === '[DONE]') {
                            showDestroySuccess();
                            return;
                        }

                        if (data === '[ERROR]') {
                            showDestroyError();
                            return;
                        }

                        try {
                            const log = JSON.parse(data);
                            addLog(log.message, log.type, log.timestamp);
                        } catch (e) {
                            // Ignorer
                        }
                    }
                });
            }

        } catch (error) {
            addLog(`❌ Erreur de connexion : ${error.message}`, 'error', new Date().toLocaleTimeString());
            showDestroyError();
        }
    });
}

function addLog(message, type, timestamp) {
    const logsDiv = document.getElementById('logs');
    const logEntry = document.createElement('div');
    logEntry.className = `log-entry ${type}`;
    logEntry.innerHTML = `<span class="log-timestamp">[${timestamp}]</span> ${message}`;
    logsDiv.appendChild(logEntry);
    logsDiv.scrollTop = logsDiv.scrollHeight;
}

function showSuccess() {
    const deployBtn = document.getElementById('deployBtn');
    deployBtn.classList.remove('running');
    deployBtn.innerHTML = '<span>✓</span> Nouveau déploiement';
    deployBtn.disabled = false;

    const statusMessage = document.getElementById('statusMessage');
    statusMessage.style.display = 'block';
    statusMessage.className = 'status-message success';
    statusMessage.innerHTML = `
        <strong>✓ Déploiement réussi !</strong><br>
        Le modèle ${catalog[selectedModel]} est maintenant déployé.
    `;

    isDeploying = false;
    selectedModel = null;
    document.querySelectorAll('.model-card').forEach(c => c.classList.remove('selected'));
}

function showError() {
    const deployBtn = document.getElementById('deployBtn');
    deployBtn.classList.remove('running');
    deployBtn.innerHTML = '<span>▶</span> Réessayer';
    deployBtn.disabled = false;

    const statusMessage = document.getElementById('statusMessage');
    statusMessage.style.display = 'block';
    statusMessage.className = 'status-message error';
    statusMessage.innerHTML = `
        <strong>✗ Échec du déploiement</strong><br>
        Une erreur s'est produite. Vérifiez les logs ci-dessus.
    `;

    isDeploying = false;
}

function showDestroySuccess() {
    const destroyBtn = document.getElementById('destroyBtn');
    destroyBtn.disabled = false;
    destroyBtn.classList.remove('running');
    destroyBtn.innerHTML = '<span>🔥</span> Détruire toutes les ressources';

    document.getElementById('deployBtn').disabled = false;

    const statusMessage = document.getElementById('statusMessage');
    statusMessage.style.display = 'block';
    statusMessage.className = 'status-message success';
    statusMessage.innerHTML = `
        <strong>✓ Destruction réussie !</strong><br>
        Toutes les ressources AWS ont été supprimées.
    `;

    isDeploying = false;
}

function showDestroyError() {
    const destroyBtn = document.getElementById('destroyBtn');
    destroyBtn.disabled = false;
    destroyBtn.classList.remove('running');
    destroyBtn.innerHTML = '<span>🔥</span> Détruire toutes les ressources';

    document.getElementById('deployBtn').disabled = false;

    const statusMessage = document.getElementById('statusMessage');
    statusMessage.style.display = 'block';
    statusMessage.className = 'status-message error';
    statusMessage.innerHTML = `
        <strong>✗ Échec de la destruction</strong><br>
        Une erreur s'est produite. Vérifiez les logs ci-dessus.
    `;

    isDeploying = false;
}
