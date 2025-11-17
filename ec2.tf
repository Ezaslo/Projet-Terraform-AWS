# --- AMI Amazon Linux 2023 (x86_64) ---
data "aws_ami" "al2023" {
  owners      = ["amazon"]
  most_recent = true

  filter {
    name   = "name"
    values = ["al2023-ami-*-kernel-6.1-x86_64"]
  }
}

# --- Security Group minimal (entrée sur 11434) ---
resource "aws_security_group" "ec2_min" {
  name        = "${var.project}-sg-ec2"
  description = "SG minimal pour EC2"
  vpc_id      = aws_vpc.main.id

  ingress {
    from_port   = 11434
    to_port     = 11434
    protocol    = "tcp"
    cidr_blocks = [var.allowed_cidr] # pour l'instant 0.0.0.0/0
  }

  ingress {
    from_port   = 80
    to_port     = 80
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"] # pour tester ; on restreindra plus tard
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = merge(var.tags, { Name = "${var.project}-sg-ec2" })
}

# --- IAM: rôle pour SSM (connexion sans SSH) ---
data "aws_iam_policy_document" "ssm_assume_role" {
  statement {
    actions = ["sts:AssumeRole"]

    principals {
      type        = "Service"
      identifiers = ["ec2.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "ssm_role" {
  name               = "${var.project}-ec2-ssm-role"
  assume_role_policy = data.aws_iam_policy_document.ssm_assume_role.json
  tags               = var.tags
}

# Politique gérée par AWS pour SSM
resource "aws_iam_role_policy_attachment" "ssm_core" {
  role       = aws_iam_role.ssm_role.name
  policy_arn = "arn:aws:iam::aws:policy/AmazonSSMManagedInstanceCore"
}

# (Optionnel) CloudWatch Logs pour agent SSM
resource "aws_iam_role_policy_attachment" "cw_agent" {
  role       = aws_iam_role.ssm_role.name
  policy_arn = "arn:aws:iam::aws:policy/CloudWatchAgentServerPolicy"
}

resource "aws_iam_instance_profile" "ssm_profile" {
  name = "${var.project}-ec2-ssm-profile"
  role = aws_iam_role.ssm_role.name
  tags = var.tags
}

# --- Locals: catalogue de modèles & user_data ---
locals {
  ai_catalog = {
    qwen-mini  = { pull = "qwen2.5:0.5b" }
    llama3-1b  = { pull = "llama3.2:1b" }
    phi3-mini  = { pull = "phi3:mini" }
    phi4-mini  = { pull = "phi4-mini" }
  }

  selected_ai = local.ai_catalog[var.ai_choice]

  user_data = <<-EOT
    #!/bin/bash
    set -euxo pipefail

    # -------------------------
    # 1. Base existante (Ollama)
    # -------------------------

    dnf update -y
    dnf install -y docker jq awscli || true
    command -v curl >/dev/null 2>&1 || dnf install -y curl-minimal --allowerasing

    systemctl enable --now docker

    docker run -d --name ollama \
      -p 0.0.0.0:11434:11434 \
      --restart unless-stopped \
      ollama/ollama:latest

    # Attendre que l'API Ollama soit up
    for i in {1..60}; do
      curl -fsS http://127.0.0.1:11434/api/version && break
      sleep 2
    done

    # Pull du modèle choisi
    curl -fsS -X POST http://127.0.0.1:11434/api/pull -d '{"name":"${local.selected_ai.pull}"}'

    # Tag EC2
    IID=$(curl -s http://169.254.169.254/latest/meta-data/instance-id)
    REGION=$(curl -s http://169.254.169.254/latest/dynamic/instance-identity/document | jq -r .region)

    aws ec2 create-tags --region "$REGION" --resources "$IID" \
      --tags Key=AI,Value=ready Key=OllamaModel,Value=${local.selected_ai.pull} || true

    # -------------------------
    # 2. NGINX + UI WEB
    # -------------------------

    dnf install -y nginx
    systemctl enable --now nginx

    mkdir -p /usr/share/nginx/html

    # index.html depuis web/index.html
    cat > /usr/share/nginx/html/index.html << 'EOF_INDEX'
    ${file("${path.module}/web/index.html")}
    EOF_INDEX

    # style.css depuis web/style.css
    cat > /usr/share/nginx/html/style.css << 'EOF_CSS'
    ${file("${path.module}/web/style.css")}
    EOF_CSS

    # chat.js depuis web/chat.js
    cat > /usr/share/nginx/html/chat.js << 'EOF_JS'
    ${file("${path.module}/web/chat.js")}
    EOF_JS

    # Configuration nginx avec reverse proxy vers Ollama
    cat > /etc/nginx/nginx.conf << 'EOF_NGINX'
    user nginx;
    worker_processes auto;

    error_log /var/log/nginx/error.log;
    pid /run/nginx.pid;

    events {
      worker_connections 1024;
    }

    http {
      include /etc/nginx/mime.types;
      default_type application/octet-stream;

      server {
        listen 80;
        server_name _;

        root /usr/share/nginx/html;
        index index.html;

        location / {
          try_files $uri $uri/ /index.html;
        }

        # Proxy /api/... -> Ollama local
        location /api/ {
          proxy_pass http://127.0.0.1:11434$request_uri;
          proxy_set_header Host $host;
          proxy_set_header X-Real-IP $remote_addr;
        }
      }
    }
    EOF_NGINX

    nginx -t
    systemctl restart nginx

  EOT
}

# --- Instance EC2 ---
resource "aws_instance" "ai_host" {
  ami                         = data.aws_ami.al2023.id
  instance_type               = var.instance_type
  subnet_id                   = aws_subnet.public_a.id
  vpc_security_group_ids      = [aws_security_group.ec2_min.id]
  iam_instance_profile        = aws_iam_instance_profile.ssm_profile.name
  associate_public_ip_address = true

  user_data                   = local.user_data
  user_data_replace_on_change = true

  tags = merge(var.tags, {
    Name    = "${var.project}-ai-host"
    Role    = "ai"
    Purpose = "lab"
  })
}

resource "aws_iam_role_policy" "tag_self" {
  name = "${var.project}-ec2-tag-self"
  role = aws_iam_role.ssm_role.id

  policy = jsonencode({
    Version = "2012-10-17",
    Statement = [
      {
        Sid      = "TagSelf",
        Effect   = "Allow",
        Action   = ["ec2:CreateTags", "ec2:DescribeInstances"],
        Resource = "*"
      }
    ]
  })
}
