import { execSync } from 'child_process';
import type { IncomingMessage } from 'http';
import { existsSync } from 'fs';
import { dirname, join } from 'path';

export type GitInfo = {
  username: string | null;
  email: string | null;
  remoteUrl: string | null;
  githubUsername: string | null;
  repoName: string | null;
  branch: string | null;
  isGitRepo: boolean;
  hasUncommittedChanges: boolean;
  headReleaseTags: string[];
  latestReleaseTag: string | null;
  nextReleaseTag: string | null;
  canSubmitRelease: boolean;
  error?: string;
};

export type SubmitReleaseRequest = {
  eventSlug?: string;
};

export type ChallengeInfoResponse = {
  challenge: {
    id: string;
    slug: string;
    name: string;
    eventName: string;
    eventPriorityDeadlineAt: string | null;
    eventFinalDeadlineAt: string | null;
    submissionDeadline: string;
    votingDeadline: string;
  };
  now: string;
  windows: {
    submissionClosed: boolean;
    submissionOpen: boolean;
    votingStarted: boolean;
    votingEnded: boolean;
    votingOpen: boolean;
  };
};

export type SubmitReleaseResponse =
  | {
      success: true;
      tag: string;
      commitSha: string;
      branch: string;
      backend: {
        url: string;
        eventSlug: string;
      };
      release: {
        gameId: string;
        versionId: string;
        slug: string;
        versionNumber: number;
        created: boolean;
        diagnosticId: string | null;
      };
    }
  | {
      success: false;
      error: string;
      step: string;
      details?: unknown;
    };

export type GameplayPreviewStatus =
  | 'none'
  | 'processing'
  | 'ready'
  | 'failed';

export type GameplayPreviewResponse = {
  success: true;
  status: GameplayPreviewStatus;
  versionId: string | null;
  versionNumber: number | null;
  previewVideoUrl: string | null;
  posterUrl: string | null;
};

const DEFAULT_EVENT_SLUG = '26-ar';
const SUBMISSION_FILES = ['game.js', 'metadata.json', 'cover.png'] as const;

function resolveEnv(projectRoot: string) {
  const envPath = join(projectRoot, '.env');
  if (existsSync(envPath)) {
    process.loadEnvFile?.(envPath);
  }
}

function getHackSiteUrl() {
  return (
    process.env.HACK_SITE_URL?.trim().replace(/\/+$/, '') ||
    'https://hack.platan.us'
  );
}

function getReleaseApiUrl() {
  return (
    process.env.ARCADE_RELEASE_API_URL ??
    `${getHackSiteUrl()}/api/26/arcade/releases`
  );
}

export function getArcadeChallengeSlug() {
  return DEFAULT_EVENT_SLUG;
}

export function getArcadeSiteUrl() {
  return getHackSiteUrl();
}

export function getArcadeChallengeInfoUrl() {
  const url = new URL('/api/26/arcade/challenge-info', getHackSiteUrl());
  url.searchParams.set('eventSlug', DEFAULT_EVENT_SLUG);
  return url.toString();
}

function parseGitHubRepo(remoteUrl: string) {
  const match = remoteUrl.match(/github\.com[:/]([^/]+)\/(.+?)(?:\.git)?$/);
  if (!match) {
    return {
      githubUsername: null,
      repoName: null,
      repoUrl: remoteUrl,
    };
  }

  return {
    githubUsername: match[1] ?? null,
    repoName: match[2] ?? null,
    repoUrl: `https://github.com/${match[1]}/${match[2]}`,
  };
}

