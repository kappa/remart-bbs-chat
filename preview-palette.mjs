// node preview-palette.mjs > /tmp/remart-palette.html
// Compare the server palette, the original before b644e14, and published alternatives.
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('./server/index.js', import.meta.url), 'utf8');
const colors = JSON.parse(source.match(/const PARTICIPANT_COLORS = (\[[\s\S]*?\]);/)[1]);
const original = ['#00FFFF', '#FFFF00', '#FF00FF', '#00FF00', '#FF8000',
  '#80FF00', '#FF0080', '#00FF80', '#8080FF', '#FF8080'];
const palettes = [
  { name: 'Original', colors: original, note: 'The original ten colors, in assignment order.' },
  { name: 'Current hybrid', colors, note: 'The current server allocation order; rooms use at most ten colors.' },
  { name: 'ColorBrewer Set2', colors: ['#66C2A5', '#FC8D62', '#8DA0CB', '#E78AC3', '#A6D854', '#FFD92F', '#E5C494', '#B3B3B3'],
    note: 'Eight published colors. Softer orange, lime, and periwinkle-like tones.', url: 'https://d3js.org/d3-scale-chromatic/categorical#schemeSet2' },
  { name: 'Paul Tol Vibrant', colors: ['#EE7733', '#0077BB', '#33BBEE', '#EE3377', '#CC3311', '#009988', '#BBBBBB'],
    note: 'Seven published colors, in the author\'s default order. Designed with color-vision differences in mind.', url: 'https://sronpersonalpages.nl/~pault/' },
  { name: 'Colorcet Glasbey Light', colors: ['#D70000', '#028800', '#B600FF', '#06ACC6', '#98FF00', '#FFA530', '#FF8FC8', '#79525F', '#00FECF', '#B0A5FF'],
    note: 'First ten published colors. Light refers to the colors: this variant is intended for dark backgrounds.', url: 'https://colorcet.holoviz.org/user_guide/Categorical.html' },
  { name: 'Selected seed', colors: ['#A6D854', '#FFD92F', '#FC8D62', '#8080FF', '#00FFFF',
      '#E78AC3', '#8DA0CB', '#FF00FF', '#FF5555', '#FFFFFF', '#66C2A5'],
    note: 'Your eleven selected colors, in the approved order.' },
  // Glasbey 0.3.0: extend_palette(seed, palette_size=20, grid_size=64,
  // lightness_bounds=(40,90), chroma_bounds=(15,100), hue_bounds=(0,360),
  // optimize_palette=False). Seed colors subsequently reordered by the user;
  // the nine generated colors retain their greedy extension order.
  { name: 'Selected + Glasbey — 20', colors: ['#A6D854', '#FFD92F', '#FC8D62', '#8080FF', '#00FFFF',
      '#E78AC3', '#8DA0CB', '#FF00FF', '#FF5555', '#FFFFFF', '#66C2A5', '#867924', '#926D75', '#00A600',
      '#108A92', '#D70082', '#9E59BA', '#CABE9A', '#E3CAFF', '#BE5900'], seedCount: 11,
    note: 'Your eleven seed colors in the latest order, followed by nine Glasbey additions with lightness constrained for black backgrounds. Preview only; the room limit remains ten.',
    url: 'https://glasbey.readthedocs.io/en/latest/extending_palettes.html' },
];
const names = {
  '#5555FF': 'Light blue', '#55FF55': 'Light green', '#55FFFF': 'Light cyan',
  '#FF5555': 'Light red', '#FF55FF': 'Light magenta', '#FFFF55': 'Yellow',
  '#FFFFFF': 'White', '#0000AA': 'Blue', '#00AA00': 'Green', '#00AAAA': 'Cyan',
  '#AA0000': 'Red', '#AA00AA': 'Magenta', '#AA5500': 'Brown',
  '#AAAAAA': 'Light gray', '#555555': 'Dark gray',
  '#00FFFF': 'Pure cyan', '#FFFF00': 'Pure yellow', '#FF00FF': 'Pure magenta',
  '#00FF00': 'Pure green', '#FF8000': 'Orange', '#80FF00': 'Lime',
  '#FF0080': 'Pink', '#00FF80': 'Mint', '#8080FF': 'Periwinkle', '#FF8080': 'Salmon',
  '#66C2A5': 'Set2 teal', '#FC8D62': 'Set2 orange', '#8DA0CB': 'Set2 blue',
  '#E78AC3': 'Set2 pink', '#A6D854': 'Set2 lime', '#FFD92F': 'Set2 yellow',
  '#867924': 'Olive', '#926D75': 'Dusty rose', '#00A600': 'Generated green',
  '#108A92': 'Teal', '#D70082': 'Raspberry', '#9E59BA': 'Violet',
  '#CABE9A': 'Sand', '#E3CAFF': 'Pale lavender', '#BE5900': 'Burnt orange',
};
if (!palettes.every(p => p.colors.every(color => /^#[0-9a-f]{6}$/i.test(color)))) throw new Error('Invalid palette color');

process.stdout.write(`<!doctype html>
<html lang="en">
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Remart palette preview</title>
<style>
  :root { color-scheme: dark; }
  body { background: #000; color: #ccc; margin: 24px; font: 16px ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "DejaVu Sans Mono", "Courier New", monospace; }
  h1 { font-size: 20px; }
  p, .label { color: #aaa; font-size: 13px; }
  .comparison { display: grid; grid-template-columns: repeat(2, minmax(460px, 1fr)); gap: 32px; }
  select { background: #111; color: #eee; font: inherit; padding: 6px; border: 1px solid #555; }
  label { display: block; margin-bottom: 6px; }
  section { margin-top: 18px; }
  .extension { border-top: 1px solid #555; padding-top: 12px; }
  a { color: #aaa; }
  .notes { min-height: 100px; max-width: 440px; }
  .sample { margin-top: 3px; }
  .roster { font-size: 13px; }
</style>
<h1>Remart palette comparison</h1>
<p>Choose any two palettes. Samples use 13px roster and 16px transcript text, all on black.</p>
<p>Published palettes retain their published order. These are candidates for review, not changes to the chat.</p>
<div class="comparison">
${['Left', 'Right'].map((side, index) => `<div>
  <label for="palette-${index}">${side} palette</label>
  <select id="palette-${index}">${palettes.map((p, i) => `<option value="${i}"${i === (index ? palettes.length - 1 : palettes.length - 2) ? ' selected' : ''}>${p.name} (${p.colors.length})</option>`).join('')}</select>
  <div class="notes" id="notes-${index}"></div>
  <div id="samples-${index}"></div>
</div>`).join('')}
</div>
<script>
const palettes = ${JSON.stringify(palettes)};
const names = ${JSON.stringify(names)};
for (const index of [0, 1]) {
  const select = document.getElementById('palette-' + index);
  const render = () => {
    const palette = palettes[Number(select.value)];
    const notes = document.getElementById('notes-' + index);
    notes.replaceChildren();
    const description = document.createElement('p');
    description.textContent = palette.note;
    notes.append(description);
    if (palette.url) {
      const link = document.createElement('a');
      link.href = palette.url; link.textContent = 'Palette source';
      notes.append(link);
    }
    const samples = document.getElementById('samples-' + index);
    samples.replaceChildren();
    palette.colors.forEach((color, i) => {
      const section = document.createElement('section');
      if (i === palette.seedCount) {
        section.className = 'extension';
        const heading = document.createElement('p');
        heading.textContent = 'Glasbey extension starts here';
        section.append(heading);
      }
      const label = document.createElement('div');
      label.className = 'label';
      label.textContent = (i + 1) + '. ' + (names[color] ? names[color] + ' · ' : '') + color;
      const roster = document.createElement('div');
      roster.className = 'sample roster'; roster.style.color = color;
      roster.textContent = '■ Participant ' + (i + 1) + ' — Участник ' + (i + 1);
      const text = document.createElement('div');
      text.className = 'sample'; text.style.color = color;
      text.textContent = 'Hello, world! Привет, мир! 0123456789 _';
      section.append(label, roster, text); samples.append(section);
    });
  };
  select.addEventListener('change', render);
  render();
}
</script>
</html>
`);
