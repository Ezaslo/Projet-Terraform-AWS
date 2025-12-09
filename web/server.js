const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const fs = require('fs');
const path = require('path');
const http = require('http');
const { spawn, spawnSync } = require('child_process');

const app = express();
const PORT = 3001;

// Dossier où se trouvent tes fichiers Terraform (main.tf, ec2.tf, etc.)
const TERRAFORM_DIR = path.join(__dirname, '..'); // adapte si tu déplaces les .tf

// Middleware
app.use(cors());
app.use(bodyParser.json());
app.use(express.static('public'));

// =======================
// État global pour les logs + SSE
// =======================
const clients = []; // connexions SSE actives

const currentOperation = {
  type: 'idle',        // 'idle' | 'deploy' | 'destroy'
  status: 'idle',      // 'idle' | 'running' | 'success' | 'error'
  logs: []             // { message, type, timestamp }[]
};

function pushLog(message, type = 'info') {
  const log = {
    message,
    type,
    timestamp: new Date().toISOString()
  };
  currentOperation.logs.push(log);

  const data = `data: ${JSON.stringify(log)}\n\n`;
  clients.forEach(res => res.write(data));
}

// =======================
// SSE : flux de logs persistant
// =======================
app.get('/api/stream', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  // Envoyer tout l'historique au nouveau client
  currentOperation.logs.forEach(log => {
    res.write(`data: ${JSON.stringify(log)}\n\n`);
  });

  clients.push(res);

  req.on('close', () => {
    const idx = clients.indexOf(res);
    if (idx !== -1) clients.splice(idx, 1);
  });
});

// =======================
// Helper : exécuter Terraform
// =======================
function runTerraform(args) {
  return new Promise((resolve, reject) => {
    pushLog(`🚀 terraform ${args.join(' ')}`, 'info');

    const proc = spawn('terraform', args, { cwd: TERRAFORM_DIR, shell: true });

    proc.stdout.on('data', (data) => {
      data.toString().split('\n').forEach(line => {
        if (line.trim() !== '') pushLog(line, 'terraform');
      });
    });

    proc.stderr.on('data', (data) => {
      data.toString().split('\n').forEach(line => {
        if (line.trim() !== '') pushLog(line, 'error');
      });
    });

    proc.on('close', (code) => {
      if (code === 0) {
        pushLog(`✅ terraform ${args[0]} terminé (code 0)`, 'success');
        resolve();
      } else {
        pushLog(`❌ terraform ${args[0]} sorti avec le code ${code}`, 'error');
        reject(new Error(`Terraform exited with code ${code}`));
      }
    });
  });
}

// =======================
// Helper : attendre que l'IA réponde sur /api/tags
// =======================
async function waitForIaReady(ip) {
  const url = `http://${ip}/api/tags`;
  pushLog(`🔍 Test de disponibilité IA sur ${url}`, 'info');

  const maxAttempts = 30;
  const delayMs = 5000;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      await new Promise((resolve, reject) => {
        const req = http.get(url, (res) => {
          if (res.statusCode === 200) resolve();
          else reject(new Error('Status ' + res.statusCode));
        });
        req.on('error', reject);
        req.setTimeout(3000, () => {
          req.destroy(new Error('timeout'));
        });
      });

      // IA OK
      const appUrl = `http://${ip}/`;
      pushLog(`🤖 IA prête sur ${appUrl}`, 'ia-ready');
      return { ready: true, url: appUrl };
    } catch (e) {
      pushLog(`⏳ IA pas encore prête (tentative ${attempt})`, 'info');
      await new Promise(r => setTimeout(r, delayMs));
    }
  }

  pushLog(`⚠️ IA toujours pas prête après ${maxAttempts} tentatives`, 'error');
  return { ready: false };
}

// =======================
// Endpoint : déploiement
// =======================
app.post('/api/deploy', async (req, res) => {
  const { aiChoice, instanceType } = req.body;

  if (!aiChoice) {
    return res.status(400).json({ ok: false, error: 'aiChoice manquant' });
  }

  const finalInstanceType =
    typeof instanceType === 'string' && instanceType.trim() !== ''
      ? instanceType.trim()
      : 't3.medium';

  try {
    // Reset de l'opération pour CE déploiement
    currentOperation.type = 'deploy';
    currentOperation.status = 'running';
    currentOperation.logs = [];
    pushLog(
      `🚀 Nouveau déploiement (ai_choice=${aiChoice}, instance_type=${finalInstanceType})`,
      'info'
    );

    // 1) Écrire terraform.tfvars
    const tfvarsPath = path.join(TERRAFORM_DIR, 'terraform.tfvars');
    const tfvarsContent =
      `ai_choice    = "${aiChoice}"\n` +
      `instance_type = "${finalInstanceType}"\n`;
    fs.writeFileSync(tfvarsPath, tfvarsContent);

    pushLog(
      `📄 terraform.tfvars mis à jour (ai_choice=${aiChoice}, instance_type=${finalInstanceType})`,
      'info'
    );

    // 2) terraform init
    await runTerraform(['init', '-input=false']);

    // 3) terraform apply
    await runTerraform(
      [
        'apply',
        '-auto-approve',
        `-var=ai_choice=${aiChoice}`,
        `-var=instance_type=${finalInstanceType}`
      ]
    );

    // 4) Récupérer l'IP publique (on utilise l'output ec2_public_ip)
    const ipOutput = spawnSync('terraform', ['output', '-raw', 'ec2_public_ip'], {
      cwd: TERRAFORM_DIR,
      encoding: 'utf8',
      shell: true
    });

    if (ipOutput.status === 0) {
      const ip = ipOutput.stdout.trim();
      pushLog(`🌐 IP publique de l'IA : ${ip}`, 'info');

      // 5) Attendre que l'IA réponde sur /api/tags
      await waitForIaReady(ip);
    } else {
      pushLog('⚠️ Impossible de récupérer ec2_public_ip', 'error');
    }

    currentOperation.status = 'success';
    res.json({ ok: true });
  } catch (e) {
    currentOperation.status = 'error';
    pushLog(`❌ Erreur deploy: ${e.message}`, 'error');
    res.status(500).json({ ok: false, error: e.message });
  }
});

// =======================
// Endpoint : destruction
// =======================
app.post('/api/destroy', async (req, res) => {
  try {
    // Reset de l'opération pour CE destroy
    currentOperation.type = 'destroy';
    currentOperation.status = 'running';
    currentOperation.logs = [];
    pushLog('💣 Destruction demandée', 'info');

    await runTerraform(['destroy', '-auto-approve']);

    currentOperation.status = 'success';
    res.json({ ok: true });
  } catch (e) {
    currentOperation.status = 'error';
    pushLog(`❌ Erreur destroy: ${e.message}`, 'error');
    res.status(500).json({ ok: false, error: e.message });
  }
});

// =======================
// Démarrage du serveur
// =======================
app.listen(PORT, () => {
  console.log(`🚀 Serveur backend démarré sur http://localhost:${PORT}`);
  console.log(`📂 Dossier Terraform : ${TERRAFORM_DIR}`);
});
