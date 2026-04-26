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

function toCompact(text) {
  return normalizeText(text).replace(/\s+/g, "");
}

const EDITABLE_SELECTOR =
  "input, textarea, select, [contenteditable='true'], [role='combobox'], [role='spinbutton'], [role='button'][aria-haspopup='listbox']";

function matchesAlias(normalizedItem, alias) {
  if (!normalizedItem || !alias) return false;
  const normalizedAlias = normalizeText(alias);
  if (!normalizedAlias) return false;
  if (normalizedItem.includes(normalizedAlias)) return true;
  return toCompact(normalizedItem).includes(toCompact(normalizedAlias));
}

function setNativeValue(el, value) {
  if (!("value" in el)) return false;
  const proto = el.tagName === "TEXTAREA" ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  const descriptor = Object.getOwnPropertyDescriptor(proto, "value");
  if (descriptor && typeof descriptor.set === "function") {
    descriptor.set.call(el, value);
  } else {
    el.value = value;
  }
  return true;
}

function dispatchInputEvents(el) {
  el.dispatchEvent(new Event("input", { bubbles: true }));
  el.dispatchEvent(new Event("change", { bubbles: true }));
}

function safeClick(el) {
  if (!el) return false;
  if (typeof el.click === "function") {
    el.click();
    return true;
  }
  try {
    el.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    return true;
  } catch (_) {
    return false;
  }
}

function getSearchRoots() {
  const roots = [document];
  const visited = new Set([document]);
  const queue = [document];

  while (queue.length) {
    const currentDoc = queue.shift();
    const iframes = Array.from(currentDoc.querySelectorAll("iframe"));
    for (const iframe of iframes) {
      try {
        const iframeDoc = iframe.contentDocument;
        if (!iframeDoc || visited.has(iframeDoc)) continue;
        visited.add(iframeDoc);
        roots.push(iframeDoc);
        queue.push(iframeDoc);
      } catch (_) {
        // Cross-origin iframe access can fail and is expected.
      }
    }
  }

  return roots;
}

function findPartnerTahsilatRoots() {
  const roots = [];
  const markerTexts = ["tahsilat tarihi", "tahsilat miktari", "tahsilat turu", "bagis turu", "referans no"];
  for (const rootDoc of getSearchRoots()) {
    const candidates = Array.from(
      rootDoc.querySelectorAll("[role='dialog'], .modal, .window, .panel, .card, .popup, .x-window, .ant-modal, div")
    );
    for (const candidate of candidates) {
      if (!candidate || !isVisible(candidate)) continue;
      const blob = normalizeText(candidate.textContent || "");
      const score = markerTexts.filter((token) => blob.includes(token)).length;
      if (score >= 3) roots.push(candidate);
    }
  }
  return roots;
}

function collectModalControlHints(roots, limit = 20) {
  if (!roots || !roots.length) return [];
  const seen = new Set();
  const hints = [];
  for (const root of roots) {
    const controls = Array.from(root.querySelectorAll(EDITABLE_SELECTOR));
    for (const el of controls) {
      const tag = (el.tagName || "").toLowerCase();
      const role = el.getAttribute("role") || "";
      const id = el.id || "";
      const name = el.getAttribute("name") || "";
      const placeholder = el.getAttribute("placeholder") || "";
      const ariaLabel = el.getAttribute("aria-label") || "";
      const text = [tag, id, name, role, placeholder, ariaLabel].filter(Boolean).join("|");
      if (!text || seen.has(text)) continue;
      seen.add(text);
      hints.push(text);
      if (hints.length >= limit) return hints;
    }
  }
  return hints;
}

function getHeaders(table) {
  return Array.from(table.querySelectorAll("thead th")).map((th) => th.textContent.trim());
}

function findBagislarTable() {
  const tables = Array.from(document.querySelectorAll("table"));
  return (
    tables.find((table) => {
      const headerText = normalizeText(getHeaders(table).join(" "));
      return (
        headerText.includes("tarih") &&
        headerText.includes("bagis sekli") &&
        headerText.includes("tl tutar") &&
        headerText.includes("ek bilgi")
      );
    }) || null
  );
}

