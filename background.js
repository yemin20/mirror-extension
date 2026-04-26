const SYSTEM_A_HOST = "sakaryaihh.sistem.plus";
const SYSTEM_B_HOST = "partner.ihh.org.tr";
const VALUE_TRANSLATIONS = {
  bagisSekli: {
    "nakit bagis": "Nakit Bağış",
    "kredi karti bagisi": "Kredi Kartı",
    "kredi kartı bağışı": "Kredi Kartı",
    "banka bagisi": "Banka Bağışı",
    "banka bağışı": "Banka Bağışı",
    nakit: "Nakit",
    "kredi karti": "Kredi Kartı",
    "kredi kartı": "Kredi Kartı",
    havale: "Havale",
    eft: "EFT",
  },
  kaynak: {
    "standart bagis": "Standart Bağış",
    "sponsorluk #1": "Sponsorluk #1",
  },
};

function normalizeText(text) {
  if (!text) return "";
  const trMap = {
    "ı": "i",
    "İ": "i",
    "ğ": "g",
    "Ğ": "g",
    "ş": "s",
    "Ş": "s",
    "ö": "o",
    "Ö": "o",
    "ü": "u",
    "Ü": "u",
    "ç": "c",
    "Ç": "c",
  };
  const replaced = String(text)
    .split("")
    .map((char) => trMap[char] || char)
    .join("");
  return replaced.toLowerCase().replace(/[^\w\s]/g, " ").replace(/\s+/g, " ").trim();
}

function translateValue(fieldName, value) {
  if (!value) return value;
  const table = VALUE_TRANSLATIONS[fieldName] || {};
  const normalized = normalizeText(value);
  for (const [source, target] of Object.entries(table)) {
    if (normalized === normalizeText(source)) return target;
  }
  return value;
}

function transformToPartnerData(plusData, overrides = {}) {
  return {
    tarih: plusData.tarih || "",
    bagisSekli: translateValue("bagisSekli", plusData.bagisSekli || ""),
    kaynak: translateValue("kaynak", plusData.kaynak || ""),
    tutar: plusData.tutar || "",
    referansNo: overrides.referansNo || "",
    ekBilgi: "",
  };
}

function normalizeOverrides(overrides = {}) {
  return {
    referansNo: String(overrides.referansNo || "").trim(),
  };
}

function sendToTab(tabId, payload) {
  const trySend = () =>
    new Promise((resolve, reject) => {
      chrome.tabs.sendMessage(tabId, payload, (response) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }
        resolve(response);
      });
    });

  return trySend().catch(async (error) => {
    if (!String(error.message || "").includes("Receiving end does not exist")) {
      throw error;
    }

    await chrome.scripting.executeScript({
      target: { tabId },
      files: ["content.js"],
    });

    return trySend();
  });
}

async function findSystemTabs() {
  const tabs = await chrome.tabs.query({});
  let systemATab = null;
  let systemBTab = null;

  for (const tab of tabs) {
    if (!tab.url) continue;
    try {
      const hostname = new URL(tab.url).hostname;
      if (hostname === SYSTEM_A_HOST && !systemATab) systemATab = tab;
      if (hostname === SYSTEM_B_HOST && !systemBTab) systemBTab = tab;
    } catch (_) {
      // Ignore non-standard URLs.
    }
  }

  return { systemATab, systemBTab };
}

function mapPreviewData(record, siraNo, overrides = {}) {
  const normalizedOverrides = normalizeOverrides(overrides);
  return transformToPartnerData(
    {
      tarih: record?.tarih || "",
      bagisSekli: record?.bagisSekli || "",
      kaynak: record?.kaynak || "",
      tutar: record?.tutar || "",
    },
    {
      referansNo: siraNo || normalizedOverrides.referansNo || "",
      ...normalizedOverrides,
    }
  );
}

function pickLatestRecord(payload) {
  if (payload?.latestRecord) return payload.latestRecord;
  const records = Array.isArray(payload?.records) ? payload.records : [];
  for (let idx = 0; idx < records.length; idx += 1) {
    if (Object.values(records[idx] || {}).some(Boolean)) return records[idx];
  }
  return null;
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  (async () => {
    if (msg.type === "PREVIEW_SYNC_DATA") {
      const siraNo = String(msg.siraNo || "").trim();
      const overrides = normalizeOverrides(msg.overrides || {});
      const { systemATab, systemBTab } = await findSystemTabs();
      if (!systemATab || !systemBTab) {
        sendResponse({
          ok: false,
          error: "Open both System A and System B donation pages first.",
        });
        return;
      }

      const scrapeResult = await sendToTab(systemATab.id, { type: "SCRAPE_SYSTEM_A" });
      if (!scrapeResult?.ok) {
        sendResponse({
          ok: false,
          error: scrapeResult?.error || "Could not scrape System A.",
        });
        return;
      }

      const latestRecord = pickLatestRecord(scrapeResult.payload);
      if (!latestRecord) {
        sendResponse({
          ok: false,
          error: "Yeni kayıt bulunamadı.",
        });
        return;
      }
      sendResponse({
        ok: true,
        scrapedCount: scrapeResult.payload.records.length,
        preview: mapPreviewData(latestRecord, siraNo, overrides),
      });
      return;
    }

    if (msg.type !== "SYNC_TO_PARTNER_TAHSILAT") return;

    const siraNo = String(msg.siraNo || "").trim();
    const overrides = normalizeOverrides(msg.overrides || {});
    if (!siraNo) {
      sendResponse({
        ok: false,
        error: "Sıra No is required. Please enter it in the popup.",
      });
      return;
    }

    const { systemATab, systemBTab } = await findSystemTabs();
    if (!systemATab || !systemBTab) {
      sendResponse({
        ok: false,
        error: "Open both System A and System B donation pages first.",
      });
      return;
    }

    const scrapeResult = await sendToTab(systemATab.id, { type: "SCRAPE_SYSTEM_A" });
    if (!scrapeResult?.ok) {
      sendResponse({
        ok: false,
        error: scrapeResult?.error || "Could not scrape System A.",
      });
      return;
    }

    const applyResult = await sendToTab(systemBTab.id, {
      type: "APPLY_TO_SYSTEM_B",
      payload: {
        ...scrapeResult.payload,
        siraNo,
        data: {
          referansNo: siraNo || overrides.referansNo,
        },
      },
    });

    if (!applyResult?.ok) {
      sendResponse({
        ok: false,
        error: applyResult?.error || "Could not apply data to System B.",
        missingSiraNo: !scrapeResult.payload?.siraNo,
      });
      return;
    }

    sendResponse({
      ok: true,
      scrapedCount: scrapeResult.payload.records.length,
      mappedCount: applyResult.mappedCount || 0,
      fieldResults: applyResult.fieldResults || {},
    });
  })().catch((error) => {
    sendResponse({ ok: false, error: error.message || "Sync failed." });
  });

  return true;
});