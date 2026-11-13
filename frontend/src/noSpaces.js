// Block unwanted spaces in all input fields (typed or pasted)
const STRICT = /pass|mobile|phone|email|otp|username|user_?name/i;
const isField = (el) => el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA");
const strict = (el) => el.tagName === "INPUT" && (["password", "tel", "email", "number"].includes(el.type) ||
  STRICT.test(`${el.name} ${el.id} ${el.placeholder} ${el.getAttribute("autocomplete") || ""} ${el.getAttribute("data-testid") || ""}`));
document.addEventListener("beforeinput", (e) => {
  const el = e.target;
  if (!isField(el) || e.inputType !== "insertText" || !e.data || !/\s/.test(e.data)) return;
  if (strict(el)) return e.preventDefault();
  const before = el.value.slice(0, el.selectionStart ?? 0);
  if (before === "" || /\s$/.test(before)) e.preventDefault();
}, true);
document.addEventListener("paste", (e) => {
  const el = e.target;
  if (!isField(el)) return;
  const t = (e.clipboardData || window.clipboardData).getData("text");
  const clean = strict(el) ? t.replace(/\s+/g, "") : t.trim().replace(/ {2,}/g, " ");
  if (clean === t) return;
  e.preventDefault();
  document.execCommand("insertText", false, clean);
}, true);