function scrapeBagislarRows(table) {
  const headers = getHeaders(table).map((header) => normalizeText(header));
  return Array.from(table.querySelectorAll("tbody tr"))
    .filter((row) => row.closest("tbody"))
    .filter((row) => isVisible(row))
    .filter((row) => row.querySelectorAll("td").length > 0)
    .map((row) => {
      const cells = Array.from(row.querySelectorAll("td"));
      const record = {
        tarih: "",
        tur: "",
        kart: "",
        bagisSekli: "",
        kaynak: "",
        tutar: "",
        tlTutar: "",
        ekBilgi: "",
      };

      cells.forEach((cell, idx) => {
        const key = headers[idx] || "";
        const value = cell.textContent ? cell.textContent.trim() : "";
        if (!value) return;

        if (key.includes("tarih")) record.tarih = value;
        if (key.includes("tur")) record.tur = value;
        if (key.includes("kart")) record.kart = value;
        if (key.includes("bagis sekli")) record.bagisSekli = value;
        if (key.includes("kaynak")) record.kaynak = value;
        if (key === "tutar" || (key.includes("tutar") && !key.includes("tl"))) record.tutar = value;
        if (key.includes("tl tutar")) record.tlTutar = value;
        if (key.includes("ek bilgi")) record.ekBilgi = value;
      });

      return record;
    })
    .filter((record) => Object.values(record).some(Boolean));
}

function pickLatestRecord(records) {
  if (!Array.isArray(records) || records.length === 0) return null;
  // Plus lists newest donations at top, so keep first non-empty row.
  for (let idx = 0; idx < records.length; idx += 1) {
    if (Object.values(records[idx] || {}).some(Boolean)) return records[idx];
  }
  return null;
}

function selectorsForAliases(aliases, rootsOverride = null) {
  const roots = rootsOverride && rootsOverride.length ? rootsOverride : getSearchRoots();
  const elements = roots.flatMap((root) => Array.from(root.querySelectorAll(EDITABLE_SELECTOR)));
  return elements.filter((el) => {
    const raw = [];
    if (el.name) raw.push(el.name);
    if (el.id) raw.push(el.id);
    if (el.placeholder) raw.push(el.placeholder);
    if (el.getAttribute("aria-label")) raw.push(el.getAttribute("aria-label"));
    const rootNode = el.ownerDocument || document;
    const byFor = el.id ? rootNode.querySelector(`label[for="${el.id}"]`) : null;
    if (byFor?.textContent) raw.push(byFor.textContent);
    if (el.closest("label")?.textContent) raw.push(el.closest("label").textContent);
    const normalizedRaw = raw.map((item) => normalizeText(item));
    return aliases.some((alias) => normalizedRaw.some((item) => matchesAlias(item, alias)));
  });
}

function isVisible(el) {
  return !!(el && (el.offsetWidth || el.offsetHeight || el.getClientRects().length));
}

function isEditableField(el) {
  if (!el || el.disabled || el.readOnly) return false;
  if (!isVisible(el) && !el.closest("[role='dialog'], .modal, .window, .panel, .card")) return false;
  if (el.closest("thead")) return false;
  if (el.closest(".filter, .grid-filter, .search, [class*='filter']")) return false;
  const type = (el.getAttribute("type") || "").toLowerCase();
  if (type === "hidden" || type === "checkbox" || type === "radio") return false;
  return true;
}

function matchesPreferredControl(el, preferredControls = []) {
  if (!preferredControls || !preferredControls.length) return true;
  const tag = (el.tagName || "").toLowerCase();
  const role = (el.getAttribute("role") || "").toLowerCase();
  const isContentEditable = el.isContentEditable || el.getAttribute("contenteditable") === "true";

  return preferredControls.some((control) => {
    if (control === "contenteditable") return isContentEditable;
    if (control === "combobox") return role === "combobox";
    if (control === "spinbutton") return role === "spinbutton";
    if (control === "button-listbox") return role === "button" && el.getAttribute("aria-haspopup") === "listbox";
    return tag === control;
  });
}

function selectFromPopupList(rootDocument, wantedValue) {
  const optionSelectors = [
    "[role='option']",
    "li[role='option']",
    "li[data-value]",
    ".ant-select-item-option",
    ".dx-list-item",
    ".x-boundlist-item",
  ].join(", ");
  const options = Array.from(rootDocument.querySelectorAll(optionSelectors)).filter((el) => isVisible(el));
  if (!options.length) return false;

  const normalizedWanted = normalizeText(wantedValue);
  const exact = options.find((opt) => normalizeText(opt.textContent || "") === normalizedWanted);
  const fuzzy =
    exact ||
    options.find((opt) => {
      const text = normalizeText(opt.textContent || "");
      return text.includes(normalizedWanted) || normalizedWanted.includes(text);
    });
  if (!fuzzy) return false;
  return safeClick(fuzzy);
}

