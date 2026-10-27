(() => {
  const messagesEl = document.querySelector('#messages');
  const toolCallsEl = document.querySelector('#tool-calls');
  const form = document.querySelector('#chat-form');
  const input = document.querySelector('#message-input');
  const sendButton = document.querySelector('#send-button');
  const healthEl = document.querySelector('#health');
  const confirmationBanner = document.querySelector('#confirmation-banner');
  const sessionLabel = document.querySelector('#session-label');
  let sessionId = makeSessionId();
  let needsConfirmation = false;

  function makeSessionId() {
    return `web-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;
  }
  function element(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }
  function addMessage(role, text) {
    const article = element('article', `message ${role === 'user' ? 'user-message' : 'assistant-message'}`);
    const avatar = element('div', 'message-avatar', role === 'user' ? 'TÚ' : 'IA');
    const content = element('div', 'message-content');
    for (const paragraph of String(text).split('\n\n')) {
      const p = element('p');
      p.textContent = paragraph;
      content.appendChild(p);
    }
    article.append(avatar, content);
    messagesEl.appendChild(article);
    messagesEl.scrollTop = messagesEl.scrollHeight;
  }
  function showTools(calls) {
    toolCallsEl.replaceChildren();
    if (!calls || calls.length === 0) {
      toolCallsEl.appendChild(element('p', 'empty-state', 'No se ejecutaron herramientas en este turno.'));
      return;
    }
    for (const call of calls) {
      const card = element('article', 'tool-card');
      const head = element('div', 'tool-card-head');
      const status = element('span', 'tool-status', call.ok ? '●' : '●');
      status.style.color = call.ok ? '#16815e' : '#bd4d40';
      const name = element('strong', '', call.name);
      head.append(status, name);
      card.appendChild(head);
      card.appendChild(element('p', '', call.resultSummary || 'Sin resumen disponible.'));
      if (call.arguments && typeof call.arguments === 'object') {
        const details = document.createElement('details');
        const summary = element('summary', '', 'Argumentos enviados');
        const pre = element('pre', '', JSON.stringify(call.arguments, null, 2));
        details.append(summary, pre);
        card.appendChild(details);
      }
      toolCallsEl.appendChild(card);
    }
  }
  async function checkHealth() {
    try {
      const response = await fetch('/api/health');
      const data = await response.json();
      healthEl.classList.toggle('online', Boolean(data.ok));
      healthEl.classList.toggle('offline', !data.ok);
      healthEl.lastElementChild.textContent = data.provider === 'not-configured' ? 'Servidor activo · IA sin configurar' : `Servidor activo · ${data.provider}/${data.model}`;
    } catch {
      healthEl.classList.add('offline');
      healthEl.lastElementChild.textContent = 'Servidor no disponible';
    }
  }
  async function sendMessage(text) {
    addMessage('user', text);
    input.value = '';
    sendButton.disabled = true;
    sendButton.querySelector('span').textContent = 'Procesando…';
    try {
      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId, message: text })
      });
      const data = await response.json();
      addMessage('assistant', data.reply || data.error || 'No se recibió una respuesta.');
      showTools(data.toolCalls || []);
      needsConfirmation = Boolean(data.needsConfirmation);
      confirmationBanner.classList.toggle('hidden', !needsConfirmation);
    } catch {
      addMessage('assistant', 'No fue posible conectar con el backend. Comprueba que el servidor esté activo e inténtalo de nuevo.');
    } finally {
      sendButton.disabled = false;
      sendButton.querySelector('span').textContent = 'Enviar';
      input.focus();
    }
  }
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    const text = input.value.trim();
    if (text) sendMessage(text);
  });
  document.querySelectorAll('[data-case]').forEach((button) => {
    button.addEventListener('click', () => {
      const caso = button.getAttribute('data-case');
      input.value = `Procesa el caso "${caso}". Dime qué campos quedaron llenos, cuáles faltan, si el paquete está listo para firma y qué soportes debo actualizar. No envíes nada todavía.`;
      input.focus();
    });
  });
  document.querySelector('#confirm-send').addEventListener('click', () => {
    if (!needsConfirmation) return;
    confirmationBanner.classList.add('hidden');
    needsConfirmation = false;
    sendMessage('Confirmo la simulación de envío.');
  });
  document.querySelector('#cancel-send').addEventListener('click', () => {
    confirmationBanner.classList.add('hidden');
    if (needsConfirmation) sendMessage('No confirmo el envío. No ejecutes ninguna acción externa.');
    needsConfirmation = false;
  });
  document.querySelector('#new-session').addEventListener('click', () => {
    sessionId = makeSessionId();
    needsConfirmation = false;
    sessionLabel.textContent = `Sesión: ${sessionId}`;
    messagesEl.replaceChildren();
    toolCallsEl.replaceChildren(element('p', 'empty-state', 'Todavía no se han ejecutado herramientas.'));
    confirmationBanner.classList.add('hidden');
    addMessage('assistant', 'Nueva sesión iniciada. Puedes pedir que procese cualquiera de los cuatro casos.');
  });
  sessionLabel.textContent = `Sesión: ${sessionId}`;
  checkHealth();
})();
