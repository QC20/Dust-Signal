// Block letters (figlet "standard" style), composed at runtime so the rows always line up.
const L: Record<string, string[]> = {
  D: [' ____  ', '|  _ \\ ', '| | | |', '| |_| |', '|____/ '],
  U: [' _   _ ', '| | | |', '| | | |', '| |_| |', ' \\___/ '],
  S: [' ____  ', '/ ___| ', '\\___ \\ ', ' ___) |', '|____/ '],
  T: [' _____ ', '|_   _|', '  | |  ', '  | |  ', '  |_|  '],
  I: [' ___ ', '|_ _|', ' | | ', ' | | ', '|___|'],
  G: ['  ____ ', ' / ___|', '| |  _ ', '| |_| |', ' \\____|'],
  N: [' _   _ ', '| \\ | |', '|  \\| |', '| |\\  |', '|_| \\_|'],
  A: ['    _    ', '   / \\   ', '  / _ \\  ', ' / ___ \\ ', '/_/   \\_\\'],
  L: [' _     ', '| |    ', '| |    ', '| |___ ', '|_____|'],
  ' ': ['   ', '   ', '   ', '   ', '   '],
};

function compose(word: string): string[] {
  const rows = ['', '', '', '', ''];
  for (const ch of word) {
    const g = L[ch] ?? L[' '];
    for (let r = 0; r < 5; r++) rows[r] += g[r];
  }
  return rows.map((r) => r.replace(/\s+$/, ''));
}

export const LOGO: string[] = compose('DUST SIGNAL');
export const LOGO_WIDTH = Math.max(...LOGO.map((r) => r.length));
