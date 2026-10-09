import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {Readable} from 'node:stream';
import {spawnSync} from 'node:child_process';
import {mkdtemp, mkdir, writeFile, readFile, readdir, rm, symlink} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';

const implementation = () => import('../scripts/publish-shared-5028f27.mjs');
const env = {GITHUB_ACTIONS: 'true', GITHUB_REPOSITORY: '9theresa9/star-oracle', GITHUB_EVENT_NAME: 'push', GITHUB_REF: 'refs/heads/feat/luminous-oracle-experience', RUNNER_TEMP: '/tmp/publisher-fixture', GH_TOKEN: 'ghs_fixture_only'};
const digest = value => createHash('sha256').update(value).digest('hex');
const rejectsCode = (action, code) => assert.rejects(action, error => error.message === code);

function evidence(p) {
  return {
    repository: {id: p.repositoryId, full_name: p.repository, private: false},
    commit: {sha: p.sourceSha, tree: {sha: p.sourceTree}},
    runs: p.runs.map(run => ({id: run.id, workflow_id: run.workflowId, status: 'completed', conclusion: 'success', event: 'pull_request', head_sha: p.sourceSha, head_branch: p.branch, head_repository: {id: p.repositoryId, full_name: p.repository}, repository: {id: p.repositoryId, full_name: p.repository}})),
    artifact: {id: p.artifactId, name: p.artifactName, size_in_bytes: p.archiveSize, digest: 'sha256:' + p.archiveSha256, expired: false, workflow_run: {id: p.runs[1].id, head_sha: p.sourceSha, head_repository_id: p.repositoryId, repository_id: p.repositoryId, head_branch: p.branch}},
  };
}

function release(p, extra = {}) {
  return {id: 42, tag_name: p.tag, target_commitish: p.sourceSha, name: p.title, body: p.body, draft: false, prerelease: true, ...extra};
}
function asset(p, name = p.archiveName, extra = {}) {
  const checksum = name === p.checksumName;
  return {id: checksum ? 102 : 101, name, state: 'uploaded', size: checksum ? Buffer.byteLength(p.checksum) : p.archiveSize, digest: 'sha256:' + (checksum ? digest(p.checksum) : p.archiveSha256), ...extra};
}

function transport(p, options = {}) {
  const facts = evidence(p), calls = [], writes = [];
  let currentRelease = Object.hasOwn(options, 'release') ? options.release : release(p), assets = options.assets ?? [], tag = Object.hasOwn(options, 'tag') ? options.tag : {ref: 'refs/tags/' + p.tag, object: {type: 'commit', sha: p.sourceSha}};
  const response = (value, status = 200) => new Response(JSON.stringify(value), {status, headers: {'content-type': 'application/json'}});
  const fetch = async (url, init = {}) => {
    const target = new URL(url), method = init.method ?? 'GET';
    calls.push({url: String(url), method, headers: init.headers, body: init.body});
    if (method !== 'GET') writes.push({url: String(url), method, body: init.body});
    assert.equal(init.redirect, 'manual');
    if (options.failRequest?.(target, method)) throw new Error('PRIVATE_TOKEN_OR_RESPONSE');
    const prefix = '/repos/' + p.repository, path = target.pathname;
    if (target.hostname === 'api.github.com') {
      assert.equal(init.headers.Authorization, 'Bearer ' + env.GH_TOKEN);
      if (method === 'GET' && path === prefix) return response(facts.repository);
      if (method === 'GET' && path === prefix + '/git/commits/' + p.sourceSha) return response(facts.commit);
      for (let i = 0; i < p.runs.length; i++) if (path === prefix + '/actions/runs/' + p.runs[i].id) return response(facts.runs[i]);
      if (path === prefix + '/actions/artifacts/' + p.artifactId) return response(facts.artifact);
      if (path === prefix + '/actions/artifacts/' + p.artifactId + '/zip') return new Response(null, {status: 302, headers: {location: options.redirect ?? 'https://fixture.blob.core.windows.net/archive?sig=PRIVATE_SIGNED_URL'}});
      if (path === prefix + '/git/ref/tags/' + p.tag) return tag ? response(tag) : response({}, 404);
      if (method === 'GET' && path === prefix + '/releases') return response(currentRelease ? [currentRelease] : []);
      if (path === prefix + '/releases/42/assets') return response(assets);
      if (method === 'GET' && path === prefix + '/releases/42') return response(currentRelease);
    }
    if (target.hostname === 'uploads.github.com' && method === 'POST' && path === prefix + '/releases/42/assets') {
      assert.equal(init.headers.Authorization, 'Bearer ' + env.GH_TOKEN);
      assert.ok(Buffer.isBuffer(init.body));
      const name = target.searchParams.get('name');
      if (options.interruptName === name) throw new Error('PRIVATE_UPLOAD_FAILURE');
      const uploaded = asset(p, name, options.uploadMutation ?? {});
      assets.push(uploaded);
      return response(uploaded, 201);
    }
    if (target.hostname === 'fixture.blob.core.windows.net') {
      assert.equal(init.headers?.Authorization, undefined);
      return options.signedResponse ? options.signedResponse() : new Response(options.archiveBytes ?? 'synthetic downloaded stream');
    }
    throw new Error('UNEXPECTED_FIXTURE_REQUEST');
  };
  return {fetch, facts, calls, writes, get assets() {return assets;}, get currentRelease() {return currentRelease;}};
}