function findTargetByLabelOrContainer(aliases, disallowAliases = [], preferredControls = [], rootsOverride = null) {
  const normalizedAliases = aliases.map((alias) => normalizeText(alias)).filter(Boolean);
  if (!normalizedAliases.length) return null;

  const roots = rootsOverride && rootsOverride.length ? rootsOverride : getSearchRoots();
  const labelSelectors = [
    "label",
    ".form-group",
    ".form-field",
    ".field",
    ".ant-form-item",
    ".dx-field-item",
    ".dx-field-item-label-text",
    ".x-form-item-label",
    "td",
    "th",
    "span",
    "div",
  ].join(", ");

  for (const root of roots) {
    const candidates = Array.from(root.querySelectorAll(labelSelectors));
    for (const candidate of candidates) {
      const rawText = candidate.textContent ? candidate.textContent.trim() : "";
      const normalizedText = normalizeText(rawText);
      if (!normalizedText || normalizedText.length > 120) continue;
      if (!normalizedAliases.some((alias) => matchesAlias(normalizedText, alias))) continue;

      const nearContainers = [
        candidate.closest(".form-group, .form-field, .field, .ant-form-item, .dx-field-item, .x-form-item, tr, td"),
        candidate.parentElement,
        candidate.parentElement?.parentElement,
      ].filter(Boolean);

      const byFor = candidate.tagName === "LABEL" && candidate.getAttribute("for")
        ? root.getElementById(candidate.getAttribute("for"))
        : null;
      if (byFor && isEditableField(byFor)) return byFor;

      for (const container of nearContainers) {
        const controls = Array.from(container.querySelectorAll(EDITABLE_SELECTOR))
          .filter((el) => isEditableField(el))
          .filter((el) => matchesPreferredControl(el, preferredControls))
          .filter((el) => {
            const raw = normalizeText(
              [el.name, el.id, el.className, el.placeholder, el.getAttribute("aria-label"), el.closest("label")?.textContent || ""].join(" ")
            );
            return !(disallowAliases || []).some((token) => matchesAlias(raw, token));
          });
        if (controls.length) return controls[0];
      }
    }
  }

  return null;
}

function findFieldByModalLabel(roots, labelAliases, preferredControls = [], disallowAliases = []) {
  if (!roots || !roots.length || !labelAliases?.length) return null;
  const normalizedAliases = labelAliases.map((alias) => normalizeText(alias)).filter(Boolean);
  const labelSelectors = "label, span, div, td, th";
  for (const root of roots) {
    const nodes = Array.from(root.querySelectorAll(labelSelectors));
    for (const node of nodes) {
      const text = normalizeText(node.textContent || "");
      if (!text || text.length > 120) continue;
      if (!normalizedAliases.some((alias) => matchesAlias(text, alias))) continue;
      const row = node.closest("tr, td, .form-group, .form-field, .field, .ant-form-item, .dx-field-item, div") || node.parentElement;
      if (!row) continue;
      const controls = Array.from(row.querySelectorAll(EDITABLE_SELECTOR))
        .filter((el) => isEditableField(el))
        .filter((el) => matchesPreferredControl(el, preferredControls))
        .filter((el) => {
          const raw = normalizeText(
            [el.name, el.id, el.className, el.placeholder, el.getAttribute("aria-label"), el.closest("label")?.textContent || ""].join(
              " "
            )
          );
          return !disallowAliases.some((token) => matchesAlias(raw, token));
        });
      if (controls.length) return controls[0];
    }
  }
  return null;
}

function findAmountFieldInModal(roots) {
  if (!roots || !roots.length) return null;
  const selectors = [
    "input[name='amount']",
    "input[id='amount']",
    "input[name*='amount']",
    "input[id*='amount']",
    "input[name*='miktar']",
    "input[id*='miktar']",
    "[role='spinbutton'][name*='amount']",
    "[role='spinbutton'][id*='amount']",
    "[role='spinbutton'][aria-label*='Miktar']",
    "[role='spinbutton'][aria-label*='Amount']",
  ];
  for (const root of roots) {
    for (const selector of selectors) {
      const candidates = Array.from(root.querySelectorAll(selector))
        .filter((el) => isEditableField(el))
        .filter((el) => {
          const tag = (el.tagName || "").toLowerCase();
          if (tag === "select") return false;
          const raw = normalizeText(
            [el.name, el.id, el.className, el.placeholder, el.getAttribute("aria-label"), el.closest("tr, .form-group, .field, .ant-form-item, .dx-field-item")?.textContent || ""].join(
              " "
            )
          );
          // Avoid picking currency/exchange selectors.
          return !["exchange", "currency", "kur", "doviz", "döviz", "tl", "usd", "euro", "gbp"].some((token) =>
            matchesAlias(raw, token)
          );
        });
      if (candidates.length) return candidates[0];
    }
  }
  return null;
}

function buildSimpleSelector(el) {
  if (!el || !el.tagName) return "";
  const tag = el.tagName.toLowerCase();
  if (el.id) return `${tag}#${CSS.escape(el.id)}`;
  const name = el.getAttribute("name");
  if (name) return `${tag}[name="${name}"]`;
  const role = el.getAttribute("role");
  if (role) return `${tag}[role="${role}"]`;
  return tag;
}

