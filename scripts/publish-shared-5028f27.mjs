#!/usr/bin/env node
/** One approved artifact, one prerelease. No archive extraction or runtime execution. */
import {createHash} from 'node:crypto';
import {constants} from 'node:fs';
import * as fs from 'node:fs/promises';
import {dirname, isAbsolute, join, resolve} from 'node:path';
import {pathToFileURL} from 'node:url';

const sourceSha = '5028f27f5808c6f0e0003aad7898a8756f47b2df';
const repository = '9theresa9/star-oracle';
const archiveName = 'star-oracle-shared-linux-amd64-5028f27.zip';
const archiveSha256 = '6c3cc3b95cf51d86464ae7205aec7d01ad03749358a145e798f81de3df995fe4';
export const PINNED = Object.freeze({
  repository, repositoryId: 1401891821,
  branch: 'feat/luminous-oracle-experience', sourceSha,
  sourceTree: 'dd062a87365fcd4a2acfa6592aaae7776c6b8ade',
  runs: Object.freeze([
    Object.freeze({id: 37913806253, workflowId: 373381395}),
    Object.freeze({id: 37913806335, workflowId: 379428670}),
  ]),
  artifactId: 11608496827,
  artifactName: 'star-oracle-shared-linux-amd64-' + sourceSha,
  archiveName, checksumName: archiveName + '.sha256', archiveSize: 311459847,
  archiveSha256, checksum: `${archiveSha256}  ${archiveName}\n`,
  tag: 'ssh-shared-5028f27', title: 'Star Oracle SSH shared MySQL · 5028f27',
  body: [
    'Verified linux/amd64 SSH-only shared-MySQL build.',
    '',
    'Source commit: ' + sourceSha,
    'Source tree: dd062a87365fcd4a2acfa6592aaae7776c6b8ade',
    '',
    'Verification:',
    `https://github.com/${repository}/actions/runs/37913806335`,
    `https://github.com/${repository}/actions/runs/37913806253`,
    '',
    'The fixed publication workflow supplies the unchanged verified ZIP and its SHA-256 file. ZIP SHA-256: ' + archiveSha256,
    '',
    'The bundle contains API, Web, Redis and MySQL client images, checked launchers, empty configuration templates and deployment documentation. It contains no runtime credentials or personal records. Read docs/SSH_SHARED_DEPLOYMENT.md before use. This opt-in profile requires localhost SSH forwarding; the default public deployment continues to require HTTPS.',
  ].join('\n'),
});

const CODES = new Set(['PUBLISH_CONTEXT', 'PUBLISH_PREREQUISITE', 'PUBLISH_IMMUTABLE', 'PUBLISH_EVIDENCE', 'PUBLISH_DOWNLOAD', 'PUBLISH_LOCAL_BYTES', 'PUBLISH_NETWORK', 'PUBLISH_HTTP', 'PUBLISH_RESPONSE', 'PUBLISH_CONFLICT', 'PUBLISH_FAILED']);
const ensure = (condition, code) => {if (!condition) throw new Error(code);};
export function failureCode(error) {return error instanceof Error && CODES.has(error.message) ? error.message : 'PUBLISH_FAILED';}
const safeId = value => Number.isSafeInteger(value) && value > 0;
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const expectedAssets = () => [
  {name: PINNED.archiveName, size: PINNED.archiveSize, sha256: PINNED.archiveSha256},
  {name: PINNED.checksumName, size: Buffer.byteLength(PINNED.checksum), sha256: sha256(PINNED.checksum)},
];

export function validateExecution(args, env) {
  ensure(Array.isArray(args) && args.length === 1 && ['verify', 'publish'].includes(args[0]) &&
    env.GITHUB_ACTIONS === 'true' && env.GITHUB_REPOSITORY === PINNED.repository &&
    env.GITHUB_EVENT_NAME === 'push' && env.GITHUB_REF === 'refs/heads/' + PINNED.branch &&
    typeof env.GH_TOKEN === 'string' && env.GH_TOKEN.length > 0 && env.GH_TOKEN.length <= 4096 && !/[\s\x00-\x1f\x7f]/u.test(env.GH_TOKEN) &&
    typeof env.RUNNER_TEMP === 'string' && isAbsolute(env.RUNNER_TEMP) && !/[\x00-\x1f\x7f]/u.test(env.RUNNER_TEMP), 'PUBLISH_CONTEXT');
  return {mode: args[0], stagingPath: join(resolve(env.RUNNER_TEMP), 'star-oracle-publish-5028f27')};
}

