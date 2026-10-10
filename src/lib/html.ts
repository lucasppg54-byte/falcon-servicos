const ENTIDADES: Record<string, string> = {
  "&": String.fromCharCode(38, 97, 109, 112, 59),
  "<": String.fromCharCode(38, 108, 116, 59),
  ">": String.fromCharCode(38, 103, 116, 59),
  '"': String.fromCharCode(38, 113, 117, 111, 116, 59),
  "'": String.fromCharCode(38, 35, 51, 57, 59),
};

export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (ch) => ENTIDADES[ch] ?? ch);
}