function storage(p, options = {}) {
  const events = [];
  return {events,
    async stage(body, path) {events.push('stage'); assert.ok(body); assert.equal(path, join(env.RUNNER_TEMP, 'star-oracle-publish-5028f27')); if (options.corrupt) throw new Error('PUBLISH_LOCAL_BYTES');},
    async inspect(path) {events.push('inspect'); assert.equal(path, join(env.RUNNER_TEMP, 'star-oracle-publish-5028f27')); if (options.corrupt) throw new Error('PUBLISH_LOCAL_BYTES'); return [{name: p.archiveName, size: p.archiveSize, sha256: p.archiveSha256}, {name: p.checksumName, size: Buffer.byteLength(p.checksum), sha256: digest(p.checksum)}];},
    async open(name) {events.push('open:' + name); return Buffer.from('synthetic upload body');},
  };
}

test('execution accepts only the fixed workflow context and verify or publish', async () => {
  const api = await implementation();
  assert.equal(api.validateExecution(['verify'], env).mode, 'verify');
  assert.equal(api.validateExecution(['verify'], {...env, GH_TOKEN: 'opaque-workflow-token'}).mode, 'verify');
  assert.equal(api.validateExecution(['publish'], env).stagingPath, '/tmp/publisher-fixture/star-oracle-publish-5028f27');
  for (const args of [[], ['other'], ['publish', '--repo=other'], ['verify', 'publish']]) assert.throws(() => api.validateExecution(args, env), /PUBLISH_CONTEXT/);
  for (const changed of [{GITHUB_ACTIONS: 'false'}, {GITHUB_REPOSITORY: 'foreign/repo'}, {GITHUB_EVENT_NAME: 'pull_request'}, {GITHUB_REF: 'refs/heads/main'}, {GH_TOKEN: ''}, {GH_TOKEN: 'ghs_x\nPRIVATE'}, {RUNNER_TEMP: 'relative'}]) assert.throws(() => api.validateExecution(['publish'], {...env, ...changed}), /PUBLISH_CONTEXT/);
});

test('source, both successful original workflow runs, and the artifact must match every pin', async () => {
  const api = await implementation(), p = api.PINNED, original = evidence(p);
  assert.doesNotThrow(() => api.validateEvidence(original));
  const mutations = [f => f.repository.id++, f => f.repository.private = true, f => delete f.repository.private, f => f.repository.full_name = 'foreign/repo', f => f.commit.sha = 'f'.repeat(40), f => f.commit.tree.sha = 'e'.repeat(40), f => f.runs[0].id++, f => f.runs[0].workflow_id++, f => f.runs[1].head_repository.id++, f => f.runs[0].head_sha = 'f'.repeat(40), f => f.runs[1].event = 'push', f => f.runs[0].status = 'in_progress', f => f.runs[1].conclusion = 'failure', f => f.runs.pop(), f => f.artifact.id++, f => f.artifact.size_in_bytes++, f => f.artifact.digest = 'sha256:' + '0'.repeat(64), f => f.artifact.expired = true, f => f.artifact.name += '-other', f => f.artifact.workflow_run.id++, f => f.artifact.workflow_run.head_repository_id++, f => f.artifact.workflow_run.head_sha = 'f'.repeat(40)];
  for (const mutate of mutations) {const changed = structuredClone(original); mutate(changed); assert.throws(() => api.validateEvidence(changed), /PUBLISH_EVIDENCE/);}
});