function collectAliasCandidateSelectors(aliases, preferredControls = [], rootsOverride = null) {
  const aliasTokens = aliases.map((alias) => normalizeText(alias)).filter(Boolean);
  if (!aliasTokens.length) return [];
  const results = [];
  const seen = new Set();

  const roots = rootsOverride && rootsOverride.length ? rootsOverride : getSearchRoots();
  for (const root of roots) {
    const all = Array.from(root.querySelectorAll(EDITABLE_SELECTOR));
    for (const el of all) {
      if (!isEditableField(el)) continue;
      if (!matchesPreferredControl(el, preferredControls)) continue;
      const blob = normalizeText(
        [
          el.name,
          el.id,
          el.className,
          el.placeholder,
          el.getAttribute("aria-label"),
          el.closest("label")?.textContent || "",
          el.closest(".form-group, .form-field, .field, .ant-form-item, .dx-field-item, .x-form-item, tr, td")?.textContent || "",
        ].join(" ")
      );
      if (!aliasTokens.some((token) => matchesAlias(blob, token))) continue;
      const selector = buildSimpleSelector(el);
      if (!selector || seen.has(selector)) continue;
      seen.add(selector);
      results.push(selector);
      if (results.length >= 12) return results;
    }
  }
  return results;
}

function elementScopeRank(el) {
  const containerText = normalizeText(
    (el.closest(".modal, .window, .panel, .card, .popup, [role='dialog']") || document.body).textContent || ""
  );
  if (containerText.includes("partner tahsilat")) return 3;
  if (containerText.includes("baglanti kayitlari")) return 2;
  return 1;
}

function setFieldValueByAliases(aliases, value, disallowAliases = []) {
  if (!value) return { ok: false, reason: "empty_value" };
  const target = selectorsForAliases(aliases)
    .filter((el) => isEditableField(el))
    .filter((el) => {
      const raw = normalizeText(
        [el.name, el.id, el.placeholder, el.getAttribute("aria-label"), el.closest("label")?.textContent || ""].join(
          " "
        )
      );
      return !disallowAliases.some((token) => matchesAlias(raw, token));
    })
    .sort((a, b) => elementScopeRank(b) - elementScopeRank(a))[0];

  if (!target) return { ok: false, reason: "no_target" };

  if (target.tagName === "SELECT") {
    const wanted = normalizeText(value);
    const option = Array.from(target.options).find(
      (opt) => normalizeText(opt.textContent).includes(wanted) || normalizeText(opt.value) === wanted
    );
    if (!option) return { ok: false, reason: "no_select_option" };
    target.value = option.value;
  } else {
    setNativeValue(target, value);
  }

  dispatchInputEvents(target);
  return {
    ok: true,
    target: {
      name: target.name || "",
      id: target.id || "",
      tag: target.tagName,
    },
  };
}

function cleanCurrency(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  const compact = raw.replace(/\s+/g, "");
  const match = compact.match(/-?\d[\d.,]*/);
  if (!match) return "";

  const numeric = match[0].replace(/[^\d,.-]/g, "").replace(/^-+/, "");
  if (!numeric) return "";

  const lastComma = numeric.lastIndexOf(",");
  const lastDot = numeric.lastIndexOf(".");
  const decimalPos = Math.max(lastComma, lastDot);
  if (decimalPos === -1) {
    return numeric.replace(/[^\d-]/g, "");
  }

  const decimalChar = numeric[decimalPos];
  const intPart = numeric.slice(0, decimalPos).replace(/[.,]/g, "");
  const fracPart = numeric.slice(decimalPos + 1).replace(/[^\d]/g, "");
  if (!intPart && !fracPart) return "";
  if (!fracPart) return intPart;
  return `${intPart}${decimalChar}${fracPart}`;
}

// Optional exact selectors for Partner form fields.
// Keep this list updated when Partner DOM changes.
const PARTNER_SELECTOR_PROFILE = {
  tarih: ["#partner-tarih", "[id='partner_tarih']", "input[name='tahsilatTarihi']", "input[name='tarih']"],
  bagisSekli: [
    "select[name='tahsilatTuru']",
    "select[name='bagisSekli']",
    "select[id='tahsilatTuru']",
    "[id='partner_bagis_sekli']",
  ],
  kaynak: [
    "select[name='bagisTuru']",
    "select[name='kaynak']",
    "select[id='bagisTuru']",
  ],
  tutar: [
    "input[name='tahsilatMiktari']",
    "input[name='amount']",
    "input[id='amount']",
    "input[aria-label*='Tahsilat Miktarı']",
    "input[aria-label*='Tahsilat Miktari']",
    "input[placeholder*='Miktar']",
    "input[name='tutar']",
    "input[id='tahsilatMiktari']",
  ],
  ekBilgi: ["textarea[name='bilgiNotu']", "#note", "#partner-ek-bilgi", "[id='partner_ek_bilgi']"],
  referansNo: ["#partner-referans-no", "[id='partner_referans_no']", "input[name='referansNo']"],
};

