/* Finds the bullet points in a LaTeX resume (Overleaf source) and writes changed bullets back.
   Same shape as docx.js: parse(text) -> { groups: [{ label, bullets: [{ index, text }] }] },
   rebuild(text, plan) -> text, where plan is [{ texts }] per group, in order.
   Works with \resumeItem{...} (Jake's resume and its copies) and plain \item lists.
   Browser: window.BulletTex. Node: module.exports. */
(function (root) {
  const LIST_START = /(\\resumeItemListStart|\\begin\{(?:itemize|enumerate|cvitems|highlights)\}(?:\[[^\]]*\])?)\s*$/;
  const LIST_END = /^\s*(\\resumeItemListEnd|\\end\{(?:itemize|enumerate|cvitems|highlights)\})/;
  // Commands that are formatting, not an experience heading.
  const NOT_HEADINGS = new Set(("item resumeItem begin end textbf textit emph underline href url small large Large LARGE " +
    "huge Huge scshape textsc vspace hspace hfill newline color textcolor fontsize setlength section subsection " +
    "subsubsection includegraphics faIcon raisebox makebox parbox").split(" "));

  // Same length as src, with % comments turned into spaces, so positions line up with the original.
  function blankComments(src) {
    let out = "";
    for (let i = 0; i < src.length; i++) {
      const c = src[i];
      if (c === "\\") { out += src.slice(i, i + 2); i++; continue; }
      if (c === "%") {
        let end = src.indexOf("\n", i);
        if (end < 0) end = src.length;
        out += " ".repeat(end - i);
        i = end - 1;
        continue;
      }
      out += c;
    }
    return out;
  }
  // Index just past the } that closes the { at p, or -1.
  function groupEnd(s, p) {
    let d = 0;
    for (let i = p; i < s.length; i++) {
      const c = s[i];
      if (c === "\\") { i++; continue; }
      if (c === "{") d++;
      else if (c === "}") { d--; if (d === 0) return i + 1; }
    }
    return -1;
  }
  const skipWs = (s, p) => { while (p < s.length && /\s/.test(s[p])) p++; return p; };
  // Up to max {...} arguments starting at p (an optional [...] is skipped).
  function readArgs(s, p, max) {
    const list = [];
    let q = p;
    while (list.length < max) {
      let r = skipWs(s, q);
      if (s[r] === "[" && !list.length) {
        const e = s.indexOf("]", r);
        if (e < 0) break;
        r = skipWs(s, e + 1);
      }
      if (s[r] !== "{") break;
      const e = groupEnd(s, r);
      if (e < 0) break;
      list.push({ start: r, end: e });
      q = e;
    }
    return { list, end: q };
  }

  // What the user sees and edits: LaTeX with the common escapes undone (\% -> %), on one line.
  const toPlain = (tex) => tex.replace(/\s+/g, " ").trim().replace(/\\([%&$#_])/g, "$1");
  // Back to LaTeX. "$16" is money and gets escaped; "$\sim$" is math and is left alone.
  function toTex(t) {
    let o = "", math = false;
    for (let i = 0; i < t.length; i++) {
      const c = t[i], esc = t[i - 1] === "\\";
      if ("%&#_".includes(c) && !esc && !math) o += "\\" + c;
      else if (c === "$" && !esc) {
        if (math) { math = false; o += c; }
        else if (/\d/.test(t[i + 1] || "")) o += "\\$";
        else { math = true; o += c; }
      } else o += c;
    }
    return o;
  }
  const norm = (t) => (t || "").replace(/\s+/g, " ").trim();
  const labelText = (tex) => norm(toPlain(tex)
    .replace(/\\[a-zA-Z@]+\*?(\[[^\]]*\])?/g, " ")
    .replace(/[{}$~]/g, " ")
    .replace(/\\/g, ""));
  const isMeta = (t) => /\b(19|20)\d{2}\b|\bpresent\b|\bcurrent\b/i.test(t) ||
    /^[A-Z][\w .'-]*,\s*[A-Z]{2,}\.?$/.test(t) || /^remote$/i.test(t);

  function analyze(src) {
    const clean = blankComments(src);
    const bodyAt = Math.max(0, clean.indexOf("\\begin{document}"));
    const arityM = clean.match(/\\(?:re)?newcommand\*?\s*\{?\\resumeItem\}?\s*\[(\d)\]/);
    const arity = arityM ? +arityM[1] : 1;

    // 1. Every bullet: \resumeItem{...}, \item{...} or \item text-until-the-next-item.
    const items = [];
    const re = /\\(resumeItem|item)(?![a-zA-Z@])/g;
    re.lastIndex = bodyAt;
    let m;
    while ((m = re.exec(clean))) {
      const start = m.index, p = m.index + m[0].length;
      let it = null;
      if (m[1] === "resumeItem") {
        const a = readArgs(clean, p, arity);
        if (a.list.length === arity) {
          const last = a.list[arity - 1];
          it = { start, end: last.end, cs: last.start + 1, ce: last.end - 1, kind: "resumeItem" };
        }
      } else {
        let q = skipWs(clean, p);
        if (clean[q] === "[") { const e = clean.indexOf("]", q); if (e > 0) q = skipWs(clean, e + 1); }
        if (clean[q] === "{") {
          const e = groupEnd(clean, q);
          if (e > 0 && /^\s*(\\item(?![a-zA-Z])|\\end\b|\\resumeItemListEnd|\}|$)/.test(clean.slice(e, e + 60)))
            it = { start, end: e, cs: q + 1, ce: e - 1, kind: "item" };
        }
        if (!it) {
          let d = 0, i = q;
          for (; i < clean.length; i++) {
            const c = clean[i];
            if (c === "\\") {
              if (d === 0 && /^\\(item(?![a-zA-Z])|end\b|resumeItemListEnd)/.test(clean.slice(i, i + 24))) break;
              i++;
              continue;
            }
            if (c === "{") d++;
            else if (c === "}") { if (d === 0) break; d--; }
          }
          let e = i;
          while (e > q && /\s/.test(clean[e - 1])) e--;
          it = { start, end: e, cs: q, ce: e, kind: "item" };
        }
      }
      if (!it) continue;
      const body = clean.slice(it.cs, it.ce);
      // Skill lines (with \\ breaks) and items holding a nested list aren't bullets to swap.
      it.skip = !body.trim() || /\\\\|\\item(?![a-zA-Z])|\\begin\{/.test(body);
      it.text = toPlain(body);
      items.push(it);
      if (!(it.skip && it.kind === "item")) re.lastIndex = it.end;
    }

    // 2. Bullets next to each other (only spaces or comments between) form one list.
    const groups = [];
    let cur = null;
    for (const it of items) {
      if (it.skip) { cur = null; continue; }
      if (cur && !clean.slice(cur.items[cur.items.length - 1].end, it.start).trim()) cur.items.push(it);
      else { cur = { items: [it] }; groups.push(cur); }
    }

    // 3. Name each list after its section and the heading just above it (e.g. \resumeSubheading).
    const seen = new Map();
    for (const g of groups) {
      const first = g.items[0], last = g.items[g.items.length - 1];
      const before = clean.slice(bodyAt, first.start);
      let section = "", secAt = 0, sm;
      const sre = /\\section\*?\s*\{/g;
      while ((sm = sre.exec(before))) {
        const e = groupEnd(before, sm.index + sm[0].length - 1);
        if (e > 0) { section = labelText(before.slice(sm.index + sm[0].length, e - 1)); secAt = e; }
      }
      let heading = null, cm;
      const cre = /\\([a-zA-Z@]+)\*?/g;
      cre.lastIndex = secAt;
      while ((cm = cre.exec(before))) {
        if (NOT_HEADINGS.has(cm[1])) continue;
        const a = readArgs(before, cm.index + cm[0].length, 6);
        if (a.list.length >= 2) {
          heading = a.list.map((x) => labelText(before.slice(x.start + 1, x.end - 1)));
          cre.lastIndex = a.end;
        }
      }
      let title = section || "Bullets";
      if (heading) {
        const kept = heading.filter((t) => t && !isMeta(t));
        title = (kept.length ? kept : heading.filter(Boolean)).join(" · ") || title;
      }
      let label = section && title !== section ? section.toUpperCase() + " | " + title : title;
      const n = (seen.get(label) || 0) + 1;
      seen.set(label, n);
      if (n > 1) label += ` (${n})`;
      g.label = label;

      const lb = clean.slice(0, first.start).match(LIST_START);
      const la = clean.slice(last.end).match(LIST_END);
      if (lb && la) { g.listStart = lb.index; g.listEnd = last.end + la[0].length; }
    }
    return { arity, groups };
  }

  function parse(src) {
    return {
      groups: analyze(src).groups.map((g) => ({
        label: g.label,
        bullets: g.items.map((it, index) => ({ index, text: it.text })),
      })),
    };
  }

  function rebuild(src, plan) {
    const { arity, groups } = analyze(src);
    const edits = [];
    groups.forEach((g, gi) => {
      const texts = plan[gi] && plan[gi].texts;
      if (!texts) return;
      const first = g.items[0], last = g.items[g.items.length - 1];
      const lineStart = src.lastIndexOf("\n", first.start - 1) + 1;
      const lead = src.slice(lineStart, first.start);
      const indent = /^[ \t]*$/.test(lead) ? lead : "";
      const gap = g.items.length > 1 ? src.slice(first.end, g.items[1].start) : "";
      const sep = gap && !gap.trim() ? gap : "\n" + indent;
      // Commented-out lines inside the list (old bullets people keep around) are kept, after the bullets.
      const comments = (src.slice(first.start, last.end).match(/^[ \t]*%.*$/gm) || []).map((c) => c.trim());
      // Unchanged bullets are written back exactly as they were.
      const orig = new Map(g.items.map((it) => [it.text, src.slice(it.start, it.end)]));
      const pre = first.kind === "resumeItem" ? "\\resumeItem" + "{}".repeat(arity - 1) + "{" : src.slice(first.start, first.cs);
      const post = first.kind === "resumeItem" ? "}" : src.slice(first.ce, first.end);
      const out = texts.map((t) => orig.get(norm(t)) ?? pre + toTex(norm(t)) + post);
      if (!out.length && g.listStart != null) {
        // An empty list is a LaTeX error, so drop the list itself.
        edits.push({ s: g.listStart, e: g.listEnd, body: comments.join("\n" + indent) });
      } else {
        edits.push({ s: first.start, e: last.end, body: [...out, ...comments].join(sep) });
      }
    });
    edits.sort((a, b) => b.s - a.s);
    let res = src;
    for (const ed of edits) res = res.slice(0, ed.s) + ed.body + res.slice(ed.e);
    return res;
  }

  const api = { parse, rebuild, toPlain, toTex };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.BulletTex = api;
})(typeof window !== "undefined" ? window : globalThis);