test('bounded stream hashing rejects corrupt, truncated, and oversized archive bytes', async () => {
  const api = await implementation(), bytes = Buffer.from('fixed fixture archive');
  assert.deepEqual(await api.hashBytes(Readable.from([bytes]), bytes.length), {size: bytes.length, sha256: digest(bytes)});
  await rejectsCode(() => api.hashBytes(Readable.from([bytes]), bytes.length - 1), 'PUBLISH_LOCAL_BYTES');
  await rejectsCode(() => api.assertBytes(Readable.from([bytes]), {size: bytes.length, sha256: '0'.repeat(64)}), 'PUBLISH_LOCAL_BYTES');
  await rejectsCode(() => api.assertBytes(Readable.from([bytes.subarray(1)]), {size: bytes.length, sha256: digest(bytes)}), 'PUBLISH_LOCAL_BYTES');
});

test('verify checks remote evidence before staging and strips credentials from signed downloads', async () => {
  const api = await implementation(), p = api.PINNED, remote = transport(p), local = storage(p);
  await api.runPublisher(['verify'], {env, fetch: remote.fetch, storage: local});
  assert.deepEqual(local.events, ['stage']);
  assert.equal(remote.writes.length, 0);
  assert.equal(remote.calls.at(-1).headers?.Authorization, undefined);
  assert.ok(remote.calls.findIndex(c => c.url.endsWith('/actions/artifacts/' + p.artifactId)) < remote.calls.findIndex(c => c.url.includes('/zip')));
});

test('verify refuses insecure, credential-bearing, local, foreign, or recursive artifact redirects', async () => {
  const api = await implementation(), p = api.PINNED;
  for (const redirect of ['http://fixture.blob.core.windows.net/zip', 'https://user:pass@fixture.blob.core.windows.net/zip', 'https://evil.invalid/archive', 'https://127.0.0.1/archive', 'https://api.github.com/private', 'https://fixture.blob.core.windows.net:8443/archive']) {
    const remote = transport(p, {redirect}), local = storage(p);
    await rejectsCode(() => api.runPublisher(['verify'], {env, fetch: remote.fetch, storage: local}), 'PUBLISH_DOWNLOAD');
    assert.equal(local.events.length, 0);
    assert.equal(remote.calls.filter(c => !c.url.startsWith('https://api.github.com/')).length, 0);
  }
});

test('publish fails before any mutation when evidence or staged bytes are invalid', async () => {
  const api = await implementation(), p = api.PINNED;
  for (const kind of ['evidence', 'local']) {
    const remote = transport(p), local = storage(p, {corrupt: kind === 'local'});
    if (kind === 'evidence') remote.facts.runs[1].conclusion = 'failure';
    await assert.rejects(() => api.runPublisher(['publish'], {env, fetch: remote.fetch, storage: local}));
    assert.equal(remote.writes.length, 0);
  }
});

test('publish uploads exactly two pinned assets into an existing published prerelease', async () => {
  const api = await implementation(), p = api.PINNED, remote = transport(p), local = storage(p);
  await api.runPublisher(['publish'], {env, fetch: remote.fetch, storage: local});
  assert.deepEqual(remote.writes.map(w => w.method), ['POST', 'POST']);
  assert.ok(remote.writes.every(w => new URL(w.url).hostname === 'uploads.github.com'));
  assert.deepEqual(remote.assets.map(a => a.name), [p.archiveName, p.checksumName]);
  assert.equal(local.events[0], 'inspect');
  assert.ok(remote.calls.slice(0, remote.calls.findIndex(c => c.method === 'POST')).some(c => c.url.includes('/git/ref/tags/')));
  assert.ok(remote.calls.at(-1).url.includes('/git/ref/tags/'));
});

test('missing published prerelease or fixed tag is a read-only prerequisite failure', async () => {
  const api = await implementation(), p = api.PINNED;
  for (const options of [{release: null}, {tag: null}, {release: release(p, {draft: true})}]) {
    const remote = transport(p, options);
    await rejectsCode(() => api.runPublisher(['publish'], {env, fetch: remote.fetch, storage: storage(p)}), 'PUBLISH_PREREQUISITE');
    assert.equal(remote.writes.length, 0);
  }
});

test('a matching partial upload resumes only its missing asset', async () => {
  const api = await implementation(), p = api.PINNED, remote = transport(p, {assets: [asset(p)]});
  await api.runPublisher(['publish'], {env, fetch: remote.fetch, storage: storage(p)});
  assert.deepEqual(remote.writes.map(w => w.method), ['POST']);
  assert.ok(remote.writes[0].url.includes(encodeURIComponent(p.checksumName)));
});