function runGitCommand(command: string) {
  return execSync(command, {
    encoding: 'utf-8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
}

function isReleaseTag(tag: string) {
  return /^v\d+$/.test(tag) || /^arcade-release-\d{8}-\d{6}-[a-f0-9]{7}$/.test(tag);
}

function getCurrentReleaseState() {
  const statusOutput = runGitCommand(
    `git status --porcelain -- ${SUBMISSION_FILES.join(' ')}`,
  );
  const headTagsOutput = runGitCommand('git tag --points-at HEAD');
  const headTags = headTagsOutput.length > 0 ? headTagsOutput.split('\n') : [];
  const releaseTags = headTags.filter(isReleaseTag);

  return {
    hasChanges: statusOutput.length > 0,
    releaseTags,
  };
}

function getLatestVersionTagOnHeadHistory() {
  try {
    const latestTag = runGitCommand(
      "git describe --tags --abbrev=0 --match 'v[0-9]*' HEAD",
    );
    return latestTag.length > 0 ? latestTag : null;
  } catch {
    return null;
  }
}

function getNextReleaseTag() {
  const latestTag = getLatestVersionTagOnHeadHistory();
  if (!latestTag) {
    return 'v1';
  }

  const match = latestTag.match(/^v(\d+)$/);
  if (!match) {
    return 'v1';
  }

  const latestVersion = Number.parseInt(match[1] ?? '0', 10);
  if (!Number.isFinite(latestVersion)) {
    return 'v1';
  }

  return `v${latestVersion + 1}`;
}

export function getGitInfo(): GitInfo {
  try {
    const remoteUrl = runGitCommand('git config --get remote.origin.url');
    const username = runGitCommand('git config user.name');
    const email = runGitCommand('git config user.email');
    const branch = runGitCommand('git rev-parse --abbrev-ref HEAD');
    const releaseState = getCurrentReleaseState();
    const latestReleaseTag = getLatestVersionTagOnHeadHistory();
    const nextReleaseTag = getNextReleaseTag();
    const parsedRepo = parseGitHubRepo(remoteUrl);

    return {
      username,
      email,
      remoteUrl: parsedRepo.repoUrl,
      githubUsername: parsedRepo.githubUsername,
      repoName: parsedRepo.repoName,
      branch,
      isGitRepo: true,
      hasUncommittedChanges: releaseState.hasChanges,
      headReleaseTags: releaseState.releaseTags,
      latestReleaseTag,
      nextReleaseTag,
      canSubmitRelease:
        releaseState.hasChanges || releaseState.releaseTags.length === 0,
    };
  } catch {
    return {
      username: null,
      email: null,
      remoteUrl: null,
      githubUsername: null,
      repoName: null,
      branch: null,
      isGitRepo: false,
      hasUncommittedChanges: false,
      headReleaseTags: [],
      latestReleaseTag: null,
      nextReleaseTag: null,
      canSubmitRelease: false,
      error: 'Not a git repository or git not configured',
    };
  }
}

export async function readJsonBody<T>(req: IncomingMessage): Promise<T> {
  const chunks: Buffer[] = [];

  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }

  if (chunks.length === 0) {
    return {} as T;
  }

  return JSON.parse(Buffer.concat(chunks).toString('utf-8')) as T;
}

export async function submitArcadeRelease(
  payload: SubmitReleaseRequest,
): Promise<SubmitReleaseResponse> {
  const gitInfo = getGitInfo();

  if (!gitInfo.isGitRepo || !gitInfo.githubUsername || !gitInfo.repoName) {
    return {
      success: false,
      error: 'A GitHub repository with a configured origin remote is required.',
      step: 'validate_git',
      details: gitInfo,
    };
  }

  if (!gitInfo.branch || gitInfo.branch === 'HEAD') {
    return {
      success: false,
      error: 'Could not determine the current git branch.',
      step: 'detect_branch',
    };
  }

  const eventSlug = payload.eventSlug?.trim() || DEFAULT_EVENT_SLUG;
  let releaseState: ReturnType<typeof getCurrentReleaseState>;

  try {
    releaseState = getCurrentReleaseState();
  } catch (error) {
    return {
      success: false,
      error: 'Failed to inspect the current git release state.',
      step: 'validate_release_state',
      details: error instanceof Error ? error.message : 'unknown',
    };
  }

  if (!releaseState.hasChanges && releaseState.releaseTags.length > 0) {
    return {
      success: false,
      error:
        'The latest commit is already tagged for release and there are no new changes to submit.',
      step: 'validate_release_state',
      details: {
        headReleaseTags: releaseState.releaseTags,
      },
    };
  }

  try {
    runGitCommand(`git add -- ${SUBMISSION_FILES.join(' ')}`);
  } catch (error) {
    return {
      success: false,
      error: 'Failed to stage files for submission.',
      step: 'git_add',
      details: error instanceof Error ? error.message : 'unknown',
    };
  }

  const tag = getNextReleaseTag();
  const commitMessage = `Arcade release ${tag}`;

  try {
    runGitCommand(`git commit --allow-empty -m "${commitMessage}"`);
  } catch (error) {
    return {
      success: false,
      error: 'Failed to create the release commit.',
      step: 'git_commit',
      details: error instanceof Error ? error.message : 'unknown',
    };
  }

  let commitSha: string;

  try {
    commitSha = runGitCommand('git rev-parse HEAD');
  } catch (error) {
    return {
      success: false,
      error: 'Failed to resolve the new commit SHA.',
      step: 'resolve_commit',
      details: error instanceof Error ? error.message : 'unknown',
    };
  }

  try {
    runGitCommand(`git push origin ${gitInfo.branch}`);
  } catch (error) {
    return {
      success: false,
      error: 'Failed to push the commit to origin.',
      step: 'git_push_branch',
      details: error instanceof Error ? error.message : 'unknown',
    };
  }

  const checkApiUrl = `${getReleaseApiUrl()}/check`;

  try {
    const checkResponse = await fetch(checkApiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        eventSlug,
        githubUsername: gitInfo.githubUsername,
        repoName: gitInfo.repoName,
        commitSha,
      }),
    });

    const checkResult = (await checkResponse.json()) as Record<string, unknown>;

    if (!checkResponse.ok || checkResult.available === false) {
      const conflicts = checkResult.conflicts as Record<string, string> | undefined;
      const messages: string[] = [];

      if (conflicts?.code) {
        messages.push(conflicts.code);
      }

      if (conflicts?.slug) {
        messages.push(conflicts.slug);
      }

      return {
        success: false,
        error: messages.length > 0
          ? messages.join('. ')
          : (typeof checkResult.error === 'string' ? checkResult.error : 'Pre-release check failed.'),
        step: 'pre_release_check',
        details: checkResult,
      };
    }
  } catch (error) {
    return {
      success: false,
      error: 'Failed to reach the pre-release check API.',
      step: 'pre_release_check',
      details: error instanceof Error ? error.message : 'unknown',
    };
  }

  try {
    runGitCommand(`git tag ${tag}`);
  } catch (error) {
    return {
      success: false,
      error: 'Failed to create the release tag.',
      step: 'git_tag',
      details: error instanceof Error ? error.message : 'unknown',
    };
  }

  try {
    runGitCommand(`git push origin ${tag}`);
  } catch (error) {
    return {
      success: false,
      error: 'Failed to push the release tag to origin.',
      step: 'git_push_tag',
      details: error instanceof Error ? error.message : 'unknown',
    };
  }

  const releaseApiUrl = getReleaseApiUrl();
  let response: Response;

  try {
    response = await fetch(releaseApiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        eventSlug,
        githubUsername: gitInfo.githubUsername,
        repoName: gitInfo.repoName,
        tag,
      }),
    });
  } catch (error) {
    return {
      success: false,
      error: 'Failed to reach the arcade release API.',
      step: 'backend_request',
      details: error instanceof Error ? error.message : 'unknown',
    };
  }

  let result: unknown;

  try {
    result = await response.json();
  } catch {
    result = null;
  }

  if (!result || typeof result !== 'object') {
    return {
      success: false,
      error: 'Arcade release API returned an invalid response.',
      step: 'backend_response',
      details: result,
    };
  }

  const parsedResult = result as Record<string, unknown>;

  if (!response.ok || parsedResult.success !== true) {
    return {
      success: false,
      error:
        typeof parsedResult.error === 'string'
          ? parsedResult.error
          : 'Arcade release ingestion failed.',
      step:
        typeof parsedResult.stage === 'string'
          ? parsedResult.stage
          : 'backend_response',
      details: parsedResult,
    };
  }

  return {
    success: true,
    tag,
    commitSha,
    branch: gitInfo.branch,
    backend: {
      url: releaseApiUrl,
      eventSlug,
    },
    release: {
      gameId: String(parsedResult.gameId),
      versionId: String(parsedResult.versionId),
      slug: String(parsedResult.slug),
      versionNumber: Number(parsedResult.versionNumber),
      created: Boolean(parsedResult.created),
      diagnosticId:
        parsedResult.diagnosticId == null
          ? null
          : String(parsedResult.diagnosticId),
    },
  };
}

