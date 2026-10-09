import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';

function renderNotice(mode,component='DeploymentNotice'){
 const script=`
  import React from 'react';
  import {renderToStaticMarkup} from 'react-dom/server';
  import {DeploymentNotice} from './apps/web/src/components/deployment-notice.tsx';
  import {InstallAccessNote} from './apps/web/src/components/install-access-note.tsx';
  process.stdout.write(renderToStaticMarkup(React.createElement(${component},{mode:${JSON.stringify(mode)}})));
 `;
 const result=spawnSync(process.execPath,['--import','tsx','--input-type=module','-e',script],{encoding:'utf8'});
 assert.equal(result.status,0,result.stderr);
 return result.stdout;
}

test('SSH notice identifies formal data and states each transport boundary',()=>{
 const html=renderNotice('ssh-only');
 assert.match(html,/仅 SSH 访问 · 正式账号与数据/);
 assert.match(html,/电脑到服务器的传输由 SSH 隧道加密/);
 assert.match(html,/本机 HTTP 不保护你免受本机恶意进程影响/);
 assert.match(html,/localhost 的 Cookie 不按端口隔离/);
 assert.match(html,/<details>/);
 assert.match(html,/role="note"/);
 assert.doesNotMatch(html,/测试|演示/);
});
test('HTTPS and unknown profiles never assert that an SSH tunnel is in use',()=>{
 assert.equal(renderNotice('https'),'');
 assert.equal(renderNotice(undefined),'');
});
test('SSH installation guidance describes browser support and a separate tunnel on each device',()=>{
 const html=renderNotice('ssh-only','InstallAccessNote');
 assert.match(html,/取决于浏览器对 localhost 的支持/);
 assert.match(html,/每台设备都需要自己的 SSH 隧道/);
 assert.match(html,/电脑的 localhost 地址不能直接用于手机访问/);
 assert.match(html,/保存书签/);
 assert.doesNotMatch(html,/需要 HTTPS 网站/);
});
test('HTTPS installation guidance keeps its secure-site requirement',()=>{
 assert.match(renderNotice('https','InstallAccessNote'),/需要 HTTPS 网站和支持的浏览器/);
 assert.doesNotMatch(renderNotice('https','InstallAccessNote'),/SSH|localhost/);
});
