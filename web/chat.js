
async function sendMessage() {
  const input = document.getElementById("prompt");
  const chat = document.getElementById("chat");
  const text = input.value.trim();
  if (!text) return;

  const userDiv = document.createElement("div");
  userDiv.className = "msg user";
  userDiv.textContent = text;
  chat.appendChild(userDiv);

  const aiDiv = document.createElement("div");
  aiDiv.className = "msg ai";
  aiDiv.textContent = "Réflexion en cours...";
  chat.appendChild(aiDiv);

  chat.scrollTop = chat.scrollHeight;
  input.value = "";

  try {
    const body = {
      model: "phi4-mini",
      prompt: text,
      stream: false
    };

    const res = await fetch("/api/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    });

    const data = await res.json();
    aiDiv.textContent = data.response || "(pas de réponse)";
  } catch (e) {
    aiDiv.textContent = "Erreur : " + e.message;
  }

  chat.scrollTop = chat.scrollHeight;
}

document.addEventListener("DOMContentLoaded", () => {
  document.getElementById("send-btn").addEventListener("click", sendMessage);
  document.getElementById("prompt").addEventListener("keydown", (e) => {
    if (e.key === "Enter") sendMessage();
  });
});