export function validateEvidence({repository: repo, commit, runs, artifact} = {}) {
  const p = PINNED;
  ensure(repo?.id === p.repositoryId && repo.private === false && repo.full_name === p.repository && commit?.sha === p.sourceSha && commit.tree?.sha === p.sourceTree, 'PUBLISH_EVIDENCE');
  ensure(Array.isArray(runs) && runs.length === p.runs.length && runs.every((run, index) =>
    run?.id === p.runs[index].id && run.workflow_id === p.runs[index].workflowId &&
    run.status === 'completed' && run.conclusion === 'success' && run.event === 'pull_request' &&
    run.head_sha === p.sourceSha && run.head_branch === p.branch &&
    run.head_repository?.id === p.repositoryId && run.head_repository.full_name === p.repository &&
    run.repository?.id === p.repositoryId && run.repository.full_name === p.repository), 'PUBLISH_EVIDENCE');
  ensure(artifact?.id === p.artifactId && artifact.name === p.artifactName && artifact.size_in_bytes === p.archiveSize &&
    artifact.digest === 'sha256:' + p.archiveSha256 && artifact.expired === false &&
    artifact.workflow_run?.id === p.runs[1].id && artifact.workflow_run.head_sha === p.sourceSha &&
    artifact.workflow_run.head_repository_id === p.repositoryId && artifact.workflow_run.repository_id === p.repositoryId &&
    artifact.workflow_run.head_branch === p.branch, 'PUBLISH_EVIDENCE');
}

/** Bounded streaming hash; the caller's sink receives only chunks within the limit. */
export async function hashBytes(body, maximum, sink) {
  ensure(body && Number.isSafeInteger(maximum) && maximum >= 0, 'PUBLISH_LOCAL_BYTES');
  let size = 0; const hash = createHash('sha256');
  try {
    for await (const value of body) {
      const chunk = Buffer.from(value); size += chunk.length;
      ensure(size <= maximum, 'PUBLISH_LOCAL_BYTES');
      hash.update(chunk); if (sink) await sink(chunk);
    }
  } catch {throw new Error('PUBLISH_LOCAL_BYTES');}
  return {size, sha256: hash.digest('hex')};
}
export async function assertBytes(body, expected, sink) {
  const actual = await hashBytes(body, expected.size, sink);
  ensure(actual.size === expected.size && actual.sha256 === expected.sha256, 'PUBLISH_LOCAL_BYTES');
  return actual;
}