test('upload interruption never mutates release metadata or tag', async () => {
  const api = await implementation(), p = api.PINNED, remote = transport(p, {interruptName: p.checksumName});
  await rejectsCode(() => api.runPublisher(['publish'], {env, fetch: remote.fetch, storage: storage(p)}), 'PUBLISH_NETWORK');
  assert.ok(remote.writes.every(w => w.method === 'POST' && new URL(w.url).hostname === 'uploads.github.com'));
  assert.deepEqual(remote.assets.map(a => a.name), [p.archiveName]);
});

test('tag commit is authoritative when UI target_commitish names the fixed branch', async () => {
  const api = await implementation(), p = api.PINNED;
  const remote = transport(p, {release: release(p, {target_commitish: p.branch, body: '\r\n' + p.body.replaceAll('\n', '\r\n') + '\r\n'})});
  await api.runPublisher(['publish'], {env, fetch: remote.fetch, storage: storage(p)});
  assert.equal(remote.writes.length, 2);
});

test('a fully matching published prerelease is read-only and idempotent', async () => {
  const api = await implementation(), p = api.PINNED, remote = transport(p, {release: release(p, {draft: false}), assets: [asset(p), asset(p, p.checksumName)], tag: {ref: 'refs/tags/' + p.tag, object: {type: 'commit', sha: p.sourceSha}}});
  await api.runPublisher(['publish'], {env, fetch: remote.fetch, storage: storage(p)});
  assert.equal(remote.writes.length, 0);
});

test('conflicting tags, release metadata, and assets are refused without writes', async () => {
  const api = await implementation(), p = api.PINNED;
  const conflicts = [{tag: {ref: 'refs/tags/' + p.tag, object: {type: 'commit', sha: 'f'.repeat(40)}}}, {tag: {ref: 'refs/tags/' + p.tag, object: {type: 'tag', sha: p.sourceSha}}}, {release: release(p, {body: 'different'})}, {release: release(p, {prerelease: false})}, {release: release(p), assets: [asset(p, 'private.env')]}, {release: release(p), assets: [asset(p, p.archiveName, {size: 1})]}, {release: release(p), assets: [asset(p, p.archiveName, {digest: null})]}, {release: release(p), assets: [asset(p), asset(p)]}];
  for (const options of conflicts) {
    const remote = transport(p, options);
    await assert.rejects(() => api.runPublisher(['publish'], {env, fetch: remote.fetch, storage: storage(p)}));
    assert.equal(remote.writes.length, 0);
  }
});

test('remote digest or size mismatch stops any further upload', async () => {
  const api = await implementation(), p = api.PINNED;
  for (const uploadMutation of [{digest: 'sha256:' + '0'.repeat(64)}, {size: 1}, {state: 'starter'}]) {
    const remote = transport(p, {uploadMutation});
    await assert.rejects(() => api.runPublisher(['publish'], {env, fetch: remote.fetch, storage: storage(p)}));
    assert.equal(remote.writes.length, 1);
  }
});

test('storage creates only pinned filenames in a fresh stage and rejects filesystem substitution', async t => {
  const api = await implementation(), p = api.PINNED, root = await mkdtemp(join(tmpdir(), 'fixed-publisher-'));
  t.after(() => rm(root, {recursive: true, force: true}));
  const path = join(root, 'star-oracle-publish-5028f27');
  await mkdir(path);
  await assert.rejects(() => api.createLocalStorage().stage(Readable.from(['x']), path));
  await writeFile(join(path, p.archiveName), 'damaged'); await writeFile(join(path, p.checksumName), p.checksum);
  await rejectsCode(() => api.createLocalStorage().inspect(path), 'PUBLISH_LOCAL_BYTES');
  await rm(join(path, p.archiveName)); await symlink(join(path, p.checksumName), join(path, p.archiveName));
  await rejectsCode(() => api.createLocalStorage().inspect(path), 'PUBLISH_LOCAL_BYTES');
  await rm(path, {recursive: true}); await symlink(root, path);
  await rejectsCode(() => api.createLocalStorage().inspect(path), 'PUBLISH_LOCAL_BYTES');
  const fresh = join(root, 'fresh');
  await rejectsCode(() => api.createLocalStorage().stage(Readable.from(['damaged']), fresh), 'PUBLISH_LOCAL_BYTES');
  assert.deepEqual(await readdir(fresh), [p.archiveName]);
});

