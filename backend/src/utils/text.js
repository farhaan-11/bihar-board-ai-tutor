// One whitespace cleaner for the whole backend. The same line used to be
// copy-pasted in five files under two different names.
export const cleanText = (value) => String(value || '').replace(/\s+/g, ' ').trim();
