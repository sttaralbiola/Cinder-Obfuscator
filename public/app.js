(() => {
  const sourceInput = document.getElementById("sourceInput");
  const outputArea = document.getElementById("outputArea");
  const bytesIn = document.getElementById("bytesIn");
  const bytesOut = document.getElementById("bytesOut");
  const forgeBtn = document.getElementById("forgeBtn");
  const copyBtn = document.getElementById("copyBtn");
  const downloadBtn = document.getElementById("downloadBtn");
  const statusEl = document.getElementById("status");
  const presetDesc = document.getElementById("presetDesc");
  const heatBtns = Array.from(document.querySelectorAll(".heat-btn"));

  const EXAMPLE = `local function greet(name)\n  print("Hello, " .. name .. "!")\nend\n\ngreet("world")\n`;

  let activePreset = "Medium";
  let presetCopy = {
    Minify: "Strips whitespace and shortens names. No real protection.",
    Weak: "Light obfuscation. Fast, easy to reverse.",
    Medium: "Balanced: renamed locals, encoded strings, flattened blocks.",
    Strong: "Heaviest preset: control-flow flattening, constant encryption, virtualised constants.",
  };

  sourceInput.value = EXAMPLE;
  updateBytes();

  fetch("/api/presets")
    .then((r) => r.json())
    .then((data) => {
      if (data && data.presets) {
        presetCopy = data.presets;
        presetDesc.textContent = presetCopy[activePreset] || presetDesc.textContent;
      }
    })
    .catch(() => {
      /* fall back to the bundled copy above — not fatal */
    });

  function formatBytes(n) {
    if (n < 1024) return `${n} B`;
    return `${(n / 1024).toFixed(1)} KB`;
  }

  function updateBytes() {
    bytesIn.textContent = formatBytes(new Blob([sourceInput.value]).size);
    bytesOut.textContent = formatBytes(new Blob([outputArea.value]).size);
  }

  function setStatus(text, kind) {
    statusEl.textContent = text || "\u00A0";
    statusEl.classList.remove("is-error", "is-ok");
    if (kind) statusEl.classList.add(kind === "error" ? "is-error" : "is-ok");
  }

  function setPreset(preset) {
    activePreset = preset;
    heatBtns.forEach((btn) => btn.classList.toggle("is-active", btn.dataset.preset === preset));
    presetDesc.textContent = presetCopy[preset] || "";
  }

  heatBtns.forEach((btn) => {
    btn.addEventListener("click", () => setPreset(btn.dataset.preset));
  });

  sourceInput.addEventListener("input", updateBytes);

  forgeBtn.addEventListener("click", async () => {
    const code = sourceInput.value;
    if (!code.trim()) {
      setStatus("Paste some Lua first.", "error");
      return;
    }

    forgeBtn.disabled = true;
    forgeBtn.classList.add("is-working");
    forgeBtn.textContent = "Forging…";
    setStatus("Sending to the forge…");
    copyBtn.disabled = true;
    downloadBtn.disabled = true;

    try {
      const res = await fetch("/api/obfuscate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code, preset: activePreset }),
      });
      const data = await res.json();

      if (!res.ok || !data.success) {
        throw new Error(data.error || "The forge rejected this script.");
      }

      outputArea.value = data.output;
      updateBytes();
      setStatus(`Forged in ${data.ms}ms · ${activePreset} preset`, "ok");
      copyBtn.disabled = false;
      downloadBtn.disabled = false;
    } catch (err) {
      setStatus(err.message || "Couldn't forge this — check that the source is valid Lua.", "error");
    } finally {
      forgeBtn.disabled = false;
      forgeBtn.classList.remove("is-working");
      forgeBtn.textContent = "Forge it";
    }
  });

  copyBtn.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(outputArea.value);
      const original = copyBtn.textContent;
      copyBtn.textContent = "Copied";
      setTimeout(() => (copyBtn.textContent = original), 1400);
    } catch {
      outputArea.select();
      setStatus("Clipboard blocked — selected the text instead, use Ctrl/Cmd+C.", "error");
    }
  });

  downloadBtn.addEventListener("click", () => {
    const blob = new Blob([outputArea.value], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "obfuscated.lua";
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  });

  setPreset(activePreset);
})();
