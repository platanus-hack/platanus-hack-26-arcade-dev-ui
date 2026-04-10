import type { IncomingMessage, ServerResponse } from 'http';
import { readFileSync } from 'fs';
import { dirname, resolve } from 'path';
import { execSync } from 'child_process';
import { fileURLToPath } from 'url';
import type { HmrContext, ViteDevServer } from 'vite';
import { checkRestrictions } from './check-restrictions.js';
import { getCoverCheckResult } from './cover-check.js';
import {
  fetchArcadeChallengeInfo,
  fetchLatestGameplayPreview,
  getArcadeChallengeSlug,
  getArcadeSiteUrl,
  getGitInfo,
  readJsonBody,
  resolveEnv,
  submitArcadeRelease,
  type SubmitReleaseRequest,
} from './release-submission.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PACKAGE_JSON_PATH = resolve(__dirname, '..', 'package.json');
const DASHBOARD_HTML_PATH = resolve(__dirname, '..', 'dashboard.html');
const PACKAGE_NAME = '@platanus/arcade-dev-ui-26';
const REGISTRY_URL = `https://registry.npmjs.org/${PACKAGE_NAME}/latest`;
const UPDATE_CHECK_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes

type ViteResponse = ServerResponse<IncomingMessage>;

function getInstalledVersion(): string {
  try {
    const pkg = JSON.parse(readFileSync(PACKAGE_JSON_PATH, 'utf-8'));
    return pkg.version || '0.0.0';
  } catch {
    return '0.0.0';
  }
}

export interface ArcadeDevUIOptions {
  /** Disable auto-update checks (default: false) */
  disableUpdateCheck?: boolean;
}

