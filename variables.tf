variable "project" {
  description = "Nom du projet (taggage des ressources)"
  type        = string
  default     = "ai-demo"
}

variable "aws_region" {
  description = "Région AWS"
  type        = string
  default     = "eu-west-3" # Paris
}

variable "aws_profile" {
  description = "Profil AWS CLI à utiliser"
  type        = string
  default     = "default"
}

variable "vpc_cidr" {
  description = "CIDR du VPC"
  type        = string
  default     = "10.0.0.0/16"
}

variable "public_subnet_cidr" {
  description = "CIDR du subnet public"
  type        = string
  default     = "10.0.1.0/24"
}

variable "az" {
  description = "Zone de dispo pour le subnet"
  type        = string
  default     = "eu-west-3a"
}

variable "tags" {
  description = "Tags communs"
  type        = map(string)
  default = {
    "Environment" = "dev"
    "ManagedBy"   = "terraform"
  }
}

variable "instance_type" {
  description = "Type d'instance pour l'hôte IA (CPU pour commencer)"
  type        = string
  default     = "t3.medium" # simple et économique; on passera à GPU plus tard
}

variable "ollama_model" {
  description = "Nom du modèle Ollama à pré-télécharger"
  type        = string
  default     = "qwen2.5:0.5b" # léger et rapide CPU (alternatives: llama3.2:1b, phi3:mini)
}

variable "ai_choice" {
  description = "Choix du modèle IA (catalogue ci-dessous)"
  type        = string
  default     = "qwen-mini"
  validation {
    condition     = contains(["qwen-mini", "llama3-1b", "phi3-mini"], var.ai_choice)
    error_message = "ai_choice doit être l'un de: qwen-mini, llama3-1b, phi3-mini."
  }
}