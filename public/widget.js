(function () {
  const root = document.getElementById("plataform-bot-root");
  if (!root) return;

  root.innerHTML = `
    <div class="pb-panel" id="pb-panel">
      <div class="pb-header">Asistente Plataform</div>
      <div class="pb-messages" id="pb-messages"></div>
      <div class="pb-input-row">
        <input id="pb-input" type="text" placeholder="Escribe tu pregunta..." />
        <button id="pb-send">Enviar</button>
      </div>
    </div>
    <button class="pb-bubble" id="pb-bubble">💬</button>
  `;

  const panel = document.getElementById("pb-panel");
  const bubble = document.getElementById("pb-bubble");
  const messages = document.getElementById("pb-messages");
  const input = document.getElementById("pb-input");
  const sendBtn = document.getElementById("pb-send");

  bubble.addEventListener("click", () => {
    panel.classList.toggle("pb-open");
  });

  function addMessage(text, sender) {
    const el = document.createElement("div");
    el.className = `pb-msg pb-${sender}`;
    el.textContent = text;
    messages.appendChild(el);
    messages.scrollTop = messages.scrollHeight;
  }

  async function sendQuestion() {
    const question = input.value.trim();
    if (!question) return;

    addMessage(question, "user");
    input.value = "";
    addMessage("Pensando...", "bot");
    const thinkingEl = messages.lastElementChild;

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question }),
      });
      const data = await res.json();
      thinkingEl.textContent = res.ok ? data.answer : data.error || "Error desconocido.";
    } catch (err) {
      thinkingEl.textContent = "No se pudo conectar con el servidor.";
    }
  }

  sendBtn.addEventListener("click", sendQuestion);
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") sendQuestion();
  });
})();