const FIELD_MAPPING_TABLE = [
  { plusField: "Tarih", partnerField: "Tahsilat Tarihi", notes: "Direct copy." },
  {
    plusField: "Bağış Şekli",
    partnerField: "Tahsilat Türü",
    notes: "Value may require translation between systems.",
  },
  { plusField: "Kaynak", partnerField: "Bağış Türü", notes: "Translated when needed." },
  { plusField: "Tutar", partnerField: "Tahsilat Miktarı", notes: "Currency text normalized before apply." },
  { plusField: "Referans No (Popup)", partnerField: "Referans No", notes: "Sira No popup girisinden gelir." },
  { plusField: "-", partnerField: "Ek Bilgi", notes: "Bilerek bos birakilir." },
];

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

function translateValue(fieldName, value) {
  if (!value) return value;
  const table = VALUE_TRANSLATIONS[fieldName] || {};
  const normalized = normalizeText(value);
  for (const [source, target] of Object.entries(table)) {
    if (normalized === normalizeText(source)) return target;
  }
  return value;
}

function pickSelectOption(selectElement, value) {
  const wanted = normalizeText(value);
  const wantedCompact = toCompact(value);
  const options = Array.from(selectElement.options || []);

  const exactValue = options.find((opt) => normalizeText(opt.value) === wanted);
  if (exactValue) return exactValue;

  const exactText = options.find((opt) => normalizeText(opt.textContent || "") === wanted);
  if (exactText) return exactText;

  const compactMatch = options.find((opt) => {
    const textCompact = toCompact(opt.textContent || "");
    const valueCompact = toCompact(opt.value || "");
    return textCompact === wantedCompact || valueCompact === wantedCompact;
  });
  if (compactMatch) return compactMatch;

  const containsMatch = options.find((opt) => {
    const text = normalizeText(opt.textContent || "");
    const rawValue = normalizeText(opt.value || "");
    return text.includes(wanted) || wanted.includes(text) || rawValue.includes(wanted);
  });
  if (containsMatch) return containsMatch;

  return null;
}

function transformToPartnerData(plusData, overrides = {}) {
  const referansNo = overrides.referansNo || "";

  return {
    tarih: plusData.tarih || "",
    bagisSekli: translateValue("bagisSekli", plusData.bagisSekli || ""),
    kaynak: translateValue("kaynak", plusData.kaynak || ""),
    tutar: plusData.tutar || "",
    ekBilgi: "",
    referansNo,
  };
}

function matchesSelectHints(el, optionHints = [], forbiddenOptionHints = []) {
  if (!el) return false;
  const tag = (el.tagName || "").toLowerCase();
  if (tag !== "select") return true;
  const options = Array.from(el.options || [])
    .map((opt) => normalizeText(opt.textContent || opt.value || ""))
    .filter(Boolean);
  if (!options.length) return true;
  const hasWanted = !optionHints.length || optionHints.some((hint) => options.some((opt) => matchesAlias(opt, hint)));
  const hasForbidden = forbiddenOptionHints.some((hint) => options.some((opt) => matchesAlias(opt, hint)));
  return hasWanted && !hasForbidden;
}

function pickFirstMatch(
  selectors,
  preferredControls = [],
  optionHints = [],
  forbiddenOptionHints = [],
  rootsOverride = null
) {
  const roots = rootsOverride && rootsOverride.length ? rootsOverride : getSearchRoots();
  for (const root of roots) {
    for (const selector of selectors) {
      const matches = Array.from(root.querySelectorAll(selector));
      for (const el of matches) {
        if (
          el &&
          isEditableField(el) &&
          matchesPreferredControl(el, preferredControls) &&
          matchesSelectHints(el, optionHints, forbiddenOptionHints)
        ) {
          return el;
        }
      }
    }
  }
  for (const root of roots) {
    for (const selector of selectors) {
      const matches = Array.from(root.querySelectorAll(selector));
      for (const el of matches) {
        if (
          el &&
          matchesPreferredControl(el, preferredControls) &&
          matchesSelectHints(el, optionHints, forbiddenOptionHints)
        ) {
          return el;
        }
      }
    }
  }
  return null;
}

