function element(id) {
  return document.getElementById(id);
}

export function initializeCredentialManager({ showToast = () => {} } = {}) {
  const api = window.electronAPI;
  const form = element("credential-form");
  const list = element("credential-list");
  const status = element("credential-manager-status");
  const idInput = element("credential-id");
  const originInput = element("credential-origin");
  const usernameInput = element("credential-username");
  const passwordInput = element("credential-password");
  const passwordToggle = element("credential-password-toggle");

  if (!form || !list || !api?.listCredentials) return;

  const setStatus = (message, isError = false) => {
    if (!status) return;
    status.textContent = message || "";
    status.classList.toggle("error", isError);
  };

  const resetForm = () => {
    form.reset();
    idInput.value = "";
    passwordInput.type = "password";
    passwordToggle.textContent = "Show";
    form.hidden = true;
  };

  const getSecret = async (id) => {
    const response = await api.getCredentialSecret(id);
    if (!response?.success) {
      setStatus(response?.error || "Could not decrypt that login.", true);
      return null;
    }
    return response.credential;
  };

  async function loadCredentials() {
    setStatus("Opening encrypted vault…");
    const result = await api.listCredentials();
    list.replaceChildren();
    if (!result?.success) {
      setStatus(result?.error || "The credential vault is unavailable.", true);
      return;
    }

    const count = result.credentials.length;
    setStatus(count ? `${count} saved login${count === 1 ? "" : "s"}` : "No saved logins yet.");
    result.credentials.forEach((credential) => {
      list.appendChild(createCredentialRow(credential));
    });
  }

  function createCredentialRow(credential) {
    const row = document.createElement("article");
    row.className = "credential-row";
    const identity = document.createElement("div");
    identity.className = "credential-identity";
    const site = document.createElement("strong");
    site.textContent = credential.origin;
    const username = document.createElement("span");
    username.textContent = credential.username;
    const secret = document.createElement("code");
    secret.textContent = "••••••••••••";
    identity.append(site, username, secret);

    const actions = document.createElement("div");
    actions.className = "credential-row-actions";
    const reveal = createButton("Reveal", async () => {
      if (reveal.dataset.visible === "true") {
        hideSecret(reveal, secret);
        return;
      }
      const saved = await getSecret(credential.id);
      if (!saved) return;
      secret.textContent = saved.password;
      reveal.dataset.visible = "true";
      reveal.textContent = "Hide";
      window.setTimeout(() => hideSecret(reveal, secret), 15000);
    });
    const edit = createButton("Edit", async () => {
      const saved = await getSecret(credential.id);
      if (!saved) return;
      idInput.value = saved.id;
      originInput.value = saved.origin;
      usernameInput.value = saved.username;
      passwordInput.value = saved.password;
      form.hidden = false;
      originInput.focus();
    });
    const remove = createButton("Delete", async () => {
      if (!confirm(`Delete the saved login for ${credential.origin}?`)) return;
      const response = await api.deleteCredential(credential.id);
      if (!response?.success) {
        setStatus(response?.error || "Could not delete that login.", true);
        return;
      }
      await loadCredentials();
      showToast("Saved login deleted.", "success");
    }, "btn-secondary danger");
    actions.append(reveal, edit, remove);
    row.append(identity, actions);
    return row;
  }

  function createButton(label, listener, className = "btn-secondary") {
    const button = document.createElement("button");
    button.type = "button";
    button.className = className;
    button.textContent = label;
    button.addEventListener("click", listener);
    return button;
  }

  function hideSecret(button, secret) {
    secret.textContent = "••••••••••••";
    button.dataset.visible = "false";
    button.textContent = "Reveal";
  }

  element("credential-add-button")?.addEventListener("click", () => {
    resetForm();
    form.hidden = false;
    originInput.focus();
  });
  element("credential-cancel-button")?.addEventListener("click", resetForm);
  passwordToggle?.addEventListener("click", () => {
    const visible = passwordInput.type === "text";
    passwordInput.type = visible ? "password" : "text";
    passwordToggle.textContent = visible ? "Show" : "Hide";
  });
  element("credential-generate-button")?.addEventListener("click", async () => {
    const result = await api.generateCredentialPassword();
    if (!result?.success) {
      setStatus(result?.error || "Could not generate a password.", true);
      return;
    }
    passwordInput.value = result.password;
    passwordInput.type = "text";
    passwordToggle.textContent = "Hide";
  });
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    setStatus("Encrypting and saving…");
    const result = await api.saveCredential({
      id: idInput.value || undefined,
      origin: originInput.value,
      username: usernameInput.value,
      password: passwordInput.value,
    });
    if (!result?.success) {
      setStatus(result?.error || "Could not save that login.", true);
      return;
    }
    resetForm();
    await loadCredentials();
    showToast("Login saved securely.", "success");
  });

  loadCredentials().catch(() => setStatus("The credential vault is unavailable.", true));
}
