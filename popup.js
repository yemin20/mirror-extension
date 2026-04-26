const REQUIRED_FIELDS = ["tarih", "tutar", "bagisSekli", "kaynak", "referansNo"];
const PREVIEW_KEYS = [
  "tarih",
  "tutar",
  "bagisSekli",
  "kaynak",
  "referansNo",
  "ekBilgi",
];

const LABELS = {
  tarih: "Tarih",
  bagisSekli: "Bağış Şekli",
  kaynak: "Kaynak",
  tutar: "Tutar",
  referansNo: "Referans No",
  ekBilgi: "Bilgi Notu",
};

const DEFAULT_SETTINGS = {
  siraNo: "",
};

const SETTINGS_KEYS = Object.keys(DEFAULT_SETTINGS);

const siraNoInput = document.getElementById("siraNoInput");
const previewButton = document.getElementById("previewButton");
const syncButton = document.getElementById("syncButton");
const previewStatus = document.getElementById("previewStatus");
const warnings = document.getElementById("warnings");
const previewTable = document.getElementById("previewTable");

let lastPreview = null;
let lastSiraNo = "";

function setStatus(text) {
  previewStatus.textContent = text;
}

function clearPreviewUI() {
  warnings.textContent = "";
  previewTable.innerHTML = "";
}

function readSettingsFromInputs() {
  return {
    siraNo: siraNoInput.value.trim(),
  };
}

function getOverrides() {
  return {
    referansNo: siraNoInput.value.trim(),
  };
}

function saveSettings(showFeedback = true) {
  const settings = readSettingsFromInputs();
  chrome.storage.local.set(settings, () => {
    if (chrome.runtime.lastError && showFeedback) {
      alert(`Kayıt hatası: ${chrome.runtime.lastError.message}`);
    }
  });
}

function applySettingsToInputs(rawSettings = {}) {
  const settings = { ...DEFAULT_SETTINGS, ...rawSettings };
  siraNoInput.value = settings.siraNo || "";
}

function loadSettings() {
  chrome.storage.local.get(SETTINGS_KEYS, (stored) => {
    if (chrome.runtime.lastError) {
      alert(`Yükleme hatası: ${chrome.runtime.lastError.message}`);
      applySettingsToInputs(DEFAULT_SETTINGS);
      return;
    }
    applySettingsToInputs(stored);
  });
}

function getMissingRequiredFields(data) {
  return REQUIRED_FIELDS.filter((key) => !String(data?.[key] || "").trim());
}

function renderPreview(previewData) {
  const rows = PREVIEW_KEYS.filter((key) => previewData[key] !== undefined).map((key) => {
    const safeValue = String(previewData[key] || "").trim();
    return `<tr><td>${LABELS[key] || key}</td><td>${safeValue || "-"}</td></tr>`;
  });
  previewTable.innerHTML = rows.join("");

  const missing = getMissingRequiredFields(previewData);
  if (missing.length) {
    warnings.textContent = `Uyarı - Zorunlu alanlar boş: ${missing.map((k) => LABELS[k] || k).join(", ")}`;
  } else {
    warnings.textContent = "Zorunlu alanlar tamam.";
  }
}

function loadPreview() {
  const siraNo = siraNoInput.value.trim();
  if (!siraNo) {
    alert("Lütfen Referans No girin.");
    return;
  }

  setStatus("Önizleme alınıyor...");
  clearPreviewUI();
  syncButton.disabled = true;

  chrome.runtime.sendMessage({ type: "PREVIEW_SYNC_DATA", siraNo, overrides: getOverrides() }, (response) => {
    if (chrome.runtime.lastError) {
      setStatus("Önizleme alınamadı.");
      alert("Hata: " + chrome.runtime.lastError.message);
      return;
    }
    if (!response?.ok) {
      setStatus("Önizleme alınamadı.");
      alert("Önizleme hatası: " + (response?.error || "Bilinmeyen hata"));
      return;
    }

    lastPreview = response.preview || null;
    lastSiraNo = siraNo;
    renderPreview(lastPreview || {});
    setStatus(`Önizleme hazır. Plus kayıt sayısı: ${response.scrapedCount || 0}`);
    syncButton.disabled = !lastPreview;
  });
}

function runSync() {
  const siraNo = siraNoInput.value.trim();
  if (!siraNo) {
    alert("Lütfen Referans No girin.");
    return;
  }

  if (!lastPreview || lastSiraNo !== siraNo) {
    alert("Önce güncel önizleme alın.");
    return;
  }

  const missing = getMissingRequiredFields(lastPreview);
  if (missing.length) {
    const confirmMissing = confirm(
      `Zorunlu alanlar boş görünüyor: ${missing.map((k) => LABELS[k] || k).join(", ")}.\nYine de doldurma yapılsın mı?`
    );
    if (!confirmMissing) return;
  }

  chrome.runtime.sendMessage({ type: "SYNC_TO_PARTNER_TAHSILAT", siraNo, overrides: getOverrides() }, (response) => {
    if (chrome.runtime.lastError) {
      alert("Hata: " + chrome.runtime.lastError.message);
      return;
    }

    if (!response?.ok) {
      alert("Aktarım başarısız: " + (response?.error || "Bilinmeyen hata"));
      return;
    }

    alert("Donation Sync: Aktarım tamamlandı.");
  });
}

previewButton.addEventListener("click", loadPreview);
syncButton.addEventListener("click", runSync);
siraNoInput.addEventListener("input", () => {
  if (siraNoInput.value.trim() !== lastSiraNo) {
    lastPreview = null;
    syncButton.disabled = true;
    setStatus("Referans No degisti. Yeniden onizleme alin.");
    clearPreviewUI();
  }
});

siraNoInput.addEventListener("blur", () => {
  saveSettings(false);
});

loadSettings();