function setElementValue(el, value) {
  if (el.isContentEditable || el.getAttribute("contenteditable") === "true") {
    el.textContent = value;
    dispatchInputEvents(el);
    return { ok: true };
  }
  const role = (el.getAttribute("role") || "").toLowerCase();
  const isListboxButton = role === "button" && el.getAttribute("aria-haspopup") === "listbox";
  if (role === "combobox" || isListboxButton) {
    safeClick(el);
    const ownerDoc = el.ownerDocument || document;
    if (selectFromPopupList(ownerDoc, value)) {
      dispatchInputEvents(el);
      return { ok: true };
    }
    return { ok: false, reason: "no_select_option" };
  }
  if (el.tagName === "SELECT") {
    const option = pickSelectOption(el, value);
    if (!option) {
      return {
        ok: false,
        reason: "no_select_option",
        availableOptions: Array.from(el.options || [])
          .map((opt) => (opt.textContent || "").trim())
          .filter(Boolean)
          .slice(0, 30),
      };
    }
    el.value = option.value;
  } else {
    const written = setNativeValue(el, value);
    if (!written) return { ok: false, reason: "no_native_value" };
  }
  dispatchInputEvents(el);
  return { ok: true };
}

function applyRequestDataToPartnerForm(data) {
  const modalRoots = findPartnerTahsilatRoots();
  const fieldConfigs = [
    {
      fieldName: "tarih",
      dataKey: "tarih",
      aliases: ["tarih", "tahsilat tarihi", "islem tarihi", "işlem tarihi"],
      selectors: [...(PARTNER_SELECTOR_PROFILE.tarih || []), "[id='tarih']", "[name='tarih']", ".tarih", "[class*='tarih']"],
      disallowAliases: ["referans", "makbuz", "tahsilat no", "receipt", "fis no", "fiş no"],
      preferredControls: ["input", "textarea", "contenteditable"],
    },
    {
      fieldName: "tutar",
      dataKey: "tutar",
      aliases: ["tutar"],
      selectors: [
        ...(PARTNER_SELECTOR_PROFILE.tutar || []),
        "input[name='amount']",
        "input[id='amount']",
        "[id='tutar']",
        "[name='tutar']",
        "[name='amount']",
        "[name*='miktar']",
        "[id*='miktar']",
        "[name*='tahsilat'][name*='miktar']",
        "[id*='tahsilat'][id*='miktar']",
        "[name*='tahsilat'][name*='tutar']",
        "[id*='tahsilat'][id*='tutar']",
        ".tutar",
        "[class*='tutar']",
        "[aria-label*='Miktar']",
        "[placeholder*='Miktar']",
        "input[role='spinbutton']",
      ],
      disallowAliases: ["tl tutar", "tltutar"],
      transform: cleanCurrency,
      optionHints: [],
      forbiddenOptionHints: ["turk lirasi", "abd dolari", "euro", "ingiliz sterlini", "usd", "gbp"],
      preferredControls: ["input", "textarea", "spinbutton", "contenteditable"],
    },
    {
      fieldName: "bagisSekli",
      dataKey: "bagisSekli",
      aliases: [
        "bagis sekli",
        "bagissekli",
        "bagis tipi",
        "odeme sekli",
        "odeme tipi",
        "tahsilat turu",
        "tahsilat tipi",
        "tahsilat sekli",
        "sekil",
      ],
      selectors: [
        ...(PARTNER_SELECTOR_PROFILE.bagisSekli || []),
        "[id='bagisSekli']",
        "[name='bagisSekli']",
        "select[name='tahsilatTuru']",
        "select[id='tahsilatTuru']",
        "[aria-label*='Tahsilat Tür']",
        "[aria-label*='Tahsilat Tur']",
        "[role='combobox'][aria-label*='Bağış']",
        "[role='button'][aria-haspopup='listbox'][aria-label*='Bağış']",
      ],
      preferredControls: ["select", "combobox", "button-listbox"],
      optionHints: ["nakit", "banka", "kredi kart", "bagis", "tahsilat"],
      forbiddenOptionHints: ["turk lirasi", "abd dolari", "euro", "ingiliz sterlini", "usd", "gbp"],
    },
    {
      fieldName: "kaynak",
      dataKey: "kaynak",
      aliases: ["kaynak", "tahsilat kaynagi", "tahsilat kaynak", "odeme kaynagi", "odeme kaynak"],
      selectors: [
        ...(PARTNER_SELECTOR_PROFILE.kaynak || []),
        "select[name='kaynak']",
        "select[id='kaynak']",
        "select[name='bagisTuru']",
        "[aria-label*='Kaynak']",
      ],
      preferredControls: ["select", "combobox", "button-listbox"],
      optionHints: ["standart bagis", "zekat", "fitre", "sponsorluk", "bagis"],
      forbiddenOptionHints: ["turk lirasi", "abd dolari", "euro", "ingiliz sterlini", "usd", "gbp"],
    },
    {
      fieldName: "referansNo",
      dataKey: "referansNo",
      aliases: ["referans no", "referansno", "makbuz no", "makbuz veya tahsilat no", "tahsilat no", "receipt no"],
      selectors: [
        ...(PARTNER_SELECTOR_PROFILE.referansNo || []),
        "[id='referansNo']",
        "[name='referansNo']",
        "[placeholder*='Makbuz']",
        "[placeholder*='Tahsilat No']",
        "[name='referans no']",
        ".referansNo",
        "[class*='referansno']",
        "[class*='referans-no']",
      ],
      disallowAliases: ["tarih", "date", "miktar", "tutar", "currency", "tl", "usd", "euro"],
      preferredControls: ["input", "textarea", "contenteditable"],
    },
    {
      fieldName: "ekBilgi",
      dataKey: "ekBilgi",
      aliases: ["ek bilgi", "ekbilgi", "not", "notlar", "notlar turu", "aciklama", "açıklama"],
      selectors: [
        ...(PARTNER_SELECTOR_PROFILE.ekBilgi || []),
        "[id='ekBilgi']",
        "[name='ek bilgi']",
        "[name*='not']",
        "[id*='not']",
        "[name*='aciklama']",
        "[id*='aciklama']",
        ".ekBilgi",
        "[class*='ekbilgi']",
        "[class*='ek-bilgi']",
        "[aria-label*='Not']",
        "[aria-label*='Açıklama']",
      ],
      allowEmpty: true,
      preferredControls: ["input", "textarea", "contenteditable"],
    },
  ];

  const fieldResults = {};
  let mappedCount = 0;
  let lastMappedElement = null;

  for (const config of fieldConfigs) {
    const rawValue = data[config.dataKey];
    const value = config.transform ? config.transform(rawValue) : rawValue;

    let target = pickFirstMatch(
      config.selectors,
      config.preferredControls || [],
      config.optionHints || [],
      config.forbiddenOptionHints || [],
      modalRoots
    );
    if (!target) {
      const byAlias = selectorsForAliases(config.aliases)
        .filter((el) => (modalRoots.length ? modalRoots.some((root) => root.contains(el)) : true))
        .filter((el) => isEditableField(el))
        .filter((el) => matchesPreferredControl(el, config.preferredControls || []))
        .filter((el) => matchesSelectHints(el, config.optionHints || [], config.forbiddenOptionHints || []))
        .filter((el) => {
          const raw = normalizeText(
            [
              el.name,
              el.id,
              el.className,
              el.placeholder,
              el.getAttribute("aria-label"),
              el.closest("label")?.textContent || "",
            ].join(" ")
          );
          return !(config.disallowAliases || []).some((token) => matchesAlias(raw, token));
        })
        .sort((a, b) => elementScopeRank(b) - elementScopeRank(a))[0];
      target = byAlias || null;
    }
    if (!target) {
      target = findTargetByLabelOrContainer(
        config.aliases,
        config.disallowAliases || [],
        config.preferredControls || [],
        modalRoots
      );
      if (!matchesSelectHints(target, config.optionHints || [], config.forbiddenOptionHints || [])) {
        target = null;
      }
    }

    if (!target && config.fieldName === "referansNo") {
      target = findFieldByModalLabel(
        modalRoots,
        ["referans no", "makbuz no", "makbuz veya tahsilat no", "tahsilat no"],
        config.preferredControls || [],
        config.disallowAliases || []
      );
    }

    if (!target && config.fieldName === "tutar") {
      target = findFieldByModalLabel(
        modalRoots,
        ["tahsilat miktari", "tahsilat miktarı", "miktar", "tutar", "amount"],
        config.preferredControls || [],
        ["tarih", "referans", "makbuz", "tahsilat no", "exchange", "kur", "currency", "tl", "usd", "euro"]
      );
    }

    if (!target && config.fieldName === "tutar") {
      target = findAmountFieldInModal(modalRoots);
    }

    if (!target) {
      const candidateSelectors = collectAliasCandidateSelectors(
        config.aliases || [],
        config.preferredControls || [],
        modalRoots
      );
      const modalControlHints = collectModalControlHints(modalRoots);
      console.warn("Missing field target:", config.fieldName, {
        selectorsTried: config.selectors || [],
        aliasesTried: config.aliases || [],
        candidates: candidateSelectors,
        modalControlHints,
      });
      fieldResults[config.fieldName] = {
        ok: false,
        reason: "no_target",
        selectorsTried: config.selectors || [],
        candidateSelectors,
        modalControlHints,
      };
      continue;
    }

    if (!config.allowEmpty && (value === undefined || value === null || value === "")) {
      fieldResults[config.fieldName] = { ok: false, reason: "empty_value" };
      continue;
    }

    const result = setElementValue(target, value);
    fieldResults[config.fieldName] = result;
    if (result.ok) {
      mappedCount += 1;
      lastMappedElement = target;
    }
  }

  // Final synthetic event pulse so System B detects batch updates.
  const form = lastMappedElement?.closest("form") || document.querySelector("form");
  if (form) {
    form.dispatchEvent(new Event("input", { bubbles: true }));
    form.dispatchEvent(new Event("change", { bubbles: true }));
  } else {
    document.dispatchEvent(new Event("input", { bubbles: true }));
    document.dispatchEvent(new Event("change", { bubbles: true }));
  }

  const saveClicked = clickSaveButton();
  return { ok: true, mappedCount, fieldResults, saveClicked };
}

