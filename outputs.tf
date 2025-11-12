output "vpc_id" {
  value       = aws_vpc.main.id
  description = "ID du VPC"
}

output "public_subnet_id" {
  value       = aws_subnet.public_a.id
  description = "ID du subnet public"
}

output "ec2_instance_id" {
  value       = aws_instance.ai_host.id
  description = "ID de l'instance EC2 IA"
}

output "ec2_public_ip" {
  value       = aws_instance.ai_host.public_ip
  description = "IP publique de l'instance (non utilisable sans règles ingress)"
}

output "ai_ready_hint" {
  description = "Quand AI=ready apparaît dans les tags EC2, l'API Ollama écoute sur 127.0.0.1:11434"
  value       = "Tag AI=ready sur l’instance => Ollama OK (modèle préchargé: ${var.ollama_model})"
}