# --- AMI Amazon Linux 2023 (x86_64) ---
data "aws_ami" "al2023" {
  owners      = ["amazon"]
  most_recent = true
  filter {
    name   = "name"
    values = ["al2023-ami-*-kernel-6.1-x86_64"]
  }
}

# --- Security Group minimal (aucune entrée) ---
resource "aws_security_group" "ec2_min" {
  name        = "${var.project}-sg-ec2"
  description = "SG minimal pour EC2 "
  vpc_id      = aws_vpc.main.id

   ingress {
    from_port   = 11434
    to_port     = 11434
    protocol    = "tcp"
    cidr_blocks = [var.allowed_cidr] # pour l'instant 0.0.0.0/0
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

# --- User data: installe Docker et démarre ---

locals {
  ai_catalog = {
    qwen-mini = { pull = "qwen2.5:0.5b" }
    llama3-1b = { pull = "llama3.2:1b" }
    phi3-mini = { pull = "phi3:mini" }
    phi4-mini   = { pull = "phi4-mini" }
  }
  selected_ai = local.ai_catalog[var.ai_choice]

  user_data = <<-EOT
    #!/bin/bash
    set -euxo pipefail
    dnf update -y
    dnf install -y docker jq awscli || true
    command -v curl >/dev/null 2>&1 || dnf install -y curl-minimal --allowerasing

    systemctl enable --now docker

    docker run -d --name ollama \
      -p 0.0.0.0:11434:11434 \
      --restart unless-stopped \
      ollama/ollama:latest

    # wait API
    for i in {1..60}; do
      curl -fsS http://127.0.0.1:11434/api/version && break
      sleep 2
    done

    # pull modèle choisi
    curl -fsS -X POST http://127.0.0.1:11434/api/pull -d '{"name":"${local.selected_ai.pull}"}'

    # tag EC2
    IID=$(curl -s http://169.254.169.254/latest/meta-data/instance-id)
    REGION=$(curl -s http://169.254.169.254/latest/dynamic/instance-identity/document | jq -r .region)
    aws ec2 create-tags --region "$REGION" --resources "$IID" \
      --tags Key=AI,Value=ready Key=OllamaModel,Value=${local.selected_ai.pull} || true
  EOT
}


# --- Instance EC2 ---
resource "aws_instance" "ai_host" {
  ami                    = data.aws_ami.al2023.id
  instance_type          = var.instance_type
  subnet_id              = aws_subnet.public_a.id
  vpc_security_group_ids = [aws_security_group.ec2_min.id]
  iam_instance_profile   = aws_iam_instance_profile.ssm_profile.name
  associate_public_ip_address = true

  user_data = local.user_data
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