function mapPartnerFields(payload) {
  const latestRecord = payload.latestRecord || pickLatestRecord(payload.records || []);
  if (!latestRecord && !payload.data) return { ok: false, error: "Yeni kayıt bulunamadı." };

  const plusData = {
    tarih: payload.data?.tarih ?? latestRecord?.tarih ?? "",
    bagisSekli: payload.data?.bagisSekli ?? latestRecord?.bagisSekli ?? "",
    kaynak: payload.data?.kaynak ?? latestRecord?.kaynak ?? "",
    tutar: payload.data?.tutar ?? latestRecord?.tutar ?? "",
  };

  const requestData = transformToPartnerData(plusData, {
    referansNo: payload.data?.referansNo ?? payload.siraNo ?? "",
  });

  return applyRequestDataToPartnerForm(requestData);
}

function clickIfFound(selectors, root = document) {
  const roots = Array.isArray(root) ? root : [root];
  for (const searchRoot of roots) {
    for (const selector of selectors) {
      const el = searchRoot.querySelector(selector);
      if (el && isVisible(el)) {
        if (safeClick(el)) return true;
      }
    }
  }
  return false;
}

function tryOpenPartnerTahsilatEditor() {
  const roots = getSearchRoots();
  const containerCandidates = roots.flatMap((root) => Array.from(root.querySelectorAll(".modal, .window, .panel, .card, body")));
  const partnerContainer =
    containerCandidates.find((el) => normalizeText(el.textContent || "").includes("partner tahsilat")) || document.body;

  // Common "new/add" controls for this UI family.
  const clicked =
    clickIfFound(
      [
        "button[title*='Yeni']",
        "button[title*='Ekle']",
        "button[title*='Add']",
        "a[title*='Yeni']",
        "a[title*='Ekle']",
        ".fa-plus",
        ".icon-plus",
        "[class*='add']",
      ],
      partnerContainer
    ) ||
    clickIfFound(
      [
        "button[title*='Yeni']",
        "button[title*='Ekle']",
        "button[title*='Add']",
        "a[title*='Yeni']",
        "a[title*='Ekle']",
      ],
      roots
    );

  return clicked;
}