async function realDirectory(path) {
  const stat = await fs.lstat(path);
  ensure(stat.isDirectory() && !stat.isSymbolicLink() && await fs.realpath(path) === resolve(path), 'PUBLISH_LOCAL_BYTES');
}
async function openRegular(path, size) {
  const stat = await fs.lstat(path);
  ensure(stat.isFile() && !stat.isSymbolicLink() && stat.size === size, 'PUBLISH_LOCAL_BYTES');
  const handle = await fs.open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const opened = await handle.stat();
    ensure(opened.isFile() && opened.size === size && opened.dev === stat.dev && opened.ino === stat.ino, 'PUBLISH_LOCAL_BYTES');
    return handle;
  } catch (error) {await handle.close(); throw error;}
}
export function createLocalStorage() {
  return {
    async stage(body, path) {
      try {
        await realDirectory(dirname(path));
        await fs.mkdir(path, {mode: 0o700});
        const handle = await fs.open(join(path, PINNED.archiveName), constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
        try {
          await assertBytes(body, expectedAssets()[0], async chunk => {
            let offset = 0;
            while (offset < chunk.length) {
              const {bytesWritten} = await handle.write(chunk, offset, chunk.length - offset, null);
              ensure(bytesWritten > 0, 'PUBLISH_LOCAL_BYTES'); offset += bytesWritten;
            }
          });
          await handle.sync();
        } finally {await handle.close();}
        await fs.writeFile(join(path, PINNED.checksumName), PINNED.checksum, {flag: 'wx', mode: 0o600});
      } catch {throw new Error('PUBLISH_LOCAL_BYTES');}
    },
    async inspect(path) {
      try {
        await realDirectory(path);
        const names = await fs.readdir(path), expected = expectedAssets();
        ensure(names.length === 2 && expected.every(item => names.includes(item.name)), 'PUBLISH_LOCAL_BYTES');
        for (const item of expected) {
          const handle = await openRegular(join(path, item.name), item.size);
          try {await assertBytes(handle.createReadStream({autoClose: false}), item);} finally {await handle.close();}
        }
        return expected;
      } catch {throw new Error('PUBLISH_LOCAL_BYTES');}
    },
    async open(name, path) {
      try {
        await realDirectory(path);
        const expected = expectedAssets().find(item => item.name === name);
        ensure(expected, 'PUBLISH_LOCAL_BYTES');
        const handle = await openRegular(join(path, name), expected.size);
        // Hold the verified bytes themselves: a public upload cannot safely stream
        // a file that another process could replace or modify after inspection.
        try {
          const chunks = [];
          await assertBytes(handle.createReadStream({autoClose: false}), expected, chunk => {chunks.push(chunk);});
          return Buffer.concat(chunks, expected.size);
        } finally {await handle.close();}
      } catch {throw new Error('PUBLISH_LOCAL_BYTES');}
    },
  };
}

function githubClient(fetch, token) {
  const base = 'https://api.github.com/repos/' + PINNED.repository;
  const headers = {Authorization: 'Bearer ' + token, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28'};
  async function request(url, {method = 'GET', body, upload = false, authenticated = true} = {}) {
    try {
      return await fetch(url, {
        method, redirect: 'manual', signal: AbortSignal.timeout(upload || !authenticated ? 10 * 60_000 : 60_000),
        headers: {...(authenticated ? headers : {}), ...(body === undefined ? {} : {'Content-Type': upload ? 'application/octet-stream' : 'application/json'}), ...(upload ? {'Content-Length': String(body.size)} : {})},
        ...(body === undefined ? {} : {body: upload ? body.bytes : JSON.stringify(body)}),
        ...(upload ? {duplex: 'half'} : {}),
      });
    } catch {throw new Error('PUBLISH_NETWORK');}
  }
  async function jsonResponse(response, allow404 = false) {
    if (allow404 && response.status === 404) {await response.body?.cancel(); return null;}
    if (![200, 201].includes(response.status)) {await response.body?.cancel(); throw new Error('PUBLISH_HTTP');}
    try {
      const chunks = []; let size = 0;
      for await (const chunk of response.body) {size += chunk.length; ensure(size <= 2 * 1024 ** 2, 'PUBLISH_RESPONSE'); chunks.push(Buffer.from(chunk));}
      return JSON.parse(Buffer.concat(chunks).toString('utf8'));
    } catch {throw new Error('PUBLISH_RESPONSE');}
  }
  return {
    async api(path, options = {}) {return jsonResponse(await request(base + path, options), options.allow404);},
    async download() {
      const redirect = await request(base + '/actions/artifacts/' + PINNED.artifactId + '/zip');
      ensure(redirect.status === 302, 'PUBLISH_DOWNLOAD');
      const location = redirect.headers.get('location'); await redirect.body?.cancel();
      let url; try {url = new URL(location);} catch {throw new Error('PUBLISH_DOWNLOAD');}
      ensure(url.protocol === 'https:' && !url.username && !url.password && !url.port && !url.hash &&
        /^[a-z0-9-]+\.blob\.core\.windows\.net$/.test(url.hostname), 'PUBLISH_DOWNLOAD');
      const result = await request(url.href, {authenticated: false});
      ensure(result.status === 200 && !result.redirected && result.body, 'PUBLISH_DOWNLOAD');
      const length = result.headers.get('content-length');
      ensure(length === null || length === String(PINNED.archiveSize), 'PUBLISH_DOWNLOAD');
      return result.body;
    },
    async upload(id, item, bytes) {
      ensure(safeId(id) && expectedAssets().some(expected => expected.name === item.name && expected.size === item.size && expected.sha256 === item.sha256), 'PUBLISH_CONFLICT');
      // GitHub's upload service is a separately fixed endpoint. Never trust upload_url.
      return jsonResponse(await request(`https://uploads.github.com/repos/${PINNED.repository}/releases/${id}/assets?name=${encodeURIComponent(item.name)}`, {method: 'POST', upload: true, body: {size: item.size, bytes}}));
    },
  };
}

async function verifyEvidence(client) {
  const [repository, commit, first, second, artifact] = await Promise.all([
    client.api(''), client.api('/git/commits/' + PINNED.sourceSha),
    ...PINNED.runs.map(run => client.api('/actions/runs/' + run.id)),
    client.api('/actions/artifacts/' + PINNED.artifactId),
  ]);
  validateEvidence({repository, commit, runs: [first, second], artifact});
}
function validateTag(tag, required = false) {
  ensure(!required || tag !== null, 'PUBLISH_PREREQUISITE');
  if (tag !== null) ensure(tag.ref === 'refs/tags/' + PINNED.tag && tag.object?.type === 'commit' && tag.object.sha === PINNED.sourceSha, 'PUBLISH_CONFLICT');
}
function validateRelease(release) {
  ensure(release && safeId(release.id) && release.tag_name === PINNED.tag &&
    release.name === PINNED.title && typeof release.body === 'string' && release.body.replaceAll('\r\n', '\n').trim() === PINNED.body &&
    release.prerelease === true && typeof release.draft === 'boolean', 'PUBLISH_CONFLICT');
  ensure(release.draft === false, 'PUBLISH_PREREQUISITE');
}
function validateAssets(assets, complete = false) {
  const expected = expectedAssets();
  ensure(Array.isArray(assets) && assets.length <= 2 && (!complete || assets.length === 2) && new Set(assets.map(asset => asset.name)).size === assets.length, 'PUBLISH_CONFLICT');
  for (const asset of assets) {
    const item = expected.find(item => item.name === asset.name);
    ensure(item && safeId(asset.id) && asset.state === 'uploaded' && asset.size === item.size && asset.digest === 'sha256:' + item.sha256, 'PUBLISH_CONFLICT');
  }
}
async function findRelease(client) {
  let result = null;
  for (let page = 1; page <= 100; page++) {
    const releases = await client.api('/releases?per_page=100&page=' + page);
    ensure(Array.isArray(releases) && releases.length <= 100, 'PUBLISH_RESPONSE');
    for (const release of releases.filter(release => release.tag_name === PINNED.tag)) {ensure(result === null, 'PUBLISH_CONFLICT'); validateRelease(release); result = release;}
    if (releases.length < 100) return result;
  }
  throw new Error('PUBLISH_RESPONSE');
}

export async function runPublisher(args, {env = process.env, fetch = globalThis.fetch, storage = createLocalStorage()} = {}) {
  const {mode, stagingPath} = validateExecution(args, env), client = githubClient(fetch, env.GH_TOKEN);
  await verifyEvidence(client);
  if (mode === 'verify') {await storage.stage(await client.download(), stagingPath); return 'PUBLISH_VERIFIED';}
  const local = await storage.inspect(stagingPath);
  ensure(JSON.stringify(local) === JSON.stringify(expectedAssets()), 'PUBLISH_LOCAL_BYTES');
  const tagPath = '/git/ref/tags/' + PINNED.tag;
  validateTag(await client.api(tagPath, {allow404: true}), true);
  const release = await findRelease(client);
  ensure(release !== null, 'PUBLISH_PREREQUISITE');
  const assets = await client.api(`/releases/${release.id}/assets?per_page=100`);
  validateAssets(assets);
  const missing = expectedAssets().filter(item => !assets.some(asset => asset.name === item.name));
  if (missing.length === 0) return 'PUBLISH_ALREADY_PUBLISHED';
  ensure(release.immutable !== true, 'PUBLISH_IMMUTABLE');
  // Snapshot and verify every missing body before any public upload. The API
  // cannot create/update this release; its tag and metadata are prerequisites.
  const bodies = new Map();
  for (const item of missing) bodies.set(item.name, await storage.open(item.name, stagingPath));
  const before = await client.api('/releases/' + release.id); validateRelease(before); ensure(before.id === release.id, 'PUBLISH_CONFLICT'); ensure(before.immutable !== true, 'PUBLISH_IMMUTABLE');
  validateTag(await client.api(tagPath, {allow404: true}), true);
  const currentAssets = await client.api(`/releases/${release.id}/assets?per_page=100`); validateAssets(currentAssets);
  ensure(JSON.stringify(currentAssets.map(asset => [asset.id, asset.name, asset.size, asset.digest]).sort()) ===
    JSON.stringify(assets.map(asset => [asset.id, asset.name, asset.size, asset.digest]).sort()), 'PUBLISH_CONFLICT');
  // Only these two fixed upload endpoints can mutate remote state.
  for (const item of missing) {
    const uploaded = await client.upload(release.id, item, bodies.get(item.name));
    validateAssets([uploaded]); ensure(uploaded.name === item.name, 'PUBLISH_CONFLICT');
    bodies.delete(item.name);
  }
  const after = await client.api('/releases/' + release.id); validateRelease(after); ensure(after.id === release.id, 'PUBLISH_CONFLICT');
  validateAssets(await client.api(`/releases/${release.id}/assets?per_page=100`), true);
  validateTag(await client.api(tagPath, {allow404: true}), true);
  return 'PUBLISH_PUBLISHED';
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  runPublisher(process.argv.slice(2)).then(code => console.log(code)).catch(error => {console.error(failureCode(error)); process.exitCode = 1;});
}
