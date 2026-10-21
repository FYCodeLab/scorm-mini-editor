import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import DOMPurify from "dompurify";
import { importZip, exportZip, buildPreviewHtml, listLocalImages, listExternalImages, refreshFile, type ScormPackage } from "./lib/scormPackage";
import { applyEdits, type ImageRef } from "./lib/editables";
import { buildSampleZip } from "./lib/sample";
import { safePath, svgLooksSafe } from "./lib/security";
import RichTextEditor from "./components/RichTextEditor";

type Mode = "edit" | "preview";
type LeftTab = "pages" | "images" | "external";
interface HistoryEntry { file: string; before: string; after: string; label: string; }
const sanitizeRich = (html: string) => DOMPurify.sanitize(html, { ALLOWED_TAGS: ["b","strong","i","em","u","span","p","br","h2","h3","h4","ul","ol","li","a"], ALLOWED_ATTR: ["style","href","target"], FORBID_TAGS: ["script","style","iframe","form","img"] });

export default function App() {
  const [pkg, setPkg] = useState<ScormPackage | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<Mode>("edit");
  const [leftTab, setLeftTab] = useState<LeftTab>("pages");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [search, setSearch] = useState("");
  const [scormLog, setScormLog] = useState<string[]>([]);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [previewKey, setPreviewKey] = useState(0);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [redoStack, setRedoStack] = useState<HistoryEntry[]>([]);
  const [dragOver, setDragOver] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const replaceInput = useRef<HTMLInputElement>(null);
  const [replaceTarget, setReplaceTarget] = useState<ImageRef | string | null>(null);
  const blobUrls = useRef<string[]>([]);

  const selectedBlock = useMemo(() => pkg?.blocks.find((b) => b.id === selectedId), [pkg, selectedId]);
  useEffect(() => { if (selectedBlock) setDraft(selectedBlock.value); }, [selectedBlock?.id]); // eslint-disable-line

  useEffect(() => {
    const handler = (e: MessageEvent) => {
      if (e.data?.type === "scorm") setScormLog((l) => [...l.slice(-19), `${e.data.event}${e.data.key ? `: ${e.data.key} = ${String(e.data.value).slice(0, 80)}` : ""}`]);
      else if (e.data?.type === "editor-select" && typeof e.data.text === "string") {
        const text = e.data.text.trim();
        const hit = pkg?.blocks.find((b) => b.value.trim() && (text.includes(b.value.trim().slice(0, 60)) || b.value.trim().slice(0, 60).includes(text.slice(0, 60))));
        if (hit) { setSelectedId(hit.id); setMode("edit"); setNotice(`Selected: ${hit.label}`); }
      }
    };
    window.addEventListener("message", handler);
    return () => window.removeEventListener("message", handler);
  }, [pkg]);
  useEffect(() => () => { blobUrls.current.forEach((u) => URL.revokeObjectURL(u)); }, []);

  const loadBlob = useCallback(async (blob: Blob, name: string) => {
    setBusy(true); setError(null); setNotice(null);
    try {
      const p = await importZip(await blob.arrayBuffer(), name);
      setPkg(p); setHistory([]); setRedoStack([]); setScormLog([]);
      setSelectedId(p.blocks[0]?.id ?? null); setMode("edit");
      if (p.warnings.length) setNotice(`Imported with warnings: ${p.warnings.join(" ")}`);
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  }, []);

  const onDropFile = (f: File) => { if (!/\.zip$/i.test(f.name)) { setError("Please choose a .zip file."); return; } void loadBlob(f, f.name); };

  const buildPreview = useCallback(async () => {
    if (!pkg) return;
    blobUrls.current.forEach((u) => URL.revokeObjectURL(u)); blobUrls.current = [];
    try {
      const html = await buildPreviewHtml(pkg, (u) => blobUrls.current.push(u));
      const url = URL.createObjectURL(new Blob([html], { type: "text/html" }));
      blobUrls.current.push(url); setPreviewUrl(url); setPreviewKey((k) => k + 1);
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
  }, [pkg]);
  useEffect(() => { if (mode === "preview") void buildPreview(); }, [mode, buildPreview]);

  const applyBlockEdit = () => {
    if (!pkg || !selectedBlock) return;
    const file = pkg.files.get(selectedBlock.file); if (!file?.text) return;
    const value = selectedBlock.rich ? sanitizeRich(draft) : draft;
    if (value === selectedBlock.value) { setNotice("No change to apply."); return; }
    try {
      const nextText = applyEdits(file.text, [{ start: selectedBlock.start, end: selectedBlock.end, value, rich: selectedBlock.rich, quote: selectedBlock.quote, js: selectedBlock.js }]);
      const updated = new Map(pkg.files);
      updated.set(selectedBlock.file, { ...file, text: nextText, blob: new Blob([nextText], { type: "text/html" }) });
      const nextPkg = refreshFile({ ...pkg, files: updated }, selectedBlock.file);
      setHistory((h) => [...h, { file: selectedBlock.file, before: file.text!, after: nextText, label: selectedBlock.label }]);
      setRedoStack([]); setPkg(nextPkg);
      const reFound = nextPkg.blocks.find((b) => b.label === selectedBlock.label && b.value === value) ?? nextPkg.blocks.find((b) => b.label === selectedBlock.label);
      setSelectedId(reFound?.id ?? null); setNotice(`Applied: ${selectedBlock.label}`);
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
  };

  const restore = (entry: HistoryEntry, to: "before" | "after") => {
    if (!pkg) return;
    const file = pkg.files.get(entry.file); if (!file) return;
    const text = to === "before" ? entry.before : entry.after;
    const updated = new Map(pkg.files);
    updated.set(entry.file, { ...file, text, blob: new Blob([text], { type: "text/html" }) });
    setPkg(refreshFile({ ...pkg, files: updated }, entry.file));
  };
  const undo = () => { if (!pkg || !history.length) return; const e = history[history.length - 1]; restore(e, "before"); setHistory(history.slice(0, -1)); setRedoStack((r) => [...r, e]); };
  const redo = () => { if (!pkg || !redoStack.length) return; const e = redoStack[redoStack.length - 1]; restore(e, "after"); setRedoStack(redoStack.slice(0, -1)); setHistory((h) => [...h, e]); };

  const doExport = async () => {
    if (!pkg) return; setBusy(true);
    try {
      const blob = await exportZip(pkg);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a"); a.href = url; a.download = pkg.name.replace(/\.zip$/i, "") + "-edited.zip"; a.click();
      setTimeout(() => URL.revokeObjectURL(url), 5000);
      setNotice("Exported ZIP downloaded. It does not overwrite your original file.");
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  };

  const handleReplaceFile = async (f: File) => {
    if (!pkg || !replaceTarget) return;
    if (!/\.(png|jpe?g|gif|webp|svg|avif)$/i.test(f.name)) { setError("Choose a PNG, JPEG, GIF, WebP, SVG or AVIF image."); return; }
    if (f.size > 20 * 1024 * 1024) { setError("Image is larger than 20 MB."); return; }
    if (/\.svg$/i.test(f.name) && !svgLooksSafe(await f.text())) { setError("This SVG contains scripts or event handlers and was rejected for safety."); return; }
    const updated = new Map(pkg.files);
    if (typeof replaceTarget === "string") {
      updated.set(replaceTarget, { path: replaceTarget, text: null, blob: f, isBinary: true });
      setPkg({ ...pkg, files: updated }); setNotice(`Replaced ${replaceTarget}. The file name is unchanged, so references still work.`);
    } else {
      const target = replaceTarget;
      if (target.local) {
        const resolved = target.src.startsWith("/") ? target.src.slice(1) : target.src;
        const path = pkg.files.has(resolved) ? resolved : [...pkg.files.keys()].find((k) => k.endsWith("/" + resolved)) ?? resolved;
        updated.set(path, { path, text: null, blob: f, isBinary: true });
        setPkg({ ...pkg, files: updated }); setNotice(`Replaced ${target.src}.`);
      } else {
        let filename = (safePath(f.name) ?? "replacement.png").split("/").pop()!;
        let n = 1;
        while (updated.has(filename)) { const dot = filename.lastIndexOf("."); filename = `${filename.slice(0, dot)}-${n}${filename.slice(dot)}`; n++; }
        updated.set(filename, { path: filename, text: null, blob: f, isBinary: true });
        const filesToFix = new Set(pkg.images.filter((im) => im.src === target.src).map((im) => im.file));
        for (const hf of filesToFix) {
          const hfFile = updated.get(hf); if (!hfFile?.text) continue;
          const refs = pkg.images.filter((im) => im.file === hf && im.src === target.src).sort((a, b) => b.start - a.start);
          let text = hfFile.text;
          for (const r of refs) text = text.slice(0, r.start) + filename + text.slice(r.end);
          updated.set(hf, { ...hfFile, text, blob: new Blob([text], { type: "text/html" }) });
        }
        const nextPkg = refreshFile({ ...pkg, files: updated }, target.file);
        const mf = nextPkg.files.get("imsmanifest.xml");
        if (mf?.text && !mf.text.includes(`href="${filename}"`)) {
          const patched = mf.text.replace(/(<\/resource>)/i, `  <file href="${filename}"/>\n$1`);
          if (patched !== mf.text) nextPkg.files.set("imsmanifest.xml", { ...mf, text: patched, blob: new Blob([patched], { type: "text/xml" }) });
        }
        setPkg(nextPkg); setNotice(`External image replaced with local file ${filename}. The original URL is gone from the course HTML.`);
      }
    }
    setReplaceTarget(null);
  };

  const makeLocal = async (url: string) => {
    if (!pkg) return; setBusy(true); setError(null);
    try {
      const res = await fetch(url, { mode: "cors" });
      if (!res.ok) throw new Error(`Server returned ${res.status}.`);
      const blob = await res.blob();
      if (!blob.type.startsWith("image/")) throw new Error("Not an image.");
      const base = decodeURIComponent(url.split("?")[0].split("/").pop() || "image.png");
      const target = pkg.images.find((im) => im.src === url);
      if (target) { setReplaceTarget(target); await handleReplaceFile(new File([blob], safePath(base) ?? "image.png", { type: blob.type })); }
    } catch {
      setError(`Could not download ${url}: the hosting site does not allow cross-origin downloads (CORS), or it blocked the request. You can still replace it by uploading a file you own — click “Replace with upload”. No restriction was bypassed.`);
    } finally { setBusy(false); }
  };

  const filteredBlocks = useMemo(() => {
    if (!pkg) return [];
    const q = search.trim().toLowerCase();
    return pkg.blocks.filter((b) => !q || b.label.toLowerCase().includes(q) || b.value.toLowerCase().includes(q));
  }, [pkg, search]);
  const localImages = pkg ? listLocalImages(pkg) : [];
  const externalImages = pkg ? listExternalImages(pkg) : [];

  if (!pkg) {
    return (
      <div className="min-h-screen bg-slate-50 text-slate-800">
        <header className="bg-teal-900 text-white px-6 py-5">
          <h1 className="text-2xl font-bold">SCORM Mini Editor</h1>
          <p className="text-teal-100">Free, browser-based WYSIWYG editor for SCORM ZIP courses. No account, no upload to a server — everything runs on your computer.</p>
        </header>
        <main className="max-w-3xl mx-auto px-4 py-8">
          {error && <div className="mb-4 rounded border border-red-300 bg-red-50 p-3 text-red-800">{error}</div>}
          <div className={`rounded-xl border-2 border-dashed p-10 text-center ${dragOver ? "border-teal-600 bg-teal-50" : "border-slate-300 bg-white"}`}
            onDragOver={(e) => { e.preventDefault(); setDragOver(true); }} onDragLeave={() => setDragOver(false)}
            onDrop={(e) => { e.preventDefault(); setDragOver(false); const f = e.dataTransfer.files[0]; if (f) onDropFile(f); }}>
            <p className="text-lg font-semibold">Import a SCORM ZIP</p>
            <p className="text-slate-500 my-2">Drag a .zip here, or choose a file. The manifest, launch page, images and tracking code are preserved.</p>
            <input ref={fileInput} type="file" accept=".zip" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) onDropFile(f); }} />
            <button className="mt-2 rounded bg-teal-700 px-5 py-2.5 text-white font-semibold" onClick={() => fileInput.current?.click()} disabled={busy}>{busy ? "Importing…" : "Import SCORM ZIP"}</button>
            <div className="mt-3"><button className="text-teal-700 underline" onClick={async () => { const b = await buildSampleZip(); void loadBlob(b, "sample-scorm.zip"); }}>Or try the built-in demo course (no file needed)</button></div>
          </div>
          <section className="mt-8 grid gap-4 sm:grid-cols-2 text-sm">
            <div className="rounded border bg-white p-4"><h2 className="font-bold mb-1">What you can edit</h2><p>Static page text (bold, colour, size, lists), JavaScript-generated lesson text where the course stores it as data (titles, quiz items, summaries), and local or external images.</p></div>
            <div className="rounded border bg-white p-4"><h2 className="font-bold mb-1">What stays untouched</h2><p>imsmanifest.xml (except one documented case: a newly added local image is listed as a file), all unmodified files, interactive activities and SCORM tracking code.</p></div>
            <div className="rounded border bg-white p-4"><h2 className="font-bold mb-1">Preview is not an LMS</h2><p>Preview runs the course in a sandboxed iframe with a simulated SCORM API. Always test the exported ZIP in your real LMS (e.g. Moodle) before publishing to learners.</p></div>
            <div className="rounded border bg-white p-4"><h2 className="font-bold mb-1">Privacy</h2><p>Your ZIP never leaves this browser tab. It is not uploaded to GitHub or any server.</p></div>
          </section>
          <p className="mt-6 text-xs text-slate-500">Supports SCORM 1.2 and SCORM 2004 packages whose launch page is HTML. Courses that are a single compiled binary, Flash, or a proprietary player cannot be edited safely and will be reported as unsupported instead of being corrupted. See the README for the full limitations list.</p>
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 text-slate-800 flex flex-col">
      <header className="bg-teal-900 text-white px-4 py-3 flex flex-wrap gap-2 items-center">
        <div className="mr-2"><div className="font-bold leading-tight">SCORM Mini Editor</div><div className="text-xs text-teal-200">{pkg.name} · {pkg.manifest.scormVersion === "unknown" ? "SCORM (version not detected)" : `SCORM ${pkg.manifest.scormVersion}`} · {pkg.manifest.orgTitle ?? pkg.manifest.launchHref}</div></div>
        <input ref={fileInput} type="file" accept=".zip" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) onDropFile(f); }} />
        <button className="rounded bg-teal-700 px-3 py-1.5 text-sm" onClick={() => fileInput.current?.click()}>Import ZIP</button>
        <button className="rounded bg-white text-teal-900 px-3 py-1.5 text-sm font-semibold" onClick={doExport} disabled={busy}>Export SCORM ZIP</button>
        <button className="rounded border border-teal-300 px-3 py-1.5 text-sm disabled:opacity-50" onClick={undo} disabled={history.length === 0}>↩ Undo</button>
        <button className="rounded border border-teal-300 px-3 py-1.5 text-sm disabled:opacity-50" onClick={redo} disabled={redoStack.length === 0}>↪ Redo</button>
        <div className="flex rounded overflow-hidden border border-teal-300 text-sm ml-auto">
          <button className={`px-3 py-1.5 ${mode === "edit" ? "bg-white text-teal-900 font-semibold" : ""}`} onClick={() => setMode("edit")}>Edit</button>
          <button className={`px-3 py-1.5 ${mode === "preview" ? "bg-white text-teal-900 font-semibold" : ""}`} onClick={() => setMode("preview")}>Preview</button>
        </div>
        <button className="rounded border border-red-300 px-3 py-1.5 text-sm" onClick={() => { setPkg(null); setSelectedId(null); }}>Close course</button>
      </header>
      {error && <div className="mx-4 mt-3 rounded border border-red-300 bg-red-50 p-3 text-red-800">{error} <button className="underline ml-2" onClick={() => setError(null)}>Dismiss</button></div>}
      {notice && <div className="mx-4 mt-3 rounded border border-teal-300 bg-teal-50 p-3 text-teal-900">{notice} <button className="underline ml-2" onClick={() => setNotice(null)}>Dismiss</button></div>}
      {pkg.warnings.length > 0 && <div className="mx-4 mt-3 rounded border border-amber-300 bg-amber-50 p-3 text-amber-900 text-sm">Warnings: {pkg.warnings.join(" ")}</div>}
      <div className="flex flex-1 flex-col lg:flex-row gap-3 p-3 min-h-0">
        <aside className="lg:w-80 shrink-0 rounded border bg-white p-3 flex flex-col max-h-[70vh] lg:max-h-none">
          <div className="flex gap-1 text-sm mb-2">
            {(["pages", "images", "external"] as LeftTab[]).map((t) => (
              <button key={t} className={`flex-1 rounded px-2 py-1.5 ${leftTab === t ? "bg-teal-700 text-white" : "bg-slate-100"}`} onClick={() => setLeftTab(t)}>
                {t === "pages" ? `Text (${pkg.blocks.length})` : t === "images" ? `Images (${localImages.length})` : `External (${externalImages.length})`}
              </button>
            ))}
          </div>
          {leftTab === "pages" && (<>
            <input className="rounded border px-2 py-1.5 text-sm mb-2" placeholder="Search text…" value={search} onChange={(e) => setSearch(e.target.value)} />
            <div className="overflow-auto flex-1 space-y-1">
              {filteredBlocks.map((b) => (
                <button key={b.id} className={`block w-full text-left rounded px-2 py-1.5 text-sm ${b.id === selectedId ? "bg-teal-100 ring-1 ring-teal-600" : "hover:bg-slate-100"}`} onClick={() => { setSelectedId(b.id); setMode("edit"); }}>
                  <span className="block font-semibold text-xs text-slate-500">{b.label}</span>
                  <span className="block truncate">{b.value.replace(/<[^>]+>/g, "")}</span>
                </button>
              ))}
              {filteredBlocks.length === 0 && <p className="text-sm text-slate-500">No editable text found. Static HTML text and the tasks/syntheses data of single-page JS courses are supported; template HTML inside JavaScript is not edited blindly.</p>}
            </div>
          </>)}
          {leftTab === "images" && (<div className="overflow-auto flex-1 space-y-2">
            {localImages.map((path) => (<div key={path} className="rounded border p-2 text-sm"><div className="font-mono text-xs break-all">{path}</div><button className="mt-1 rounded bg-teal-700 px-2 py-1 text-white text-xs" onClick={() => { setReplaceTarget(path); replaceInput.current?.click(); }}>Replace image</button></div>))}
            {localImages.length === 0 && <p className="text-sm text-slate-500">No local images in this package.</p>}
            <p className="text-xs text-slate-500">Replacing a local image keeps its file name, so every reference still works.</p>
          </div>)}
          {leftTab === "external" && (<div className="overflow-auto flex-1 space-y-2">
            {externalImages.map((url) => (<div key={url} className="rounded border p-2 text-sm"><div className="break-all text-xs">{url}</div><div className="flex gap-1 mt-1 flex-wrap">
              <button className="rounded bg-teal-700 px-2 py-1 text-white text-xs" onClick={() => { const t = pkg.images.find((im) => im.src === url); setReplaceTarget(t ?? url); replaceInput.current?.click(); }}>Replace with upload</button>
              <button className="rounded border px-2 py-1 text-xs" onClick={() => void makeLocal(url)} disabled={busy}>Make local (download)</button>
            </div></div>))}
            {externalImages.length === 0 && <p className="text-sm text-slate-500">No external images found.</p>}
            <p className="text-xs text-slate-500">“Make local” only works if the hosting site allows cross-origin downloads. If it fails, upload a file you have the right to use instead.</p>
          </div>)}
        </aside>
        <main className="flex-1 rounded border bg-white p-3 min-w-0">
          {mode === "preview" ? (<>
            <p className="text-sm text-slate-500 mb-2">Preview runs in a sandboxed iframe (scripts only, no access to this editor). Clicking course text tries to select the matching editable block. SCORM calls are simulated, not saved to an LMS.</p>
            {previewUrl && <iframe key={previewKey} title="Course preview" sandbox="allow-scripts" src={previewUrl} className="w-full h-[70vh] border rounded bg-white" />}
            <details className="mt-2 text-sm"><summary className="cursor-pointer font-semibold">SCORM API log (preview only)</summary><pre className="mt-1 max-h-40 overflow-auto bg-slate-50 p-2 rounded text-xs">{scormLog.length ? scormLog.join("\n") : "No SCORM calls yet."}</pre></details>
          </>) : selectedBlock ? (<>
            <h2 className="font-bold">{selectedBlock.label}</h2>
            <p className="text-sm text-slate-500 mb-1">File: {selectedBlock.file} · {selectedBlock.kind === "js-text" ? "Text stored in JavaScript course data — edited in place, without touching scoring keys or logic." : "Static HTML text."} {selectedBlock.rich ? "Formatting (bold, colour, size) is supported for this block." : "Plain text only: formatting tags would be shown literally by the course, so they are not offered here."}</p>
            {selectedBlock.kind === "js-text" && !selectedBlock.rich && <p className="text-xs bg-amber-50 border border-amber-200 rounded p-2 mb-2">This lesson text is generated by JavaScript at run time and is edited as plain text on purpose — the course escapes HTML here, so a &lt;b&gt; tag would appear as text to learners.</p>}
            {selectedBlock.rich ? <RichTextEditor value={draft} onChange={setDraft} /> : <textarea className="w-full min-h-[160px] rounded border p-3 text-[15px]" value={draft} onChange={(e) => setDraft(e.target.value)} />}
            <div className="flex gap-2 mt-3 flex-wrap">
              <button className="rounded bg-teal-700 px-4 py-2 text-white font-semibold" onClick={applyBlockEdit}>Apply change</button>
              <button className="rounded border px-4 py-2" onClick={() => setDraft(selectedBlock.value)}>Reset to current</button>
              <button className="rounded border px-4 py-2" onClick={() => setMode("preview")}>See in preview</button>
            </div>
            <p className="text-xs text-slate-500 mt-2">Original: {selectedBlock.original.slice(0, 200)}{selectedBlock.original.length > 200 ? "…" : ""}</p>
          </>) : (<p className="text-slate-500">Select a text block on the left to edit it, or switch to Preview to see the course as a learner would.</p>)}
        </main>
        <aside className="lg:w-64 shrink-0 rounded border bg-white p-3 text-sm space-y-2">
          <h2 className="font-bold">Package</h2>
          <p><b>Manifest ID:</b> {pkg.manifest.identifier ?? "—"}</p>
          <p><b>Launch file:</b> {pkg.manifest.launchHref ?? "—"}</p>
          <p><b>Files:</b> {pkg.fileList.length} ({pkg.htmlFiles.length} HTML)</p>
          <p><b>Editable text blocks:</b> {pkg.blocks.length}</p>
          <p><b>Local images:</b> {localImages.length} · <b>External:</b> {externalImages.length}</p>
          <details><summary className="cursor-pointer font-semibold">All files</summary><ul className="mt-1 space-y-0.5 text-xs font-mono break-all">{pkg.fileList.map((f) => <li key={f}>{f}</li>)}</ul></details>
          <details><summary className="cursor-pointer font-semibold">What cannot be edited here</summary><ul className="list-disc ml-4 mt-1 space-y-1 text-xs text-slate-600">
            <li>HTML generated inside JavaScript template strings (except tasks/syntheses/readPhotos data) — editing it by string replacement could break interactivity.</li>
            <li>Scoring keys, points and navigation logic — never exposed as editable text.</li>
            <li>SVG illustrations drawn by JavaScript code.</li>
            <li>Non-HTML launch content (Flash, compiled binaries).</li>
          </ul></details>
          <button className="w-full rounded bg-teal-700 px-3 py-2 text-white font-semibold" onClick={doExport}>Export SCORM ZIP</button>
        </aside>
      </div>
      <input ref={replaceInput} type="file" accept="image/png,image/jpeg,image/gif,image/webp,image/svg+xml,image/avif" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) void handleReplaceFile(f); e.target.value = ""; }} />
    </div>
  );
}