export async function fetchArcadeChallengeInfo(): Promise<ChallengeInfoResponse> {
  const response = await fetch(getArcadeChallengeInfoUrl(), {
    headers: {
      Accept: 'application/json',
    },
  });

  if (!response.ok) {
    throw new Error(`Challenge info request failed with ${response.status}`);
  }

  return (await response.json()) as ChallengeInfoResponse;
}

export function getGameplayPreviewUrl(
  githubUsername: string,
  repoName: string,
): string {
  const url = new URL(
    '/api/26/arcade/releases/latest-preview',
    getHackSiteUrl(),
  );
  url.searchParams.set('githubUsername', githubUsername);
  url.searchParams.set('repoName', repoName);
  return url.toString();
}

export function getGameplayCaptureUploadUrl(versionId: string): string {
  return new URL(
    `/api/26/arcade/releases/${versionId}/gameplay-capture`,
    getHackSiteUrl(),
  ).toString();
}

export function getGameplayCarryForwardUrl(versionId: string): string {
  return new URL(
    `/api/26/arcade/releases/${versionId}/gameplay-carry-forward`,
    getHackSiteUrl(),
  ).toString();
}

export async function fetchLatestGameplayPreview(
  githubUsername: string,
  repoName: string,
): Promise<GameplayPreviewResponse> {
  const response = await fetch(
    getGameplayPreviewUrl(githubUsername, repoName),
    {
      headers: { Accept: 'application/json' },
    },
  );

  if (!response.ok) {
    throw new Error(
      `Gameplay preview lookup failed with ${response.status}`,
    );
  }

  return (await response.json()) as GameplayPreviewResponse;
}

export { resolveEnv };
