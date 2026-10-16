import { defineConfig } from 'astro/config';

export default defineConfig({
  vite: {
    resolve: { preserveSymlinks: process.env.PRESERVE_SYMLINKS === '1' },
    // Optional compatibility for Windows workspaces with restricted parent paths.
    ...(process.env.PRESERVE_SYMLINKS === '1' ? {
      plugins: [{
        name: 'restricted-workspace',
        configResolved(config) {
          for (const target of [config, ...Object.values(config.environments ?? {})]) {
            if (target.optimizeDeps) {
              target.optimizeDeps.noDiscovery = true;
              target.optimizeDeps.include = [];
            }
          }
        },
      }],
    } : {}),
    server: { proxy: { '/api': process.env.API_PROXY_TARGET || 'http://localhost:3001' } },
  },
});

