import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

describe('theme.css', ()=>{
  it('contains monospace mandatory and line-height 1.55em', ()=>{
    const cssPath = path.join(__dirname, 'theme.css');
    const css = fs.readFileSync(cssPath, 'utf8');
    expect(css).toMatch(/font-family.*monospace/);
    expect(css).toMatch(/line-height:\s*1\.55em/);
    expect(css).toMatch(/min-height:\s*1\.55em/);
  });
  it('system-line has bottom margin 0.8em', ()=>{
    const css = fs.readFileSync(path.join(__dirname,'theme.css'),'utf8');
    expect(css).toMatch(/\.system-line.*margin-bottom:\s*0\.8em/s);
  });
  it('caret has blink animation', ()=>{
    const css = fs.readFileSync(path.join(__dirname,'theme.css'),'utf8');
    expect(css).toMatch(/\.caret/);
    expect(css).toMatch(/@keyframes blink/);
  });
  it('roster has sticky and width', ()=>{
    const css = fs.readFileSync(path.join(__dirname,'theme.css'),'utf8');
    expect(css).toMatch(/#roster/);
    expect(css).toMatch(/width:\s*160px/);
  });
});
