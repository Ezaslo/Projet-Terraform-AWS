import subprocess
import sys
from pathlib import Path

# Dictionnaire des modèles IA disponibles
catalog = {
    "qwen-mini": "qwen2.5:0.5b (ultra léger, FR ok)",
    "llama3-1b": "llama3.2:1b (polyvalent)",
    "phi3-mini": "phi3:mini (compact)",
    "phi4-mini": "phi4-mini (modèle plus puissant, toujours local)"
}

# Afficher le menu
print("\nChoisis ton IA :\n")
choices = list(catalog.keys())
for i, key in enumerate(choices, start=1):
    print(f"[{i}] {key} -> {catalog[key]}")

# Lire le choix de l'utilisateur
try:
    idx = int(input(f"\nNuméro (1-{len(choices)}) : ").strip())
    if idx < 1 or idx > len(choices):
        raise ValueError
except ValueError:
    print("❌ Choix invalide. Relance le script et choisis un numéro valide.")
    sys.exit(1)

selected = choices[idx - 1]
print(f"\n✅ Tu as choisi : {selected} ({catalog[selected]})")

# Écrire terraform.tfvars
tfvars_content = f'ai_choice = "{selected}"\n'
tfvars_path = Path("terraform.tfvars")
tfvars_path.write_text(tfvars_content, encoding="utf-8")
print(f"📄 Fichier {tfvars_path} mis à jour avec : {tfvars_content.strip()}")

# Lancer terraform init / plan / apply
def run_cmd(cmd):
    print(f"\n🧱 Exécution : {' '.join(cmd)}\n")
    result = subprocess.run(cmd, capture_output=True, text=True)
    print(result.stdout)
    if result.returncode != 0:
        print(result.stderr)
        sys.exit(result.returncode)

run_cmd(["terraform", "init"])
run_cmd(["terraform", "plan", f"-var=ai_choice={selected}"])
run_cmd(["terraform", "apply", "-auto-approve", f"-var=ai_choice={selected}"])

print("\n🚀 Déploiement Terraform terminé avec succès !")
