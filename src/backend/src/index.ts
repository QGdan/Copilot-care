import { createBackendApp } from './bootstrap/createBackendApp';
import { createRuntime } from './bootstrap/createRuntime';
import { loadLocalEnv } from './config/loadLocalEnv';

loadLocalEnv();

const port = Number(process.env.PORT ?? process.env.APP_PORT ?? 3001);
const runtime = createRuntime();
const app = createBackendApp(runtime);

if (require.main === module) {
  const server = app.listen(port, () => {
    // Keep runtime output minimal and deterministic.
    console.log(`[copilot-care] backend listening on :${port}`);
  });

  server.on('error', (error: NodeJS.ErrnoException) => {
    if (error.code === 'EADDRINUSE') {
      console.error(
        `[copilot-care] backend failed to start: port ${port} is already in use. ` +
          'Stop the existing process or set PORT/APP_PORT to another value.',
      );
      process.exit(1);
    }

    if (error.code === 'EACCES') {
      console.error(
        `[copilot-care] backend failed to start: no permission to bind port ${port}.`,
      );
      process.exit(1);
    }

    console.error(
      `[copilot-care] backend failed to start: ${error.message || 'unknown error'}`,
    );
    process.exit(1);
  });
}

export { app };
