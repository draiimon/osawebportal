function parsePortalContentValue(raw) {
  const text = String(raw == null ? "" : raw).trim();
  if (!text) return "";
  const looksJson =
    (text.startsWith("{") && text.endsWith("}")) ||
    (text.startsWith("[") && text.endsWith("]"));
  if (!looksJson) return text;
  try {
    return JSON.parse(text);
  } catch (_error) {
    return text;
  }
}

function asObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : null;
}

function pickString(source, keys) {
  const obj = asObject(source);
  if (!obj) return "";
  for (const key of keys) {
    const value = obj[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
}

function listFromArray(value) {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => {
      if (typeof entry === "string") return entry.trim();
      const obj = asObject(entry);
      if (!obj) return "";
      return (
        pickString(obj, ["title", "label", "heading", "kicker", "name"]) ||
        [
          pickString(obj, ["kicker"]),
          pickString(obj, ["title"]),
          pickString(obj, ["subtitle", "desc", "description"]),
        ]
          .filter(Boolean)
          .join(" — ")
      );
    })
    .filter(Boolean);
}

function pushField(lines, label, value) {
  const text = typeof value === "string" ? value.trim() : "";
  if (!text) return;
  lines.push(`- ${label}: ${text}`);
}

function normalizePortalPages(rows) {
  const pages = {};
  const items = Array.isArray(rows) ? rows : [];
  items.forEach((row) => {
    const page = String(row?.page_name || "").trim().toLowerCase();
    const key = String(row?.content_key || "").trim();
    if (!page || !key) return;
    if (!pages[page]) pages[page] = {};
    pages[page][key] = parsePortalContentValue(row?.content_value);
  });
  return pages;
}

function buildPortalPageContext(rows) {
  const pages = normalizePortalPages(rows);
  const home = pages.home || {};
  const about = pages.about || {};
  const homeHero = asObject(home.hero);
  const homeManual = asObject(home.manual);
  const aboutPortal = asObject(about.portal);
  const aboutSchool = asObject(about.school);

  const lines = [];

  if (Object.keys(home).length || Object.keys(about).length) {
    lines.push("\n\nPORTAL PAGE CONTENT (live from the Home/About page editor):");
  }

  if (Object.keys(home).length) {
    lines.push("HOME PAGE / DASHBOARD:");
    pushField(lines, "Portal title", pickString(homeHero, ["title"]) || String(home.hero_title || "").trim());

    const heroSubtitles = Array.isArray(homeHero?.subtitles)
      ? homeHero.subtitles.map((item) => String(item || "").trim()).filter(Boolean)
      : [];
    pushField(
      lines,
      "Hero subtitle",
      heroSubtitles.length ? heroSubtitles.join(" | ") : String(home.hero_subtitle || "").trim()
    );

    const slideTitles = listFromArray(home.slides).slice(0, 4);
    if (slideTitles.length) {
      lines.push(`- Guide slides shown on the dashboard: ${slideTitles.join(" | ")}`);
    }

    pushField(lines, "Services section heading", String(home.services_heading || "").trim());
    pushField(lines, "Services section description", String(home.services_description || "").trim());

    const serviceCards = listFromArray(home.services).slice(0, 10);
    if (serviceCards.length) {
      lines.push(`- OSA service cards shown on the dashboard: ${serviceCards.join("; ")}`);
    }

    pushField(lines, "Manual and forms heading", String(home.manual_heading || "").trim());
    pushField(lines, "Manual and forms description", String(home.manual_description || "").trim());

    pushField(lines, "Primary manual title", pickString(homeManual, ["title"]));
    pushField(lines, "Primary manual description", pickString(homeManual, ["description", "desc"]));

    const formTitles = listFromArray(home.forms).slice(0, 10);
    if (formTitles.length) {
      lines.push(`- Download links shown on the dashboard: ${formTitles.join("; ")}`);
    }

    pushField(lines, "Dedicated modules heading", String(home.modules_heading || "").trim());
    pushField(lines, "Dedicated modules description", String(home.modules_description || "").trim());
  }

  if (Object.keys(about).length) {
    lines.push("ABOUT PAGE:");
    pushField(lines, "Portal title", pickString(aboutPortal, ["title"]) || String(about.hero_title || "").trim());
    pushField(lines, "Portal introduction", pickString(aboutPortal, ["desc", "description"]) || String(about.hero_lead || "").trim());
    pushField(lines, "Institution heading", pickString(aboutSchool, ["name", "abbr"]) || String(about.eac_heading || "").trim());
    pushField(lines, "Institution lead", String(about.eac_lead || "").trim());
    pushField(lines, "OSA heading", String(about.osa_heading || "").trim());
    pushField(lines, "OSA summary", String(about.osa_lead || about.osaSummary || "").trim());
    pushField(lines, "OSA services description", String(about.osaServicesDesc || "").trim());

    const duties = listFromArray(about.duties).slice(0, 8);
    if (duties.length) {
      lines.push(`- Duties listed on the About page: ${duties.join("; ")}`);
    }

    const services = listFromArray(about.services).slice(0, 10);
    if (services.length) {
      lines.push(`- Core services listed on the About page: ${services.join("; ")}`);
    }

    const files = listFromArray(about.files).slice(0, 10);
    if (files.length) {
      lines.push(`- Files and forms listed on the About page: ${files.join("; ")}`);
    }

    pushField(lines, "Contact phone", pickString(aboutSchool, ["phone"]) || String(about.contact_phone || "").trim());
    pushField(lines, "Contact email", pickString(aboutSchool, ["email"]) || String(about.contact_email || "").trim());
    pushField(lines, "Contact address", pickString(aboutSchool, ["address"]) || String(about.contact_address || "").trim());
  }

  return lines.length ? lines.join("\n") : "";
}

function looksLikePortalPageIntent(message) {
  const text = String(message || "").toLowerCase();
  if (!text.trim()) return false;
  return (
    /\b(portal|dashboard|homepage|home\s+page|about\s+portal|public\s+pages?|module\s+pages?)\b/i.test(text) ||
    /\b(chat\s+guide|announcement\s+guide|lost\s*(and|&)?\s*found\s+guide)\b/i.test(text) ||
    /\b(student\s+manual\s+and\s+forms|manual\s+and\s+forms|downloadable\s+forms)\b/i.test(text) ||
    /\b(what('?s| is)\s+(on|inside|shown\s+on)\s+the\s+(portal|dashboard|home\s+page|about\s+page))\b/i.test(text) ||
    /\b(contents?|sections?|cards?|features?)\s+(of|on|inside)\s+(the\s+)?(portal|dashboard|home\s+page|about\s+page)\b/i.test(text)
  );
}

module.exports = {
  buildPortalPageContext,
  looksLikePortalPageIntent,
};
