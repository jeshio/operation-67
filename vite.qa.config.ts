import { defineConfig } from 'vite';
import { readFileSync } from 'node:fs';
// Explicit, local QA build. The normal production build removes all QA controls.
export default defineConfig({
  plugins:[{name:'qa-panel',generateBundle(){this.emitFile({type:'asset',fileName:'qa-panel.html',source:readFileSync(new URL('./scripts/qa-panel.html',import.meta.url),'utf8')});}}],
  define:{'import.meta.env.DEV':'true'},
  build:{rollupOptions:{input:{game:'index.html',network:'qa-network.html'}},outDir:'test-artifacts/qa-client',emptyOutDir:true},
});
