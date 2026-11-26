// Core .docx logic: find bullet paragraphs, then rewrite them in place.
// Runs in the browser (uses the page's JSZip and DOM) and in Node (for tests).
(function (root) {
"use strict";
const isBrowser = typeof window !== "undefined";
const JSZip = isBrowser ? root.JSZip : require("jszip");
const { DOMParser, XMLSerializer } = isBrowser ? root : require("@xmldom/xmldom");
const XML_NS = "http://www.w3.org/XML/1998/namespace";

const W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
const FAKE_BULLET = /^\s*([•▪◦‣●○■□➢►✓\-–*·])(\s*)/;

function children(node, name) {
  const out = [];
  for (let c = node.firstChild; c; c = c.nextSibling) {
    if (c.nodeType === 1 && c.nodeName === name) out.push(c);
  }
  return out;
}
function child(node, name) {
  return children(node, name)[0] || null;
}
function hasAncestor(node, names) {
  for (let p = node.parentNode; p; p = p.parentNode) {
    if (names.includes(p.nodeName)) return true;
  }
  return false;
}

// Style ids whose definition (or a parent style) carries list numbering.
function listStyleIds(stylesXml) {
  const ids = new Set();
  if (!stylesXml) return ids;
  const doc = new DOMParser().parseFromString(stylesXml, "text/xml");
  const styles = Array.from(doc.getElementsByTagName("w:style"));
  const byId = {};
  for (const s of styles) byId[s.getAttribute("w:styleId")] = s;
  const isList = (id, seen = new Set()) => {
    const s = byId[id];
    if (!s || seen.has(id)) return false;
    seen.add(id);
    const pPr = child(s, "w:pPr");
    if (pPr && child(pPr, "w:numPr")) return true;
    const based = child(s, "w:basedOn");
    return based ? isList(based.getAttribute("w:val"), seen) : false;
  };
  for (const id of Object.keys(byId)) if (isList(id)) ids.add(id);
  return ids;
}

function paraText(p) {
  let t = "";
  const walk = (n) => {
    for (let c = n.firstChild; c; c = c.nextSibling) {
      if (c.nodeType !== 1) continue;
      if (c.nodeName === "w:t") t += c.textContent;
      else if (c.nodeName === "w:tab") t += "\t";
      else if (c.nodeName === "w:br") t += " ";
      else if (c.nodeName === "w:del" || c.nodeName === "w:pPr") continue;
      else walk(c);
    }
  };
  walk(p);
  return t;
}

function bulletKind(p, listIds) {
  const pPr = child(p, "w:pPr");
  if (pPr) {
    const numPr = child(pPr, "w:numPr");
    if (numPr) {
      const numId = child(numPr, "w:numId");
      // numId 0 means "numbering explicitly turned off", even if the style has it
      const off = numId && numId.getAttribute("w:val") === "0";
      if (!off) return "list";
    } else {
      const style = child(pPr, "w:pStyle");
      // Headings often carry outline numbering in their style; those are not bullets.
      const sid = style && style.getAttribute("w:val");
      if (sid && listIds.has(sid) && !/^heading|title/i.test(sid)) return "list";
    }
  }
  if (FAKE_BULLET.test(paraText(p))) return "fake";
  return null;
}

async function load(buffer) {
  const zip = await JSZip.loadAsync(buffer);
  const xml = await zip.file("word/document.xml").async("string");
  const stylesFile = zip.file("word/styles.xml");
  const stylesXml = stylesFile ? await stylesFile.async("string") : null;
  const doc = new DOMParser().parseFromString(xml, "text/xml");
  // Body paragraphs in document order, skipping text boxes and nested paragraphs.
  const paras = Array.from(doc.getElementsByTagName("w:p")).filter(
    (p) => !hasAncestor(p, ["w:txbxContent", "w:p", "mc:Fallback"])
  );
  return { zip, doc, paras, listIds: listStyleIds(stylesXml) };
}

// Returns groups of consecutive bullets, each labeled by the lines above it.
async function parse(buffer) {
  const { paras, listIds } = await load(buffer);
  const groups = [];
  let current = null;
  let recentLines = [];
  paras.forEach((p, i) => {
    const text = paraText(p).trim();
    const kind = bulletKind(p, listIds);
    if (kind && text) {
      if (!current) {
        current = { label: recentLines.slice(-2).join(" | ") || "Untitled", bullets: [] };
        groups.push(current);
        recentLines = [];
      }
      current.bullets.push({ index: i, kind, text: text.replace(FAKE_BULLET, "").trim() });
    } else if (text) {
      current = null;
      recentLines.push(text.replace(/\s+/g, " "));
      if (recentLines.length > 2) recentLines.shift();
    }
    // Blank lines don't break a group.
  });
  return { paragraphCount: paras.length, groups };
}

function setText(doc, p, text, kind) {
  // Keep paragraph properties and the first run's formatting; replace everything else.
  const pPr = child(p, "w:pPr");
  const firstRun = p.getElementsByTagName("w:r")[0];
  const rPr = firstRun ? child(firstRun, "w:rPr") : null;
  let prefix = "";
  let gap = "";
  if (kind === "fake") {
    const m = paraText(p).match(FAKE_BULLET);
    if (m) {
      prefix = m[1];
      gap = m[2] || " ";
    }
  }
  for (let c = p.firstChild; c; ) {
    const next = c.nextSibling;
    if (c !== pPr) p.removeChild(c);
    c = next;
  }
  const run = doc.createElementNS(W, "w:r");
  if (rPr) run.appendChild(rPr.cloneNode(true));
  const addText = (s) => {
    const t = doc.createElementNS(W, "w:t");
    t.setAttributeNS(XML_NS, "xml:space", "preserve");
    t.appendChild(doc.createTextNode(s));
    run.appendChild(t);
  };
  if (prefix) {
    addText(prefix);
    if (gap.includes("\t")) run.appendChild(doc.createElementNS(W, "w:tab"));
    else addText(gap);
  }
  addText(text);
  p.appendChild(run);
}

function stripIds(p) {
  for (const el of [p, ...Array.from(p.getElementsByTagName("*"))]) {
    if (el.removeAttribute) {
      el.removeAttribute("w14:paraId");
      el.removeAttribute("w14:textId");
    }
  }
}

// plan: [{ indices: [paragraph indexes of the original group], texts: [new bullets in order] }]
async function rebuild(buffer, plan) {
  const { zip, doc, paras, listIds } = await load(buffer);
  for (const g of plan) {
    const originals = g.indices.map((i) => paras[i]).filter(Boolean);
    if (!originals.length) continue;
    const kinds = originals.map((p) => bulletKind(p, listIds) || "list");
    const texts = g.texts.filter((t) => t && t.trim());
    const n = Math.min(originals.length, texts.length);
    for (let i = 0; i < n; i++) setText(doc, originals[i], texts[i].trim(), kinds[i]);
    // Extra bullets: clone the last kept bullet and insert after it.
    let anchor = originals[Math.max(n - 1, 0)];
    for (let i = n; i < texts.length; i++) {
      const clone = anchor.cloneNode(true);
      stripIds(clone);
      setText(doc, clone, texts[i].trim(), kinds[kinds.length - 1]);
      anchor.parentNode.insertBefore(clone, anchor.nextSibling);
      anchor = clone;
    }
    // Fewer bullets: remove the leftovers (a table cell must keep one paragraph).
    for (let i = texts.length; i < originals.length; i++) {
      const p = originals[i];
      const parent = p.parentNode;
      if (parent.nodeName === "w:tc" && children(parent, "w:p").length === 1) setText(doc, p, "", "list");
      else parent.removeChild(p);
    }
  }
  let xml = new XMLSerializer().serializeToString(doc);
  // Browsers drop the XML declaration when serializing; Word expects it.
  if (!xml.startsWith("<?xml")) xml = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\r\n' + xml;
  zip.file("word/document.xml", xml);
  return zip.generateAsync({
    type: "uint8array", compression: "DEFLATE",
    mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  });
}

const api = { parse, rebuild };
if (isBrowser) root.BulletDocx = api;
else module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