test('failure reporting emits only enumerated codes and never arbitrary error text', async () => {
  const api = await implementation();
  for (const error of [null, 'PRIVATE_TOKEN', new Error('PRIVATE_TOKEN'), new Error('PUBLISH_NETWORK\nPRIVATE_TOKEN'), {message: 'PUBLISH_NETWORK'}, new Error('PUBLISH_UNRECOGNIZED')]) assert.equal(api.failureCode(error), 'PUBLISH_FAILED');
  assert.equal(api.failureCode(new Error('PUBLISH_NETWORK')), 'PUBLISH_NETWORK');
});

test('same-size checksum substitution after inspection is rejected before any upload', async t => {
  const api = await implementation(), p = api.PINNED, root = await mkdtemp(join(tmpdir(), 'publisher-substitution-'));
  t.after(() => rm(root, {recursive: true, force: true}));
  const path = join(root, 'star-oracle-publish-5028f27'); await mkdir(path);
  const checksumPath = join(path, p.checksumName); await writeFile(checksumPath, p.checksum);
  const remote = transport(p, {assets: [asset(p)]}), fake = storage(p), real = api.createLocalStorage();
  const local = {
    async inspect() {assert.equal(await readFile(checksumPath, 'utf8'), p.checksum); await writeFile(checksumPath, '0' + p.checksum.slice(1)); return fake.inspect('/tmp/publisher-fixture/star-oracle-publish-5028f27');},
    open(name, stage) {return real.open(name, stage);},
  };
  await rejectsCode(() => api.runPublisher(['publish'], {env: {...env, RUNNER_TEMP: root}, fetch: remote.fetch, storage: local}), 'PUBLISH_LOCAL_BYTES');
  assert.equal(remote.writes.length, 0);
});

test('both missing upload bodies are prepared before the first POST', async () => {
  const api = await implementation(), p = api.PINNED, remote = transport(p), local = storage(p);
  const originalOpen = local.open;
  local.open = async name => {if (name === p.checksumName) throw new Error('PUBLISH_LOCAL_BYTES'); return originalOpen(name);};
  await rejectsCode(() => api.runPublisher(['publish'], {env, fetch: remote.fetch, storage: local}), 'PUBLISH_LOCAL_BYTES');
  assert.equal(remote.writes.length, 0);
});


test('an immutable prerelease cannot receive missing assets, but completed uploads remain read-only', async () => {
  const api = await implementation(), p = api.PINNED;
  const blocked = transport(p, {release: release(p, {immutable: true})});
  await rejectsCode(() => api.runPublisher(['publish'], {env, fetch: blocked.fetch, storage: storage(p)}), 'PUBLISH_IMMUTABLE');
  assert.equal(blocked.writes.length, 0);
  const complete = transport(p, {release: release(p, {immutable: true}), assets: [asset(p), asset(p, p.checksumName)]});
  await api.runPublisher(['publish'], {env, fetch: complete.fetch, storage: storage(p)});
  assert.equal(complete.writes.length, 0);
});


test('signed storage cannot redirect again or supply a different declared byte count', async () => {
  const api = await implementation(), p = api.PINNED;
  for (const signedResponse of [() => new Response(null, {status: 302, headers: {location: 'https://evil.invalid/again'}}), () => new Response('x', {headers: {'content-length': '1'}})]) {
    const remote = transport(p, {signedResponse}), local = storage(p);
    await rejectsCode(() => api.runPublisher(['verify'], {env, fetch: remote.fetch, storage: local}), 'PUBLISH_DOWNLOAD');
    assert.equal(local.events.length, 0);
    assert.equal(remote.calls.filter(call => call.url.includes('evil.invalid')).length, 0);
    assert.equal(remote.calls.at(-1).headers?.Authorization, undefined);
  }
});

test('CLI emits one sanitized code and refuses arbitrary arguments before any network call', () => {
  const result = spawnSync(process.execPath, ['scripts/publish-shared-5028f27.mjs', 'publish', 'PRIVATE_SENTINEL'], {encoding: 'utf8', env: {...env, GH_TOKEN: 'PRIVATE_TOKEN_SENTINEL'}});
  assert.equal(result.status, 1);
  assert.equal(result.stdout, '');
  assert.equal(result.stderr, 'PUBLISH_CONTEXT\n');
});
