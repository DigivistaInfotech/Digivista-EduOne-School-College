process.env.MANAGED_WEB = 'true';
import('tsx/esm/api')
  .then(({ tsImport }) => tsImport('./apps/api/src/server.ts', import.meta.url))
  .catch((error) => {
    console.error('School ERP could not start', error);
    process.exitCode = 1;
  });
