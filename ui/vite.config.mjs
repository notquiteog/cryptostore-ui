import baseConfig from '../client/vite.config.js';
import { demoApi } from './demo-api.mjs';

// A separate config keeps the production client byte-for-byte portable.
export default (env) => {
  const config = baseConfig(env);
  const install = (server) => { server.middlewares.use(demoApi()); };
  return {
    ...config,
    server: { ...config.server, host: '127.0.0.1', proxy: {} },
    preview: { ...config.preview, host: '127.0.0.1', proxy: {} },
    plugins: [...config.plugins, {
      name: 'synthetic-ui-demo',
      configureServer: install,
      configurePreviewServer: install,
    }],
  };
};