export function arcadeDevUI(options: ArcadeDevUIOptions = {}) {
  const installedVersion = getInstalledVersion();
  let latestVersion: string | null = null;
  let updateCheckTimer: ReturnType<typeof setInterval> | null = null;

  async function checkForUpdate() {
    try {
      const response = await fetch(REGISTRY_URL);
      if (response.ok) {
        const data = (await response.json()) as { version?: string };
        latestVersion = data.version ?? null;
      }
    } catch {
      // Silently ignore — network may be unavailable
    }
  }

  return {
    name: 'arcade-dev-ui',

    async handleHotUpdate({ file }: HmrContext) {
      if (file.endsWith('game.js')) {
        console.log('\n🔄 Checks updated at', new Date().toLocaleTimeString());
        try {
          const results = await checkRestrictions('./game.js');
          console.log(`   Size: ${results.sizeKB.toFixed(2)} KB`);
          console.log(
            `   Status: ${results.passed ? '✅ Passing' : '❌ Failing'}`,
          );

          if (!results.passed) {
            const failed = results.results.filter((r) => !r.passed);
            failed.forEach((f) => {
              console.log(`   ❌ ${f.name}: ${f.message}`);
            });
          }
        } catch (error) {
          console.error('Error running checks:', error);
        }
      }
    },

    configureServer(server: ViteDevServer) {
      // Load .env from the project root
      resolveEnv(server.config.root);

      // Watch non-JS files so changes trigger a browser reload
      const extraFiles = ['cover.png', 'metadata.json'];
      for (const file of extraFiles) {
        const abs = resolve(server.config.root, file);
        server.watcher.add(abs);
      }
      server.watcher.on('change', (changedPath) => {
        const base = changedPath.split('/').pop() ?? '';
        if (extraFiles.includes(base)) {
          console.log(`\n🔄 ${base} changed at`, new Date().toLocaleTimeString());
          server.ws.send({ type: 'full-reload' });
        }
      });

      // Start update checks
      if (!options.disableUpdateCheck) {
        checkForUpdate();
        updateCheckTimer = setInterval(checkForUpdate, UPDATE_CHECK_INTERVAL_MS);

        // Clean up on server close
        server.httpServer?.on('close', () => {
          if (updateCheckTimer) {
            clearInterval(updateCheckTimer);
            updateCheckTimer = null;
          }
        });
      }

      // Serve dashboard HTML at root
      server.middlewares.use((req, res: ViteResponse, next) => {
        if (req.url === '/' || req.url === '/index.html') {
          try {
            const html = readFileSync(DASHBOARD_HTML_PATH, 'utf-8');
            res.setHeader('Content-Type', 'text/html; charset=utf-8');
            res.end(html);
          } catch (error) {
            res.statusCode = 500;
            res.end(`Failed to load dashboard: ${error instanceof Error ? error.message : 'unknown'}`);
          }
          return;
        }
        next();
      });

      // --- API endpoints ---

      server.middlewares.use('/api/checks', async (_req, res: ViteResponse) => {
        try {
          const results = await checkRestrictions('./game.js');
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify(results));
        } catch {
          res.statusCode = 500;
          res.end(JSON.stringify({ error: 'Failed to run checks' }));
        }
      });

      server.middlewares.use(
        '/api/git-info',
        async (_req, res: ViteResponse) => {
          try {
            const gitInfo = getGitInfo();
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify(gitInfo));
          } catch {
            res.statusCode = 500;
            res.end(JSON.stringify({ error: 'Failed to get git info' }));
          }
        },
      );

      server.middlewares.use(
        '/api/challenge-info',
        async (_req, res: ViteResponse) => {
          try {
            const challengeInfo = await fetchArcadeChallengeInfo();
            res.setHeader('Content-Type', 'application/json');
            res.end(
              JSON.stringify({
                ...challengeInfo,
                sourceSlug: getArcadeChallengeSlug(),
                siteUrl: getArcadeSiteUrl(),
              }),
            );
          } catch (error) {
            res.statusCode = 502;
            res.setHeader('Content-Type', 'application/json');
            res.end(
              JSON.stringify({
                error: 'Failed to fetch arcade challenge info',
                details: error instanceof Error ? error.message : 'unknown',
              }),
            );
          }
        },
      );

      server.middlewares.use(
        '/api/cover-check',
        async (_req, res: ViteResponse) => {
          const coverCheck = getCoverCheckResult();
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify(coverCheck));
        },
      );

      server.middlewares.use(
        '/api/gameplay-preview',
        async (req, res: ViteResponse) => {
          if (req.method !== 'GET') {
            res.statusCode = 405;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ error: 'Method not allowed' }));
            return;
          }

          try {
            const gitInfo = getGitInfo();
            if (!gitInfo.githubUsername || !gitInfo.repoName) {
              res.statusCode = 400;
              res.setHeader('Content-Type', 'application/json');
              res.end(
                JSON.stringify({
                  error: 'Git repository with an origin remote is required.',
                }),
              );
              return;
            }

            const preview = await fetchLatestGameplayPreview(
              gitInfo.githubUsername,
              gitInfo.repoName,
            );
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify(preview));
          } catch (error) {
            res.statusCode = 502;
            res.setHeader('Content-Type', 'application/json');
            res.end(
              JSON.stringify({
                error: 'Failed to fetch gameplay preview',
                details: error instanceof Error ? error.message : 'unknown',
              }),
            );
          }
        },
      );

      server.middlewares.use(
        '/api/submit-release',
        async (req, res: ViteResponse) => {
          if (req.method !== 'POST') {
            res.statusCode = 405;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ error: 'Method not allowed' }));
            return;
          }

          try {
            const payload = await readJsonBody<SubmitReleaseRequest>(req);
            const result = await submitArcadeRelease(payload);
            res.statusCode = result.success ? 200 : 400;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify(result));
          } catch (error) {
            res.statusCode = 500;
            res.setHeader('Content-Type', 'application/json');
            res.end(
              JSON.stringify({
                success: false,
                error: 'Failed to process arcade release submission.',
                step: 'submit_release',
                details: error instanceof Error ? error.message : 'unknown',
              }),
            );
          }
        },
      );

      // --- Auto-update endpoints ---

      server.middlewares.use(
        '/api/dev-ui-status',
        (_req, res: ViteResponse) => {
          res.setHeader('Content-Type', 'application/json');
          res.end(
            JSON.stringify({
              installed: installedVersion,
              latest: latestVersion,
              updateAvailable:
                latestVersion !== null && latestVersion !== installedVersion,
              packageName: PACKAGE_NAME,
            }),
          );
        },
      );

      server.middlewares.use(
        '/api/dev-ui-update',
        async (req, res: ViteResponse) => {
          if (req.method !== 'POST') {
            res.statusCode = 405;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ error: 'Method not allowed' }));
            return;
          }

          try {
            // Detect which package manager is being used
            const projectRoot = server.config.root;
            let updateCommand: string;

            try {
              // Check for pnpm-lock.yaml
              readFileSync(resolve(projectRoot, 'pnpm-lock.yaml'));
              updateCommand = `pnpm update ${PACKAGE_NAME}`;
            } catch {
              try {
                // Check for yarn.lock
                readFileSync(resolve(projectRoot, 'yarn.lock'));
                updateCommand = `yarn upgrade ${PACKAGE_NAME}`;
              } catch {
                updateCommand = `npm update ${PACKAGE_NAME}`;
              }
            }

            console.log(`\n📦 Updating ${PACKAGE_NAME}...`);
            execSync(updateCommand, {
              cwd: projectRoot,
              stdio: 'inherit',
            });
            console.log(`✅ Updated ${PACKAGE_NAME} successfully`);

            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ success: true }));

            // Restart the Vite server to pick up the new version
            console.log('🔄 Restarting dev server...');
            await server.restart();
          } catch (error) {
            console.error(`❌ Failed to update ${PACKAGE_NAME}:`, error);
            res.statusCode = 500;
            res.setHeader('Content-Type', 'application/json');
            res.end(
              JSON.stringify({
                success: false,
                error: `Failed to update: ${error instanceof Error ? error.message : 'unknown'}`,
              }),
            );
          }
        },
      );
    },
  };
}

export default arcadeDevUI;

// Re-export for convenience
export { checkRestrictions } from './check-restrictions.js';
export type { CheckResults, RestrictionResult } from './check-restrictions.js';
export { getCoverCheckResult } from './cover-check.js';
export type { CoverCheckResult } from './cover-check.js';