function clickSaveButton() {
  const roots = getSearchRoots();
  return clickIfFound(
    [
      "button[type='submit']",
      "button[title*='Kaydet']",
      "button[aria-label*='Kaydet']",
      "button[name*='kaydet']",
      "button[id*='kaydet']",
      "a[title*='Kaydet']",
      "[role='button'][aria-label*='Kaydet']",
      "button[title*='Save']",
      "button[aria-label*='Save']",
      "a[title*='Save']",
    ],
    roots
  );
}

function shouldRetryAfterOpen(result) {
  if (!result || !result.fieldResults) return true;
  const criticalFields = ["tarih", "bagisSekli", "kaynak", "tutar", "referansNo"];
  return criticalFields.some((field) => {
    const status = result.fieldResults[field];
    return status && !status.ok && (status.reason === "no_target" || status.reason === "no_select_option");
  });
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.type === "SCRAPE_SYSTEM_A") {
    const table = findBagislarTable();
    if (!table) {
      sendResponse({ ok: false, error: "Bağışlar table not found in System A." });
      return;
    }
    const records = scrapeBagislarRows(table);
    if (!records.length) {
      sendResponse({ ok: false, error: "Yeni kayıt bulunamadı." });
      return;
    }
    const latestRecord = pickLatestRecord(records);
    if (!latestRecord) {
      sendResponse({ ok: false, error: "Yeni kayıt bulunamadı." });
      return;
    }
    sendResponse({ ok: true, payload: { records, latestRecord } });
    return;
  }

  if (msg.type === "APPLY_TO_SYSTEM_B") {
    const payload = msg.payload || { records: [], siraNo: "" };
    const firstPass = mapPartnerFields(payload);

    // Retry after opening editor when critical fields are still unresolved.
    if (shouldRetryAfterOpen(firstPass) && tryOpenPartnerTahsilatEditor()) {
      window.setTimeout(() => {
        sendResponse(mapPartnerFields(payload));
      }, 700);
      return true;
    }

    sendResponse(firstPass);
    return;
  }

  if (msg.type === "APPLY_REQUEST_DATA") {
    const data = msg.data || {};
    sendResponse(applyRequestDataToPartnerForm(data));
    return;
  }

  if (msg.type === "GET_FIELD_MAPPING") {
    sendResponse({ ok: true, mapping: FIELD_MAPPING_TABLE });
  }
});