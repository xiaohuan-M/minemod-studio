import { AssetStore } from './storage/asset-store.mjs';
import { WorkspaceStore } from './storage/workspace-store.mjs';
import { BuildManager } from './runner/manager.mjs';
import { AppError } from './core/errors.mjs';
import { zipFiles } from './core/archive.mjs';
import { pngTexture, exportBlockbench } from './core/assets.mjs';

export function workshopServices(dataDir, store) {
  const assets = new AssetStore(dataDir),
    workspaces = new WorkspaceStore(dataDir, assets),
    builds = new BuildManager(dataDir, workspaces);
  async function route({ request, response, url, json, body, fields, publicProject }) {
    const path = url.pathname,
      method = request.method;
    const send = (bytes, type, name) => {
      response.writeHead(200, {
        'Content-Type': type,
        ...(name ? { 'Content-Disposition': 'attachment; filename="' + name + '"' } : {}),
      });
      response.end(bytes);
    };
    if (path === '/api/assets') {
      if (method === 'GET') json(response, 200, { assets: assets.list() });
      else if (method === 'POST')
        json(response, 201, assets.create(await body(request, 1024 * 1024)));
      else return false;
      return true;
    }
    let match = path.match(/^\/api\/assets\/([^/]+)(?:\/(png|bbmodel))?$/);
    if (match && method === 'GET') {
      const asset = assets.get(match[1]);
      if (!match[2]) json(response, 200, asset);
      else if (match[2] === 'png' && asset.kind === 'texture')
        send(pngTexture(asset.data), 'image/png', 'texture-' + asset.id + '.png');
      else if (match[2] === 'bbmodel' && asset.kind === 'model')
        send(
          JSON.stringify(exportBlockbench(asset.data, asset.name), null, 2),
          'application/json',
          'model-' + asset.id + '.bbmodel',
        );
      else throw new AppError(400, 'ASSET_TYPE', '资源类型不匹配。');
      return true;
    }
    if (path === '/api/builder' && method === 'GET') {
      json(response, 200, await builds.status());
      return true;
    }
    if (path === '/api/builder/prepare' && method === 'POST') {
      const input = fields(await body(request), ['allowNetwork']);
      json(response, 202, await builds.prepare(input.allowNetwork));
      return true;
    }
    match = path.match(/^\/api\/builds\/([^/]+)(?:\/(cancel|jar|report|bundle))?$/);
    if (match) {
      const record = builds.get(match[1]);
      if (!match[2] && method === 'GET') json(response, 200, record);
      else if (match[2] === 'cancel' && method === 'POST') {
        fields(await body(request), []);
        json(response, 200, await builds.cancel(record.id));
      } else if (match[2] === 'jar' && method === 'GET') {
        const artifact = builds.artifact(record.id);
        send(artifact.bytes, 'application/java-archive', artifact.record.artifact.name);
      } else if (match[2] === 'report' && method === 'GET')
        send(JSON.stringify(record, null, 2), 'application/json', 'build-' + record.id + '.json');
      else if (match[2] === 'bundle' && method === 'GET') {
        const artifact = builds.artifact(record.id);
        const files = workspaces.files(record.projectId, record.snapshotHash);
        const bundle = Object.fromEntries(
          Object.entries(files).map(([path, bytes]) => ['source/' + path, bytes]),
        );
        bundle[artifact.record.artifact.name] = artifact.bytes;
        bundle['BUILD-REPORT.json'] = Buffer.from(JSON.stringify(record, null, 2));
        bundle['INSTALL.md'] = Buffer.from(
          '安装匹配的 Fabric Loader 1.21.1 和 Fabric API。把同目录的模组 JAR 放入独立测试实例 mods 目录。\n使用创造模式中的自定义标签页检查物品、工具、方块、合成、掉落和右键行为。编译通过不等于游戏实测通过。\n',
        );
        send(zipFiles(bundle), 'application/zip', 'delivery-' + record.id + '.zip');
      } else return false;
      return true;
    }
    match = path.match(
      /^\/api\/projects\/([^/]+)\/(workspaces|builds|clone|import)(?:\/([^/]+))?(?:\/(file|source|approve))?$/,
    );
    if (!match) return false;
    const [, id, section, hash, action] = match;
    const project = store.get(id);
    if (section === 'clone' && method === 'POST' && !hash) {
      fields(await body(request), []);
      let copy = store.create({
        name: project.name.slice(0, 75) + ' 副本',
        prompt: project.prompt,
      });
      if (project.spec)
        copy = store.setSpec(copy.id, project.spec, copy.revision, {
          provider: 'manual',
          demo: false,
        });
      json(response, 201, publicProject(copy));
      return true;
    }
    if (section === 'import' && method === 'POST' && !hash) {
      const input = fields(await body(request), ['revision', 'spec']);
      json(response, 200, publicProject(store.setSpec(id, input.spec, input.revision)));
      return true;
    }
    if (section === 'builds' && !hash) {
      if (method === 'GET') json(response, 200, { builds: builds.list(id) });
      else if (method === 'POST') {
        const input = fields(await body(request), ['revision', 'snapshotHash', 'allowNetwork']);
        store.assertRevision(project, input.revision);
        if (
          !input.snapshotHash ||
          project.workspaceHash !== input.snapshotHash ||
          project.approvedWorkspaceHash !== input.snapshotHash
        )
          throw new AppError(409, 'BUILD_APPROVAL_REQUIRED', '请审查并批准当前工程快照。');
        json(
          response,
          202,
          await builds.start(id, input.snapshotHash, {
            approval: project.approvedWorkspaceHash,
            allowNetwork: input.allowNetwork,
          }),
        );
      } else return false;
      return true;
    }
    if (section !== 'workspaces') return false;
    if (!hash) {
      if (method === 'GET') json(response, 200, { workspaces: workspaces.list(id) });
      else if (method === 'POST') {
        const input = fields(await body(request), ['revision']);
        store.assertRevision(project, input.revision);
        const snapshot = workspaces.generate(project);
        const updated = store.attachWorkspace(id, snapshot, input.revision);
        json(response, 201, {
          project: publicProject(updated),
          workspace: workspaces.summary(snapshot),
        });
      } else return false;
      return true;
    }
    const snapshot = workspaces.get(id, hash);
    if (!action && method === 'GET') json(response, 200, workspaces.summary(snapshot));
    else if (action === 'approve' && method === 'POST') {
      const input = fields(await body(request), ['revision']);
      json(response, 200, publicProject(store.approveWorkspace(id, hash, input.revision)));
    } else if (action === 'source' && method === 'GET')
      send(zipFiles(workspaces.files(id, hash)), 'application/zip', snapshot.modId + '-source.zip');
    else if (action === 'file' && method === 'GET') {
      const file = snapshot.files.find((file) => file.path === url.searchParams.get('path'));
      if (!file) throw new AppError(404, 'FILE_NOT_FOUND', '此快照没有该文件。');
      if (/\.(jar|png)$/.test(file.path))
        throw new AppError(400, 'BINARY_FILE', '二进制文件请通过源码 ZIP 下载。');
      json(response, 200, {
        path: file.path,
        sha256: file.sha256,
        content: Buffer.from(file.content, 'base64').toString('utf8'),
      });
    } else return false;
    return true;
  }
  return { route, builds, assets, workspaces };
}
