import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

// Assets are exported from client/public/icon-master.svg. To regenerate:
//   magick icon-master.svg -resize NxN -modulate 150,150,100   (N = 16, 32, 48) -> favicon.ico
//   magick icon-master.svg -resize 180x180                      -> apple-touch-icon.png
// The +50% boost exists because a 16x16 downscale of the master averages its
// bright glyph pixels with the black ground and comes out too dim to read as
// text. The boost cannot live in an SVG: renderers filter before downsampling,
// so the multiply clips back to the original colours. That is also why no
// favicon.svg is shipped - browsers prefer it over the ICO and would rasterize
// the untuned master themselves.

const publicDir = path.join(__dirname, '..', 'public');
const html = () => fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');

/** Parse an ICO directory into its per-image sizes. */
function icoSizes(buf: Buffer): Array<{ width:number; height:number }> {
  expect(buf.readUInt16LE(0)).toBe(0);
  expect(buf.readUInt16LE(2)).toBe(1); // 1 = icon
  const count = buf.readUInt16LE(4);
  return Array.from({ length: count }, (_, i) => {
    const entry = 6 + i * 16;
    return {
      width: buf[entry] === 0 ? 256 : buf[entry],
      height: buf[entry + 1] === 0 ? 256 : buf[entry + 1],
    };
  });
}

describe('favicon markup', () => {
  it('no longer suppresses the icon with the empty data URI', () => {
    expect(html()).not.toMatch(/href=["']data:,["']/);
  });
  it('links the ICO as the tab icon', () => {
    expect(html()).toMatch(/<link[^>]+rel=["']icon["'][^>]+href=["']\/favicon\.ico["']/);
  });
  it('links a 180x180 apple touch icon', () => {
    const link = html().match(/<link[^>]+rel=["']apple-touch-icon["'][^>]*>/)?.[0] ?? '';
    expect(link).toMatch(/sizes=["']180x180["']/);
    expect(link).toMatch(/href=["']\/apple-touch-icon\.png["']/);
  });
  it('ships no favicon.svg, which browsers would prefer over the tuned ICO', () => {
    expect(html()).not.toMatch(/image\/svg\+xml/);
    expect(fs.existsSync(path.join(publicDir, 'favicon.svg'))).toBe(false);
  });
  it('references only files that exist in public/', () => {
    const hrefs = [...html().matchAll(/<link[^>]+rel=["'][^"']*icon[^"']*["'][^>]+href=["']\/([^"']+)["']/g)]
      .map(m => m[1]);
    expect(hrefs.length).toBeGreaterThan(0);
    for (const href of hrefs) expect(fs.existsSync(path.join(publicDir, href))).toBe(true);
  });
});

describe('favicon assets', () => {
  it('ICO carries 16, 32 and 48 pixel images', () => {
    const sizes = icoSizes(fs.readFileSync(path.join(publicDir, 'favicon.ico')));
    expect(sizes.map(s => s.width).sort((a, b) => a - b)).toEqual([16, 32, 48]);
    for (const s of sizes) expect(s.height).toBe(s.width);
  });
  it('apple touch icon is a 180x180 PNG', () => {
    const buf = fs.readFileSync(path.join(publicDir, 'apple-touch-icon.png'));
    expect(buf.subarray(1, 4).toString()).toBe('PNG');
    expect(buf.readUInt32BE(16)).toBe(180);
    expect(buf.readUInt32BE(20)).toBe(180);
  });
  it('keeps the vector master as the reproducible source', () => {
    const svg = fs.readFileSync(path.join(publicDir, 'icon-master.svg'), 'utf8');
    expect(svg).toMatch(/<svg[^>]*viewBox=/);
  });
});
