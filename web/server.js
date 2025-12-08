const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const { exec } = require('child_process');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = 3001;

// Middleware
app.use(cors());
app.use(bodyParser.json());
app.use(express.static('public'));

// Chemin vers le dossier Terraform (dossier parent)
const TERRAFORM_DIR = path.join(__dirname, '..');

// Endpoint de déploiement
app.post('/api/deploy', async (req, res) => {
  const { aiChoice } = req.body;

  if (!aiChoice) {
    return res.status(400).json({ error: 'Aucun modèle sélectionné' });
  }

  // SSE pour envoyer les logs en temps réel
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  const sendLog = (message, type = 'info') => {
    res.write(`data: ${JSON.stringify({ message, type, timestamp: new Date().toLocaleTimeString() })}\n\n`);
  };

  try {
    // 1. Écrire terraform.tfvars
    const tfvarsPath = path.join(TERRAFORM_DIR, 'terraform.tfvars');
    const tfvarsContent = `ai_choice = "${aiChoice}"\n`;
    fs.writeFileSync(tfvarsPath, tfvarsContent);
    sendLog(`📄 Fichier terraform.tfvars mis à jour avec : ai_choice = "${aiChoice}"`, 'success');

    // 2. Terraform init
    await runCommand('terraform init', TERRAFORM_DIR, sendLog);

    // 3. Terraform plan
    await runCommand(`terraform plan -var=ai_choice=${aiChoice}`, TERRAFORM_DIR, sendLog);

    // 4. Terraform apply
    await runCommand(`terraform apply -auto-approve -var=ai_choice=${aiChoice}`, TERRAFORM_DIR, sendLog);

    sendLog('🎉 Déploiement Terraform terminé avec succès !', 'success');
    res.write('data: [DONE]\n\n');
    res.end();

  } catch (error) {
    sendLog(`❌ Erreur : ${error.message}`, 'error');
    res.write('data: [ERROR]\n\n');
    res.end();
  }
});

// Endpoint de destruction
app.post('/api/destroy', async (req, res) => {
  // SSE pour envoyer les logs en temps réel
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  const sendLog = (message, type = 'info') => {
    res.write(`data: ${JSON.stringify({ message, type, timestamp: new Date().toLocaleTimeString() })}\n\n`);
  };

  try {
    sendLog('🔥 Début de la destruction des ressources Terraform...', 'info');

    // Terraform destroy
    await runCommand('terraform destroy -auto-approve', TERRAFORM_DIR, sendLog);

    sendLog('✅ Toutes les ressources ont été détruites avec succès !', 'success');
    res.write('data: [DONE]\n\n');
    res.end();

  } catch (error) {
    sendLog(`❌ Erreur lors de la destruction : ${error.message}`, 'error');
    res.write('data: [ERROR]\n\n');
    res.end();
  }
});

// Fonction helper pour exécuter les commandes
function runCommand(command, cwd, sendLog) {
  return new Promise((resolve, reject) => {
    sendLog(`🔧 Exécution de : ${command}`, 'info');
    
    const childProcess = exec(command, { cwd }, (error, stdout, stderr) => {
      if (error) {
        sendLog(stderr || error.message, 'error');
        reject(error);
        return;
      }
      resolve(stdout);
    });

    // Capturer la sortie en temps réel
    childProcess.stdout.on('data', (data) => {
      const output = data.toString().trim();
      if (output) {
        sendLog(output, 'info');
      }
    });

    childProcess.stderr.on('data', (data) => {
      const output = data.toString().trim();
      if (output && !output.includes('Refreshing state')) {
        sendLog(output, 'error');
      }
    });
  });
}

app.listen(PORT, () => {
  console.log(`🚀 Serveur backend démarré sur http://localhost:${PORT}`);
  console.log(`📂 Dossier Terraform : ${TERRAFORM_DIR}`);
});